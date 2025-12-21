// ═══════════════════════════════════════════════════════════════════════════════
// SHUTDOWN HOOKS — Shutdown Hook Registry
// NovaOS Infrastructure — Phase 4
// ═══════════════════════════════════════════════════════════════════════════════
//
// Registry for shutdown hooks that need to run during graceful shutdown:
// - Prioritized execution (higher priority runs first)
// - Timeout enforcement per hook
// - Error isolation (one hook failure doesn't stop others)
//
// ═══════════════════════════════════════════════════════════════════════════════

import { getLogger } from '../../observability/logging/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Shutdown hook priority levels.
 * Higher numbers run first.
 */
export type ShutdownPriority = 
  | 'critical'    // 100 - Must run first (stop accepting requests)
  | 'high'        // 75  - Important cleanup (close connections)
  | 'normal'      // 50  - Standard cleanup
  | 'low'         // 25  - Nice-to-have cleanup
  | 'background'; // 0   - Best-effort cleanup

/**
 * Priority numeric values.
 */
export const PRIORITY_VALUES: Record<ShutdownPriority, number> = {
  critical: 100,
  high: 75,
  normal: 50,
  low: 25,
  background: 0,
};

/**
 * Shutdown hook function.
 */
export type ShutdownHookFn = () => Promise<void> | void;

/**
 * Shutdown hook registration.
 */
export interface ShutdownHook {
  /** Unique name for the hook */
  readonly name: string;
  
  /** Hook function */
  readonly fn: ShutdownHookFn;
  
  /** Priority level */
  readonly priority: ShutdownPriority;
  
  /** Timeout in ms (0 = use default) */
  readonly timeoutMs: number;
  
  /** Whether hook is enabled */
  enabled: boolean;
}

/**
 * Hook execution result.
 */
export interface HookResult {
  readonly name: string;
  readonly success: boolean;
  readonly durationMs: number;
  readonly error?: Error;
  readonly timedOut?: boolean;
}

/**
 * Shutdown result.
 */
export interface ShutdownResult {
  readonly success: boolean;
  readonly totalDurationMs: number;
  readonly hooks: HookResult[];
  readonly failed: string[];
  readonly timedOut: string[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// HOOKS REGISTRY
// ─────────────────────────────────────────────────────────────────────────────────

const hooks = new Map<string, ShutdownHook>();
const logger = getLogger({ component: 'shutdown' });

let defaultTimeoutMs = 5000;
let isShuttingDown = false;

/**
 * Configure default timeout for hooks.
 */
export function setDefaultHookTimeout(timeoutMs: number): void {
  defaultTimeoutMs = timeoutMs;
}

/**
 * Check if shutdown is in progress.
 */
export function isShutdownInProgress(): boolean {
  return isShuttingDown;
}

/**
 * Register a shutdown hook.
 */
export function registerShutdownHook(
  name: string,
  fn: ShutdownHookFn,
  options?: {
    priority?: ShutdownPriority;
    timeoutMs?: number;
    enabled?: boolean;
  }
): void {
  if (hooks.has(name)) {
    logger.warn('Overwriting existing shutdown hook', { name });
  }
  
  hooks.set(name, {
    name,
    fn,
    priority: options?.priority ?? 'normal',
    timeoutMs: options?.timeoutMs ?? 0,
    enabled: options?.enabled ?? true,
  });
  
  logger.debug('Registered shutdown hook', {
    name,
    priority: options?.priority ?? 'normal',
  });
}

/**
 * Unregister a shutdown hook.
 */
export function unregisterShutdownHook(name: string): boolean {
  const removed = hooks.delete(name);
  if (removed) {
    logger.debug('Unregistered shutdown hook', { name });
  }
  return removed;
}

/**
 * Enable or disable a hook.
 */
export function setHookEnabled(name: string, enabled: boolean): boolean {
  const hook = hooks.get(name);
  if (hook) {
    hook.enabled = enabled;
    return true;
  }
  return false;
}

/**
 * Get all registered hooks.
 */
export function getRegisteredHooks(): ShutdownHook[] {
  return Array.from(hooks.values());
}

/**
 * Get hooks sorted by priority (highest first).
 */
export function getHooksByPriority(): ShutdownHook[] {
  return getRegisteredHooks()
    .filter(h => h.enabled)
    .sort((a, b) => PRIORITY_VALUES[b.priority] - PRIORITY_VALUES[a.priority]);
}

/**
 * Clear all hooks.
 */
export function clearShutdownHooks(): void {
  hooks.clear();
  logger.debug('Cleared all shutdown hooks');
}

// ─────────────────────────────────────────────────────────────────────────────────
// HOOK EXECUTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Execute a single hook with timeout.
 */
async function executeHook(hook: ShutdownHook): Promise<HookResult> {
  const startTime = Date.now();
  const timeout = hook.timeoutMs > 0 ? hook.timeoutMs : defaultTimeoutMs;
  
  try {
    await Promise.race([
      Promise.resolve(hook.fn()),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Hook timed out')), timeout);
      }),
    ]);
    
    const durationMs = Date.now() - startTime;
    
    logger.debug('Shutdown hook completed', {
      name: hook.name,
      durationMs,
    });
    
    return {
      name: hook.name,
      success: true,
      durationMs,
    };
    
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const isTimeout = error instanceof Error && error.message === 'Hook timed out';
    
    logger.error('Shutdown hook failed', error, {
      name: hook.name,
      durationMs,
      timedOut: isTimeout,
    });
    
    return {
      name: hook.name,
      success: false,
      durationMs,
      error: error instanceof Error ? error : new Error(String(error)),
      timedOut: isTimeout,
    };
  }
}

