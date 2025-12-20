// ═══════════════════════════════════════════════════════════════════════════════
// RISK INDEX — Barrel Export for Risk Assessment Module
// Phase 7: Lens Gate
// ═══════════════════════════════════════════════════════════════════════════════

export {
  // Main assessment function
  assessRisk,
  
  // Invariant validation
  validateForceHighInvariant,
  
  // Quick checks
  requiresForceHigh,
  hasQualitativeFallback,
  isVolatileCategory,
  getCategoryRiskWeight,
  assessCategoryRisk,
  
  // Constants
  FORCE_HIGH_RISK_THRESHOLD,
  CATEGORY_RISK_WEIGHTS,
  NO_FALLBACK_CATEGORIES,
  VOLATILE_CATEGORIES,
  HIGH_STAKES_DOMAINS,
  
  // Types
  type RiskAssessment,
  type RiskFactor,
  type StakesLevel,
  type ForceHighReason,
} from './assessor.js';
