// ═══════════════════════════════════════════════════════════════════════════════
// OPERATIONAL EVENTS — Lens Gate Observability & Alerting
// Phase 8: Integration & Tests
// 
// Emits operational events for monitoring, alerting, and debugging.
// CRITICAL: invalid_state events trigger paging (highest severity).
// 
// INVARIANTS:
// - invalid_state always triggers page alert
// - All events include correlation ID for tracing
// - Events are non-blocking (fire-and-forget)
// ═══════════════════════════════════════════════════════════════════════════════

import type { LensGateResult, LensMode } from '../types/lens.js';
import type { DataNeedClassification, TruthMode } from '../types/data-need.js';
import type { LiveCategory } from '../types/categories.js';

// ─────────────────────────────────────────────────────────────────────────────────
// EVENT TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Lens gate operational event names.
 */
export type LensEventName =
  | 'lens.request'       // Gate execution started
  | 'lens.success'       // Gate completed successfully
  | 'lens.failure'       // Gate failed (recoverable)
  | 'lens.invalid_state' // CRITICAL: Invalid system state detected
  | 'lens.degraded'      // Operating in degraded mode
  | 'lens.blocked';      // User action required

/**
 * Alert level for operational events.
 */
export type AlertLevel = 'none' | 'warn' | 'page';

/**
 * Outcome classification for events.
 */
export type LensOutcome =
  | 'success'
  | 'degraded'
  | 'blocked'
  | 'failure'
  | 'invalid_state';

/**
 * Complete operational event structure.
 */
export interface LensOperationalEvent {
  /** Event identifier */
  readonly eventName: LensEventName;
  
  /** Unique correlation ID for distributed tracing */
  readonly correlationId: string;
  
  /** Event outcome classification */
  readonly outcome: LensOutcome;
  
  /** Alert level for this event */
  readonly alertLevel: AlertLevel;
  
  /** ISO timestamp */
  readonly timestamp: string;
  
  /** Lens mode at event time */
  readonly mode?: LensMode;
  
  /** Truth mode from classification */
  readonly truthMode?: TruthMode;
  
  /** Categories involved */
  readonly categories?: readonly LiveCategory[];
  
  /** Processing time in milliseconds */
  readonly durationMs?: number;
  
  /** Error message if applicable */
  readonly error?: string;
  
