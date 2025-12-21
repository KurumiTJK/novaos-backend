// ═══════════════════════════════════════════════════════════════════════════════
// SPARK ENGINE INTERFACES — Dependency Contracts
// NovaOS Spark Engine — Phase 8: Core Types & SparkEngine
// ═══════════════════════════════════════════════════════════════════════════════
//
// This module defines the interfaces for SparkEngine dependencies:
//   - ISparkEngineStore: Persistent storage
//   - IStepGenerator: Step generation service
//   - ISparkGenerator: Spark generation service
//   - IReminderService: Reminder scheduling service
//   - ISparkEngine: Main orchestrator interface
//
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  UserId,
  GoalId,
  QuestId,
  StepId,
  SparkId,
} from '../../types/branded.js';
import type { AsyncAppResult } from '../../types/result.js';
import type {
  Goal,
  Quest,
  Step,
  Spark,
  ReminderSchedule,
  DifficultyRating,
  CreateGoalParams,
  CreateQuestParams,
  UpdateGoalParams,
  TodayResult,
  PathProgress,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// STORE INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Persistent storage for Spark Engine entities.
 */
export interface ISparkEngineStore {
  // ─────────────────────────────────────────────────────────────────────────────
  // Goals
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Save a goal (create or update).
   */
  saveGoal(goal: Goal): AsyncAppResult<Goal>;

  /**
   * Get a goal by ID.
   */
  getGoal(goalId: GoalId): AsyncAppResult<Goal | null>;

  /**
   * Get all goals for a user.
   */
  getGoalsByUser(userId: UserId): AsyncAppResult<readonly Goal[]>;

  /**
   * Delete a goal and all associated data.
   */
  deleteGoal(goalId: GoalId): AsyncAppResult<void>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Quests
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Save a quest (create or update).
   */
  saveQuest(quest: Quest): AsyncAppResult<Quest>;

  /**
   * Get a quest by ID.
   */
  getQuest(questId: QuestId): AsyncAppResult<Quest | null>;

  /**
   * Get all quests for a goal.
   */
  getQuestsByGoal(goalId: GoalId): AsyncAppResult<readonly Quest[]>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Steps
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Save a step (create or update).
   */
  saveStep(step: Step): AsyncAppResult<Step>;

  /**
   * Get a step by ID.
   */
  getStep(stepId: StepId): AsyncAppResult<Step | null>;

  /**
   * Get all steps for a quest.
   */
  getStepsByQuest(questId: QuestId): AsyncAppResult<readonly Step[]>;

  /**
   * Get a step by scheduled date for a user.
   * Searches across all active goals.
   */
  getStepByDate(userId: UserId, date: string): AsyncAppResult<Step | null>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Sparks
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Save a spark (create or update).
   */
  saveSpark(spark: Spark): AsyncAppResult<Spark>;

  /**
   * Get a spark by ID.
   */
  getSpark(sparkId: SparkId): AsyncAppResult<Spark | null>;

  /**
   * Get all sparks for a step.
   */
  getSparksByStep(stepId: StepId): AsyncAppResult<readonly Spark[]>;

  /**
   * Get the active spark for a step (status = 'active' or 'pending').
   */
  getActiveSparkForStep(stepId: StepId): AsyncAppResult<Spark | null>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP GENERATOR INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generates steps for a quest from verified resources.
 */
export interface IStepGenerator {
  /**
   * Generate steps for a quest.
   * Uses the quest's resources and goal's learning config.
   *
   * @param quest - The quest to generate steps for
   * @param goal - The parent goal (for learning config)
   * @returns Generated steps (not yet saved)
   */
  generateSteps(quest: Quest, goal: Goal): AsyncAppResult<readonly Step[]>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPARK GENERATOR INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generates sparks for steps.
 */
export interface ISparkGenerator {
  /**
   * Generate a spark for a step at the given escalation level.
   *
   * @param step - The step to generate a spark for
   * @param escalationLevel - Escalation level (0-3)
   * @returns Generated spark (not yet saved)
   */
  generateSpark(step: Step, escalationLevel: number): AsyncAppResult<Spark>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// REMINDER SERVICE INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Manages reminder scheduling and delivery.
 */
export interface IReminderService {
  /**
   * Schedule reminders for a spark.
   *
   * @param spark - The spark to schedule reminders for
   * @param goal - The parent goal (for reminder config)
   * @returns Scheduled reminders
   */
  scheduleReminders(
    spark: Spark,
    goal: Goal
  ): AsyncAppResult<readonly ReminderSchedule[]>;

  /**
   * Cancel pending reminders for a spark.
   *
   * @param sparkId - The spark to cancel reminders for
   */
  cancelReminders(sparkId: SparkId): AsyncAppResult<void>;

  /**
   * Get pending reminders for a user.
   *
   * @param userId - The user to get reminders for
   * @returns Pending reminders sorted by scheduled time
   */
  getPendingReminders(
    userId: UserId
  ): AsyncAppResult<readonly ReminderSchedule[]>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPARK ENGINE INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * SparkEngine — Main orchestrator for the Sword learning system.
 *
 * Coordinates:
 * - Goal/Quest/Step management
 * - Daily spark delivery
 * - Completion tracking
 * - Progress computation
 * - Reminder scheduling (via ReminderService)
 */
export interface ISparkEngine {
  // ─────────────────────────────────────────────────────────────────────────────
  // Goal Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a new learning goal.
   */
  createGoal(params: CreateGoalParams): AsyncAppResult<Goal>;

  /**
   * Get a goal by ID.
   */
  getGoal(goalId: GoalId): AsyncAppResult<Goal | null>;

  /**
   * Get all goals for a user.
   */
  getGoalsForUser(userId: UserId): AsyncAppResult<readonly Goal[]>;

  /**
   * Update an existing goal.
   */
  updateGoal(goalId: GoalId, updates: UpdateGoalParams): AsyncAppResult<Goal>;

  /**
   * Delete a goal and all associated data.
   */
  deleteGoal(goalId: GoalId): AsyncAppResult<void>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Quest Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a new quest within a goal.
   */
  createQuest(params: CreateQuestParams): AsyncAppResult<Quest>;

  /**
   * Get all quests for a goal.
   */
  getQuestsForGoal(goalId: GoalId): AsyncAppResult<readonly Quest[]>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Handoff from SwordGate
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Handle goal creation from SwordGate.
   * Triggers step generation for the first quest.
   */
  onGoalCreated(goal: Goal, quests: readonly Quest[]): AsyncAppResult<void>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Daily Operations
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get today's learning content for a user.
   * Finds the scheduled step and active/creates spark.
   */
  getTodayForUser(userId: UserId): AsyncAppResult<TodayResult>;

  /**
   * Generate a spark for a step at the given escalation level.
   */
  generateSparkForStep(
    stepId: StepId,
    escalationLevel: number
  ): AsyncAppResult<Spark>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Completion
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Mark a spark as completed.
   * Cancels pending reminders and may complete the parent step.
   */
  markSparkComplete(
    sparkId: SparkId,
    actualMinutes?: number
  ): AsyncAppResult<void>;

  /**
   * Skip a spark.
   * Records the skip reason and may advance to next content.
   */
  skipSpark(sparkId: SparkId, reason?: string): AsyncAppResult<void>;

  /**
   * Rate the difficulty of a completed step.
   * Used for adaptive difficulty adjustment.
   */
  rateDifficulty(
    stepId: StepId,
    rating: DifficultyRating
  ): AsyncAppResult<void>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Progress
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get progress through a goal's learning path.
   */
  getPathProgress(goalId: GoalId): AsyncAppResult<PathProgress>;
}
