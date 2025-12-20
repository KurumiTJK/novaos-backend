// ═══════════════════════════════════════════════════════════════════════════════
// FAILURE SEMANTICS — Central Failure Handling (CODE-ENFORCED)
// Phase 6: Evidence & Injection
// 
// This module is the SINGLE SOURCE OF TRUTH for what happens when providers fail.
// All paths through the system that handle provider failures MUST go through
// getFailureSemantics().
// 
// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║  CRITICAL INVARIANT: TIME HAS NO QUALITATIVE FALLBACK                        ║
// ║                                                                               ║
// ║  Time category CANNOT degrade to "qualitative" responses. There is no        ║
// ║  meaningful qualitative answer to "What time is it?"                         ║
// ║                                                                               ║
// ║  If time provider fails → insufficient → refuse to answer                    ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝
// ═══════════════════════════════════════════════════════════════════════════════

import type { LiveCategory } from '../../types/categories.js';
import type { TruthMode, FallbackMode } from '../../types/data-need.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Provider status for failure semantics determination.
 */
export type ProviderStatus =
  | 'verified'      // Provider returned verified data
  | 'stale'         // Provider returned stale cached data
  | 'degraded'      // Provider returned partial/degraded data
  | 'failed';       // Provider failed completely

/**
 * Constraint level to apply based on failure semantics.
 */
export type ConstraintLevel =
  | 'quote_evidence_only'     // Only quote from evidence, no extrapolation
  | 'forbid_numeric_claims'   // No numeric claims allowed
  | 'qualitative_only'        // Only qualitative statements allowed
  | 'insufficient'            // Cannot proceed - refuse to answer
  | 'permissive';             // Normal operation, all constraints relaxed

/**
 * Model proceeding status.
 */
export type ModelProceedStatus =
  | 'proceed'                 // Model can generate response
  | 'proceed_degraded'        // Model can generate but with constraints
  | 'refuse';                 // Model should not generate, return error

/**
 * Complete failure semantics result.
 */
export interface FailureSemantics {
  /** Whether model should proceed */
  readonly proceed: ModelProceedStatus;
  
  /** Constraint level to apply */
  readonly constraintLevel: ConstraintLevel;
  
  /** Whether numeric precision is allowed */
  readonly numericPrecisionAllowed: boolean;
  
  /** Whether action recommendations are allowed */
  readonly actionRecommendationsAllowed: boolean;
  
  /** User message to display (if any) */
  readonly userMessage: string | null;
  
  /** System message for model (if any) */
  readonly systemMessage: string | null;
  
  /** Reason for this semantic determination */
  readonly reason: string;
  
  /** Whether this is an invalid state */
  readonly isInvalidState: boolean;
  
