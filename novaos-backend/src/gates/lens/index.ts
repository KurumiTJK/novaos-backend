// ═══════════════════════════════════════════════════════════════════════════════
// LENS GATE — Live Data Router Entry Point
// Phase 7: Lens Gate
// 
// The Lens gate is responsible for:
// 1. Classifying user queries to determine data needs
// 2. Assessing risk and enforcing forceHigh invariants
// 3. Orchestrating live data fetching from providers
// 4. Building evidence packs with numeric tokens
// 5. Determining response constraints based on failure semantics
// 
// CRITICAL INVARIANTS:
// - live_feed/mixed → forceHigh = true (IMMUTABLE)
// - time + failure → refuse (NO qualitative fallback)
// - All numeric values in model output MUST come from evidence tokens
// 
// USAGE:
// ```typescript
// import { executeLensGate, LensGateResult } from './gates/lens';
// 
// const result = await executeLensGate(state, context);
// if (result.status === 'pass') {
//   // Use result.output.evidence for response generation
// }
// ```
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  PipelineState,
  PipelineContext,
  GateResult,
} from '../../types/index.js';
import type { LensGateResult, LensMode, LensUserOption } from '../../types/lens.js';
import type { DataNeedClassification } from '../../types/data-need.js';
import type { RiskAssessment } from './risk/index.js';

import { createBlockedResult } from '../../types/lens.js';
import { createEmptyEntities } from '../../types/entities.js';
import { orchestrate, orchestrateSync, type OrchestrationOptions } from './orchestration/index.js';
import { validateForceHighInvariant } from './risk/index.js';
import {
  LensTraceBuilder,
  createClassificationTrace,
  createRiskTrace,
  createProviderTrace,
  createResultTrace,
  formatTrace,
  extractMetrics,
  formatMetrics,
  type LensTrace,
} from './telemetry.js';

// ─────────────────────────────────────────────────────────────────────────────────
// GATE ID
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Gate identifier for the Lens gate.
 */
export const LENS_GATE_ID = 'lens' as const;

// ─────────────────────────────────────────────────────────────────────────────────
// GATE CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Configuration options for the Lens gate.
 */
export interface LensGateConfig {
  /** Whether to enable live data fetching (default: true) */
  readonly enableLiveData?: boolean;
  
  /** Whether to force LLM classification (default: false) */
  readonly forceLLMClassification?: boolean;
  
  /** Whether to skip LLM classification (default: false) */
  readonly skipLLMClassification?: boolean;
  
  /** Timeout for provider calls in milliseconds (default: 5000) */
  readonly providerTimeoutMs?: number;
  
  /** Whether to allow parallel provider fetching (default: true) */
  readonly parallelFetch?: boolean;
  
  /** User's timezone for time queries */
  readonly userTimezone?: string;
  
  /** User's location for weather queries */
  readonly userLocation?: string;
  
  /** Whether to enable telemetry tracing (default: true) */
  readonly enableTracing?: boolean;
  
  /** Whether to log trace on completion (default: false) */
  readonly logTrace?: boolean;
}

/**
 * Default configuration for the Lens gate.
 */
const DEFAULT_CONFIG: Required<LensGateConfig> = {
  enableLiveData: true,
  forceLLMClassification: false,
  skipLLMClassification: false,
  providerTimeoutMs: 5000,
  parallelFetch: true,
  userTimezone: 'UTC',
  userLocation: '',
  enableTracing: true,
  logTrace: false,
};

// ─────────────────────────────────────────────────────────────────────────────────
// MAIN GATE EXECUTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Execute the Lens gate.
 * 
 * This is the main entry point for the Lens gate in the 8-gate pipeline.
 * It classifies the user message, assesses risk, fetches live data if needed,
 * and returns a complete LensGateResult with evidence and constraints.
 * 
 * @param state - Current pipeline state
 * @param context - Pipeline context
 * @param config - Optional gate configuration
 * @returns Gate result with LensGateResult output
 * 
 * @example
 * const result = await executeLensGate(state, context);
 * if (result.status === 'pass') {
 *   const { evidence, constraints, mode } = result.output;
 *   // Use evidence for response generation
 * }
 */
