// ═══════════════════════════════════════════════════════════════════════════════
// LIVE DATA MODULE — Evidence, Injection & Leak Guard
// Phase 5: Leak Guard + Phase 6: Evidence & Injection
// 
// This module provides:
// 1. Evidence formatting and injection (Phase 6)
// 2. Numeric token extraction (Phase 6)
// 3. Failure semantics (Phase 6)
// 4. Constraint building (Phase 6)
// 5. Leak guard validation (Phase 5)
// 
// TYPICAL USAGE FLOW:
// 
//   // 1. Determine failure semantics
//   const semantics = getFailureSemantics(truthMode, category, providerStatus, fallbackMode);
//   
//   // 2. Build constraints
//   const { constraints } = buildConstraints(semantics, providerResult, category);
//   
//   // 3. Build augmented message with evidence
//   const { augmentedMessage, evidencePack } = buildAugmentedMessage(
//     userQuery, providerResults, constraints
//   );
//   
//   // 4. Send to model... get response
//   const modelResponse = await model.generate(augmentedMessage);
//   
//   // 5. Validate response with leak guard
//   const validation = validateModelOutput(modelResponse, constraints, category);
//   
//   // 6. Return safe response
//   return validation.response;
// 
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// PHASE 6: EVIDENCE & INJECTION
// ─────────────────────────────────────────────────────────────────────────────────

// Failure Semantics — Central failure handling
export {
  getFailureSemantics,
  combineSemantics,
  validateSemantics,
  validateFailureSemanticsMatrix,
  canProceed,
  allowsNumeric,
  isErrorState,
  getConstraintDescription,
  createVerifiedSemantics,
  createStaleSemantics,
  createInsufficientSemantics,
  createInvalidStateSemantics,
  type FailureSemantics,
  type ProviderStatus,
  type ConstraintLevel,
  type ModelProceedStatus,
} from './failure-semantics.js';

// Constraints Builder — Build ResponseConstraints
export {
  buildConstraints,
  buildInsufficientConstraints,
  buildQualitativeConstraints,
  buildForbidNumericConstraints,
  buildLiveDataConstraints,
  buildPermissiveConstraints,
  buildMultiProviderConstraints,
  validateConstraints,
  QUOTE_EVIDENCE_EXEMPTIONS,
  FORBID_NUMERIC_EXEMPTIONS,
  QUALITATIVE_EXEMPTIONS,
  NO_EXEMPTIONS,
  PERMISSIVE_EXEMPTIONS,
  UNIVERSAL_BANNED_PHRASES,
  type ConstraintBuildOptions,
  type ConstraintBuildResult,
} from './constraints-builder.js';

// Numeric Tokens — Extract tokens from provider data
export {
  formatStockData,
  formatFxData,
  formatCryptoData,
  formatWeatherData,
  formatTimeData,
  formatProviderData,
  extractTokensFromData,
  buildTokenSet,
  mergeTokenSets,
  buildTokenSetFromData,
  formatMultipleData,
  createTokenKey,
  type FormattedDataResult,
  type TokenExtractionOptions,
} from './numeric-tokens.js';

// Evidence Injection — Inject evidence into model prompt
export {
  buildEvidencePack,
  buildSingleEvidencePack,
  buildEvidenceXml,
  injectEvidence,
  buildAugmentedMessage,
  buildDegradedMessage,
  buildQualitativeMessage,
  buildPartialDataMessage,
  validateInjection,
  getSystemInstructions,
  QUOTE_EVIDENCE_INSTRUCTIONS,
  FORBID_NUMERIC_INSTRUCTIONS,
  QUALITATIVE_INSTRUCTIONS,
  STALE_DATA_INSTRUCTIONS,
  type EvidenceInjectionOptions,
  type AugmentedMessageResult,
  type FreshnessStatus,
} from './evidence-injection.js';

// Formatting — Deterministic number formatting
export {
  formatWithCommas,
  formatCurrency,
  formatPercent,
  formatCurrencyChange,
  formatTemperature,
  formatTemperatureDual,
  formatSpeed,
  formatWindSpeed,
  formatTime12,
  formatTime24,
  formatTimeWithZone,
  formatPressure,
  formatHumidity,
  formatUvIndex,
  formatVisibility,
  formatLargeNumber,
  formatMarketCap,
  formatVolume,
  formatExchangeRate,
  formatRate,
  formatCryptoPrice,
  formatSupply,
  getDecimalPlaces,
  roundToSignificant,
  shouldAbbreviate,
  CURRENCY_SYMBOLS,
  CURRENCY_DECIMALS,
  type TemperatureUnit,
  type SpeedUnit,
} from './formatting.js';

// ─────────────────────────────────────────────────────────────────────────────────
// PHASE 5: LEAK GUARD (Re-exports)
// These would be imported from Phase 5 files in a full implementation
// ─────────────────────────────────────────────────────────────────────────────────

// NOTE: Phase 5 exports would be included here when integrated
// For now, we define the expected interface