  /** Categories that triggered this semantic */
  readonly triggeredBy: readonly LiveCategory[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// FAILURE SEMANTICS MATRIX (THE SOURCE OF TRUTH)
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * ┌─────────────┬──────────┬──────────┬──────────────┬─────────┬─────────────────────┐
 * │ TruthMode   │ Category │ Provider │ Fallback     │ Model?  │ Constraints         │
 * ├─────────────┼──────────┼──────────┼──────────────┼─────────┼─────────────────────┤
 * │ local       │ any      │ n/a      │ n/a          │ yes     │ permissive          │
 * │ live_feed   │ market   │ verified │ -            │ yes     │ quote_evidence_only │
 * │ live_feed   │ market   │ stale    │ -            │ yes     │ quote_evidence_only │
 * │ live_feed   │ market   │ fail     │ degrade      │ yes     │ forbid_numeric      │
 * │ live_feed   │ market   │ fail     │ refuse       │ no      │ insufficient        │
 * │ live_feed   │ crypto   │ verified │ -            │ yes     │ quote_evidence_only │
 * │ live_feed   │ crypto   │ fail     │ degrade      │ yes     │ forbid_numeric      │
 * │ live_feed   │ fx       │ verified │ -            │ yes     │ quote_evidence_only │
 * │ live_feed   │ fx       │ fail     │ degrade      │ yes     │ forbid_numeric      │
 * │ live_feed   │ weather  │ verified │ -            │ yes     │ quote_evidence_only │
 * │ live_feed   │ weather  │ fail     │ degrade      │ yes     │ qualitative_only    │
 * │ live_feed   │ time     │ verified │ -            │ yes     │ quote_evidence_only │
 * │ live_feed   │ time     │ fail     │ ANY          │ NO      │ insufficient        │ ← CRITICAL
 * │ mixed       │ any      │ partial  │ -            │ yes     │ forbid_numeric      │
 * │ mixed       │ any      │ fail     │ -            │ yes     │ forbid_numeric      │
 * │ auth_verify │ any      │ verified │ -            │ yes     │ quote_evidence_only │
 * │ auth_verify │ any      │ fail     │ acknowledge  │ yes*    │ qualitative_only    │
 * │ web_research│ any      │ verified │ -            │ yes     │ quote_evidence_only │
 * │ web_research│ any      │ fail     │ degrade      │ yes     │ qualitative_only    │
 * └─────────────┴──────────┴──────────┴──────────────┴─────────┴─────────────────────┘
 */

// ─────────────────────────────────────────────────────────────────────────────────
// MAIN FUNCTION — THE SINGLE SOURCE OF TRUTH
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Determine failure semantics based on truth mode, category, provider status, and fallback.
 * 
 * THIS IS THE CENTRAL FUNCTION. All failure handling MUST go through here.
 * 
 * @param truthMode - How data was supposed to be sourced
 * @param category - The live data category
 * @param providerStatus - Current provider status
 * @param fallbackMode - Configured fallback mode
 * @returns Complete failure semantics
 */
export function getFailureSemantics(
  truthMode: TruthMode,
  category: LiveCategory,
  providerStatus: ProviderStatus,
  fallbackMode: FallbackMode
): FailureSemantics {
  // ═══════════════════════════════════════════════════════════════════════════════
  // CRITICAL: TIME CATEGORY SPECIAL HANDLING
  // Time can NEVER fall back to qualitative. No exceptions.
  // ═══════════════════════════════════════════════════════════════════════════════
  
  if (category === 'time' && providerStatus === 'failed') {
    return createInsufficientSemantics(
      'Time queries require verified data. There is no meaningful qualitative answer to "What time is it?"',
      [category]
    );
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // VERIFIED DATA — Always proceed with quote_evidence_only
  // ═══════════════════════════════════════════════════════════════════════════════
  
  if (providerStatus === 'verified') {
    return createVerifiedSemantics(category);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // STALE DATA — Proceed with warning
  // ═══════════════════════════════════════════════════════════════════════════════
  
  if (providerStatus === 'stale') {
    return createStaleSemantics(category);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // DEGRADED DATA — Proceed with partial constraints
  // ═══════════════════════════════════════════════════════════════════════════════
  
  if (providerStatus === 'degraded') {
    return createDegradedSemantics(category, truthMode);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // FAILED PROVIDER — Handle based on truth mode and fallback
  // ═══════════════════════════════════════════════════════════════════════════════
  
  // Exhaustive switch on truth mode
  switch (truthMode) {
    case 'local':
      // Local mode doesn't use providers, this is an invalid state
      return createInvalidStateSemantics(
        'Local truth mode should not have provider failures',
        [category]
      );
    
    case 'live_feed':
      return handleLiveFeedFailure(category, fallbackMode);
    
    case 'authoritative_verify':
      return handleAuthoritativeFailure(category, fallbackMode);
    
    case 'web_research':
      return handleWebResearchFailure(category, fallbackMode);
    
    case 'mixed':
      return handleMixedFailure(category, fallbackMode);
    
    default:
      // Exhaustive check
      const _exhaustive: never = truthMode;
      return createInvalidStateSemantics(
        `Unknown truth mode: ${_exhaustive}`,
        [category]
      );
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// TRUTH MODE SPECIFIC HANDLERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Handle live_feed provider failure.
 */
function handleLiveFeedFailure(
  category: LiveCategory,
  fallbackMode: FallbackMode
): FailureSemantics {
  // Exhaustive switch on fallback mode
  switch (fallbackMode) {
    case 'degrade':
      return createDegradeFallbackSemantics(category);
    
    case 'stale':
      // Stale fallback for failed provider means we don't have stale data
      // This degrades to forbid numeric
      return createDegradeFallbackSemantics(category);
    
    case 'alternative':
      // Alternative provider also failed (we're here because all failed)
      return createDegradeFallbackSemantics(category);
    
    case 'refuse':
      return createInsufficientSemantics(
        `Live data unavailable and fallback mode is 'refuse'`,
        [category]
      );
    
    case 'acknowledge':
      return createAcknowledgeSemantics(category);
    
    default:
      // Exhaustive check
      const _exhaustive: never = fallbackMode;
      return createInvalidStateSemantics(
        `Unknown fallback mode: ${_exhaustive}`,
        [category]
      );
  }
}

/**
 * Handle authoritative_verify provider failure.
 */
function handleAuthoritativeFailure(
  category: LiveCategory,
  fallbackMode: FallbackMode
): FailureSemantics {
  switch (fallbackMode) {
    case 'degrade':
    case 'stale':
    case 'alternative':
      // Authoritative sources can degrade to qualitative
      return {
        proceed: 'proceed_degraded',
        constraintLevel: 'qualitative_only',
        numericPrecisionAllowed: false,
        actionRecommendationsAllowed: true, // Can still give general advice
        userMessage: 'Unable to verify against authoritative sources. Response may be less precise.',
        systemMessage: 'Could not verify against authoritative sources. Provide general guidance only.',
        reason: 'Authoritative verification failed, degrading to qualitative',
        isInvalidState: false,
        triggeredBy: [category],
      };
    
    case 'refuse':
      return createInsufficientSemantics(
        'Authoritative verification required but unavailable',
        [category]
      );
    
    case 'acknowledge':
      return createAcknowledgeSemantics(category);
    
    default:
      const _exhaustive: never = fallbackMode;
      return createInvalidStateSemantics(
        `Unknown fallback mode: ${_exhaustive}`,
        [category]
      );
  }
}

/**
 * Handle web_research provider failure.
 */
function handleWebResearchFailure(
  category: LiveCategory,
  fallbackMode: FallbackMode
): FailureSemantics {
  switch (fallbackMode) {
    case 'degrade':
    case 'stale':
    case 'alternative':
      return {
        proceed: 'proceed_degraded',
        constraintLevel: 'qualitative_only',
        numericPrecisionAllowed: false,
        actionRecommendationsAllowed: true,
        userMessage: 'Unable to search current information. Response based on general knowledge.',
        systemMessage: 'Web search unavailable. Use general knowledge, avoid specific claims.',
        reason: 'Web research failed, degrading to general knowledge',
        isInvalidState: false,
        triggeredBy: [category],
      };
    
    case 'refuse':
      return createInsufficientSemantics(
        'Web research required but unavailable',
        [category]
      );
    
    case 'acknowledge':
      return createAcknowledgeSemantics(category);
    
    default:
      const _exhaustive: never = fallbackMode;
      return createInvalidStateSemantics(
        `Unknown fallback mode: ${_exhaustive}`,
        [category]
      );
  }
}

/**
 * Handle mixed mode provider failure.
 */
function handleMixedFailure(
  category: LiveCategory,
  fallbackMode: FallbackMode
): FailureSemantics {
  // Mixed mode with failure always forbids numeric claims
  // but can proceed with qualitative response
  switch (fallbackMode) {
    case 'degrade':
    case 'stale':
    case 'alternative':
      return {
        proceed: 'proceed_degraded',
        constraintLevel: 'forbid_numeric_claims',
        numericPrecisionAllowed: false,
        actionRecommendationsAllowed: false,
        userMessage: 'Some live data unavailable. Response will not include specific numbers.',
        systemMessage: 'Mixed data fetch partially failed. Do not make numeric claims.',
        reason: 'Mixed mode partial failure, forbidding numeric claims',
        isInvalidState: false,
        triggeredBy: [category],
      };
    
    case 'refuse':
      return createInsufficientSemantics(
        'Mixed data required but partially unavailable',
        [category]
      );
    
    case 'acknowledge':
      return createAcknowledgeSemantics(category);
    
    default:
      const _exhaustive: never = fallbackMode;
      return createInvalidStateSemantics(
        `Unknown fallback mode: ${_exhaustive}`,
        [category]
      );
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SEMANTICS FACTORIES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create semantics for verified provider data.
 */
function createVerifiedSemantics(category: LiveCategory): FailureSemantics {
  return {
    proceed: 'proceed',
    constraintLevel: 'quote_evidence_only',
    numericPrecisionAllowed: true,
    actionRecommendationsAllowed: false, // No buy/sell recommendations even with verified data
    userMessage: null,
    systemMessage: 'Use ONLY the numeric values from the provided evidence. Do not extrapolate.',
    reason: 'Provider returned verified data',
    isInvalidState: false,
    triggeredBy: [category],
  };
}

/**
 * Create semantics for stale cached data.
 */
function createStaleSemantics(category: LiveCategory): FailureSemantics {
  return {
    proceed: 'proceed',
    constraintLevel: 'quote_evidence_only',
    numericPrecisionAllowed: true,
    actionRecommendationsAllowed: false,
    userMessage: 'Note: This data may be slightly outdated.',
    systemMessage: 'Data is stale. Include freshness warning in response.',
    reason: 'Provider returned stale cached data',
    isInvalidState: false,
    triggeredBy: [category],
  };
}

/**
 * Create semantics for degraded provider data.
 */
function createDegradedSemantics(
  category: LiveCategory,
  truthMode: TruthMode
): FailureSemantics {
  return {
    proceed: 'proceed_degraded',
    constraintLevel: 'forbid_numeric_claims',
    numericPrecisionAllowed: false,
    actionRecommendationsAllowed: false,
    userMessage: 'Some data fields unavailable. Response may be incomplete.',
    systemMessage: 'Provider returned partial data. Only use explicitly provided values.',
    reason: `Provider returned degraded data in ${truthMode} mode`,
    isInvalidState: false,
    triggeredBy: [category],
  };
}

/**
 * Create semantics for degrade fallback.
 */
function createDegradeFallbackSemantics(category: LiveCategory): FailureSemantics {
  // Category-specific degradation
  const isWeather = category === 'weather';
  
  return {
    proceed: 'proceed_degraded',
    constraintLevel: isWeather ? 'qualitative_only' : 'forbid_numeric_claims',
    numericPrecisionAllowed: false,
    actionRecommendationsAllowed: false,
    userMessage: 'Live data unavailable. Response will not include specific numbers.',
    systemMessage: isWeather
      ? 'Weather data unavailable. Provide only qualitative descriptions (e.g., "typically warm").'
      : 'Live data unavailable. Do not make any numeric claims. Suggest checking external sources.',
    reason: `Live feed failed, degrading to ${isWeather ? 'qualitative' : 'no-numeric'} response`,
    isInvalidState: false,
    triggeredBy: [category],
  };
}

/**
 * Create semantics for acknowledge fallback.
 */
function createAcknowledgeSemantics(category: LiveCategory): FailureSemantics {
  return {
    proceed: 'proceed_degraded',
    constraintLevel: 'qualitative_only',
    numericPrecisionAllowed: false,
    actionRecommendationsAllowed: true,
    userMessage: null, // Model will generate appropriate acknowledgment
    systemMessage: 'Acknowledge that live data is unavailable. Offer to help with alternatives.',
    reason: 'Acknowledge mode: inform user of unavailability',
    isInvalidState: false,
    triggeredBy: [category],
  };
}

/**
 * Create semantics for insufficient data (refuse to answer).
 */
function createInsufficientSemantics(
  reason: string,
  categories: readonly LiveCategory[]
): FailureSemantics {
  return {
    proceed: 'refuse',
    constraintLevel: 'insufficient',
    numericPrecisionAllowed: false,
    actionRecommendationsAllowed: false,
    userMessage: null, // Will be replaced with safe response
    systemMessage: null,
    reason,
    isInvalidState: false,
    triggeredBy: categories,
  };
}

/**
 * Create semantics for invalid system state.
 */
function createInvalidStateSemantics(
  reason: string,
  categories: readonly LiveCategory[]
): FailureSemantics {
  return {
    proceed: 'refuse',
    constraintLevel: 'insufficient',
    numericPrecisionAllowed: false,
    actionRecommendationsAllowed: false,
    userMessage: 'An unexpected error occurred. Please try again.',
    systemMessage: `INVALID STATE: ${reason}`,
    reason: `INVALID STATE: ${reason}`,
    isInvalidState: true,
    triggeredBy: categories,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Validate that semantics are internally consistent.
 * 
 * @param semantics - Failure semantics to validate
 * @returns Validation result
 */
export function validateSemantics(semantics: FailureSemantics): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  // If proceed is 'refuse', constraint level should be 'insufficient'
  if (semantics.proceed === 'refuse' && semantics.constraintLevel !== 'insufficient') {
    errors.push(
      `Inconsistent: proceed='refuse' but constraintLevel='${semantics.constraintLevel}' (expected 'insufficient')`
    );
  }
  
  // If constraint level is 'insufficient', proceed should be 'refuse'
  if (semantics.constraintLevel === 'insufficient' && semantics.proceed !== 'refuse') {
    errors.push(
      `Inconsistent: constraintLevel='insufficient' but proceed='${semantics.proceed}' (expected 'refuse')`
    );
  }
  
  // If numeric precision is allowed, constraint level should allow it
  if (semantics.numericPrecisionAllowed && 
      (semantics.constraintLevel === 'forbid_numeric_claims' ||
       semantics.constraintLevel === 'qualitative_only' ||
       semantics.constraintLevel === 'insufficient')) {
    errors.push(
      `Inconsistent: numericPrecisionAllowed=true but constraintLevel='${semantics.constraintLevel}'`
    );
  }
  
  // Must have at least one triggered category
  if (semantics.triggeredBy.length === 0) {
    errors.push('triggeredBy must contain at least one category');
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate that the failure semantics matrix is correctly implemented.
 * Used for testing.
 */
export function validateFailureSemanticsMatrix(): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST: Time category failure MUST result in 'insufficient'
  // ═══════════════════════════════════════════════════════════════════════════════
  
  const timeCategories: LiveCategory[] = ['time'];
  const fallbackModes: FallbackMode[] = ['degrade', 'stale', 'alternative', 'refuse', 'acknowledge'];
  
  for (const fallback of fallbackModes) {
    const result = getFailureSemantics('live_feed', 'time', 'failed', fallback);
    
    if (result.constraintLevel !== 'insufficient') {
      errors.push(
        `CRITICAL: time + failed + ${fallback} should be 'insufficient' but got '${result.constraintLevel}'`
      );
    }
    
    if (result.proceed !== 'refuse') {
      errors.push(
        `CRITICAL: time + failed + ${fallback} should proceed='refuse' but got '${result.proceed}'`
      );
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST: Verified data should always allow numeric precision
  // ═══════════════════════════════════════════════════════════════════════════════
  
  const categories: LiveCategory[] = ['market', 'crypto', 'fx', 'weather', 'time'];
  
  for (const category of categories) {
    const result = getFailureSemantics('live_feed', category, 'verified', 'degrade');
    
    if (!result.numericPrecisionAllowed) {
      errors.push(
        `${category} + verified should allow numeric precision`
      );
    }
    
    if (result.constraintLevel !== 'quote_evidence_only') {
      errors.push(
        `${category} + verified should be 'quote_evidence_only' but got '${result.constraintLevel}'`
      );
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST: All refuse fallbacks should result in insufficient
  // ═══════════════════════════════════════════════════════════════════════════════
  
  for (const category of categories) {
    if (category === 'time') continue; // Already tested
    
    const result = getFailureSemantics('live_feed', category, 'failed', 'refuse');
    
    if (result.constraintLevel !== 'insufficient') {
      errors.push(
        `${category} + failed + refuse should be 'insufficient' but got '${result.constraintLevel}'`
      );
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Check if semantics allow model to proceed.
 */
export function canProceed(semantics: FailureSemantics): boolean {
  return semantics.proceed !== 'refuse';
}

/**
 * Check if semantics allow numeric content.
 */
export function allowsNumeric(semantics: FailureSemantics): boolean {
  return semantics.numericPrecisionAllowed;
}

/**
 * Check if semantics represent an error state.
 */
export function isErrorState(semantics: FailureSemantics): boolean {
  return semantics.isInvalidState || semantics.constraintLevel === 'insufficient';
}

/**
 * Get human-readable description of constraint level.
 */
export function getConstraintDescription(level: ConstraintLevel): string {
  switch (level) {
    case 'quote_evidence_only':
      return 'Only quote numeric values from provided evidence';
    case 'forbid_numeric_claims':
      return 'No numeric claims allowed in response';
    case 'qualitative_only':
      return 'Only qualitative statements allowed';
    case 'insufficient':
      return 'Cannot proceed - insufficient data';
    case 'permissive':
      return 'Normal operation - no special constraints';
    default:
      return 'Unknown constraint level';
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// MULTI-CATEGORY HANDLING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Get combined failure semantics for multiple categories.
 * Uses the MOST RESTRICTIVE semantics.
 * 
 * @param categoryResults - Map of category to semantics
 * @returns Combined semantics (most restrictive)
 */
export function combineSemantics(
  categoryResults: ReadonlyMap<LiveCategory, FailureSemantics>
): FailureSemantics {
  if (categoryResults.size === 0) {
    return createInvalidStateSemantics('No category results provided', []);
  }
  
  // Priority order (most to least restrictive)
  const constraintPriority: ConstraintLevel[] = [
    'insufficient',
    'forbid_numeric_claims',
    'qualitative_only',
    'quote_evidence_only',
    'permissive',
  ];
  
  const proceedPriority: ModelProceedStatus[] = [
    'refuse',
    'proceed_degraded',
    'proceed',
  ];
  
  let mostRestrictive: FailureSemantics | null = null;
  const allCategories: LiveCategory[] = [];
  
  for (const [category, semantics] of categoryResults) {
    allCategories.push(category);
    
    if (!mostRestrictive) {
      mostRestrictive = semantics;
      continue;
    }
    
    // Compare constraint levels
    const currentPriority = constraintPriority.indexOf(mostRestrictive.constraintLevel);
    const newPriority = constraintPriority.indexOf(semantics.constraintLevel);
    
    if (newPriority < currentPriority) {
      mostRestrictive = semantics;
    } else if (newPriority === currentPriority) {
      // Same constraint level - compare proceed status
      const currentProceed = proceedPriority.indexOf(mostRestrictive.proceed);
      const newProceed = proceedPriority.indexOf(semantics.proceed);
      
      if (newProceed < currentProceed) {
        mostRestrictive = semantics;
      }
    }
  }
  
  // Return combined with all triggered categories
  return {
    ...mostRestrictive!,
    triggeredBy: allCategories,
    reason: mostRestrictive!.reason + ` (combined from ${allCategories.length} categories)`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export {
  createVerifiedSemantics,
  createStaleSemantics,
  createInsufficientSemantics,
  createInvalidStateSemantics,
};
