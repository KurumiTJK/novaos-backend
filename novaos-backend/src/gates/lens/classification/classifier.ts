// ═══════════════════════════════════════════════════════════════════════════════
// CLASSIFIER — Data Need Classification Orchestrator
// Phase 7: Lens Gate
// 
// This module orchestrates classification by combining pattern matching with
// LLM-assisted classification. Pattern matching is tried first for speed and
// determinism; LLM is used when patterns have low confidence.
// 
// CLASSIFICATION FLOW:
// 1. Run pattern matching
// 2. If high confidence → use pattern result
// 3. If medium confidence → use pattern, optionally verify with LLM
// 4. If low confidence → use LLM classification
// 5. Merge results and build DataNeedClassification
// ═══════════════════════════════════════════════════════════════════════════════

import type { LiveCategory, AuthoritativeCategory, DataCategory } from '../../../types/categories.js';
import type {
  DataNeedClassification,
  TruthMode,
  FallbackMode,
  ClassificationConfidence,
} from '../../../types/data-need.js';
import type {
  ResolvedEntities,
  ResolvedEntity,
  RawEntityMention,
} from '../../../types/entities.js';
import {
  toClassificationConfidence,
  DEFAULT_FALLBACK_MODES,
} from '../../../types/data-need.js';
import { createEmptyEntities } from '../../../types/entities.js';

import {
  classifyWithPatterns,
  isHighConfidenceMatch,
  isMediumConfidenceMatch,
  requiresLLMAssist,
  HIGH_CONFIDENCE_THRESHOLD,
  type PatternClassificationResult,
} from './patterns.js';

import {
  classifyWithLLM,
  isLLMAvailable,
  requiresLiveData,
  mergeWithPatternResult,
  type LLMClassificationResult,
  type LLMExtractedEntity,
} from './llm-assist.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Classification context for additional signals.
 */
export interface ClassificationContext {
  /** User's timezone (for time queries without explicit timezone) */
  readonly userTimezone?: string;
  
  /** User's location (for weather queries without explicit location) */
  readonly userLocation?: string;
  
  /** Previous conversation context */
  readonly conversationContext?: string;
  
  /** Whether to force LLM classification (skip pattern matching) */
  readonly forceLLM?: boolean;
  
  /** Whether to skip LLM even for low confidence patterns */
  readonly skipLLM?: boolean;
  
  /** Custom timeout for LLM classification */
  readonly llmTimeoutMs?: number;
}

/**
 * Internal classification result before building DataNeedClassification.
 */
