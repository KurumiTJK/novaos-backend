// ═══════════════════════════════════════════════════════════════════════════════
// RISK ASSESSOR — Risk Assessment for Live Data Queries
// Phase 7: Lens Gate
// 
// This module assesses risk levels for queries requiring live data and determines
// whether forceHigh should be set. The forceHigh flag is IMMUTABLE once set for
// live_feed or mixed queries - this is a critical system invariant.
// 
// CRITICAL INVARIANT:
// live_feed/mixed queries → forceHigh = true (CANNOT be overridden)
// This ensures that live data queries always go through high-stakes verification.
// ═══════════════════════════════════════════════════════════════════════════════

import type { LiveCategory, AuthoritativeCategory } from '../../../types/categories.js';
import type { TruthMode, DataNeedClassification } from '../../../types/data-need.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Risk assessment result.
 */
export interface RiskAssessment {
  /** Whether this query requires HIGH tier verification */
  readonly forceHigh: boolean;
  
  /** Overall risk score (0-1) */
  readonly riskScore: number;
  
  /** Detected risk factors */
  readonly riskFactors: readonly RiskFactor[];
  
  /** Stakes level for this query */
  readonly stakes: StakesLevel;
  
  /** Human-readable reasoning for the assessment */
  readonly reasoning: string;
  
  /** Whether forceHigh was set due to the immutable invariant */
  readonly forceHighReason: ForceHighReason;
}

/**
 * Risk factors that contribute to risk score.
 */
export type RiskFactor =
  | 'live_data_required'      // Query requires real-time data
  | 'time_critical'           // Time data has no fallback
  | 'financial_data'          // Market/crypto/FX data
  | 'numeric_precision'       // Specific numbers required
  | 'freshness_critical'      // Stale data would be harmful
  | 'no_fallback_available'   // Category has no qualitative fallback
  | 'high_stakes_domain'      // Health/legal/financial domain
  | 'decision_pressure'       // User making a decision based on this
  | 'volatile_data'           // Data changes rapidly
  | 'authoritative_required'; // Needs verified sources

/**
 * Stakes level for the query.
 */
export type StakesLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Reason for forceHigh being set.
 */
export type ForceHighReason =
  | 'not_forced'              // forceHigh is false
  | 'live_feed_invariant'     // Set due to live_feed truthMode (IMMUTABLE)
  | 'mixed_mode_invariant'    // Set due to mixed truthMode (IMMUTABLE)
  | 'time_category'           // Time queries always forceHigh
  | 'authoritative_domain'    // Health/legal domain
  | 'high_risk_score'         // Risk score exceeded threshold
  | 'explicit_override';      // Explicitly set by caller

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Risk score threshold for automatic forceHigh.
 */
const FORCE_HIGH_RISK_THRESHOLD = 0.8;

/**
 * Risk weights by category.
 */
const CATEGORY_RISK_WEIGHTS: ReadonlyMap<LiveCategory | AuthoritativeCategory, number> = new Map([
  // Live categories
  ['time', 1.0],      // Time has NO fallback - maximum risk
  ['market', 0.9],    // Financial data - very high risk
  ['crypto', 0.9],    // Crypto data - very high risk
  ['fx', 0.85],       // FX data - high risk
  ['weather', 0.6],   // Weather can have qualitative fallback
  
  // Authoritative categories
  ['medical', 0.95],  // Health/safety critical
  ['legal', 0.9],     // Legal advice is high stakes
  ['government', 0.7], // Government info is important but less volatile
  ['academic', 0.5],  // Academic can often use existing knowledge
]);

/**
 * Categories that have no qualitative fallback.
 */
const NO_FALLBACK_CATEGORIES: ReadonlySet<LiveCategory> = new Set(['time']);

/**
 * Categories with volatile data (changes very frequently).
 */
const VOLATILE_CATEGORIES: ReadonlySet<LiveCategory> = new Set([
  'market',
  'crypto',
  'fx',
  'time',
]);

/**
 * High-stakes domains that require verification.
 */
const HIGH_STAKES_DOMAINS: ReadonlySet<AuthoritativeCategory> = new Set([
  'medical',
  'legal',
]);

// ─────────────────────────────────────────────────────────────────────────────────
// MAIN ASSESSMENT FUNCTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Assess risk for a data need classification.
 * 
 * CRITICAL: This function enforces the forceHigh invariant for live_feed/mixed modes.
 * Once forceHigh is set for these modes, it CANNOT be overridden downstream.
 * 
 * @param classification - The data need classification
 * @returns Risk assessment with forceHigh determination
 * 
 * @example
 * const assessment = assessRisk(classification);
 * if (assessment.forceHigh) {
 *   // Must go through HIGH tier verification
 * }
 */
