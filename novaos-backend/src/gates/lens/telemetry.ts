// ═══════════════════════════════════════════════════════════════════════════════
// TELEMETRY — Lens Gate Tracing and Logging
// Phase 7: Lens Gate
// 
// This module provides structured telemetry for the Lens gate including:
// - Trace building with timing information
// - Structured logging with correlation IDs
// - Performance metrics collection
// - Error tracking with context
// ═══════════════════════════════════════════════════════════════════════════════

import type { LiveCategory, AuthoritativeCategory } from '../../types/categories.js';
import type { TruthMode } from '../../types/data-need.js';
import type { LensMode } from '../../types/lens.js';
import type { StakesLevel, RiskFactor } from './risk/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Complete trace for a Lens gate execution.
 */
export interface LensTrace {
  /** Unique correlation ID for this trace */
  readonly correlationId: string;
  
  /** Timestamp when processing started */
  readonly startedAt: number;
  
  /** Timestamp when processing completed */
  readonly completedAt: number;
  
  /** Total processing time in milliseconds */
  readonly totalDurationMs: number;
  
  /** Classification phase trace */
  readonly classification: ClassificationTrace;
  
  /** Risk assessment phase trace */
  readonly riskAssessment: RiskAssessmentTrace;
  
  /** Provider fetching phase trace */
  readonly providers: ProviderTrace;
  
  /** Final result summary */
  readonly result: ResultTrace;
  
  /** Any errors that occurred */
  readonly errors: readonly ErrorTrace[];
  
  /** Whether the overall execution succeeded */
  readonly success: boolean;
}

/**
 * Trace for classification phase.
 */
export interface ClassificationTrace {
  readonly durationMs: number;
  readonly method: 'rule_based' | 'llm' | 'hybrid';
  readonly truthMode: TruthMode;
  readonly liveCategories: readonly LiveCategory[];
  readonly authoritativeCategories: readonly AuthoritativeCategory[];
  readonly entityCount: number;
  readonly confidence: number;
  readonly patternConfidence: number | null;
  readonly llmUsed: boolean;
  readonly llmFallback: boolean;
}

/**
 * Trace for risk assessment phase.
 */
export interface RiskAssessmentTrace {
  readonly durationMs: number;
  readonly forceHigh: boolean;
  readonly forceHighReason: string;
  readonly riskScore: number;
  readonly riskFactors: readonly RiskFactor[];
  readonly stakes: StakesLevel;
}

/**
 * Trace for provider fetching phase.
 */
export interface ProviderTrace {
  readonly totalDurationMs: number;
  readonly parallelFetch: boolean;
  readonly categoryTraces: readonly CategoryTrace[];
  readonly successCount: number;
  readonly failureCount: number;
  readonly partialSuccess: boolean;
}

/**
 * Trace for a single category provider call.
 */
export interface CategoryTrace {
  readonly category: LiveCategory;
  readonly durationMs: number;
  readonly success: boolean;
  readonly stale: boolean;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly entityQueried?: string;
  readonly dataFreshness?: number;
}

/**
 * Trace for final result.
 */
export interface ResultTrace {
  readonly mode: LensMode;
  readonly hasEvidence: boolean;
  readonly tokenCount: number;
  readonly constraintLevel: string;
  readonly systemPromptAdditions: number;
}

/**
 * Trace for an error.
 */
export interface ErrorTrace {
  readonly phase: 'classification' | 'risk' | 'provider' | 'orchestration';
  readonly category?: LiveCategory;
  readonly error: string;
  readonly stack?: string;
  readonly timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// TRACE BUILDER
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Builder for constructing LensTrace incrementally.
 */
export class LensTraceBuilder {
  private readonly correlationId: string;
  private readonly startedAt: number;
  private completedAt: number = 0;
  
  private classificationTrace: ClassificationTrace | null = null;
  private riskAssessmentTrace: RiskAssessmentTrace | null = null;
  private providerTrace: ProviderTrace | null = null;
  private resultTrace: ResultTrace | null = null;
  private errors: ErrorTrace[] = [];
  
  constructor(correlationId?: string) {
    this.correlationId = correlationId ?? generateTraceId();
    this.startedAt = Date.now();
  }
  
