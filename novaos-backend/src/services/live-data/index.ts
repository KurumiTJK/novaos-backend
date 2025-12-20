// ═══════════════════════════════════════════════════════════════════════════════
// LIVE DATA MODULE — Leak Guard & Validation
// Phase 5: Leak Guard
// 
// This module provides numeric leak prevention for live data responses.
// It ensures that model output only contains verified numbers from providers
// or explicitly exempted patterns.
// 
// USAGE:
// 
//   import { validateModelOutput, PostModelValidationResult } from './live-data';
//   
//   const result = validateModelOutput(modelOutput, constraints, category, {
//     entity: 'AAPL',
//   });
//   
//   if (result.wasReplaced) {
//     console.log('Response replaced due to leak detection');
//   }
//   
//   return result.response;
// 
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// MAIN EXPORTS — Post-Model Validation
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Main validation function
  validateModelOutput,
  validateMultiCategory,
  
  // Quick checks
  wouldPassValidation,
  isForbidMode,
  isAllowlistMode,
  
  // Debug
  getDebugInfo,
  
  // Re-exports from leak-guard
  checkNumericLeak,
  getResultSummary,
  isCriticalFailure,
  
  // Types
  type PostModelValidationResult,
  type PostModelValidationOptions,
  type ValidationTelemetry,
} from './post-model-validation.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LEAK GUARD — Core Detection Engine
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Mode-specific checks
  checkLeakForbidMode,
  checkLeakAllowlistMode,
  
  // Utilities
  getViolationMatches,
  
  // Context keywords (for debugging)
  CONTEXT_KEYWORDS,
  
  // Types
  type LeakGuardMode,
  type LeakViolation,
  type LeakGuardResult,
  type LeakGuardTrace,
} from './leak-guard.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LEAK PATTERNS — Numeric Detection
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Pattern access
  getPattern,
  getAllPatterns,
  getPatternDescription,
  getAllPatternKeys,
  getPatternsByCategory,
  
  // Pattern matching
  findAllMatches,
  hasAnyNumeric,
  isAlwaysExemptPattern,
  
  // Pattern groups
  PRIORITY_PATTERNS,
  SECONDARY_PATTERNS,
  TERTIARY_PATTERNS,
  ALWAYS_EXEMPT_PATTERNS,
  
  // Combined patterns
  ANY_NUMERIC_PATTERN,
  SPELLED_NUMBER_PATTERN,
  
  // Pattern categories
  PATTERN_CATEGORIES,
  
  // Types
  type LeakPatternKey,
  type PatternCategory,
} from './leak-patterns.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LEAK EXEMPTIONS — Allowed Patterns
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Exemption checking
  isExempted,
  checkExemptions,
  filterNonExempted,
  
  // Context utilities
  getSurroundingContext,
  isFinancialContext,
  getExemptionsForContext,
  
  // Exemption builders
  withCustomPatterns,
  allowSpecificNumber,
  
  // Presets
  GENERAL_EXEMPTIONS,
  FINANCIAL_EXEMPTIONS,
  MINIMAL_EXEMPTIONS,
  
  // Pattern exports (for testing)
  YEAR_PATTERN,
  ORDINAL_PATTERN,
  STEP_NUMBER_PATTERN,
  VERSION_PATTERN,
  CODE_BLOCK_PATTERN,
  INLINE_CODE_PATTERN,
  QUOTED_TEXT_PATTERN,
  ISO_TIMESTAMP_PATTERN,
  PHONE_NUMBER_PATTERN,
  IP_ADDRESS_PATTERN,
  
  // Types
  type ExemptionReason,
  type ExemptionResult,
  type MatchWithExemption,
} from './leak-exemptions.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LEAK RESPONSE — Safe Fallbacks
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Response builders
  getSafeResponse,
  buildSafeResponse,
  buildContextualSafeResponse,
  buildPartialResponse,
  
  // Invalid state
  getInvalidStateResponse,
  INVALID_STATE_RESPONSE,
  
  // Validation
  validateSafeResponse,
  validateAllTemplates,
  getAllSafeResponses,
  
  // Templates
  SAFE_RESPONSE_TEMPLATES,
} from './leak-response.js';

// ─────────────────────────────────────────────────────────────────────────────────
// RE-EXPORTS FROM DEPENDENCIES
// ─────────────────────────────────────────────────────────────────────────────────

// Re-export constraint types for convenience
export type {
  NumericToken,
  NumericTokenSet,
  NumericExemptions,
  ResponseConstraints,
  NumericContextKey,
  ConstraintLevel,
} from '../../types/constraints.js';

// Re-export constraint builders
export {
  createDefaultConstraints,
  createStrictConstraints,
  createDegradedConstraints,
  createTokenKey,
  isExemptNumber,
  isNumericContextKey,
  VALID_NUMERIC_CONTEXT_KEYS,
  DEFAULT_EXEMPTIONS,
  STRICT_EXEMPTIONS,
  NO_EXEMPTIONS,
} from '../../types/constraints.js';

// Re-export canonicalization utilities
export {
  canonicalizeNumeric,
  extractNumericValue,
  numericEquals,
  numericApproxEquals,
  generateCanonicalVariants,
  extractAllNumbers,
  isNumericString,
  formatNumeric,
} from '../../utils/canonicalize.js';

// Re-export LiveCategory
export type { LiveCategory } from '../../types/categories.js';