export async function executeLensGate(
  state: PipelineState,
  context: PipelineContext,
  config: LensGateConfig = {}
): Promise<GateResult<LensGateResult>> {
  const startTime = Date.now();
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  
  // Initialize trace builder
  const traceBuilder = mergedConfig.enableTracing 
    ? new LensTraceBuilder() 
    : null;
  
  const correlationId = traceBuilder?.getCorrelationId() ?? generateCorrelationId();
  
  console.log(`[LENS] Starting gate execution (correlationId: ${correlationId})`);
  
  try {
    // Build orchestration options
    const orchestrationOptions: OrchestrationOptions = {
      classificationContext: {
        userTimezone: mergedConfig.userTimezone,
        userLocation: mergedConfig.userLocation,
        forceLLM: mergedConfig.forceLLMClassification,
        skipLLM: mergedConfig.skipLLMClassification,
      },
      providerTimeoutMs: mergedConfig.providerTimeoutMs,
      parallelFetch: mergedConfig.parallelFetch,
      userTimezone: mergedConfig.userTimezone,
      userLocation: mergedConfig.userLocation,
      correlationId,
    };
    
    // Execute orchestration
    let lensResult: LensGateResult;
    
    if (mergedConfig.enableLiveData) {
      lensResult = await orchestrate(state.normalizedInput, orchestrationOptions);
    } else {
      // Use sync orchestration when live data is disabled
      lensResult = orchestrateSync(state.normalizedInput, orchestrationOptions);
    }
    
    // Validate invariants
    if (lensResult.classification.truthMode === 'live_feed' || 
        lensResult.classification.truthMode === 'mixed') {
      validateForceHighInvariant(lensResult.classification.truthMode, lensResult.forceHigh);
    }
    
    // Build trace if enabled
    if (traceBuilder) {
      recordTraceFromResult(traceBuilder, lensResult);
      const trace = traceBuilder.build();
      
      if (mergedConfig.logTrace) {
        console.log(formatTrace(trace));
      }
      
      const metrics = extractMetrics(trace);
      console.log(`[LENS] Complete: ${formatMetrics(metrics)}`);
    }
    
    // Determine gate status based on lens mode
    const gateStatus = determineGateStatus(lensResult.mode);
    const executionTimeMs = Date.now() - startTime;
    
    console.log(`[LENS] Gate ${gateStatus}: mode=${lensResult.mode}, time=${executionTimeMs}ms`);
    
    return {
      gateId: LENS_GATE_ID,
      status: gateStatus,
      output: lensResult,
      action: gateStatus === 'hard_fail' ? 'halt' : 'continue',
      executionTimeMs,
      failureReason: gateStatus === 'hard_fail' ? 'Live data unavailable' : undefined,
    };
    
  } catch (error) {
    const executionTimeMs = Date.now() - startTime;
    
    console.error(`[LENS] Gate error after ${executionTimeMs}ms:`, error);
    
    // Record error in trace
    if (traceBuilder) {
      traceBuilder.recordError('orchestration', error instanceof Error ? error : String(error));
    }
    
    // Return hard fail on error
    return {
      gateId: LENS_GATE_ID,
      status: 'hard_fail',
      output: createErrorResult(error, correlationId),
      action: 'halt',
      executionTimeMs,
      failureReason: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SYNCHRONOUS GATE EXECUTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Execute the Lens gate synchronously (pattern-only, no live data fetching).
 * 
 * Use this when async execution is not possible or for quick classification.
 * Note: This will not fetch live data - all live queries will be degraded.
 * 
 * @param state - Current pipeline state
 * @param context - Pipeline context
 * @param config - Optional gate configuration
 * @returns Gate result with LensGateResult output
 */
export function executeLensGateSync(
  state: PipelineState,
  context: PipelineContext,
  config: LensGateConfig = {}
): GateResult<LensGateResult> {
  const startTime = Date.now();
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const correlationId = generateCorrelationId();
  
  try {
    const lensResult = orchestrateSync(state.normalizedInput, {
      userTimezone: mergedConfig.userTimezone,
      userLocation: mergedConfig.userLocation,
      correlationId,
    });
    
    const gateStatus = determineGateStatus(lensResult.mode);
    
    return {
      gateId: LENS_GATE_ID,
      status: gateStatus,
      output: lensResult,
      action: gateStatus === 'hard_fail' ? 'halt' : 'continue',
      executionTimeMs: Date.now() - startTime,
    };
    
  } catch (error) {
    return {
      gateId: LENS_GATE_ID,
      status: 'hard_fail',
      output: createErrorResult(error, correlationId),
      action: 'halt',
      executionTimeMs: Date.now() - startTime,
      failureReason: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Determine gate status from lens mode.
 */
function determineGateStatus(mode: LensMode): 'pass' | 'soft_fail' | 'hard_fail' {
  switch (mode) {
    case 'passthrough':
    case 'live_fetch':
    case 'verification':
      return 'pass';
    case 'degraded':
      return 'soft_fail';
    case 'blocked':
      return 'hard_fail';
    default:
      return 'pass';
  }
}

/**
 * Generate a correlation ID.
 */
function generateCorrelationId(): string {
  return `lens-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create an error result.
 */
function createErrorResult(error: unknown, correlationId: string): LensGateResult {
  // Create minimal classification for error state
  const errorClassification: DataNeedClassification = {
    truthMode: 'local',
    primaryCategory: 'general',
    categories: ['general'],
    liveCategories: [],
    authoritativeCategories: [],
    entities: createEmptyEntities(),
    entitiesComplete: true,
    entitiesNeedingClarification: [],
    confidence: 'low',
    confidenceScore: 0,
    reasoning: 'Gate error',
    method: 'rule_based',
    fallbackMode: 'refuse',
    freshnessCritical: false,
    maxDataAgeMs: null,
    requiresNumericPrecision: false,
    allowsActionRecommendations: false,
  };
  
  const userOptions: LensUserOption[] = [
    { id: 'retry', label: 'Try Again', requiresAck: false, action: 'retry' },
    { id: 'cancel', label: 'Cancel', requiresAck: false, action: 'cancel' },
  ];
  
  const result = createBlockedResult(
    errorClassification,
    createEmptyEntities(),
    error instanceof Error ? error.message : 'Unknown error',
    userOptions
  );
  
  return result;
}

/**
 * Record trace information from lens result.
 */
function recordTraceFromResult(
  builder: LensTraceBuilder,
  result: LensGateResult
): void {
  // Record classification trace
  builder.recordClassification(createClassificationTrace(
    0, // Duration not tracked in result
    result.classification.method,
    result.classification.truthMode,
    result.classification.liveCategories,
    result.classification.authoritativeCategories,
    result.classification.entities.resolved.length,
    result.classification.confidenceScore,
    null, // Pattern confidence not separately tracked
    result.classification.method !== 'rule_based',
    false
  ));
  
  // Record risk assessment trace
  builder.recordRiskAssessment(createRiskTrace(
    0,
    result.forceHigh,
    result.forceHigh ? 'invariant' : 'not_forced',
    result.riskAssessment?.score ?? 0,
    result.riskAssessment?.factors ?? [],
    result.riskAssessment?.stakes ?? 'low'
  ));
  
  // Record provider trace
  const categoryTraces = result.retrieval.successfulData.map(d => ({
    category: d.type as any,
    durationMs: 0,
    success: true,
    stale: false,
  }));
  
  for (const cat of result.retrieval.failedCategories) {
    categoryTraces.push({
      category: cat,
      durationMs: 0,
      success: false,
      stale: false,
    });
  }
  
  builder.recordProviders(createProviderTrace(
    result.retrieval.totalLatencyMs,
    true,
    categoryTraces
  ));
  
  // Record result trace
  builder.recordResult(createResultTrace(
    result.mode,
    !!result.evidence,
    result.evidence?.numericTokens?.tokens.size ?? 0,
    result.constraints.level,
    result.evidence?.systemPromptAdditions?.length ?? 0
  ));
}

// ─────────────────────────────────────────────────────────────────────────────────
// RE-EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

// Classification
export {
  classify,
  classifySync,
  quickNeedsLiveData,
  quickNeedsAuthoritative,
  quickExtractEntities,
  classifyWithPatterns,
  isHighConfidenceMatch,
  classifyWithLLM,
  isLLMAvailable,
  type ClassificationContext,
  type PatternMatch,
  type PatternClassificationResult,
  type LLMClassificationResult,
} from './classification/index.js';

// Risk Assessment
export {
  assessRisk,
  validateForceHighInvariant,
  requiresForceHigh,
  hasQualitativeFallback,
  isVolatileCategory,
  type RiskAssessment,
  type RiskFactor,
  type StakesLevel,
  type ForceHighReason,
} from './risk/index.js';

// Orchestration
export {
  orchestrate,
  orchestrateSync,
  handleTimeData,
  handleMultipleTimeQueries,
  isValidTimezone,
  hasTimeEntity,
  type OrchestrationOptions,
  type TimeHandlerResult,
  type TimeHandlerOptions,
} from './orchestration/index.js';

// Telemetry
export {
  LensTraceBuilder,
  createLogger,
  generateTraceId,
  formatTrace,
  formatTraceAsJson,
  extractMetrics,
  formatMetrics,
  type LensTrace,
  type ClassificationTrace,
  type RiskAssessmentTrace,
  type ProviderTrace,
  type CategoryTrace,
  type ResultTrace,
  type ErrorTrace,
  type LensMetrics,
  type LogLevel,
  type LogEntry,
} from './telemetry.js';

// Types re-export
export type { LensGateResult, LensMode, EvidencePack, RetrievalOutcome } from '../../types/lens.js';
export type { DataNeedClassification, TruthMode, FallbackMode } from '../../types/data-need.js';
export type { LiveCategory, AuthoritativeCategory, DataCategory } from '../../types/categories.js';

// ─────────────────────────────────────────────────────────────────────────────────
// COMPATIBILITY LAYER EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export {
  toLegacyLensResult,
  getFullLensResult,
  hasExtendedData,
  type ExtendedLensResult,
  type LegacyEvidencePack,
  type LegacyEvidenceItem,
} from './compatibility.js';

// ─────────────────────────────────────────────────────────────────────────────────
// PIPELINE-COMPATIBLE ASYNC EXPORT
// ─────────────────────────────────────────────────────────────────────────────────

import type { LensResult, GateResult as PipelineGateResult } from '../../types/index.js';
import { toLegacyLensResult, type ExtendedLensResult } from './compatibility.js';

/**
 * Pipeline-compatible interface for Lens gate configuration.
 */
export interface TieredLensConfig {
  readonly enableSearch?: boolean;
  readonly userTimezone?: string;
  readonly userLocation?: string;
}

/**
 * Alias types for backward compatibility with existing pipeline.
 */
export type TieredLensResult = ExtendedLensResult;
export type LensClassification = DataNeedClassification;
export type SearchTier = 'official' | 'authoritative' | 'general';
export type VerificationStatus = 'verified' | 'degraded' | 'stopped';
export type LensConfidenceLevel = 'high' | 'medium' | 'low';
export type EvidenceItem = { title: string; url?: string; excerpt?: string; snippet?: string };
export type VerifiedClaim = { claim: string; verified: boolean; source?: string };
export type RiskFactor = { factor: string; severity: 'low' | 'medium' | 'high' };
export type DegradationReason = string;
export type ReliabilityTier = 'feed' | 'official' | 'aggregator';

/**
 * Execute the Lens gate asynchronously with pipeline-compatible output.
 * 
 * This is the main entry point for the execution pipeline.
 * It wraps the Phase 7 Lens gate and converts the output to the legacy
 * LensResult format expected by the pipeline.
 * 
 * @param state - Current pipeline state
 * @param context - Pipeline context
 * @param config - Optional configuration
 * @returns Gate result with legacy-compatible LensResult (extended)
 */
export async function executeLensGateAsync(
  state: PipelineState,
  context: PipelineContext,
  config: TieredLensConfig = {}
): Promise<PipelineGateResult<ExtendedLensResult>> {
  // Map config to LensGateConfig
  const lensConfig: LensGateConfig = {
    enableLiveData: config.enableSearch ?? true,
    userTimezone: config.userTimezone ?? context.timezone,
    userLocation: config.userLocation,
    enableTracing: true,
    logTrace: false,
  };
  
  // Execute the Phase 7 Lens gate
  const result = await executeLensGate(state, context, lensConfig);
  
  // Convert to legacy-compatible format
  const legacyResult = toLegacyLensResult(result.output);
  
  // Map action from Phase 7 to pipeline GateAction
  let action: 'continue' | 'regenerate' | 'stop' | 'await_ack' | 'degrade';
  switch (result.action) {
    case 'halt':
      action = 'stop';
      break;
    default:
      action = result.action as any ?? 'continue';
  }
  
  return {
    gateId: 'lens',
    status: result.status,
    output: legacyResult,
    action,
    executionTimeMs: result.executionTimeMs,
    failureReason: result.failureReason,
  };
}
