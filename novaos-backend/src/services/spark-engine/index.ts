// ═══════════════════════════════════════════════════════════════════════════════
// SPARK ENGINE MODULE — Public API Exports
// NovaOS Spark Engine — Phase 8: Core Types & SparkEngine
// ═══════════════════════════════════════════════════════════════════════════════
//
// This module exports the complete Spark Engine public API:
//   - Types: All extended Sword types for the learning system
//   - Interfaces: Dependency contracts for store, generators, services
//   - SparkEngine: Main orchestrator class
//
// Usage:
//   import { SparkEngine, type Goal, type Spark } from './spark-engine';
//
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Common types
  type DayOfWeek,
  ALL_DAYS,
  WEEKDAYS,

  // Goal types
  type GoalStatus,
  type UserLevel,
  type LearningStyle,
  type LearningConfig,
  type LessonPlanMetadata,
  type Goal,

  // Quest types
  type QuestStatus,
  type QuestResource,
  type Quest,

  // Step types
  type StepStatus,
  type DifficultyRating,
  type Step,

  // Activity types
  type ActivityType,
  type Activity,
  type VerificationLevel,
  type StepResource,

  // Spark types
  type SparkStatus,
  type SparkVariant,
  SPARK_MINUTES_BOUNDS,
  type Spark,

  // Reminder types
  type ReminderStatus,
  type ReminderTone,
  type ReminderChannels,
  type ReminderSchedule,
  REMINDER_CONFIG_DEFAULTS,
  type ReminderConfig,

  // SparkEngine param types
  type CreateGoalParams,
  type CreateQuestParams,
  type UpdateGoalParams,
  type TodayResult,
  type PathProgress,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// INTERFACES
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Dependency interfaces
  type ISparkEngineStore,
  type IStepGenerator,
  type ISparkGenerator,
  type IReminderService,

  // Main interface
  type ISparkEngine,
} from './interfaces.js';

// ─────────────────────────────────────────────────────────────────────────────────
// SPARK ENGINE
// ─────────────────────────────────────────────────────────────────────────────────

export {
  SparkEngine,
  DEFAULT_SPARK_ENGINE_CONFIG,
  type SparkEngineConfig,
} from './spark-engine.js';
