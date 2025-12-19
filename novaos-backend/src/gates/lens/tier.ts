// ═══════════════════════════════════════════════════════════════════════════════
// LENS TIER — Tier Determination Logic
// Decides LOW / MEDIUM / HIGH based on classification
// ═══════════════════════════════════════════════════════════════════════════════

import type { LensClassification, SearchTier, RiskFactor } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// FORCE HIGH RISK FACTORS
// ─────────────────────────────────────────────────────────────────────────────────

const FORCE_HIGH_FACTORS: RiskFactor[] = [
  'high_stakes',
  'volatile_data',
  'time_sensitive_claim',
  'breaking_news',
];

// ─────────────────────────────────────────────────────────────────────────────────
// TIER THRESHOLDS
// ─────────────────────────────────────────────────────────────────────────────────

const TIER_THRESHOLDS = {
  HIGH: 0.8,
  MEDIUM: 0.5,
} as const;

// ─────────────────────────────────────────────────────────────────────────────────
// DETERMINE SEARCH TIER
// ─────────────────────────────────────────────────────────────────────────────────

export function determineSearchTier(classification: LensClassification): SearchTier {
  const {
    webHelpful,
    riskScore,
    riskFactors,
    hasRecencyRequest,
    isEvolvingDomain,
    forceHigh,
  } = classification;

  // ─── DECISION 1: If no web help needed → LOW ───
  if (!webHelpful) {
    return 'low';
  }

  // ─── DECISION 2: forceHigh flag → HIGH ───
  if (forceHigh) {
    return 'high';
  }

  // ─── DECISION 3: Force HIGH risk factors → HIGH ───
  if (riskFactors.some(f => FORCE_HIGH_FACTORS.includes(f))) {
    return 'high';
  }

  // ─── DECISION 4: Risk score thresholds ───
  if (riskScore >= TIER_THRESHOLDS.HIGH) {
    return 'high';
  }

  if (riskScore >= TIER_THRESHOLDS.MEDIUM) {
    return 'medium';
  }

  // ─── DECISION 5: Recency + evolving domain → MEDIUM ───
  if (hasRecencyRequest && isEvolvingDomain) {
    return 'medium';
  }

  // ─── DEFAULT: LOW ───
  return 'low';
}

// ─────────────────────────────────────────────────────────────────────────────────
// GET TIER EXPLANATION
// ─────────────────────────────────────────────────────────────────────────────────

export function getTierExplanation(
  classification: LensClassification,
  tier: SearchTier
): string {
  const { webHelpful, riskScore, riskFactors, forceHigh, hasRecencyRequest, isEvolvingDomain } = classification;

  if (tier === 'low') {
    if (!webHelpful) {
      return 'No external information needed for this query';
    }
    return `Risk score (${riskScore.toFixed(2)}) below threshold for search`;
  }

  if (tier === 'medium') {
    if (hasRecencyRequest && isEvolvingDomain) {
      return 'Recency request in evolving domain - augmenting with search';
    }
    return `Risk score (${riskScore.toFixed(2)}) warrants search augmentation`;
  }

  if (tier === 'high') {
    if (forceHigh) {
      return 'High-stakes domain requires verification';
    }
    const highFactors = riskFactors.filter(f => FORCE_HIGH_FACTORS.includes(f));
    if (highFactors.length > 0) {
      return `High-risk factors detected: ${highFactors.join(', ')}`;
    }
    return `High risk score (${riskScore.toFixed(2)}) requires verification`;
  }

  return 'Tier determination complete';
}

// ─────────────────────────────────────────────────────────────────────────────────
// SHOULD SKIP SEARCH (for LOW tier)
// ─────────────────────────────────────────────────────────────────────────────────

export function shouldSkipSearch(
  classification: LensClassification,
  tier: SearchTier
): { skip: boolean; reason: 'not_applicable' | 'skipped' } {
  if (tier !== 'low') {
    return { skip: false, reason: 'not_applicable' };
  }

  if (!classification.webHelpful) {
    return { skip: true, reason: 'not_applicable' };
  }

  // webHelpful is true but risk is below threshold
  return { skip: true, reason: 'skipped' };
}
