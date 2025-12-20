// ═══════════════════════════════════════════════════════════════════════════════
// CONSTRAINTS BUILDER — Build ResponseConstraints from Failure Semantics
// Phase 6: Evidence & Injection
// 
// This module builds ResponseConstraints based on:
// 1. Failure semantics (what level of constraint to apply)
// 2. Provider result (tokens to allow if verified)
// 3. Category (what exemptions are appropriate)
// 
// The constraints are consumed by:
// - Model gate (prompt construction)
// - Post-model validation (leak guard)
// ═══════════════════════════════════════════════════════════════════════════════

import type { LiveCategory } from '../../types/categories.js';
import type {
  ResponseConstraints,
  NumericTokenSet,
  NumericExemptions,
  ConstraintLevel,
} from '../../types/constraints.js';
import type { ProviderResult, ProviderOkResult } from '../../types/provider-results.js';

import {
  FailureSemantics,
  ConstraintLevel as SemanticsConstraintLevel,
  canProceed,
  allowsNumeric,
} from './failure-semantics.js';

import {
  extractTokensFromData,
  buildTokenSet,
} from './numeric-tokens.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Options for constraint building.
 */
export interface ConstraintBuildOptions {
  /** Include freshness warning in constraints */
  readonly includeFreshnessWarning?: boolean;
  
  /** Custom banned phrases */
  readonly bannedPhrases?: readonly string[];
  
  /** Custom required phrases */
  readonly requiredPhrases?: readonly string[];
  
  /** Override exemptions */
  readonly exemptionOverrides?: Partial<NumericExemptions>;
}

/**
 * Result of constraint building.
 */
export interface ConstraintBuildResult {
  /** Built constraints */
  readonly constraints: ResponseConstraints;
  
  /** Whether constraints are valid */
  readonly valid: boolean;
  
  /** Validation errors if any */
  readonly errors: readonly string[];
  
