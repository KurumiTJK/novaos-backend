// ═══════════════════════════════════════════════════════════════════════════════
// LENS GATE COMPATIBILITY LAYER
// Maps Phase 7 LensGateResult to legacy LensResult for pipeline integration
// ═══════════════════════════════════════════════════════════════════════════════

import type { StakesLevel, LensResult } from '../../types/index.js';
import type { LensGateResult, EvidencePack, ContextItem } from '../../types/lens.js';
import type { DataNeedClassification } from '../../types/data-need.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LEGACY EVIDENCE PACK FORMAT
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Legacy evidence item format expected by execution-pipeline.ts
 */
export interface LegacyEvidenceItem {
  readonly title: string;
  readonly url?: string;
  readonly excerpt?: string;
  readonly snippet?: string;
  readonly source?: string;
  readonly category?: string;
  readonly relevance?: number;
}

/**
 * Legacy evidence pack format expected by execution-pipeline.ts
 */
export interface LegacyEvidencePack {
  readonly items: readonly LegacyEvidenceItem[];
  readonly formattedContext?: string;
  readonly freshnessWarning?: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXTENDED LENS RESULT
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Extended LensResult that includes both legacy fields and new Phase 7 data.
 * This allows the pipeline to use legacy fields while new code can access
 * the full LensGateResult.
 */
export interface ExtendedLensResult extends LensResult {
  /** Legacy evidence pack for pipeline injection */
  readonly evidencePack?: LegacyEvidencePack;
  
  /** Full Phase 7 result for new code */
  readonly _fullResult?: LensGateResult;
  
  /** Response constraints for model gate */
  readonly responseConstraints?: {
    readonly numericPrecisionAllowed: boolean;
    readonly actionRecommendationsAllowed: boolean;
    readonly bannedPhrases?: readonly string[];
    readonly requiredPhrases?: readonly string[];
    readonly freshnessWarningRequired?: boolean;
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// MAPPING FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Map Phase 7 LensMode to legacy status.
 */
function mapModeToStatus(mode: LensGateResult['mode']): LensResult['status'] {
  switch (mode) {
    case 'passthrough':
    case 'live_fetch':
    case 'verification':
      return 'verified';
    case 'degraded':
      return 'degraded';
    case 'blocked':
      return 'stopped';
    default:
      return 'degraded';
  }
}

/**
 * Map Phase 7 classification to legacy domain.
 */
function mapCategoryToDomain(classification: DataNeedClassification): string {
  // Use primary category or first live category
  if (classification.primaryCategory) {
    return classification.primaryCategory;
  }
  if (classification.liveCategories.length > 0) {
    return classification.liveCategories[0]!;
  }
  return 'general';
}

/**
 * Map Phase 7 confidence to legacy stakes level.
 */
function mapConfidenceToStakes(
  classification: DataNeedClassification,
  forceHigh: boolean
): StakesLevel {
  if (forceHigh) {
    return 'high';
  }
  
  // High-stakes categories
  const highStakesCategories = ['market', 'crypto', 'fx'];
  if (classification.liveCategories.some(c => highStakesCategories.includes(c))) {
    return 'high';
  }
  
  // Medium stakes for time (critical but simple)
  if (classification.liveCategories.includes('time')) {
    return 'medium';
  }
  
  // Default based on truth mode
  if (classification.truthMode === 'live_feed' || classification.truthMode === 'mixed') {
    return 'high';
  }
  
  return 'low';
}

/**
 * Convert Phase 7 ContextItem to legacy EvidenceItem.
 */
function mapContextItemToLegacy(item: ContextItem): LegacyEvidenceItem {
  return {
    title: item.entity ?? item.category ?? 'Evidence',
    url: item.sourceUrl,
    excerpt: item.content,
    snippet: item.content.slice(0, 200),
    source: item.citation ?? item.source,
    category: item.category,
    relevance: item.relevance,
  };
}

/**
 * Convert Phase 7 EvidencePack to legacy format.
 */
function mapEvidencePackToLegacy(evidence: EvidencePack | null): LegacyEvidencePack | undefined {
  if (!evidence) {
    return undefined;
  }
  
  return {
    items: evidence.contextItems.map(mapContextItemToLegacy),
    formattedContext: evidence.formattedContext,
    freshnessWarning: evidence.freshnessWarnings.join(' '),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// MAIN CONVERSION FUNCTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Convert Phase 7 LensGateResult to legacy-compatible ExtendedLensResult.
 * 
 * This function bridges the new Live Data Router output to the existing
 * pipeline infrastructure, allowing gradual migration.
 * 
 * @param result - Phase 7 LensGateResult
 * @returns ExtendedLensResult compatible with legacy pipeline
 */
export function toLegacyLensResult(result: LensGateResult): ExtendedLensResult {
  const classification = result.classification;
  const forceHigh = result.numericPrecisionAllowed === false && 
                    (classification.truthMode === 'live_feed' || classification.truthMode === 'mixed');
  
  return {
    // Legacy fields
    needsVerification: classification.truthMode !== 'local',
    verified: result.mode === 'live_fetch' || result.mode === 'verification',
    domain: mapCategoryToDomain(classification),
    stakes: mapConfidenceToStakes(classification, forceHigh),
    confidence: classification.confidenceScore,
    status: mapModeToStatus(result.mode),
    message: result.userMessage ?? result.freshnessWarning ?? undefined,
    freshnessWindow: result.freshnessWarning ?? undefined,
    sources: result.sources.length > 0 ? [...result.sources] : undefined,
    
    // Extended fields for pipeline evidence injection
    evidencePack: mapEvidencePackToLegacy(result.evidence),
    
    // Full result for new code
    _fullResult: result,
    
    // Response constraints for model gate
    responseConstraints: {
      numericPrecisionAllowed: result.numericPrecisionAllowed,
      actionRecommendationsAllowed: result.actionRecommendationsAllowed,
      bannedPhrases: result.responseConstraints.bannedPhrases,
      requiredPhrases: result.responseConstraints.requiredPhrases,
      freshnessWarningRequired: result.requiresFreshnessDisclaimer,
    },
  };
}

/**
 * Extract the full Phase 7 result from an ExtendedLensResult.
 * Returns undefined if not available (legacy result).
 */
export function getFullLensResult(result: LensResult): LensGateResult | undefined {
  return (result as ExtendedLensResult)._fullResult;
}

/**
 * Check if a LensResult has extended Phase 7 data.
 */
export function hasExtendedData(result: LensResult): result is ExtendedLensResult {
  return '_fullResult' in result && result._fullResult !== undefined;
}

// ─────────────────────────────────────────────────────────────────────────────────
// TYPE EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export type {
  LensResult,
  LensGateResult,
};