/**
 * Execute all hooks in priority order.
 */
export async function executeShutdownHooks(): Promise<ShutdownResult> {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress');
    return {
      success: false,
      totalDurationMs: 0,
      hooks: [],
      failed: [],
      timedOut: [],
    };
  }
  
  isShuttingDown = true;
  const startTime = Date.now();
  const sortedHooks = getHooksByPriority();
  const results: HookResult[] = [];
  const failed: string[] = [];
  const timedOut: string[] = [];
  
  logger.info('Executing shutdown hooks', {
    count: sortedHooks.length,
    hooks: sortedHooks.map(h => h.name),
  });
  
  // Group hooks by priority for parallel execution within groups
  const priorityGroups = new Map<ShutdownPriority, ShutdownHook[]>();
  
  for (const hook of sortedHooks) {
    const group = priorityGroups.get(hook.priority) ?? [];
    group.push(hook);
    priorityGroups.set(hook.priority, group);
  }
  
  // Execute groups in priority order (highest first)
  const priorities: ShutdownPriority[] = ['critical', 'high', 'normal', 'low', 'background'];
  
  for (const priority of priorities) {
    const group = priorityGroups.get(priority);
    if (!group || group.length === 0) continue;
    
    logger.debug('Executing priority group', {
      priority,
      count: group.length,
    });
    
    // Execute hooks in this priority group in parallel
    const groupResults = await Promise.all(group.map(executeHook));
    
    for (const result of groupResults) {
      results.push(result);
      if (!result.success) {
        failed.push(result.name);
        if (result.timedOut) {
          timedOut.push(result.name);
        }
      }
    }
  }
  
  const totalDurationMs = Date.now() - startTime;
  const success = failed.length === 0;
  
  logger.info('Shutdown hooks completed', {
    success,
    totalDurationMs,
    total: results.length,
    failed: failed.length,
    timedOut: timedOut.length,
  });
  
  return {
    success,
    totalDurationMs,
    hooks: results,
    failed,
    timedOut,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// COMMON HOOKS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create a hook for closing an HTTP server.
 */
export function createServerCloseHook(
  server: { close: (callback?: (err?: Error) => void) => void },
  name = 'http-server'
): ShutdownHookFn {
  return () => new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Create a hook for disconnecting a client.
 */
export function createDisconnectHook(
  client: { disconnect: () => Promise<void> | void },
  name = 'client'
): ShutdownHookFn {
  return () => Promise.resolve(client.disconnect());
}

/**
 * Create a hook for flushing/closing a logger.
 */
export function createLoggerFlushHook(
  logger: { flush?: () => void; end?: () => void },
  name = 'logger'
): ShutdownHookFn {
  return () => {
    logger.flush?.();
    logger.end?.();
  };
}
