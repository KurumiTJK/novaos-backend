// ═══════════════════════════════════════════════════════════════════════════════
// CLASSIFICATION INDEX — Barrel Export for Classification Module
// Phase 7: Lens Gate
// 
// This module exports all classification components for use by the Lens gate.
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// MAIN CLASSIFIER
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Main async classification function
  classify,
  
  // Synchronous classification (pattern-only)
  classifySync,
  
  // Quick helpers
  quickNeedsLiveData,
  quickNeedsAuthoritative,
  quickExtractEntities,
  
  // Internal helpers (for testing)
  determineTruthMode,
  determineFallbackMode,
  determineMaxDataAge,
  buildEntitiesFromPatterns,
  buildEntitiesFromLLM,
  
  // Types
  type ClassificationContext,
} from './classifier.js';

// ─────────────────────────────────────────────────────────────────────────────────
// PATTERN MATCHING
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Main pattern classification function
  classifyWithPatterns,
  
  // Confidence checks
  isHighConfidenceMatch,
  isMediumConfidenceMatch,
  requiresLLMAssist,
  
  // Thresholds
  HIGH_CONFIDENCE_THRESHOLD,
  MEDIUM_CONFIDENCE_THRESHOLD,
  
  // Pattern registries
  LIVE_CATEGORY_PATTERNS,
  AUTHORITATIVE_CATEGORY_PATTERNS,
  
  // Entity extraction helpers
  extractCompanyOrTicker,
  cryptoNameToSymbol,
  normalizeCurrency,
  normalizeIndex,
  normalizeLocation,
  normalizeTimezone,
  
  // Lookup tables
  COMPANY_TO_TICKER,
  CRYPTO_NAME_TO_SYMBOL,
  CURRENCY_NAME_TO_CODE,
  CITY_TO_TIMEZONE,
  
  // Types
  type PatternMatch,
  type PatternClassificationResult,
} from './patterns.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LLM ASSIST
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Main LLM classification function
  classifyWithLLM,
  
  // Availability check
  isLLMAvailable,
  
  // Result helpers
  requiresLiveData,
  requiresAuthoritative,
  isHighConfidence,
  mergeWithPatternResult,
  
  // Fallback
  createFallbackResult,
  
  // Normalization helpers (for testing)
  normalizeConfidence,
  normalizeTruthMode,
  
  // Constants
  DEFAULT_TIMEOUT_MS,
  
  // Types
  type LLMClassificationResult,
  type LLMExtractedEntity,
} from './llm-assist.js';
