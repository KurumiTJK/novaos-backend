// ═══════════════════════════════════════════════════════════════════════════════
// SWORDGATE MODULE — Exports
// NovaOS Gates — Phase 14A+14B: SwordGate Explore + Refine Modules
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// Main Gate
// ─────────────────────────────────────────────────────────────────────────────────

export { SwordGate, createSwordGate } from './sword-gate.js';
export type { IGoalRateLimiter } from './sword-gate.js';

// ─────────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────────

export type {
  SwordGateMode,
  SwordGateInput,
  SwordGateOutput,
  SwordGateConfig,
  SwordRefinementState,
  SwordRefinementInputs,
  SwordUserPreferences,
  ConversationMessage,
  LessonPlanProposal,
  ProposedQuest,
  GoalRateLimitInfo,
  CreatedGoalResult,
  RefinementField,
  // Phase 14A: Export ExploreContext
  ExploreContext,
} from './types.js';

export {
  SWORD_GATE_MODES,
  REFINEMENT_FIELDS,
  REQUIRED_REFINEMENT_FIELDS,
  OPTIONAL_REFINEMENT_FIELDS,
  DEFAULT_SWORD_GATE_CONFIG,
  isSwordGateMode,
  isRefinementField,
  hasRequiredFields,
  getMissingRequiredFields,
  calculateRefinementProgress,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// Mode Detector
// ─────────────────────────────────────────────────────────────────────────────────

export { ModeDetector, createModeDetector } from './mode-detector.js';
export type { ModeDetectionResult } from './mode-detector.js';

// ─────────────────────────────────────────────────────────────────────────────────
// Refinement Flow
// ─────────────────────────────────────────────────────────────────────────────────

export { RefinementFlow, createRefinementFlow } from './refinement-flow.js';

// ─────────────────────────────────────────────────────────────────────────────────
// Refinement Store
// ─────────────────────────────────────────────────────────────────────────────────

export { SwordRefinementStore, createSwordRefinementStore } from './sword-refinement-store.js';

// ─────────────────────────────────────────────────────────────────────────────────
// Sanitizers
// ─────────────────────────────────────────────────────────────────────────────────

export {
  GoalStatementSanitizer,
  createGoalStatementSanitizer,
  sanitizeGoalStatement,
} from './sanitizers.js';
export type { SanitizationResult, SanitizationRejectionReason } from './sanitizers.js';

// ─────────────────────────────────────────────────────────────────────────────────
// Lesson Plan Generator
// ─────────────────────────────────────────────────────────────────────────────────

export { LessonPlanGenerator, createLessonPlanGenerator } from './lesson-plan-generator.js';
export type {
  IResourceDiscoveryService,
  ICurriculumService,
  VerifiedResource,
  ResourceDiscoveryRequest,
  ResourceDiscoveryResult,
  CurriculumRequest,
  GeneratedCurriculum,
  CurriculumDay,
} from './lesson-plan-generator.js';

// ─────────────────────────────────────────────────────────────────────────────────
// Rate Limiter
// ─────────────────────────────────────────────────────────────────────────────────

export {
  GoalRateLimiter,
  createGoalRateLimiter,
  InMemoryGoalRateLimiter,
  createInMemoryGoalRateLimiter,
  DEFAULT_RATE_LIMITER_CONFIG,
} from './rate-limiter.js';
export type { GoalRateLimiterConfig } from './rate-limiter.js';

// ─────────────────────────────────────────────────────────────────────────────────
// Explore Module (Phase 14A)
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Types
  type ExploreState,
  type ExploreStage,
  type ExploreMessage,
  type ExploreConfig,
  type ClarityDetectionResult,
  // Type guards
  isExploreStage,
  isExploreTerminal,
  canContinueExploring,
  // Factories
  createEmptyExploreContext,
  buildExploreContext,
  DEFAULT_EXPLORE_CONFIG,
} from './explore/types.js';

export {
  ExploreStore,
  createExploreStore,
} from './explore/explore-store.js';

export {
  ClarityDetector,
  createClarityDetector,
} from './explore/clarity-detector.js';

export {
  ExploreFlow,
  createExploreFlow,
} from './explore/explore-flow.js';

// ─────────────────────────────────────────────────────────────────────────────────
// Refine Module (Phase 14B)
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Types
  type VolatilityCategory,
  type VolatilitySignal,
  type VolatilityAssessment,
  type VolatilityThresholds,
  type TopicDifficulty,
  type ScopeAssessment,
  type TopicNode,
  type Prerequisite,
  type LearningPath,
  type DeprecationWarning,
  type FreshnessInfo,
  type TopicLandscape,
  type RefineContext,
  type PrerequisiteAssessmentResult,
  type PrerequisiteStatus,
  type WebSearchRequest,
  type WebSearchResult,
  type WebSearchResponse,
  type IWebSearchService,
  type RefineModuleConfig,
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
} from './refine/types.js';

export {
  VolatilityDetector,
  createVolatilityDetector,
} from './refine/volatility-detector.js';

export {
  TopicLandscapeGenerator,
  createTopicLandscapeGenerator,
} from './refine/topic-landscape-generator.js';
