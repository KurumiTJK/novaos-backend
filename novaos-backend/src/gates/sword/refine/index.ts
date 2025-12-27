// ═══════════════════════════════════════════════════════════════════════════════
// REFINE MODULE — Exports
// NovaOS Gates — Phase 14B+14C+14D: SwordGate Refine Expansion
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// Types (Phase 14B)
// ─────────────────────────────────────────────────────────────────────────────────

export type {
  // Volatility
  VolatilityCategory,
  VolatilitySignal,
  VolatilityAssessment,
  VolatilityThresholds,

  // Topic Landscape
  TopicDifficulty,
  ScopeAssessment,
  TopicNode,
  Prerequisite,
  LearningPath,
  DeprecationWarning,
  FreshnessInfo,
  TopicLandscape,

  // Refine Context
  RefineContext,
  PrerequisiteAssessmentResult,
  PrerequisiteStatus,

  // Web Search
  WebSearchRequest,
  WebSearchResult,
  WebSearchResponse,
  IWebSearchService,

  // Configuration
  RefineModuleConfig,
} from './types.js';

export {
  // Constants
  VOLATILITY_CATEGORIES,
  TOPIC_DIFFICULTIES,
  SCOPE_ASSESSMENTS,
  DEFAULT_VOLATILITY_THRESHOLDS,
  DEFAULT_REFINE_CONFIG,

  // Type Guards
  isVolatilityCategory,
  isTopicDifficulty,
  isScopeAssessment,

  // Factories
  createStableVolatilityAssessment,
  createHighVolatilityAssessment,
  createMinimalLandscape,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// Volatility Detector (Phase 14B)
// ─────────────────────────────────────────────────────────────────────────────────

export {
  VolatilityDetector,
  createVolatilityDetector,
} from './volatility-detector.js';

// ─────────────────────────────────────────────────────────────────────────────────
// Topic Landscape Generator (Phase 14B)
// ─────────────────────────────────────────────────────────────────────────────────

export {
  TopicLandscapeGenerator,
  createTopicLandscapeGenerator,
} from './topic-landscape-generator.js';

// ─────────────────────────────────────────────────────────────────────────────────
// Web Search Enricher (Phase 14C)
// ─────────────────────────────────────────────────────────────────────────────────

export {
  WebSearchEnricher,
  createWebSearchEnricher,
  DEFAULT_ENRICHER_CONFIG,
} from './web-search-enricher.js';

export type {
  WebSearchEnricherConfig,
} from './web-search-enricher.js';

// ─────────────────────────────────────────────────────────────────────────────────
// Path Recommender (Phase 14C)
// ─────────────────────────────────────────────────────────────────────────────────

export {
  PathRecommender,
  createPathRecommender,
  DEFAULT_RECOMMENDER_CONFIG,
} from './path-recommender.js';

export type {
  PathRecommendation,
  PathMatchContext,
  PathRecommenderConfig,
} from './path-recommender.js';

// ─────────────────────────────────────────────────────────────────────────────────
// Prerequisite Assessor (Phase 14D)
// ─────────────────────────────────────────────────────────────────────────────────

export {
  PrerequisiteAssessor,
  createPrerequisiteAssessor,
  DEFAULT_ASSESSOR_CONFIG,
} from './prerequisite-assessor.js';

export type {
  ProficiencyLevel,
  AssessmentQuestion,
  AssessmentState,
  PrerequisiteAssessorConfig,
} from './prerequisite-assessor.js';