  /** Human-readable summary */
  readonly summary: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// DEFAULT EXEMPTIONS BY CONSTRAINT LEVEL
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Standard exemptions for quote_evidence_only mode.
 * Allow structural numbers but require tokens for data.
 */
const QUOTE_EVIDENCE_EXEMPTIONS: NumericExemptions = {
  allowYears: true,
  allowDates: true,
  allowSmallIntegers: true,
  smallIntegerMax: 10,
  allowExplanatoryPercentages: false, // Must come from tokens
  allowOrdinals: true,
  allowInCodeBlocks: true,
  allowInQuotes: true,
  customPatterns: [],
};

/**
 * Strict exemptions for forbid_numeric_claims mode.
 * Only allow structural numbers.
 */
const FORBID_NUMERIC_EXEMPTIONS: NumericExemptions = {
  allowYears: true,
  allowDates: true,
  allowSmallIntegers: true,
  smallIntegerMax: 5, // More restrictive
  allowExplanatoryPercentages: false,
  allowOrdinals: true,
  allowInCodeBlocks: true,
  allowInQuotes: false, // Don't allow in quotes - could be fabricated
  customPatterns: [],
};

/**
 * Minimal exemptions for qualitative_only mode.
 * Almost no numbers allowed.
 */
const QUALITATIVE_EXEMPTIONS: NumericExemptions = {
  allowYears: true,
  allowDates: false,
  allowSmallIntegers: true,
  smallIntegerMax: 3, // Very restrictive
  allowExplanatoryPercentages: false,
  allowOrdinals: true,
  allowInCodeBlocks: false,
  allowInQuotes: false,
  customPatterns: [],
};

/**
 * No exemptions for insufficient mode.
 */
const NO_EXEMPTIONS: NumericExemptions = {
  allowYears: false,
  allowDates: false,
  allowSmallIntegers: false,
  smallIntegerMax: 0,
  allowExplanatoryPercentages: false,
  allowOrdinals: false,
  allowInCodeBlocks: false,
  allowInQuotes: false,
  customPatterns: [],
};

/**
 * Permissive exemptions for local/passthrough mode.
 */
const PERMISSIVE_EXEMPTIONS: NumericExemptions = {
  allowYears: true,
  allowDates: true,
  allowSmallIntegers: true,
  smallIntegerMax: 100,
  allowExplanatoryPercentages: true,
  allowOrdinals: true,
  allowInCodeBlocks: true,
  allowInQuotes: true,
  customPatterns: [],
};

/**
 * Get exemptions for a constraint level.
 */
function getExemptionsForLevel(level: SemanticsConstraintLevel): NumericExemptions {
  switch (level) {
    case 'quote_evidence_only':
      return QUOTE_EVIDENCE_EXEMPTIONS;
    case 'forbid_numeric_claims':
      return FORBID_NUMERIC_EXEMPTIONS;
    case 'qualitative_only':
      return QUALITATIVE_EXEMPTIONS;
    case 'insufficient':
      return NO_EXEMPTIONS;
    case 'permissive':
      return PERMISSIVE_EXEMPTIONS;
    default:
      // Exhaustive check
      const _exhaustive: never = level;
      return NO_EXEMPTIONS;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// BANNED PHRASES BY CATEGORY
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Phrases that should NEVER appear in responses with live data.
 * These indicate the model is fabricating or speculating.
 */
const UNIVERSAL_BANNED_PHRASES: readonly string[] = [
  'I believe the price is',
  'I think it might be',
  'The price should be around',
  'It was probably',
  'Last I checked',
  'As of my knowledge',
  'Based on my training',
  'I don\'t have real-time',
  'I cannot access live',
];

/**
 * Category-specific banned phrases.
 */
const CATEGORY_BANNED_PHRASES: ReadonlyMap<LiveCategory, readonly string[]> = new Map([
  ['market', [
    'you should buy',
    'you should sell',
    'I recommend buying',
    'I recommend selling',
    'this is a good investment',
    'this is a bad investment',
    'the stock will go up',
    'the stock will go down',
  ]],
  ['crypto', [
    'you should buy',
    'you should sell',
    'to the moon',
    'guaranteed returns',
    'this coin will',
    'crypto will',
  ]],
  ['fx', [
    'the rate will',
    'currency will strengthen',
    'currency will weaken',
    'you should exchange now',
  ]],
  ['weather', [
    // Weather has fewer banned phrases
  ]],
  ['time', [
    // Time has no banned phrases
  ]],
]);

/**
 * Get banned phrases for categories.
 */
function getBannedPhrases(categories: readonly LiveCategory[]): string[] {
  const phrases = [...UNIVERSAL_BANNED_PHRASES];
  
  for (const category of categories) {
    const categoryPhrases = CATEGORY_BANNED_PHRASES.get(category);
    if (categoryPhrases) {
      phrases.push(...categoryPhrases);
    }
  }
  
  return phrases;
}

// ─────────────────────────────────────────────────────────────────────────────────
// REQUIRED PHRASES BY CONSTRAINT LEVEL
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Phrases that MUST appear when data is stale.
 */
const STALE_DATA_PHRASES: readonly string[] = [
  // At least one of these should appear
  'may be outdated',
  'might not reflect',
  'check for latest',
  'verify current',
  'data from',
];

/**
 * Phrases for degraded mode responses.
 */
const DEGRADED_MODE_PHRASES: readonly string[] = [
  // At least one of these should appear
  'unable to retrieve',
  'couldn\'t access',
  'for current',
  'check',
  'visit',
];

// ─────────────────────────────────────────────────────────────────────────────────
// MAIN BUILDER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Build constraints from failure semantics and provider result.
 * 
 * @param semantics - Failure semantics determining constraint level
 * @param providerResult - Provider result (may contain tokens)
 * @param category - Primary category
 * @param options - Build options
 * @returns Built constraints with validation
 */
export function buildConstraints(
  semantics: FailureSemantics,
  providerResult: ProviderResult | null,
  category: LiveCategory,
  options: ConstraintBuildOptions = {}
): ConstraintBuildResult {
  const errors: string[] = [];
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // INSUFFICIENT — Cannot proceed
  // ═══════════════════════════════════════════════════════════════════════════════
  
  if (semantics.constraintLevel === 'insufficient') {
    return buildInsufficientConstraints(semantics, category);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // QUALITATIVE ONLY — No numeric precision, no tokens
  // ═══════════════════════════════════════════════════════════════════════════════
  
  if (semantics.constraintLevel === 'qualitative_only') {
    return buildQualitativeConstraints(semantics, category, options);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // FORBID NUMERIC — No numeric precision, no tokens
  // ═══════════════════════════════════════════════════════════════════════════════
  
  if (semantics.constraintLevel === 'forbid_numeric_claims') {
    return buildForbidNumericConstraints(semantics, category, options);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // QUOTE EVIDENCE ONLY — Extract tokens from provider result
  // ═══════════════════════════════════════════════════════════════════════════════
  
  if (semantics.constraintLevel === 'quote_evidence_only') {
    if (!providerResult || !providerResult.ok) {
      // Should have verified data but don't - this is inconsistent
      errors.push('quote_evidence_only requires verified provider data');
      return buildForbidNumericConstraints(semantics, category, options);
    }
    
    return buildLiveDataConstraints(semantics, providerResult, category, options);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // PERMISSIVE — No constraints
  // ═══════════════════════════════════════════════════════════════════════════════
  
  if (semantics.constraintLevel === 'permissive') {
    return buildPermissiveConstraints(category);
  }
  
  // Should never reach here
  errors.push(`Unknown constraint level: ${semantics.constraintLevel}`);
  return {
    constraints: buildDefaultConstraints(category),
    valid: false,
    errors,
    summary: 'Unknown constraint level - using defaults',
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// SPECIFIC CONSTRAINT BUILDERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Build constraints for insufficient data (cannot proceed).
 */
export function buildInsufficientConstraints(
  semantics: FailureSemantics,
  category: LiveCategory
): ConstraintBuildResult {
  const constraints: ResponseConstraints = {
    numericPrecisionAllowed: false,
    allowedTokens: null,
    numericExemptions: NO_EXEMPTIONS,
    actionRecommendationsAllowed: false,
    bannedPhrases: getBannedPhrases([category]),
    requiredPhrases: [],
    freshnessWarningRequired: false,
    requiredCitations: [],
    level: 'strict',
    reason: semantics.reason,
    triggeredByCategories: [...semantics.triggeredBy],
  };
  
  return {
    constraints,
    valid: true,
    errors: [],
    summary: `INSUFFICIENT: ${semantics.reason}`,
  };
}

/**
 * Build constraints for qualitative-only mode.
 */
export function buildQualitativeConstraints(
  semantics: FailureSemantics,
  category: LiveCategory,
  options: ConstraintBuildOptions = {}
): ConstraintBuildResult {
  const exemptions = mergeExemptions(
    QUALITATIVE_EXEMPTIONS,
    options.exemptionOverrides
  );
  
  const constraints: ResponseConstraints = {
    numericPrecisionAllowed: false,
    allowedTokens: null,
    numericExemptions: exemptions,
    actionRecommendationsAllowed: semantics.actionRecommendationsAllowed,
    bannedPhrases: [
      ...getBannedPhrases([category]),
      ...(options.bannedPhrases ?? []),
    ],
    requiredPhrases: options.requiredPhrases ?? [],
    freshnessWarningRequired: options.includeFreshnessWarning ?? false,
    requiredCitations: [],
    level: 'strict',
    reason: semantics.reason,
    triggeredByCategories: [...semantics.triggeredBy],
  };
  
  return {
    constraints,
    valid: true,
    errors: [],
    summary: `QUALITATIVE: ${semantics.reason}`,
  };
}

/**
 * Build constraints for forbid-numeric mode.
 */
export function buildForbidNumericConstraints(
  semantics: FailureSemantics,
  category: LiveCategory,
  options: ConstraintBuildOptions = {}
): ConstraintBuildResult {
  const exemptions = mergeExemptions(
    FORBID_NUMERIC_EXEMPTIONS,
    options.exemptionOverrides
  );
  
  const constraints: ResponseConstraints = {
    numericPrecisionAllowed: false,
    allowedTokens: null,
    numericExemptions: exemptions,
    actionRecommendationsAllowed: false,
    bannedPhrases: [
      ...getBannedPhrases([category]),
      ...(options.bannedPhrases ?? []),
    ],
    requiredPhrases: [
      ...DEGRADED_MODE_PHRASES.slice(0, 1), // Require at least one
      ...(options.requiredPhrases ?? []),
    ],
    freshnessWarningRequired: true, // Always warn in degraded mode
    requiredCitations: [],
    level: 'strict',
    reason: semantics.reason,
    triggeredByCategories: [...semantics.triggeredBy],
  };
  
  return {
    constraints,
    valid: true,
    errors: [],
    summary: `FORBID_NUMERIC: ${semantics.reason}`,
  };
}

/**
 * Build constraints for live data mode (with tokens).
 */
export function buildLiveDataConstraints(
  semantics: FailureSemantics,
  providerResult: ProviderOkResult,
  category: LiveCategory,
  options: ConstraintBuildOptions = {}
): ConstraintBuildResult {
  // Extract tokens from provider data
  const tokens = extractTokensFromData(providerResult.data, providerResult.fetchedAt);
  const tokenSet = buildTokenSet(tokens);
  
  const exemptions = mergeExemptions(
    QUOTE_EVIDENCE_EXEMPTIONS,
    options.exemptionOverrides
  );
  
  // Check if data is stale
  const isStale = isDataStale(providerResult);
  
  const constraints: ResponseConstraints = {
    numericPrecisionAllowed: true,
    allowedTokens: tokenSet,
    numericExemptions: exemptions,
    actionRecommendationsAllowed: false, // Never allow recommendations with live data
    bannedPhrases: [
      ...getBannedPhrases([category]),
      ...(options.bannedPhrases ?? []),
    ],
    requiredPhrases: isStale
      ? [...STALE_DATA_PHRASES.slice(0, 1), ...(options.requiredPhrases ?? [])]
      : (options.requiredPhrases ?? []),
    freshnessWarningRequired: isStale || (options.includeFreshnessWarning ?? false),
    requiredCitations: [providerResult.provider],
    level: 'strict',
    reason: semantics.reason,
    triggeredByCategories: [...semantics.triggeredBy],
  };
  
  return {
    constraints,
    valid: true,
    errors: [],
    summary: `LIVE_DATA: ${tokens.length} tokens from ${providerResult.provider}`,
  };
}

/**
 * Build permissive constraints (no restrictions).
 */
export function buildPermissiveConstraints(
  category: LiveCategory
): ConstraintBuildResult {
  const constraints: ResponseConstraints = {
    numericPrecisionAllowed: true,
    allowedTokens: null, // No token restriction
    numericExemptions: PERMISSIVE_EXEMPTIONS,
    actionRecommendationsAllowed: true,
    bannedPhrases: [],
    requiredPhrases: [],
    freshnessWarningRequired: false,
    requiredCitations: [],
    level: 'permissive',
    reason: 'Local/passthrough mode - no live data constraints',
    triggeredByCategories: [category],
  };
  
  return {
    constraints,
    valid: true,
    errors: [],
    summary: 'PERMISSIVE: No live data constraints',
  };
}

/**
 * Build default constraints (fallback).
 */
function buildDefaultConstraints(category: LiveCategory): ResponseConstraints {
  return {
    numericPrecisionAllowed: false,
    allowedTokens: null,
    numericExemptions: FORBID_NUMERIC_EXEMPTIONS,
    actionRecommendationsAllowed: false,
    bannedPhrases: getBannedPhrases([category]),
    requiredPhrases: [],
    freshnessWarningRequired: true,
    requiredCitations: [],
    level: 'strict',
    reason: 'Default constraints applied',
    triggeredByCategories: [category],
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// MULTI-PROVIDER CONSTRAINT BUILDING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Build constraints from multiple provider results.
 * 
 * @param results - Map of category to provider result and semantics
 * @param options - Build options
 * @returns Combined constraints
 */
export function buildMultiProviderConstraints(
  results: ReadonlyMap<LiveCategory, {
    semantics: FailureSemantics;
    providerResult: ProviderResult | null;
  }>,
  options: ConstraintBuildOptions = {}
): ConstraintBuildResult {
  if (results.size === 0) {
    return {
      constraints: buildDefaultConstraints('market'),
      valid: false,
      errors: ['No provider results provided'],
      summary: 'ERROR: No results',
    };
  }
  
  const allConstraints: ResponseConstraints[] = [];
  const allErrors: string[] = [];
  const summaries: string[] = [];
  
  for (const [category, { semantics, providerResult }] of results) {
    const result = buildConstraints(semantics, providerResult, category, options);
    allConstraints.push(result.constraints);
    allErrors.push(...result.errors);
    summaries.push(`${category}: ${result.summary}`);
  }
  
  // Merge constraints (most restrictive wins)
  const merged = mergeConstraints(allConstraints);
  
  return {
    constraints: merged,
    valid: allErrors.length === 0,
    errors: allErrors,
    summary: summaries.join('; '),
  };
}

/**
 * Merge multiple constraints (most restrictive wins).
 */
function mergeConstraints(constraints: readonly ResponseConstraints[]): ResponseConstraints {
  if (constraints.length === 0) {
    return buildDefaultConstraints('market');
  }
  
  if (constraints.length === 1) {
    return constraints[0]!;
  }
  
  // Find most restrictive
  let mostRestrictive = constraints[0]!;
  
  for (const c of constraints.slice(1)) {
    // If any is strict with no numeric, that wins
    if (!c.numericPrecisionAllowed && mostRestrictive.numericPrecisionAllowed) {
      mostRestrictive = c;
      continue;
    }
    
    // If levels differ, use stricter
    if (c.level === 'strict' && mostRestrictive.level !== 'strict') {
      mostRestrictive = c;
    }
  }
  
  // Merge tokens if both allow numeric
  let mergedTokens: NumericTokenSet | null = null;
  if (mostRestrictive.numericPrecisionAllowed) {
    const allTokens = new Map<string, import('../../types/constraints.js').NumericToken>();
    const byValue = new Map<number, import('../../types/constraints.js').NumericToken[]>();
    const byContext = new Map<import('../../types/constraints.js').NumericContextKey, import('../../types/constraints.js').NumericToken[]>();
    
    for (const c of constraints) {
      if (c.allowedTokens) {
        for (const [key, token] of c.allowedTokens.tokens) {
          allTokens.set(key, token);
          
          const valueTokens = byValue.get(token.value) ?? [];
          valueTokens.push(token);
          byValue.set(token.value, valueTokens);
          
          const contextTokens = byContext.get(token.contextKey) ?? [];
          contextTokens.push(token);
          byContext.set(token.contextKey, contextTokens);
        }
      }
    }
    
    if (allTokens.size > 0) {
      mergedTokens = { tokens: allTokens, byValue, byContext };
    }
  }
  
  // Merge banned phrases (union)
  const allBanned = new Set<string>();
  for (const c of constraints) {
    for (const phrase of c.bannedPhrases) {
      allBanned.add(phrase);
    }
  }
  
  // Merge triggered categories
  const allCategories = new Set<LiveCategory>();
  for (const c of constraints) {
    for (const cat of c.triggeredByCategories) {
      allCategories.add(cat);
    }
  }
  
  return {
    ...mostRestrictive,
    allowedTokens: mergedTokens,
    bannedPhrases: [...allBanned],
    triggeredByCategories: [...allCategories],
    freshnessWarningRequired: constraints.some(c => c.freshnessWarningRequired),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Merge exemption overrides with base exemptions.
 */
function mergeExemptions(
  base: NumericExemptions,
  overrides?: Partial<NumericExemptions>
): NumericExemptions {
  if (!overrides) {
    return base;
  }
  
  return {
    allowYears: overrides.allowYears ?? base.allowYears,
    allowDates: overrides.allowDates ?? base.allowDates,
    allowSmallIntegers: overrides.allowSmallIntegers ?? base.allowSmallIntegers,
    smallIntegerMax: overrides.smallIntegerMax ?? base.smallIntegerMax,
    allowExplanatoryPercentages: overrides.allowExplanatoryPercentages ?? base.allowExplanatoryPercentages,
    allowOrdinals: overrides.allowOrdinals ?? base.allowOrdinals,
    allowInCodeBlocks: overrides.allowInCodeBlocks ?? base.allowInCodeBlocks,
    allowInQuotes: overrides.allowInQuotes ?? base.allowInQuotes,
    customPatterns: overrides.customPatterns ?? base.customPatterns,
  };
}

/**
 * Check if provider data is stale.
 */
function isDataStale(result: ProviderOkResult, now: number = Date.now()): boolean {
  const age = now - result.fetchedAt;
  return age > result.freshnessPolicy.maxAgeMs;
}

// ─────────────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Validate built constraints for consistency.
 */
export function validateConstraints(constraints: ResponseConstraints): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  // If numeric precision is allowed, should have tokens or be permissive
  if (constraints.numericPrecisionAllowed && 
      constraints.allowedTokens === null && 
      constraints.level === 'strict') {
    errors.push(
      'numericPrecisionAllowed=true with level=strict requires allowedTokens'
    );
  }
  
  // If tokens exist, numeric precision should be allowed
  if (constraints.allowedTokens !== null && !constraints.numericPrecisionAllowed) {
    errors.push(
      'allowedTokens provided but numericPrecisionAllowed=false'
    );
  }
  
  // Level should match numeric precision setting
  if (constraints.level === 'permissive' && !constraints.numericPrecisionAllowed) {
    errors.push(
      'level=permissive should have numericPrecisionAllowed=true'
    );
  }
  
  // Should have at least one triggered category
  if (constraints.triggeredByCategories.length === 0) {
    errors.push('triggeredByCategories must not be empty');
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export {
  QUOTE_EVIDENCE_EXEMPTIONS,
  FORBID_NUMERIC_EXEMPTIONS,
  QUALITATIVE_EXEMPTIONS,
  NO_EXEMPTIONS,
  PERMISSIVE_EXEMPTIONS,
  UNIVERSAL_BANNED_PHRASES,
};