export function assessRisk(classification: DataNeedClassification): RiskAssessment {
  const {
    truthMode,
    liveCategories,
    authoritativeCategories,
    freshnessCritical,
    requiresNumericPrecision,
  } = classification;
  
  const riskFactors: RiskFactor[] = [];
  let forceHighReason: ForceHighReason = 'not_forced';
  
  // ─── INVARIANT CHECK: live_feed/mixed → forceHigh ───
  // This is IMMUTABLE and cannot be overridden
  if (truthMode === 'live_feed') {
    forceHighReason = 'live_feed_invariant';
    riskFactors.push('live_data_required');
  } else if (truthMode === 'mixed') {
    forceHighReason = 'mixed_mode_invariant';
    riskFactors.push('live_data_required');
  }
  
  // ─── TIME CATEGORY CHECK ───
  // Time queries ALWAYS forceHigh (no qualitative fallback)
  if (liveCategories.includes('time')) {
    if (forceHighReason === 'not_forced') {
      forceHighReason = 'time_category';
    }
    riskFactors.push('time_critical');
    riskFactors.push('no_fallback_available');
  }
  
  // ─── FINANCIAL DATA CHECK ───
  if (liveCategories.some(c => ['market', 'crypto', 'fx'].includes(c))) {
    riskFactors.push('financial_data');
    riskFactors.push('volatile_data');
  }
  
  // ─── NUMERIC PRECISION CHECK ───
  if (requiresNumericPrecision) {
    riskFactors.push('numeric_precision');
  }
  
  // ─── FRESHNESS CHECK ───
  if (freshnessCritical) {
    riskFactors.push('freshness_critical');
  }
  
  // ─── HIGH-STAKES DOMAIN CHECK ───
  if (authoritativeCategories.some(c => HIGH_STAKES_DOMAINS.has(c))) {
    riskFactors.push('high_stakes_domain');
    if (forceHighReason === 'not_forced') {
      forceHighReason = 'authoritative_domain';
    }
  }
  
  // ─── AUTHORITATIVE CHECK ───
  if (truthMode === 'authoritative_verify') {
    riskFactors.push('authoritative_required');
  }
  
  // ─── VOLATILE DATA CHECK ───
  if (liveCategories.some(c => VOLATILE_CATEGORIES.has(c))) {
    if (!riskFactors.includes('volatile_data')) {
      riskFactors.push('volatile_data');
    }
  }
  
  // ─── CALCULATE RISK SCORE ───
  const riskScore = calculateRiskScore(
    liveCategories,
    authoritativeCategories,
    riskFactors,
    freshnessCritical,
    requiresNumericPrecision
  );
  
  // ─── HIGH RISK SCORE CHECK ───
  if (riskScore >= FORCE_HIGH_RISK_THRESHOLD && forceHighReason === 'not_forced') {
    forceHighReason = 'high_risk_score';
  }
  
  // ─── DETERMINE STAKES LEVEL ───
  const stakes = determineStakesLevel(
    riskScore,
    riskFactors,
    liveCategories,
    authoritativeCategories
  );
  
  // ─── DETERMINE forceHigh ───
  const forceHigh = forceHighReason !== 'not_forced';
  
  // ─── BUILD REASONING ───
  const reasoning = buildReasoning(forceHigh, forceHighReason, riskFactors, riskScore);
  
  return {
    forceHigh,
    riskScore,
    riskFactors,
    stakes,
    reasoning,
    forceHighReason,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// RISK SCORE CALCULATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Calculate overall risk score from categories and factors.
 */
function calculateRiskScore(
  liveCategories: readonly LiveCategory[],
  authoritativeCategories: readonly AuthoritativeCategory[],
  riskFactors: readonly RiskFactor[],
  freshnessCritical: boolean,
  requiresNumericPrecision: boolean
): number {
  let score = 0;
  let maxCategoryWeight = 0;
  
  // Get max category risk weight
  for (const category of liveCategories) {
    const weight = CATEGORY_RISK_WEIGHTS.get(category) ?? 0.5;
    maxCategoryWeight = Math.max(maxCategoryWeight, weight);
  }
  
  for (const category of authoritativeCategories) {
    const weight = CATEGORY_RISK_WEIGHTS.get(category) ?? 0.5;
    maxCategoryWeight = Math.max(maxCategoryWeight, weight);
  }
  
  // Base score from category weight
  score = maxCategoryWeight;
  
  // Boost for freshness critical
  if (freshnessCritical) {
    score = Math.min(1, score + 0.1);
  }
  
  // Boost for numeric precision
  if (requiresNumericPrecision) {
    score = Math.min(1, score + 0.1);
  }
  
  // Boost for no fallback available
  if (riskFactors.includes('no_fallback_available')) {
    score = Math.min(1, score + 0.15);
  }
  
  // Boost for volatile data
  if (riskFactors.includes('volatile_data')) {
    score = Math.min(1, score + 0.05);
  }
  
  // Boost for high stakes domain
  if (riskFactors.includes('high_stakes_domain')) {
    score = Math.min(1, score + 0.1);
  }
  
  return Math.round(score * 100) / 100; // Round to 2 decimal places
}

// ─────────────────────────────────────────────────────────────────────────────────
// STAKES LEVEL DETERMINATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Determine stakes level from risk assessment.
 */
function determineStakesLevel(
  riskScore: number,
  riskFactors: readonly RiskFactor[],
  liveCategories: readonly LiveCategory[],
  authoritativeCategories: readonly AuthoritativeCategory[]
): StakesLevel {
  // Critical: Time (no fallback), medical, legal
  if (liveCategories.includes('time')) {
    return 'critical';
  }
  
  if (authoritativeCategories.some(c => ['medical', 'legal'].includes(c))) {
    return 'critical';
  }
  
  // High: Financial data, high risk score
  if (liveCategories.some(c => ['market', 'crypto', 'fx'].includes(c))) {
    return 'high';
  }
  
  if (riskScore >= 0.8) {
    return 'high';
  }
  
  // Medium: Moderate risk
  if (riskScore >= 0.5) {
    return 'medium';
  }
  
  if (riskFactors.length > 2) {
    return 'medium';
  }
  
  // Low: Everything else
  return 'low';
}

// ─────────────────────────────────────────────────────────────────────────────────
// REASONING BUILDER
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Build human-readable reasoning for the assessment.
 */
function buildReasoning(
  forceHigh: boolean,
  forceHighReason: ForceHighReason,
  riskFactors: readonly RiskFactor[],
  riskScore: number
): string {
  const parts: string[] = [];
  
  // Force high reason
  switch (forceHighReason) {
    case 'live_feed_invariant':
      parts.push('Live data feed requires HIGH tier verification (invariant)');
      break;
    case 'mixed_mode_invariant':
      parts.push('Mixed mode query requires HIGH tier verification (invariant)');
      break;
    case 'time_category':
      parts.push('Time queries have no fallback - HIGH tier required');
      break;
    case 'authoritative_domain':
      parts.push('High-stakes domain (medical/legal) requires verification');
      break;
    case 'high_risk_score':
      parts.push(`Risk score ${(riskScore * 100).toFixed(0)}% exceeds threshold`);
      break;
    case 'not_forced':
      parts.push(`Risk score ${(riskScore * 100).toFixed(0)}% - standard processing`);
      break;
  }
  
  // Risk factors summary
  if (riskFactors.length > 0) {
    const factorNames = riskFactors.map(f => f.replace(/_/g, ' ')).slice(0, 3);
    parts.push(`Factors: ${factorNames.join(', ')}`);
  }
  
  return parts.join('. ');
}

// ─────────────────────────────────────────────────────────────────────────────────
// VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Validate that forceHigh invariant is respected.
 * 
 * This function should be called at pipeline boundaries to ensure
 * the invariant hasn't been violated downstream.
 * 
 * @param truthMode - The truth mode
 * @param forceHigh - The forceHigh flag
 * @throws Error if invariant is violated
 */
export function validateForceHighInvariant(
  truthMode: TruthMode,
  forceHigh: boolean
): void {
  if ((truthMode === 'live_feed' || truthMode === 'mixed') && !forceHigh) {
    throw new Error(
      `INVARIANT VIOLATION: truthMode=${truthMode} requires forceHigh=true. ` +
      `This is a critical system invariant that cannot be overridden.`
    );
  }
}

/**
 * Check if a category has a qualitative fallback.
 */
export function hasQualitativeFallback(category: LiveCategory): boolean {
  return !NO_FALLBACK_CATEGORIES.has(category);
}

/**
 * Check if a category has volatile data.
 */
export function isVolatileCategory(category: LiveCategory): boolean {
  return VOLATILE_CATEGORIES.has(category);
}

/**
 * Get the risk weight for a category.
 */
export function getCategoryRiskWeight(
  category: LiveCategory | AuthoritativeCategory
): number {
  return CATEGORY_RISK_WEIGHTS.get(category) ?? 0.5;
}

// ─────────────────────────────────────────────────────────────────────────────────
// QUICK ASSESSMENT
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Quick check if truthMode requires forceHigh.
 * This is the simplest form of the invariant check.
 */
export function requiresForceHigh(truthMode: TruthMode): boolean {
  return truthMode === 'live_feed' || truthMode === 'mixed';
}

/**
 * Quick assessment for a single category.
 */
export function assessCategoryRisk(category: LiveCategory): {
  riskWeight: number;
  hasFallback: boolean;
  isVolatile: boolean;
} {
  return {
    riskWeight: CATEGORY_RISK_WEIGHTS.get(category) ?? 0.5,
    hasFallback: hasQualitativeFallback(category),
    isVolatile: isVolatileCategory(category),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export {
  FORCE_HIGH_RISK_THRESHOLD,
  CATEGORY_RISK_WEIGHTS,
  NO_FALLBACK_CATEGORIES,
  VOLATILE_CATEGORIES,
  HIGH_STAKES_DOMAINS,
};