  /** Additional context */
  readonly context?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────────
// INVALID STATE DETECTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Invalid state conditions that trigger paging.
 * These represent impossible states that should never occur.
 */
export interface InvalidStateCondition {
  readonly code: string;
  readonly description: string;
  readonly check: (result: LensGateResult) => boolean;
}

/**
 * Known invalid state conditions.
 * Any of these triggers immediate paging.
 */
export const INVALID_STATE_CONDITIONS: readonly InvalidStateCondition[] = [
  {
    code: 'TIME_QUALITATIVE_FALLBACK',
    description: 'Time category has no qualitative fallback - this should never degrade',
    check: (result) => {
      const hasTime = result.classification.liveCategories.includes('time');
      const isDegraded = result.mode === 'degraded';
      const hasForbidNumeric = !result.numericPrecisionAllowed;
      return hasTime && isDegraded && hasForbidNumeric;
    },
  },
  {
    code: 'LIVE_FEED_NO_FORCE_HIGH',
    description: 'live_feed/mixed truth mode must have forceHigh=true',
    check: (result) => {
      const truthMode = result.classification.truthMode;
      const requiresForceHigh = truthMode === 'live_feed' || truthMode === 'mixed';
      // Check if forceHigh is false when it should be true
      // We use numericPrecisionAllowed as proxy - if true in degraded mode, that's wrong
      return requiresForceHigh && result.mode === 'degraded' && result.numericPrecisionAllowed;
    },
  },
  {
    code: 'BLOCKED_NO_OPTIONS',
    description: 'Blocked mode must provide user options',
    check: (result) => {
      return result.mode === 'blocked' && 
             (!result.userOptions || result.userOptions.length === 0);
    },
  },
  {
    code: 'EVIDENCE_WITHOUT_TOKENS',
    description: 'Evidence pack exists but no numeric tokens extracted',
    check: (result) => {
      const hasEvidence = result.evidence !== null && 
                          result.evidence.contextItems.length > 0;
      const hasTokens = result.evidence?.numericTokens?.tokens?.size ?? 0 > 0;
      const requiresTokens = result.classification.requiresNumericPrecision;
      return hasEvidence && requiresTokens && !hasTokens;
    },
  },
];

/**
 * Check for invalid state conditions.
 * Returns the first matching condition, or null if state is valid.
 */
export function detectInvalidState(result: LensGateResult): InvalidStateCondition | null {
  for (const condition of INVALID_STATE_CONDITIONS) {
    try {
      if (condition.check(result)) {
        return condition;
      }
    } catch {
      // If check throws, skip it (defensive)
      continue;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────────
// ALERT LEVEL DETERMINATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Determine alert level for an event.
 * 
 * INVARIANT: invalid_state always returns 'page'
 */
export function determineAlertLevel(
  eventName: LensEventName,
  outcome: LensOutcome,
  result?: LensGateResult
): AlertLevel {
  // CRITICAL: invalid_state always pages
  if (eventName === 'lens.invalid_state' || outcome === 'invalid_state') {
    return 'page';
  }
  
  // Failures warn by default
  if (eventName === 'lens.failure' || outcome === 'failure') {
    return 'warn';
  }
  
  // Blocked with high-stakes categories warns
  if (eventName === 'lens.blocked' && result) {
    const highStakesCategories: LiveCategory[] = ['market', 'crypto', 'fx'];
    const hasHighStakes = result.classification.liveCategories.some(
      c => highStakesCategories.includes(c)
    );
    if (hasHighStakes) {
      return 'warn';
    }
  }
  
  // Degraded mode for time category warns (should not happen)
  if (outcome === 'degraded' && result) {
    if (result.classification.liveCategories.includes('time')) {
      return 'warn';
    }
  }
  
  return 'none';
}

// ─────────────────────────────────────────────────────────────────────────────────
// EVENT EMITTER
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Event handler function type.
 */
export type EventHandler = (event: LensOperationalEvent) => void | Promise<void>;

/**
 * Pager function type for critical alerts.
 */
export type PagerFunction = (event: LensOperationalEvent, condition?: InvalidStateCondition) => void | Promise<void>;

/**
 * Event emitter configuration.
 */
export interface EventEmitterConfig {
  /** Handler for all events */
  readonly onEvent?: EventHandler;
  
  /** Handler for warn-level events */
  readonly onWarn?: EventHandler;
  
  /** Handler for page-level events (critical) */
  readonly onPage?: PagerFunction;
  
  /** Enable console logging (default: true in development) */
  readonly enableConsoleLog?: boolean;
  
  /** Environment (affects default logging) */
  readonly environment?: 'development' | 'production' | 'test';
}

/**
 * Default configuration.
 */
const DEFAULT_CONFIG: EventEmitterConfig = {
  enableConsoleLog: process.env.NODE_ENV !== 'production',
  environment: (process.env.NODE_ENV as any) ?? 'development',
};

// Global configuration (can be updated via configure())
let globalConfig: EventEmitterConfig = { ...DEFAULT_CONFIG };

/**
 * Configure the event emitter.
 */
export function configure(config: EventEmitterConfig): void {
  globalConfig = { ...DEFAULT_CONFIG, ...config };
}

/**
 * Get current configuration.
 */
export function getConfig(): Readonly<EventEmitterConfig> {
  return globalConfig;
}

// ─────────────────────────────────────────────────────────────────────────────────
// EVENT EMISSION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create a lens operational event.
 */
export function createEvent(
  eventName: LensEventName,
  correlationId: string,
  outcome: LensOutcome,
  options: {
    result?: LensGateResult;
    durationMs?: number;
    error?: string;
    context?: Record<string, unknown>;
  } = {}
): LensOperationalEvent {
  const { result, durationMs, error, context } = options;
  
  return {
    eventName,
    correlationId,
    outcome,
    alertLevel: determineAlertLevel(eventName, outcome, result),
    timestamp: new Date().toISOString(),
    mode: result?.mode,
    truthMode: result?.classification.truthMode,
    categories: result?.classification.liveCategories,
    durationMs,
    error,
    context,
  };
}

/**
 * Emit a lens operational event.
 * 
 * This is fire-and-forget - errors are logged but don't propagate.
 */
export function emitLensEvent(event: LensOperationalEvent): void {
  const config = globalConfig;
  
  // Console logging
  if (config.enableConsoleLog) {
    const prefix = `[LENS:${event.eventName}]`;
    const suffix = `(${event.correlationId})`;
    
    switch (event.alertLevel) {
      case 'page':
        console.error(`🚨 ${prefix} CRITICAL: ${event.outcome} ${suffix}`, event);
        break;
      case 'warn':
        console.warn(`⚠️  ${prefix} ${event.outcome} ${suffix}`, event);
        break;
      default:
        console.log(`ℹ️  ${prefix} ${event.outcome} ${suffix}`);
    }
  }
  
  // Fire handlers asynchronously (non-blocking)
  setImmediate(() => {
    try {
      // General event handler
      if (config.onEvent) {
        Promise.resolve(config.onEvent(event)).catch(err => {
          console.error('[LENS:EVENT] Handler error:', err);
        });
      }
      
      // Warn handler
      if (event.alertLevel === 'warn' && config.onWarn) {
        Promise.resolve(config.onWarn(event)).catch(err => {
          console.error('[LENS:WARN] Handler error:', err);
        });
      }
      
      // Page handler (CRITICAL)
      if (event.alertLevel === 'page' && config.onPage) {
        Promise.resolve(config.onPage(event)).catch(err => {
          console.error('[LENS:PAGE] Handler error:', err);
        });
      }
    } catch (err) {
      console.error('[LENS:EMIT] Unexpected error:', err);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONVENIENCE EMITTERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Emit a lens.request event (gate execution started).
 */
export function emitRequestEvent(
  correlationId: string,
  context?: Record<string, unknown>
): void {
  emitLensEvent(createEvent('lens.request', correlationId, 'success', { context }));
}

/**
 * Emit a lens.success event.
 */
export function emitSuccessEvent(
  correlationId: string,
  result: LensGateResult,
  durationMs: number
): void {
  emitLensEvent(createEvent('lens.success', correlationId, 'success', {
    result,
    durationMs,
  }));
}

/**
 * Emit a lens.failure event.
 */
export function emitFailureEvent(
  correlationId: string,
  error: string,
  durationMs?: number,
  result?: LensGateResult
): void {
  emitLensEvent(createEvent('lens.failure', correlationId, 'failure', {
    result,
    durationMs,
    error,
  }));
}

/**
 * Emit a lens.degraded event.
 */
export function emitDegradedEvent(
  correlationId: string,
  result: LensGateResult,
  durationMs: number,
  reason?: string
): void {
  emitLensEvent(createEvent('lens.degraded', correlationId, 'degraded', {
    result,
    durationMs,
    context: reason ? { reason } : undefined,
  }));
}

/**
 * Emit a lens.blocked event.
 */
export function emitBlockedEvent(
  correlationId: string,
  result: LensGateResult,
  durationMs: number
): void {
  emitLensEvent(createEvent('lens.blocked', correlationId, 'blocked', {
    result,
    durationMs,
  }));
}

/**
 * Emit a lens.invalid_state event.
 * 
 * CRITICAL: This always triggers paging.
 */
export function emitInvalidStateEvent(
  correlationId: string,
  result: LensGateResult,
  condition: InvalidStateCondition,
  durationMs?: number
): void {
  const event = createEvent('lens.invalid_state', correlationId, 'invalid_state', {
    result,
    durationMs,
    error: `${condition.code}: ${condition.description}`,
    context: {
      conditionCode: condition.code,
      conditionDescription: condition.description,
    },
  });
  
  emitLensEvent(event);
  
  // Also call pager directly for immediate notification
  if (globalConfig.onPage) {
    try {
      Promise.resolve(globalConfig.onPage(event, condition)).catch(err => {
        console.error('[LENS:INVALID_STATE] Pager error:', err);
      });
    } catch (err) {
      console.error('[LENS:INVALID_STATE] Pager error:', err);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// RESULT-BASED EMISSION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Emit appropriate event based on Lens gate result.
 * Automatically detects invalid states and triggers paging.
 */
export function emitResultEvent(
  correlationId: string,
  result: LensGateResult,
  durationMs: number
): void {
  // Check for invalid state first (highest priority)
  const invalidState = detectInvalidState(result);
  if (invalidState) {
    emitInvalidStateEvent(correlationId, result, invalidState, durationMs);
    return;
  }
  
  // Emit based on mode
  switch (result.mode) {
    case 'passthrough':
    case 'live_fetch':
    case 'verification':
      emitSuccessEvent(correlationId, result, durationMs);
      break;
    case 'degraded':
      emitDegradedEvent(correlationId, result, durationMs);
      break;
    case 'blocked':
      emitBlockedEvent(correlationId, result, durationMs);
      break;
    default:
      // Unknown mode - treat as success but log warning
      console.warn(`[LENS:EVENT] Unknown mode: ${result.mode}`);
      emitSuccessEvent(correlationId, result, durationMs);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export {
  LensOperationalEvent as OperationalEvent,
  EventEmitterConfig as EmitterConfig,
};
