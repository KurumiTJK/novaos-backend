// ═══════════════════════════════════════════════════════════════════════════════
// SWORDGATE MODULE — Exports
// NovaOS Gates — Phase 13: SwordGate Integration
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
