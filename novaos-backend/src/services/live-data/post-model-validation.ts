// ═══════════════════════════════════════════════════════════════════════════════
// POST-MODEL VALIDATION — Integration Layer for Leak Guard
// Phase 5: Leak Guard
// 
// This module sits between the Model gate output and the final response.
// It orchestrates the leak guard check and response replacement.
// 
// PIPELINE POSITION:
//   Intent → Shield → Lens → Stance → Capability → Model → [POST-MODEL] → Personality → Spark
//                                                    ↑
//                                              YOU ARE HERE
// 
// If the leak guard catches violations, the model output is REPLACED with a
// safe fallback. This is a TERMINAL operation - there is no retry.
// ═══════════════════════════════════════════════════════════════════════════════

import type { LiveCategory } from '../../types/categories.js';
import type { ResponseConstraints } from '../../types/constraints.js';

import {
  checkNumericLeak,
  getResultSummary,
  isCriticalFailure,
  type LeakGuardResult,
  type LeakGuardMode,
} from './leak-guard.js';

import {
  getSafeResponse,
  buildContextualSafeResponse,
  getInvalidStateResponse,
} from './leak-response.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Result of post-model validation.
 */
export interface PostModelValidationResult {
  /** The final response to return to user */
  readonly response: string;
  
  /** Whether the original response was modified */
  readonly wasModified: boolean;
  
  /** Whether this was a complete replacement (vs. redaction) */
  readonly wasReplaced: boolean;
  
  /** The original response (if modified) */
  readonly originalResponse?: string;
  
  /** Leak guard result */
  readonly leakGuardResult: LeakGuardResult;
  
  /** Summary for logging */
  readonly summary: string;
  
  /** Whether this represents a system error */
  readonly isSystemError: boolean;
  
  /** Telemetry data for observability */
  readonly telemetry: ValidationTelemetry;
}

/**
 * Telemetry data for observability.
 */
export interface ValidationTelemetry {
  /** Timestamp of validation */
  readonly timestamp: number;
  
  /** Category validated */
  readonly category: LiveCategory;
  
  /** Mode used */
  readonly mode: LeakGuardMode;
  
  /** Original response length */
  readonly originalLength: number;
  
  /** Final response length */
  readonly finalLength: number;
  
  /** Number of violations detected */
  readonly violationCount: number;
  
  /** Processing time in milliseconds */
  readonly processingTimeMs: number;
  
  /** Whether response was replaced */
  readonly replaced: boolean;
  
  /** Constraint level */
  readonly constraintLevel: string;
}

/**
 * Options for post-model validation.
 */
export interface PostModelValidationOptions {
  /** Entity name for contextual responses */
  readonly entity?: string;
  
  /** Whether to log detailed trace */
  readonly enableTrace?: boolean;
  
  /** Custom safe response override */
  readonly customSafeResponse?: string;
  
