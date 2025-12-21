// ═══════════════════════════════════════════════════════════════════════════════
// STEP GENERATOR MODULE — Public API
// NovaOS Spark Engine — Phase 9: Step Generation
// ═══════════════════════════════════════════════════════════════════════════════
//
// Exports:
//   - StepGenerator: Main generator class
//   - Types: Configuration, results, validation
//   - Utilities: Locking, day validation, gap remediation
//
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export type {
  // Configuration
  StepGenerationConfig,
  LockConfig,
  DaySchedulingConfig,

  // Results
  StepGenerationResult,
  StepGenerationDiagnostics,
  StepGenerationErrorCode,

  // Validation
  ValidationIssue,
  ValidationSeverity,
  ValidationIssueType,

  // Gaps
  TopicGap,
  GapRemediation,
  GapRemediationStrategy,

  // Lock
  StepGenerationLock,

  // Scheduling
  ScheduledDay,
} from './types.js';

export {
  // Defaults
  DEFAULT_STEP_GENERATION_CONFIG,
  DEFAULT_LOCK_CONFIG,

  // Constants
  STEP_GENERATION_CONSTRAINTS,
  STEP_GENERATION_LOCK_PREFIX,

  // Utilities
  buildLockKey,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// GENERATOR
// ─────────────────────────────────────────────────────────────────────────────────

export {
  StepGenerator,
  createStepGenerator,
  createTestStepGenerator,
  DEFAULT_STEP_GENERATOR_CONFIG,
  type StepGeneratorConfig,
} from './generator.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LOCKING
// ─────────────────────────────────────────────────────────────────────────────────

export {
  DistributedLock,
  createDistributedLock,
  type LockError,
  type LockErrorCode,
} from './locking.js';

// ─────────────────────────────────────────────────────────────────────────────────
// DAY SEQUENCE VALIDATION
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Validation
  validateDaySequence,
  validateStepSequence,
  hasBlockingIssues,
  countBySeverity,
  filterByType,
  getIssuesForDay,

  // Date utilities
  getTodayInTimezone,
  isValidDateString,
  getDayOfWeek,
  getNextActiveDate,
  generateSchedule,
} from './day-sequence.js';

// ─────────────────────────────────────────────────────────────────────────────────
// GAP REMEDIATION
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Detection
  detectGaps,
  detectGapsFromResources,

  // Strategy
  selectStrategy,
  generateFallbackTemplate,

  // Planning
  planRemediation,
  planGapRemediations,
  applyFallbackRemediations,

  // Validation
  areGapsAcceptable,
  getManualInterventionRequired,
  summarizeRemediations,

  // Types
  type ITopicTaxonomy,
  type TopicMetadata,
  type FallbackTemplate,
  type FallbackType,
} from './gap-remediation.js';
