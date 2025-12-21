// ═══════════════════════════════════════════════════════════════════════════════
// SPARK ENGINE — Main Orchestrator Implementation
// NovaOS Spark Engine — Phase 8: Core Types & SparkEngine
// ═══════════════════════════════════════════════════════════════════════════════
//
// SparkEngine orchestrates the Sword learning system:
//   - Goal/Quest/Step management
//   - Daily spark delivery
//   - Completion tracking
//   - Progress computation
//   - Reminder scheduling (via ReminderService)
//
// ═══════════════════════════════════════════════════════════════════════════════

import { ok, err, isOk } from '../../types/result.js';
import type { AsyncAppResult } from '../../types/result.js';
import {
  createGoalId,
  createQuestId,
  createTimestamp,
  type UserId,
  type GoalId,
  type QuestId,
  type StepId,
  type SparkId,
  type Timestamp,
} from '../../types/branded.js';

import type {
  Goal,
  Quest,
  Step,
  Spark,
  DifficultyRating,
  CreateGoalParams,
  CreateQuestParams,
  UpdateGoalParams,
  TodayResult,
  PathProgress,
} from './types.js';

import type {
  ISparkEngine,
  ISparkEngineStore,
  IStepGenerator,
  ISparkGenerator,
  IReminderService,
} from './interfaces.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * SparkEngine configuration options.
 */
export interface SparkEngineConfig {
  /** Default timezone if user hasn't set one */
  readonly defaultTimezone: string;
}

/**
 * Default configuration.
 */
export const DEFAULT_SPARK_ENGINE_CONFIG: SparkEngineConfig = {
  defaultTimezone: 'UTC',
};

// ─────────────────────────────────────────────────────────────────────────────────
// SPARK ENGINE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * SparkEngine orchestrates the Sword learning system.
 */
export class SparkEngine implements ISparkEngine {
  private readonly store: ISparkEngineStore;
  private readonly stepGenerator: IStepGenerator;
  private readonly sparkGenerator: ISparkGenerator;
  private readonly reminderService: IReminderService;
  private readonly config: SparkEngineConfig;