/**
 * Phase 5 Leak Guard exports (to be integrated):
 * 
 * - validateModelOutput
 * - validateMultiCategory
 * - wouldPassValidation
 * - isForbidMode
 * - isAllowlistMode
 * - getDebugInfo
 * - checkNumericLeak
 * - getResultSummary
 * - isCriticalFailure
 * - checkLeakForbidMode
 * - checkLeakAllowlistMode
 * - getViolationMatches
 * - CONTEXT_KEYWORDS
 * - getPattern
 * - findAllMatches
 * - hasAnyNumeric
 * - isAlwaysExemptPattern
 * - isExempted
 * - checkExemptions
 * - filterNonExempted
 * - getSafeResponse
 * - buildContextualSafeResponse
 * - getInvalidStateResponse
 * - validateAllTemplates
 */

// ─────────────────────────────────────────────────────────────────────────────────
// TYPE RE-EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

// Re-export constraint types for convenience
export type {
  NumericToken,
  NumericTokenSet,
  NumericExemptions,
  ResponseConstraints,
  NumericContextKey,
  ConstraintLevel as ResponseConstraintLevel,
} from '../../types/constraints.js';

// Re-export provider types
export type {
  ProviderData,
  StockData,
  FxData,
  CryptoData,
  WeatherData,
  TimeData,
  ProviderResult,
  ProviderOkResult,
  ProviderErrResult,
  ProviderError,
  ProviderErrorCode,
  FreshnessPolicy,
} from '../../types/provider-results.js';

// Re-export lens types
export type {
  EvidencePack,
  ContextItem,
  ContextSource,
  RetrievalStatus,
  RetrievalOutcome,
  LensGateResult,
  LensMode,
} from '../../types/lens.js';

// Re-export data-need types
export type {
  TruthMode,
  FallbackMode,
  DataNeedClassification,
  ClassificationConfidence,
} from '../../types/data-need.js';

// Re-export LiveCategory
export type { LiveCategory } from '../../types/categories.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CONVENIENCE FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

import { getFailureSemantics } from './failure-semantics.js';
import { buildConstraints } from './constraints-builder.js';
import { buildAugmentedMessage } from './evidence-injection.js';
import type { LiveCategory } from '../../types/categories.js';
import type { TruthMode, FallbackMode } from '../../types/data-need.js';
import type { ProviderResult } from '../../types/provider-results.js';
import type { ResponseConstraints } from '../../types/constraints.js';

/**
 * Complete pipeline: semantics → constraints → augmented message.
 * 
 * This is the main convenience function for the typical use case.
 * 
 * @param userQuery - Original user query
 * @param truthMode - How data was supposed to be sourced
 * @param category - Primary live data category
 * @param providerResult - Provider result (success or failure)
 * @param fallbackMode - Configured fallback mode
 * @returns Augmented message result with constraints
 */
export function processLiveDataRequest(
  userQuery: string,
  truthMode: TruthMode,
  category: LiveCategory,
  providerResult: ProviderResult,
  fallbackMode: FallbackMode
): {
  augmentedMessage: string;
  constraints: ResponseConstraints;
  canProceed: boolean;
  reason: string;
} {
  // 1. Determine failure semantics
  const providerStatus = providerResult.ok ? 'verified' : 'failed';
  const semantics = getFailureSemantics(truthMode, category, providerStatus, fallbackMode);
  
  // 2. Check if we can proceed
  if (semantics.proceed === 'refuse') {
    return {
      augmentedMessage: userQuery, // Return original - will be handled by caller
      constraints: buildConstraints(semantics, null, category).constraints,
      canProceed: false,
      reason: semantics.reason,
    };
  }
  
  // 3. Build constraints
  const { constraints } = buildConstraints(
    semantics,
    providerResult.ok ? providerResult : null,
    category
  );
  
  // 4. Build augmented message
  const providerResults = new Map<LiveCategory, ProviderResult>();
  providerResults.set(category, providerResult);
  
  const { augmentedMessage } = buildAugmentedMessage(
    userQuery,
    providerResults,
    constraints
  );
  
  return {
    augmentedMessage,
    constraints,
    canProceed: true,
    reason: semantics.reason,
  };
}

/**
 * Quick check if a category+status combination allows numeric precision.
 */
export function allowsNumericPrecision(
  truthMode: TruthMode,
  category: LiveCategory,
  providerStatus: 'verified' | 'stale' | 'degraded' | 'failed',
  fallbackMode: FallbackMode
): boolean {
  const semantics = getFailureSemantics(truthMode, category, providerStatus, fallbackMode);
  return semantics.numericPrecisionAllowed;
}

/**
 * Quick check if a request should be refused (insufficient data).
 */
export function shouldRefuse(
  truthMode: TruthMode,
  category: LiveCategory,
  providerStatus: 'verified' | 'stale' | 'degraded' | 'failed',
  fallbackMode: FallbackMode
): boolean {
  const semantics = getFailureSemantics(truthMode, category, providerStatus, fallbackMode);
  return semantics.proceed === 'refuse';
}