  /** Whether to allow partial responses (not yet implemented) */
  readonly allowPartial?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────
// MAIN VALIDATION FUNCTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Validate model output and replace with safe response if needed.
 * 
 * This is the main entry point for post-model validation.
 * 
 * @param modelOutput - The raw output from the Model gate
 * @param constraints - Response constraints from the pipeline
 * @param category - The primary live data category
 * @param options - Validation options
 * @returns Validation result with final response
 */
export function validateModelOutput(
  modelOutput: string,
  constraints: ResponseConstraints,
  category: LiveCategory,
  options: PostModelValidationOptions = {}
): PostModelValidationResult {
  const startTime = Date.now();
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // RUN LEAK GUARD
  // ═══════════════════════════════════════════════════════════════════════════════
  
  const leakGuardResult = checkNumericLeak(modelOutput, constraints, category);
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // HANDLE INVALID STATE
  // ═══════════════════════════════════════════════════════════════════════════════
  
  if (leakGuardResult.invalidState) {
    const safeResponse = getInvalidStateResponse(category, leakGuardResult.invalidStateReason);
    
    return {
      response: safeResponse,
      wasModified: true,
      wasReplaced: true,
      originalResponse: modelOutput,
      leakGuardResult,
      summary: `INVALID STATE: ${leakGuardResult.invalidStateReason}`,
      isSystemError: true,
      telemetry: buildTelemetry(
        category,
        leakGuardResult,
        modelOutput.length,
        safeResponse.length,
        startTime,
        true,
        constraints.level
      ),
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // HANDLE PASSED VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════════
  
  if (leakGuardResult.passed) {
    return {
      response: modelOutput,
      wasModified: false,
      wasReplaced: false,
      leakGuardResult,
      summary: getResultSummary(leakGuardResult),
      isSystemError: false,
      telemetry: buildTelemetry(
        category,
        leakGuardResult,
        modelOutput.length,
        modelOutput.length,
        startTime,
        false,
        constraints.level
      ),
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // HANDLE VIOLATIONS — REPLACE WITH SAFE RESPONSE
  // ═══════════════════════════════════════════════════════════════════════════════
  
  let safeResponse: string;
  
  if (options.customSafeResponse) {
    safeResponse = options.customSafeResponse;
  } else if (options.entity) {
    safeResponse = buildContextualSafeResponse(category, options.entity);
  } else {
    safeResponse = getSafeResponse(category);
  }
  
  return {
    response: safeResponse,
    wasModified: true,
    wasReplaced: true,
    originalResponse: modelOutput,
    leakGuardResult,
    summary: getResultSummary(leakGuardResult),
    isSystemError: false,
    telemetry: buildTelemetry(
      category,
      leakGuardResult,
      modelOutput.length,
      safeResponse.length,
      startTime,
      true,
      constraints.level
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// MULTI-CATEGORY VALIDATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Validate model output against multiple categories.
 * 
 * Used when a query touches multiple live data categories (e.g., "What's
 * Apple's stock price and the weather in Cupertino?").
 * 
 * @param modelOutput - The raw output from the Model gate
 * @param categoryConstraints - Map of category to constraints
 * @param options - Validation options
 * @returns Validation result with final response
 */
export function validateMultiCategory(
  modelOutput: string,
  categoryConstraints: ReadonlyMap<LiveCategory, ResponseConstraints>,
  options: PostModelValidationOptions = {}
): PostModelValidationResult {
  const startTime = Date.now();
  
  // Find the strictest constraint level
  let strictestConstraints: ResponseConstraints | null = null;
  let primaryCategory: LiveCategory = 'market';
  
  for (const [category, constraints] of categoryConstraints) {
    if (!strictestConstraints) {
      strictestConstraints = constraints;
      primaryCategory = category;
      continue;
    }
    
    // FORBID mode is strictest
    if (!constraints.numericPrecisionAllowed) {
      strictestConstraints = constraints;
      primaryCategory = category;
      break;  // Can't get stricter than FORBID
    }
    
    // Strict level with tokens is next strictest
    if (constraints.level === 'strict' && constraints.allowedTokens) {
      if (strictestConstraints.level !== 'strict' || !strictestConstraints.numericPrecisionAllowed) {
        strictestConstraints = constraints;
        primaryCategory = category;
      }
    }
  }
  
  if (!strictestConstraints) {
    // No constraints provided - should not happen
    return {
      response: modelOutput,
      wasModified: false,
      wasReplaced: false,
      leakGuardResult: {
        passed: true,
        mode: 'allowlist',
        violations: [],
        unexemptedViolations: [],
        invalidState: false,
        processingTimeMs: 0,
        trace: {
          patternsChecked: 0,
          matchesFound: 0,
          matchesExempted: 0,
          overlapsDeduplicated: 0,
          exemptionReasons: [],
          tokensChecked: 0,
          tokensMatched: 0,
        },
      },
      summary: 'No constraints provided',
      isSystemError: false,
      telemetry: buildTelemetry(
        primaryCategory,
        {
          passed: true,
          mode: 'allowlist',
          violations: [],
          unexemptedViolations: [],
          invalidState: false,
          processingTimeMs: 0,
          trace: {
            patternsChecked: 0,
            matchesFound: 0,
            matchesExempted: 0,
            overlapsDeduplicated: 0,
            exemptionReasons: [],
            tokensChecked: 0,
            tokensMatched: 0,
          },
        },
        modelOutput.length,
        modelOutput.length,
        startTime,
        false,
        'permissive'
      ),
    };
  }
  
  // Merge token sets if multiple categories have ALLOWLIST mode
  let mergedConstraints = strictestConstraints;
  
  if (strictestConstraints.numericPrecisionAllowed && strictestConstraints.allowedTokens) {
    const mergedTokens = new Map(strictestConstraints.allowedTokens.tokens);
    
    for (const [, constraints] of categoryConstraints) {
      if (constraints.allowedTokens && constraints !== strictestConstraints) {
        for (const [key, token] of constraints.allowedTokens.tokens) {
          mergedTokens.set(key, token);
        }
      }
    }
    
    // Rebuild byValue and byContext maps
    const byValue = new Map<number, import('../../types/constraints.js').NumericToken[]>();
    const byContext = new Map<import('../../types/constraints.js').NumericContextKey, import('../../types/constraints.js').NumericToken[]>();
    
    for (const token of mergedTokens.values()) {
      // By value
      const valueTokens = byValue.get(token.value) || [];
      valueTokens.push(token);
      byValue.set(token.value, valueTokens);
      
      // By context
      const contextTokens = byContext.get(token.contextKey) || [];
      contextTokens.push(token);
      byContext.set(token.contextKey, contextTokens);
    }
    
    mergedConstraints = {
      ...strictestConstraints,
      allowedTokens: {
        tokens: mergedTokens,
        byValue,
        byContext,
      },
    };
  }
  
  // Run validation with merged constraints
  return validateModelOutput(modelOutput, mergedConstraints, primaryCategory, options);
}

// ─────────────────────────────────────────────────────────────────────────────────
// TELEMETRY BUILDER
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Build telemetry data for observability.
 */
function buildTelemetry(
  category: LiveCategory,
  result: LeakGuardResult,
  originalLength: number,
  finalLength: number,
  startTime: number,
  replaced: boolean,
  constraintLevel: string
): ValidationTelemetry {
  return {
    timestamp: Date.now(),
    category,
    mode: result.mode,
    originalLength,
    finalLength,
    violationCount: result.unexemptedViolations.length,
    processingTimeMs: Date.now() - startTime,
    replaced,
    constraintLevel,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// QUICK CHECK UTILITIES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Quick check if validation would pass (without building full result).
 * 
 * @param modelOutput - The raw output from the Model gate
 * @param constraints - Response constraints from the pipeline
 * @param category - The primary live data category
 * @returns True if validation would pass
 */
export function wouldPassValidation(
  modelOutput: string,
  constraints: ResponseConstraints,
  category: LiveCategory
): boolean {
  const result = checkNumericLeak(modelOutput, constraints, category);
  return result.passed && !result.invalidState;
}

/**
 * Check if constraints would trigger FORBID mode.
 * 
 * @param constraints - Response constraints
 * @returns True if FORBID mode would be used
 */
export function isForbidMode(constraints: ResponseConstraints): boolean {
  return !constraints.numericPrecisionAllowed;
}

/**
 * Check if constraints would trigger ALLOWLIST mode.
 * 
 * @param constraints - Response constraints
 * @returns True if ALLOWLIST mode would be used
 */
export function isAllowlistMode(constraints: ResponseConstraints): boolean {
  return constraints.numericPrecisionAllowed && constraints.allowedTokens !== null;
}

// ─────────────────────────────────────────────────────────────────────────────────
// DEBUG UTILITIES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Get detailed debug information for a validation result.
 */
export function getDebugInfo(result: PostModelValidationResult): string {
  const lines: string[] = [
    '═══════════════════════════════════════════════════════════════════',
    'POST-MODEL VALIDATION DEBUG',
    '═══════════════════════════════════════════════════════════════════',
    '',
    `Summary: ${result.summary}`,
    `Was Modified: ${result.wasModified}`,
    `Was Replaced: ${result.wasReplaced}`,
    `Is System Error: ${result.isSystemError}`,
    '',
    '─── Leak Guard Result ───',
    `Mode: ${result.leakGuardResult.mode}`,
    `Passed: ${result.leakGuardResult.passed}`,
    `Invalid State: ${result.leakGuardResult.invalidState}`,
    `Processing Time: ${result.leakGuardResult.processingTimeMs}ms`,
    '',
    '─── Trace ───',
    `Patterns Checked: ${result.leakGuardResult.trace.patternsChecked}`,
    `Matches Found: ${result.leakGuardResult.trace.matchesFound}`,
    `Matches Exempted: ${result.leakGuardResult.trace.matchesExempted}`,
    `Overlaps Deduplicated: ${result.leakGuardResult.trace.overlapsDeduplicated}`,
    `Tokens Checked: ${result.leakGuardResult.trace.tokensChecked}`,
    `Tokens Matched: ${result.leakGuardResult.trace.tokensMatched}`,
  ];
  
  if (result.leakGuardResult.trace.exemptionReasons.length > 0) {
    lines.push(`Exemption Reasons: ${result.leakGuardResult.trace.exemptionReasons.join(', ')}`);
  }
  
  if (result.leakGuardResult.unexemptedViolations.length > 0) {
    lines.push('');
    lines.push('─── Violations ───');
    for (const v of result.leakGuardResult.unexemptedViolations.slice(0, 10)) {
      lines.push(`  [${v.index}] "${v.match}" (${v.pattern ?? 'unknown'})`);
      if (v.context) {
        lines.push(`       Context: ...${v.context}...`);
      }
    }
    if (result.leakGuardResult.unexemptedViolations.length > 10) {
      lines.push(`  ... and ${result.leakGuardResult.unexemptedViolations.length - 10} more`);
    }
  }
  
  lines.push('');
  lines.push('─── Telemetry ───');
  lines.push(`Category: ${result.telemetry.category}`);
  lines.push(`Original Length: ${result.telemetry.originalLength}`);
  lines.push(`Final Length: ${result.telemetry.finalLength}`);
  lines.push(`Violation Count: ${result.telemetry.violationCount}`);
  lines.push(`Replaced: ${result.telemetry.replaced}`);
  lines.push(`Constraint Level: ${result.telemetry.constraintLevel}`);
  
  if (result.originalResponse && result.wasReplaced) {
    lines.push('');
    lines.push('─── Original Response (first 500 chars) ───');
    lines.push(result.originalResponse.slice(0, 500));
    if (result.originalResponse.length > 500) {
      lines.push('... [truncated]');
    }
  }
  
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════════');
  
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export {
  checkNumericLeak,
  getResultSummary,
  isCriticalFailure,
};