interface InternalClassificationResult {
  readonly truthMode: TruthMode;
  readonly primaryCategory: DataCategory;
  readonly liveCategories: readonly LiveCategory[];
  readonly authoritativeCategories: readonly AuthoritativeCategory[];
  readonly entities: ResolvedEntities;
  readonly confidence: number;
  readonly reasoning: string;
  readonly method: 'rule_based' | 'llm' | 'hybrid';
  readonly freshnessCritical: boolean;
  readonly requiresNumericPrecision: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────
// MAIN CLASSIFICATION FUNCTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Classify a user message to determine data needs.
 * 
 * This is the main entry point for classification. It combines pattern matching
 * with LLM-assisted classification based on confidence levels.
 * 
 * @param message - The user message to classify
 * @param context - Additional context for classification
 * @returns Complete DataNeedClassification
 * 
 * @example
 * const classification = await classify("What's AAPL trading at?");
 * // {
 * //   truthMode: 'live_feed',
 * //   primaryCategory: 'market',
 * //   liveCategories: ['market'],
 * //   entities: { resolved: [{ canonicalForm: 'AAPL', ... }], ... },
 * //   ...
 * // }
 */
export async function classify(
  message: string,
  context: ClassificationContext = {}
): Promise<DataNeedClassification> {
  const startTime = Date.now();
  
  // ─── STEP 1: PATTERN MATCHING ───
  let patternResult: PatternClassificationResult | null = null;
  
  if (!context.forceLLM) {
    patternResult = classifyWithPatterns(message);
    
    console.log(`[CLASSIFIER] Pattern match: ${patternResult.primaryCategory ?? 'none'} ` +
      `(confidence: ${(patternResult.highestConfidence * 100).toFixed(0)}%, ` +
      `entities: ${patternResult.allEntities.length})`);
  }
  
  // ─── STEP 2: DETERMINE IF LLM NEEDED ───
  let llmResult: LLMClassificationResult | null = null;
  let method: 'rule_based' | 'llm' | 'hybrid' = 'rule_based';
  
  const shouldUseLLM = context.forceLLM || 
    (!context.skipLLM && patternResult && requiresLLMAssist(patternResult));
  
  if (shouldUseLLM && isLLMAvailable()) {
    console.log('[CLASSIFIER] Using LLM assist for classification');
    
    llmResult = await classifyWithLLM(message, context.llmTimeoutMs);
    method = patternResult && patternResult.highestConfidence > 0 ? 'hybrid' : 'llm';
    
    // Merge pattern entities if we have them
    if (patternResult && patternResult.allEntities.length > 0) {
      llmResult = mergeWithPatternResult(
        llmResult,
        patternResult.allEntities,
        patternResult.primaryCategory,
        patternResult.highestConfidence
      );
    }
    
    console.log(`[CLASSIFIER] LLM result: ${llmResult.primaryCategory} ` +
      `(confidence: ${(llmResult.confidence * 100).toFixed(0)}%, ` +
      `truthMode: ${llmResult.truthMode})`);
  }
  
  // ─── STEP 3: BUILD INTERNAL RESULT ───
  const internalResult = buildInternalResult(patternResult, llmResult, method, context);
  
  // ─── STEP 4: BUILD FINAL CLASSIFICATION ───
  const classification = buildDataNeedClassification(internalResult, message);
  
  const elapsed = Date.now() - startTime;
  console.log(`[CLASSIFIER] Classification complete in ${elapsed}ms: ` +
    `truthMode=${classification.truthMode}, ` +
    `categories=[${classification.liveCategories.join(', ')}], ` +
    `method=${classification.method}`);
  
  return classification;
}

// ─────────────────────────────────────────────────────────────────────────────────
// INTERNAL RESULT BUILDING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Build internal classification result from pattern and LLM results.
 */
function buildInternalResult(
  patternResult: PatternClassificationResult | null,
  llmResult: LLMClassificationResult | null,
  method: 'rule_based' | 'llm' | 'hybrid',
  context: ClassificationContext
): InternalClassificationResult {
  // LLM result takes precedence when available and not fallback
  if (llmResult && !llmResult.isFallback) {
    const entities = buildEntitiesFromLLM(llmResult.entities, context);
    
    return {
      truthMode: llmResult.truthMode,
      primaryCategory: llmResult.primaryCategory,
      liveCategories: llmResult.liveCategories,
      authoritativeCategories: llmResult.authoritativeCategories,
      entities,
      confidence: llmResult.confidence,
      reasoning: llmResult.reasoning,
      method,
      freshnessCritical: llmResult.freshnessCritical,
      requiresNumericPrecision: llmResult.requiresNumericPrecision,
    };
  }
  
  // High-confidence pattern match
  if (patternResult && isHighConfidenceMatch(patternResult)) {
    const entities = buildEntitiesFromPatterns(patternResult, context);
    const truthMode = determineTruthMode(patternResult);
    
    return {
      truthMode,
      primaryCategory: patternResult.primaryCategory ?? 'general',
      liveCategories: patternResult.liveCategories,
      authoritativeCategories: patternResult.authoritativeCategories,
      entities,
      confidence: patternResult.highestConfidence,
      reasoning: patternResult.reasoning,
      method: 'rule_based',
      freshnessCritical: patternResult.liveCategories.length > 0,
      requiresNumericPrecision: patternResult.liveCategories.some(
        c => ['market', 'crypto', 'fx', 'time'].includes(c)
      ),
    };
  }
  
  // Medium-confidence pattern match (with possible LLM fallback)
  if (patternResult && isMediumConfidenceMatch(patternResult)) {
    const entities = buildEntitiesFromPatterns(patternResult, context);
    const truthMode = determineTruthMode(patternResult);
    
    // Use LLM fallback if available
    if (llmResult) {
      return {
        truthMode: llmResult.truthMode,
        primaryCategory: llmResult.primaryCategory,
        liveCategories: mergeLiveCategories(patternResult.liveCategories, llmResult.liveCategories),
        authoritativeCategories: mergeAuthCategories(
          patternResult.authoritativeCategories,
          llmResult.authoritativeCategories
        ),
        entities,
        confidence: Math.max(patternResult.highestConfidence, llmResult.confidence * 0.9),
        reasoning: `${patternResult.reasoning} (verified by LLM: ${llmResult.reasoning})`,
        method: 'hybrid',
        freshnessCritical: llmResult.freshnessCritical,
        requiresNumericPrecision: llmResult.requiresNumericPrecision,
      };
    }
    
    return {
      truthMode,
      primaryCategory: patternResult.primaryCategory ?? 'general',
      liveCategories: patternResult.liveCategories,
      authoritativeCategories: patternResult.authoritativeCategories,
      entities,
      confidence: patternResult.highestConfidence,
      reasoning: patternResult.reasoning,
      method: 'rule_based',
      freshnessCritical: patternResult.liveCategories.length > 0,
      requiresNumericPrecision: patternResult.liveCategories.some(
        c => ['market', 'crypto', 'fx', 'time'].includes(c)
      ),
    };
  }
  
  // LLM fallback result (when pattern failed and LLM gave fallback)
  if (llmResult) {
    const entities = buildEntitiesFromLLM(llmResult.entities, context);
    
    return {
      truthMode: llmResult.truthMode,
      primaryCategory: llmResult.primaryCategory,
      liveCategories: llmResult.liveCategories,
      authoritativeCategories: llmResult.authoritativeCategories,
      entities,
      confidence: llmResult.confidence,
      reasoning: llmResult.reasoning,
      method: llmResult.isFallback ? 'rule_based' : 'llm',
      freshnessCritical: llmResult.freshnessCritical,
      requiresNumericPrecision: llmResult.requiresNumericPrecision,
    };
  }
  
  // No result at all (shouldn't happen, but handle gracefully)
  return {
    truthMode: 'local',
    primaryCategory: 'general',
    liveCategories: [],
    authoritativeCategories: [],
    entities: createEmptyEntities(),
    confidence: 0.5,
    reasoning: 'No classification result available - defaulting to local',
    method: 'rule_based',
    freshnessCritical: false,
    requiresNumericPrecision: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// TRUTH MODE DETERMINATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Determine truth mode from pattern classification result.
 */
function determineTruthMode(result: PatternClassificationResult): TruthMode {
  const { liveCategories, authoritativeCategories } = result;
  
  // No categories → local
  if (liveCategories.length === 0 && authoritativeCategories.length === 0) {
    return 'local';
  }
  
  // Both live and authoritative → mixed
  if (liveCategories.length > 0 && authoritativeCategories.length > 0) {
    return 'mixed';
  }
  
  // Only live categories → live_feed
  if (liveCategories.length > 0) {
    return 'live_feed';
  }
  
  // Only authoritative categories → authoritative_verify
  if (authoritativeCategories.length > 0) {
    return 'authoritative_verify';
  }
  
  return 'local';
}

// ─────────────────────────────────────────────────────────────────────────────────
// ENTITY BUILDING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Build ResolvedEntities from pattern extraction results.
 */
function buildEntitiesFromPatterns(
  result: PatternClassificationResult,
  context: ClassificationContext
): ResolvedEntities {
  const resolved: ResolvedEntity[] = [];
  
  for (const match of result.matches) {
    for (const entity of match.extractedEntities) {
      if (!entity) continue;
      
      // Handle special 'local' entity for time queries
      let canonicalForm = entity;
      if (entity === 'local' && match.category === 'time') {
        canonicalForm = context.userTimezone ?? 'local';
      }
      
      const rawMention: RawEntityMention = {
        rawText: entity,
        startIndex: 0, // We don't track positions in pattern matching
        endIndex: entity.length,
        confidence: match.confidence,
      };
      
      // Check if already resolved (dedup)
      const existing = resolved.find(r => r.canonicalForm === canonicalForm);
      if (existing) continue;
      
      resolved.push({
        raw: rawMention,
        canonicalForm,
        category: isLiveCategory(match.category) ? match.category : 'time', // Default for entities
      });
    }
  }
  
  return {
    resolved,
    ambiguous: [],
    failed: [],
  };
}

/**
 * Build ResolvedEntities from LLM extraction results.
 */
function buildEntitiesFromLLM(
  entities: readonly LLMExtractedEntity[],
  context: ClassificationContext
): ResolvedEntities {
  const resolved: ResolvedEntity[] = [];
  
  for (const entity of entities) {
    if (!entity.text) continue;
    
    // Handle special 'local' entity for time queries
    let canonicalForm = entity.canonicalForm ?? entity.text;
    if (entity.text === 'local' && entity.category === 'time') {
      canonicalForm = context.userTimezone ?? 'local';
    }
    
    const rawMention: RawEntityMention = {
      rawText: entity.text,
      startIndex: 0,
      endIndex: entity.text.length,
      confidence: 0.8, // LLM entities have reasonable confidence
    };
    
    // Check if already resolved (dedup)
    const existing = resolved.find(r => r.canonicalForm === canonicalForm);
    if (existing) continue;
    
    resolved.push({
      raw: rawMention,
      canonicalForm,
      category: entity.category === 'general' ? 'time' : entity.category, // Default
    });
  }
  
  return {
    resolved,
    ambiguous: [],
    failed: [],
  };
}

/**
 * Type guard for LiveCategory.
 */
function isLiveCategory(category: DataCategory): category is LiveCategory {
  return ['market', 'crypto', 'fx', 'weather', 'time'].includes(category);
}

// ─────────────────────────────────────────────────────────────────────────────────
// CATEGORY MERGING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Merge live categories from pattern and LLM results.
 */
function mergeLiveCategories(
  pattern: readonly LiveCategory[],
  llm: readonly LiveCategory[]
): readonly LiveCategory[] {
  const merged = new Set([...pattern, ...llm]);
  return Array.from(merged);
}

/**
 * Merge authoritative categories from pattern and LLM results.
 */
function mergeAuthCategories(
  pattern: readonly AuthoritativeCategory[],
  llm: readonly AuthoritativeCategory[]
): readonly AuthoritativeCategory[] {
  const merged = new Set([...pattern, ...llm]);
  return Array.from(merged);
}

// ─────────────────────────────────────────────────────────────────────────────────
// FALLBACK MODE DETERMINATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Determine fallback mode based on categories.
 * 
 * CRITICAL INVARIANT: Time category has NO fallback - must refuse if data unavailable.
 */
function determineFallbackMode(
  liveCategories: readonly LiveCategory[],
  authoritativeCategories: readonly AuthoritativeCategory[]
): FallbackMode {
  // Time has NO fallback
  if (liveCategories.includes('time')) {
    return 'refuse';
  }
  
  // Authoritative categories should acknowledge inability
  if (authoritativeCategories.length > 0) {
    return 'acknowledge';
  }
  
  // Market/crypto/fx can degrade to qualitative
  if (liveCategories.some(c => ['market', 'crypto', 'fx'].includes(c))) {
    return 'degrade';
  }
  
  // Weather can degrade
  if (liveCategories.includes('weather')) {
    return 'degrade';
  }
  
  // Default
  return 'degrade';
}

/**
 * Determine max data age based on categories.
 */
function determineMaxDataAge(liveCategories: readonly LiveCategory[]): number | null {
  if (liveCategories.length === 0) return null;
  
  // Time: 1 second
  if (liveCategories.includes('time')) return 1_000;
  
  // Market/crypto: 1 minute
  if (liveCategories.some(c => ['market', 'crypto'].includes(c))) return 60_000;
  
  // FX: 5 minutes
  if (liveCategories.includes('fx')) return 300_000;
  
  // Weather: 15 minutes
  if (liveCategories.includes('weather')) return 900_000;
  
  return 60_000; // Default 1 minute
}

// ─────────────────────────────────────────────────────────────────────────────────
// FINAL CLASSIFICATION BUILDING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Build the final DataNeedClassification from internal result.
 */
function buildDataNeedClassification(
  internal: InternalClassificationResult,
  message: string
): DataNeedClassification {
  const {
    truthMode,
    primaryCategory,
    liveCategories,
    authoritativeCategories,
    entities,
    confidence,
    reasoning,
    method,
    freshnessCritical,
    requiresNumericPrecision,
  } = internal;
  
  // Build all categories array
  const categories: DataCategory[] = [
    ...liveCategories,
    ...authoritativeCategories,
  ];
  if (categories.length === 0) {
    categories.push('general');
  }
  
  // Determine fallback mode
  const fallbackMode = determineFallbackMode(liveCategories, authoritativeCategories);
  
  // Determine max data age
  const maxDataAgeMs = determineMaxDataAge(liveCategories);
  
  // Check entity completeness
  const entitiesComplete = entities.ambiguous.length === 0 && entities.failed.length === 0;
  const entitiesNeedingClarification = entities.ambiguous.map(e => e.raw.rawText);
  
  // Determine if action recommendations are allowed
  // Not allowed for live financial data (no buy/sell advice)
  const allowsActionRecommendations = !liveCategories.some(
    c => ['market', 'crypto', 'fx'].includes(c)
  );
  
  return {
    // Primary classification
    truthMode,
    primaryCategory,
    categories,
    liveCategories,
    authoritativeCategories,
    
    // Entity information
    entities,
    entitiesComplete,
    entitiesNeedingClarification,
    
    // Confidence & reasoning
    confidence: toClassificationConfidence(confidence),
    confidenceScore: confidence,
    reasoning,
    method,
    
    // Fallback & constraints
    fallbackMode,
    freshnessCritical,
    maxDataAgeMs,
    requiresNumericPrecision,
    allowsActionRecommendations,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// SYNCHRONOUS CLASSIFICATION (Pattern Only)
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Synchronous classification using patterns only.
 * Use when LLM is not available or for quick classification.
 * 
 * @param message - The user message to classify
 * @param context - Additional context
 * @returns DataNeedClassification (synchronous)
 */
export function classifySync(
  message: string,
  context: ClassificationContext = {}
): DataNeedClassification {
  const patternResult = classifyWithPatterns(message);
  
  const internalResult = buildInternalResult(patternResult, null, 'rule_based', context);
  
  return buildDataNeedClassification(internalResult, message);
}

// ─────────────────────────────────────────────────────────────────────────────────
// QUICK CLASSIFICATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Quick check if message likely needs live data.
 * Uses pattern matching only for speed.
 */
export function quickNeedsLiveData(message: string): boolean {
  const result = classifyWithPatterns(message);
  return result.liveCategories.length > 0;
}

/**
 * Quick check if message likely needs authoritative verification.
 * Uses pattern matching only for speed.
 */
export function quickNeedsAuthoritative(message: string): boolean {
  const result = classifyWithPatterns(message);
  return result.authoritativeCategories.length > 0;
}

/**
 * Quick extraction of entities from message.
 * Uses pattern matching only for speed.
 */
export function quickExtractEntities(message: string): readonly string[] {
  const result = classifyWithPatterns(message);
  return result.allEntities;
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export {
  determineTruthMode,
  determineFallbackMode,
  determineMaxDataAge,
  buildEntitiesFromPatterns,
  buildEntitiesFromLLM,
};