  constructor(
    store: ISparkEngineStore,
    stepGenerator: IStepGenerator,
    sparkGenerator: ISparkGenerator,
    reminderService: IReminderService,
    config: Partial<SparkEngineConfig> = {}
  ) {
    this.store = store;
    this.stepGenerator = stepGenerator;
    this.sparkGenerator = sparkGenerator;
    this.reminderService = reminderService;
    this.config = { ...DEFAULT_SPARK_ENGINE_CONFIG, ...config };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Goal Management
  // ─────────────────────────────────────────────────────────────────────────────

  async createGoal(params: CreateGoalParams): AsyncAppResult<Goal> {
    const now = createTimestamp();

    const goal: Goal = {
      id: createGoalId(),
      userId: params.userId,
      title: params.title,
      description: params.description,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      learningConfig: params.learningConfig,
      reminderConfig: params.reminderConfig,
    };

    return this.store.saveGoal(goal);
  }

  async getGoal(goalId: GoalId): AsyncAppResult<Goal | null> {
    return this.store.getGoal(goalId);
  }

  async getGoalsForUser(userId: UserId): AsyncAppResult<readonly Goal[]> {
    return this.store.getGoalsByUser(userId);
  }

  async updateGoal(
    goalId: GoalId,
    updates: UpdateGoalParams
  ): AsyncAppResult<Goal> {
    const existingResult = await this.store.getGoal(goalId);

    if (!isOk(existingResult)) {
      return existingResult;
    }

    if (!existingResult.value) {
      return err({
        code: 'NOT_FOUND',
        message: `Goal not found: ${goalId}`,
      });
    }

    const existing = existingResult.value;
    const now = createTimestamp();

    const updated: Goal = {
      ...existing,
      title: updates.title ?? existing.title,
      description: updates.description ?? existing.description,
      learningConfig: updates.learningConfig
        ? { ...existing.learningConfig, ...updates.learningConfig }
        : existing.learningConfig,
      reminderConfig: updates.reminderConfig
        ? { ...existing.reminderConfig, ...updates.reminderConfig }
        : existing.reminderConfig,
      updatedAt: now,
    };

    return this.store.saveGoal(updated);
  }

  async deleteGoal(goalId: GoalId): AsyncAppResult<void> {
    return this.store.deleteGoal(goalId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Quest Management
  // ─────────────────────────────────────────────────────────────────────────────

  async createQuest(params: CreateQuestParams): AsyncAppResult<Quest> {
    const now = createTimestamp();

    const quest: Quest = {
      id: createQuestId(),
      goalId: params.goalId,
      title: params.title,
      description: params.description,
      status: 'pending',
      order: params.order,
      createdAt: now,
      updatedAt: now,
      estimatedDays: params.estimatedDays,
    };

    return this.store.saveQuest(quest);
  }

  async getQuestsForGoal(goalId: GoalId): AsyncAppResult<readonly Quest[]> {
    return this.store.getQuestsByGoal(goalId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Handoff from SwordGate
  // ─────────────────────────────────────────────────────────────────────────────

  async onGoalCreated(
    goal: Goal,
    quests: readonly Quest[]
  ): AsyncAppResult<void> {
    if (quests.length === 0) {
      return ok(undefined);
    }

    // Get first quest by order
    const firstQuest = quests.reduce((a, b) => (a.order < b.order ? a : b));

    // Generate steps for first quest
    const stepsResult = await this.stepGenerator.generateSteps(firstQuest, goal);

    if (!isOk(stepsResult)) {
      return stepsResult;
    }

    // Save all steps
    for (const step of stepsResult.value) {
      const saveResult = await this.store.saveStep(step);
      if (!isOk(saveResult)) {
        return err(saveResult.error);
      }
    }

    // Activate first quest
    const activatedQuest: Quest = {
      ...firstQuest,
      status: 'active',
      updatedAt: createTimestamp(),
    };

    const questSaveResult = await this.store.saveQuest(activatedQuest);
    if (!isOk(questSaveResult)) {
      return err(questSaveResult.error);
    }

    // Schedule reminders for first day if there are steps
    if (stepsResult.value.length > 0) {
      const firstStep = stepsResult.value[0];

      // Generate initial spark
      const sparkResult = await this.sparkGenerator.generateSpark(firstStep, 0);

      if (isOk(sparkResult)) {
        await this.store.saveSpark(sparkResult.value);

        // Schedule reminders
        await this.reminderService.scheduleReminders(sparkResult.value, goal);
      }
    }

    return ok(undefined);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Daily Operations
  // ─────────────────────────────────────────────────────────────────────────────

  async getTodayForUser(userId: UserId): AsyncAppResult<TodayResult> {
    // Get user's goals to find timezone
    const goalsResult = await this.store.getGoalsByUser(userId);

    if (!isOk(goalsResult)) {
      return goalsResult;
    }

    // Find timezone from first active goal with reminder config
    const activeGoal = goalsResult.value.find(
      (g) => g.status === 'active' && g.reminderConfig?.timezone
    );

    const timezone =
      activeGoal?.reminderConfig?.timezone ?? this.config.defaultTimezone;

    // Get today's date in user's timezone
    const today = this.getTodayInTimezone(timezone);

    // Find step scheduled for today
    const stepResult = await this.store.getStepByDate(userId, today);

    if (!isOk(stepResult)) {
      return stepResult;
    }

    const step = stepResult.value;

    // No content today
    if (!step) {
      return ok({
        hasContent: false,
        step: null,
        spark: null,
        date: today,
        timezone,
        goalId: null,
        questId: null,
      });
    }

    // Find or create active spark for step
    let spark: Spark | null = null;

    const existingSparkResult = await this.store.getActiveSparkForStep(step.id);

    if (isOk(existingSparkResult) && existingSparkResult.value) {
      spark = existingSparkResult.value;
    } else {
      // Generate new spark
      const sparkResult = await this.sparkGenerator.generateSpark(step, 0);

      if (isOk(sparkResult)) {
        const saveResult = await this.store.saveSpark(sparkResult.value);
        if (isOk(saveResult)) {
          spark = saveResult.value;
        }
      }
    }

    // Get quest to find goal
    const questResult = await this.store.getQuest(step.questId);
    const quest = isOk(questResult) ? questResult.value : null;

    return ok({
      hasContent: true,
      step,
      spark,
      date: today,
      timezone,
      goalId: quest?.goalId ?? null,
      questId: step.questId,
    });
  }

  async generateSparkForStep(
    stepId: StepId,
    escalationLevel: number
  ): AsyncAppResult<Spark> {
    const stepResult = await this.store.getStep(stepId);

    if (!isOk(stepResult)) {
      return stepResult;
    }

    if (!stepResult.value) {
      return err({
        code: 'NOT_FOUND',
        message: `Step not found: ${stepId}`,
      });
    }

    return this.sparkGenerator.generateSpark(stepResult.value, escalationLevel);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Completion
  // ─────────────────────────────────────────────────────────────────────────────

  async markSparkComplete(
    sparkId: SparkId,
    actualMinutes?: number
  ): AsyncAppResult<void> {
    // Get spark
    const sparkResult = await this.store.getSpark(sparkId);

    if (!isOk(sparkResult)) {
      return sparkResult;
    }

    if (!sparkResult.value) {
      return err({
        code: 'NOT_FOUND',
        message: `Spark not found: ${sparkId}`,
      });
    }

    const spark = sparkResult.value;
    const now = createTimestamp();

    // Update spark status
    const completedSpark: Spark = {
      ...spark,
      status: 'completed',
      updatedAt: now,
    };

    const saveResult = await this.store.saveSpark(completedSpark);
    if (!isOk(saveResult)) {
      return err(saveResult.error);
    }

    // Cancel pending reminders
    await this.reminderService.cancelReminders(sparkId);

    // Check if all sparks for step are complete
    const stepSparksResult = await this.store.getSparksByStep(spark.stepId);

    if (isOk(stepSparksResult)) {
      const allComplete = stepSparksResult.value.every(
        (s) => s.status === 'completed' || s.status === 'skipped'
      );

      if (allComplete) {
        // Mark step as completed
        const stepResult = await this.store.getStep(spark.stepId);

        if (isOk(stepResult) && stepResult.value) {
          const completedStep: Step = {
            ...stepResult.value,
            status: 'completed',
            completedAt: now,
            actualMinutes,
            updatedAt: now,
          };

          await this.store.saveStep(completedStep);
        }
      }
    }

    return ok(undefined);
  }

  async skipSpark(sparkId: SparkId, reason?: string): AsyncAppResult<void> {
    const sparkResult = await this.store.getSpark(sparkId);

    if (!isOk(sparkResult)) {
      return sparkResult;
    }

    if (!sparkResult.value) {
      return err({
        code: 'NOT_FOUND',
        message: `Spark not found: ${sparkId}`,
      });
    }

    const spark = sparkResult.value;
    const now = createTimestamp();

    const skippedSpark: Spark = {
      ...spark,
      status: 'skipped',
      updatedAt: now,
    };

    const saveResult = await this.store.saveSpark(skippedSpark);
    if (!isOk(saveResult)) {
      return err(saveResult.error);
    }

    // Cancel pending reminders
    await this.reminderService.cancelReminders(sparkId);

    return ok(undefined);
  }

  async rateDifficulty(
    stepId: StepId,
    rating: DifficultyRating
  ): AsyncAppResult<void> {
    const stepResult = await this.store.getStep(stepId);

    if (!isOk(stepResult)) {
      return stepResult;
    }

    if (!stepResult.value) {
      return err({
        code: 'NOT_FOUND',
        message: `Step not found: ${stepId}`,
      });
    }

    const updatedStep: Step = {
      ...stepResult.value,
      difficultyRating: rating,
      updatedAt: createTimestamp(),
    };

    const saveResult = await this.store.saveStep(updatedStep);

    return isOk(saveResult) ? ok(undefined) : err(saveResult.error);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Progress
  // ─────────────────────────────────────────────────────────────────────────────

  async getPathProgress(goalId: GoalId): AsyncAppResult<PathProgress> {
    // Get goal
    const goalResult = await this.store.getGoal(goalId);

    if (!isOk(goalResult)) {
      return goalResult;
    }

    if (!goalResult.value) {
      return err({
        code: 'NOT_FOUND',
        message: `Goal not found: ${goalId}`,
      });
    }

    // Get all quests
    const questsResult = await this.store.getQuestsByGoal(goalId);

    if (!isOk(questsResult)) {
      return questsResult;
    }

    const quests = questsResult.value;
    const completedQuests = quests.filter((q) => q.status === 'completed').length;
    const currentQuest = quests.find((q) => q.status === 'active') ?? null;

    // Get all steps across quests
    let allSteps: Step[] = [];

    for (const quest of quests) {
      const stepsResult = await this.store.getStepsByQuest(quest.id);
      if (isOk(stepsResult)) {
        allSteps = allSteps.concat(stepsResult.value as Step[]);
      }
    }

    const completedSteps = allSteps.filter((s) => s.status === 'completed');
    const currentStep = allSteps.find((s) => s.status === 'active') ?? null;

    // Calculate progress
    const totalSteps = allSteps.length;
    const overallProgress =
      totalSteps > 0
        ? Math.round((completedSteps.length / totalSteps) * 100)
        : 0;

    // Calculate days
    const daysCompleted = completedSteps.length;
    const totalDays = allSteps.length;

    // Calculate average difficulty
    const stepsWithRating = completedSteps.filter((s) => s.difficultyRating);
    const averageDifficulty =
      stepsWithRating.length > 0
        ? stepsWithRating.reduce((sum, s) => sum + (s.difficultyRating ?? 0), 0) /
          stepsWithRating.length
        : null;

    // Find last activity
    const lastActivityAt =
      completedSteps.length > 0
        ? completedSteps.reduce(
            (latest, s) =>
              s.completedAt && s.completedAt > (latest ?? '')
                ? s.completedAt
                : latest,
            null as Timestamp | null
          )
        : null;

    // Calculate days behind
    const today = this.getTodayInTimezone(this.config.defaultTimezone);
    const scheduledToday = allSteps.filter(
      (s) => s.scheduledDate && s.scheduledDate <= today && s.status === 'pending'
    );
    const daysBehind = scheduledToday.length;

    // Estimate completion
    const remainingSteps = allSteps.filter((s) => s.status === 'pending');
    const estimatedCompletionDate =
      remainingSteps.length > 0 &&
      remainingSteps[remainingSteps.length - 1].scheduledDate
        ? remainingSteps[remainingSteps.length - 1].scheduledDate!
        : null;

    return ok({
      goalId,
      overallProgress,
      completedSteps: completedSteps.length,
      totalSteps,
      completedQuests,
      totalQuests: quests.length,
      currentQuest,
      currentStep,
      daysCompleted,
      totalDays,
      estimatedCompletionDate,
      onTrack: daysBehind === 0,
      daysBehind,
      averageDifficulty,
      lastActivityAt,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get today's date in the given timezone (YYYY-MM-DD format).
   */
  private getTodayInTimezone(timezone: string): string {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(now);
  }
}