  /**
   * Get the correlation ID for this trace.
   */
  getCorrelationId(): string {
    return this.correlationId;
  }
  
  /**
   * Record classification phase completion.
   */
  recordClassification(trace: ClassificationTrace): this {
    this.classificationTrace = trace;
    return this;
  }
  
  /**
   * Record risk assessment phase completion.
   */
  recordRiskAssessment(trace: RiskAssessmentTrace): this {
    this.riskAssessmentTrace = trace;
    return this;
  }
  
  /**
   * Record provider fetching phase completion.
   */
  recordProviders(trace: ProviderTrace): this {
    this.providerTrace = trace;
    return this;
  }
  
  /**
   * Record final result.
   */
  recordResult(trace: ResultTrace): this {
    this.resultTrace = trace;
    return this;
  }
  
  /**
   * Record an error.
   */
  recordError(
    phase: ErrorTrace['phase'],
    error: Error | string,
    category?: LiveCategory
  ): this {
    const errorTrace: ErrorTrace = {
      phase,
      category,
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: Date.now(),
    };
    this.errors.push(errorTrace);
    return this;
  }
  
  /**
   * Build the final trace.
   */
  build(): LensTrace {
    this.completedAt = Date.now();
    
    const totalDurationMs = this.completedAt - this.startedAt;
    const success = this.errors.length === 0 && this.resultTrace !== null;
    
    return {
      correlationId: this.correlationId,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      totalDurationMs,
      classification: this.classificationTrace ?? createDefaultClassificationTrace(),
      riskAssessment: this.riskAssessmentTrace ?? createDefaultRiskTrace(),
      providers: this.providerTrace ?? createDefaultProviderTrace(),
      result: this.resultTrace ?? createDefaultResultTrace(),
      errors: this.errors,
      success,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// DEFAULT TRACES
// ─────────────────────────────────────────────────────────────────────────────────

function createDefaultClassificationTrace(): ClassificationTrace {
  return {
    durationMs: 0,
    method: 'rule_based',
    truthMode: 'local',
    liveCategories: [],
    authoritativeCategories: [],
    entityCount: 0,
    confidence: 0,
    patternConfidence: null,
    llmUsed: false,
    llmFallback: false,
  };
}

function createDefaultRiskTrace(): RiskAssessmentTrace {
  return {
    durationMs: 0,
    forceHigh: false,
    forceHighReason: 'not_forced',
    riskScore: 0,
    riskFactors: [],
    stakes: 'low',
  };
}

function createDefaultProviderTrace(): ProviderTrace {
  return {
    totalDurationMs: 0,
    parallelFetch: true,
    categoryTraces: [],
    successCount: 0,
    failureCount: 0,
    partialSuccess: false,
  };
}

function createDefaultResultTrace(): ResultTrace {
  return {
    mode: 'passthrough',
    hasEvidence: false,
    tokenCount: 0,
    constraintLevel: 'permissive',
    systemPromptAdditions: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// TRACE HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Generate a unique trace ID.
 */
export function generateTraceId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `lens-${timestamp}-${random}`;
}

/**
 * Create a classification trace from classification result.
 */
export function createClassificationTrace(
  durationMs: number,
  method: 'rule_based' | 'llm' | 'hybrid',
  truthMode: TruthMode,
  liveCategories: readonly LiveCategory[],
  authoritativeCategories: readonly AuthoritativeCategory[],
  entityCount: number,
  confidence: number,
  patternConfidence: number | null,
  llmUsed: boolean,
  llmFallback: boolean
): ClassificationTrace {
  return {
    durationMs,
    method,
    truthMode,
    liveCategories,
    authoritativeCategories,
    entityCount,
    confidence,
    patternConfidence,
    llmUsed,
    llmFallback,
  };
}

/**
 * Create a risk assessment trace.
 */
export function createRiskTrace(
  durationMs: number,
  forceHigh: boolean,
  forceHighReason: string,
  riskScore: number,
  riskFactors: readonly RiskFactor[],
  stakes: StakesLevel
): RiskAssessmentTrace {
  return {
    durationMs,
    forceHigh,
    forceHighReason,
    riskScore,
    riskFactors,
    stakes,
  };
}

/**
 * Create a category trace.
 */
export function createCategoryTrace(
  category: LiveCategory,
  durationMs: number,
  success: boolean,
  stale: boolean = false,
  errorCode?: string,
  errorMessage?: string,
  entityQueried?: string,
  dataFreshness?: number
): CategoryTrace {
  return {
    category,
    durationMs,
    success,
    stale,
    errorCode,
    errorMessage,
    entityQueried,
    dataFreshness,
  };
}

/**
 * Create a provider trace from category traces.
 */
export function createProviderTrace(
  totalDurationMs: number,
  parallelFetch: boolean,
  categoryTraces: readonly CategoryTrace[]
): ProviderTrace {
  const successCount = categoryTraces.filter(t => t.success).length;
  const failureCount = categoryTraces.filter(t => !t.success).length;
  const partialSuccess = successCount > 0 && failureCount > 0;
  
  return {
    totalDurationMs,
    parallelFetch,
    categoryTraces,
    successCount,
    failureCount,
    partialSuccess,
  };
}

/**
 * Create a result trace.
 */
export function createResultTrace(
  mode: LensMode,
  hasEvidence: boolean,
  tokenCount: number,
  constraintLevel: string,
  systemPromptAdditions: number
): ResultTrace {
  return {
    mode,
    hasEvidence,
    tokenCount,
    constraintLevel,
    systemPromptAdditions,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// STRUCTURED LOGGING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Log levels for structured logging.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Structured log entry.
 */
export interface LogEntry {
  readonly level: LogLevel;
  readonly timestamp: number;
  readonly correlationId: string;
  readonly phase: string;
  readonly message: string;
  readonly data?: Record<string, unknown>;
}

/**
 * Create a structured logger for a trace.
 */
export function createLogger(correlationId: string): LensLogger {
  return new LensLogger(correlationId);
}

/**
 * Logger class for structured logging.
 */
export class LensLogger {
  private readonly correlationId: string;
  private readonly entries: LogEntry[] = [];
  
  constructor(correlationId: string) {
    this.correlationId = correlationId;
  }
  
  /**
   * Log a debug message.
   */
  debug(phase: string, message: string, data?: Record<string, unknown>): void {
    this.log('debug', phase, message, data);
  }
  
  /**
   * Log an info message.
   */
  info(phase: string, message: string, data?: Record<string, unknown>): void {
    this.log('info', phase, message, data);
  }
  
  /**
   * Log a warning message.
   */
  warn(phase: string, message: string, data?: Record<string, unknown>): void {
    this.log('warn', phase, message, data);
  }
  
  /**
   * Log an error message.
   */
  error(phase: string, message: string, data?: Record<string, unknown>): void {
    this.log('error', phase, message, data);
  }
  
  /**
   * Internal log method.
   */
  private log(
    level: LogLevel,
    phase: string,
    message: string,
    data?: Record<string, unknown>
  ): void {
    const entry: LogEntry = {
      level,
      timestamp: Date.now(),
      correlationId: this.correlationId,
      phase,
      message,
      data,
    };
    
    this.entries.push(entry);
    
    // Also log to console with structured format
    const prefix = `[LENS:${this.correlationId.slice(-8)}:${phase}]`;
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    
    switch (level) {
      case 'debug':
        console.debug(`${prefix} ${message}${dataStr}`);
        break;
      case 'info':
        console.log(`${prefix} ${message}${dataStr}`);
        break;
      case 'warn':
        console.warn(`${prefix} ${message}${dataStr}`);
        break;
      case 'error':
        console.error(`${prefix} ${message}${dataStr}`);
        break;
    }
  }
  
  /**
   * Get all log entries.
   */
  getEntries(): readonly LogEntry[] {
    return this.entries;
  }
  
  /**
   * Get entries by level.
   */
  getEntriesByLevel(level: LogLevel): readonly LogEntry[] {
    return this.entries.filter(e => e.level === level);
  }
  
  /**
   * Check if any errors were logged.
   */
  hasErrors(): boolean {
    return this.entries.some(e => e.level === 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// METRICS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Metrics collected during Lens gate execution.
 */
export interface LensMetrics {
  readonly classificationDurationMs: number;
  readonly riskAssessmentDurationMs: number;
  readonly providerFetchDurationMs: number;
  readonly totalDurationMs: number;
  readonly categoryCount: number;
  readonly successfulFetches: number;
  readonly failedFetches: number;
  readonly tokenCount: number;
  readonly llmCalls: number;
  readonly patternMatches: number;
}

/**
 * Extract metrics from a trace.
 */
export function extractMetrics(trace: LensTrace): LensMetrics {
  return {
    classificationDurationMs: trace.classification.durationMs,
    riskAssessmentDurationMs: trace.riskAssessment.durationMs,
    providerFetchDurationMs: trace.providers.totalDurationMs,
    totalDurationMs: trace.totalDurationMs,
    categoryCount: trace.providers.categoryTraces.length,
    successfulFetches: trace.providers.successCount,
    failedFetches: trace.providers.failureCount,
    tokenCount: trace.result.tokenCount,
    llmCalls: trace.classification.llmUsed ? 1 : 0,
    patternMatches: trace.classification.patternConfidence !== null ? 1 : 0,
  };
}

/**
 * Format metrics for logging.
 */
export function formatMetrics(metrics: LensMetrics): string {
  const parts = [
    `total=${metrics.totalDurationMs}ms`,
    `classification=${metrics.classificationDurationMs}ms`,
    `risk=${metrics.riskAssessmentDurationMs}ms`,
    `providers=${metrics.providerFetchDurationMs}ms`,
    `fetches=${metrics.successfulFetches}/${metrics.categoryCount}`,
    `tokens=${metrics.tokenCount}`,
  ];
  
  if (metrics.llmCalls > 0) {
    parts.push(`llm=${metrics.llmCalls}`);
  }
  
  return parts.join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────────
// TRACE FORMATTING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Format a trace for logging.
 */
export function formatTrace(trace: LensTrace): string {
  const lines: string[] = [
    `=== Lens Trace: ${trace.correlationId} ===`,
    `Duration: ${trace.totalDurationMs}ms | Success: ${trace.success}`,
    '',
    'Classification:',
    `  Method: ${trace.classification.method} | TruthMode: ${trace.classification.truthMode}`,
    `  Categories: [${trace.classification.liveCategories.join(', ')}]`,
    `  Confidence: ${(trace.classification.confidence * 100).toFixed(0)}%`,
    '',
    'Risk Assessment:',
    `  ForceHigh: ${trace.riskAssessment.forceHigh} (${trace.riskAssessment.forceHighReason})`,
    `  Score: ${(trace.riskAssessment.riskScore * 100).toFixed(0)}% | Stakes: ${trace.riskAssessment.stakes}`,
    '',
    'Providers:',
    `  Parallel: ${trace.providers.parallelFetch} | Duration: ${trace.providers.totalDurationMs}ms`,
    `  Success: ${trace.providers.successCount} | Failed: ${trace.providers.failureCount}`,
  ];
  
  for (const cat of trace.providers.categoryTraces) {
    const status = cat.success ? '✓' : '✗';
    const error = cat.errorMessage ? ` (${cat.errorMessage})` : '';
    lines.push(`    ${status} ${cat.category}: ${cat.durationMs}ms${error}`);
  }
  
  lines.push('');
  lines.push('Result:');
  lines.push(`  Mode: ${trace.result.mode} | Tokens: ${trace.result.tokenCount}`);
  lines.push(`  Constraints: ${trace.result.constraintLevel}`);
  
  if (trace.errors.length > 0) {
    lines.push('');
    lines.push('Errors:');
    for (const err of trace.errors) {
      lines.push(`  [${err.phase}] ${err.error}`);
    }
  }
  
  lines.push('='.repeat(40));
  
  return lines.join('\n');
}

/**
 * Format a trace as JSON for structured logging.
 */
export function formatTraceAsJson(trace: LensTrace): string {
  return JSON.stringify(trace, null, 2);
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export {
  LensTraceBuilder as TraceBuilder,
};
