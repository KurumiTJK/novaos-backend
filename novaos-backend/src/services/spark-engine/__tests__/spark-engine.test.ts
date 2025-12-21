// ═══════════════════════════════════════════════════════════════════════════════
// SPARK ENGINE TESTS — SparkEngine Orchestrator Tests
// NovaOS Spark Engine — Phase 8: Core Types & SparkEngine
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ok, err } from '../../../types/result.js';
import type { AsyncAppResult } from '../../../types/result.js';
import {
  createGoalId,
  createQuestId,
  createStepId,
  createSparkId,
  createUserId,
  createTimestamp,
  type GoalId,
  type QuestId,
  type StepId,
  type SparkId,
  type UserId,
} from '../../../types/branded.js';

import { SparkEngine } from '../spark-engine.js';
import type {
  Goal,
  Quest,
  Step,
  Spark,
  ReminderSchedule,
} from '../types.js';
import type {
  ISparkEngineStore,
  IStepGenerator,
  ISparkGenerator,
  IReminderService,
} from '../interfaces.js';

// ─────────────────────────────────────────────────────────────────────────────────
// MOCK IMPLEMENTATIONS
// ─────────────────────────────────────────────────────────────────────────────────

function createMockStore(): ISparkEngineStore {
  const goals = new Map<string, Goal>();
  const quests = new Map<string, Quest>();
  const steps = new Map<string, Step>();
  const sparks = new Map<string, Spark>();

  return {
    // Goals
    saveGoal: vi.fn(async (goal: Goal): AsyncAppResult<Goal> => {
      goals.set(goal.id, goal);
      return ok(goal);
    }),
    getGoal: vi.fn(async (goalId: GoalId): AsyncAppResult<Goal | null> => {
      return ok(goals.get(goalId) ?? null);
    }),
    getGoalsByUser: vi.fn(async (userId: UserId): AsyncAppResult<readonly Goal[]> => {
      return ok(Array.from(goals.values()).filter(g => g.userId === userId));
    }),
    deleteGoal: vi.fn(async (goalId: GoalId): AsyncAppResult<void> => {
      goals.delete(goalId);
      return ok(undefined);
    }),

    // Quests
    saveQuest: vi.fn(async (quest: Quest): AsyncAppResult<Quest> => {
      quests.set(quest.id, quest);
      return ok(quest);
    }),
    getQuest: vi.fn(async (questId: QuestId): AsyncAppResult<Quest | null> => {
      return ok(quests.get(questId) ?? null);
    }),
    getQuestsByGoal: vi.fn(async (goalId: GoalId): AsyncAppResult<readonly Quest[]> => {
      return ok(Array.from(quests.values()).filter(q => q.goalId === goalId));
    }),

    // Steps
    saveStep: vi.fn(async (step: Step): AsyncAppResult<Step> => {
      steps.set(step.id, step);
      return ok(step);
    }),
    getStep: vi.fn(async (stepId: StepId): AsyncAppResult<Step | null> => {
      return ok(steps.get(stepId) ?? null);
    }),
    getStepsByQuest: vi.fn(async (questId: QuestId): AsyncAppResult<readonly Step[]> => {
      return ok(Array.from(steps.values()).filter(s => s.questId === questId));
    }),
    getStepByDate: vi.fn(async (userId: UserId, date: string): AsyncAppResult<Step | null> => {
      const step = Array.from(steps.values()).find(s => s.scheduledDate === date);
      return ok(step ?? null);
    }),

    // Sparks
    saveSpark: vi.fn(async (spark: Spark): AsyncAppResult<Spark> => {
      sparks.set(spark.id, spark);
      return ok(spark);
    }),
    getSpark: vi.fn(async (sparkId: SparkId): AsyncAppResult<Spark | null> => {
      return ok(sparks.get(sparkId) ?? null);
    }),
    getSparksByStep: vi.fn(async (stepId: StepId): AsyncAppResult<readonly Spark[]> => {
      return ok(Array.from(sparks.values()).filter(s => s.stepId === stepId));
    }),
    getActiveSparkForStep: vi.fn(async (stepId: StepId): AsyncAppResult<Spark | null> => {
      const spark = Array.from(sparks.values()).find(
        s => s.stepId === stepId && (s.status === 'active' || s.status === 'pending')
      );
      return ok(spark ?? null);
    }),
  };
}

function createMockStepGenerator(): IStepGenerator {
  return {
    generateSteps: vi.fn(async (quest: Quest, goal: Goal): AsyncAppResult<readonly Step[]> => {
      const steps: Step[] = [
        {
          id: createStepId(),
          questId: quest.id,
          title: 'Day 1: Introduction',
          description: 'First day of learning',
          status: 'pending',
          order: 1,
          createdAt: createTimestamp(),
          updatedAt: createTimestamp(),
          scheduledDate: '2025-01-01',
          dayNumber: 1,
          estimatedMinutes: 60,
        },
        {
          id: createStepId(),
          questId: quest.id,
          title: 'Day 2: Deep Dive',
          description: 'Second day of learning',
          status: 'pending',
          order: 2,
          createdAt: createTimestamp(),
          updatedAt: createTimestamp(),
          scheduledDate: '2025-01-02',
          dayNumber: 2,
          estimatedMinutes: 60,
        },
      ];
      return ok(steps);
    }),
  };
}

function createMockSparkGenerator(): ISparkGenerator {
  return {
    generateSpark: vi.fn(async (step: Step, escalationLevel: number): AsyncAppResult<Spark> => {
      const variants = ['full', 'full', 'reduced', 'minimal'] as const;
      const variant = variants[Math.min(escalationLevel, 3)];

      const spark: Spark = {
        id: createSparkId(),
        stepId: step.id,
        action: `Start ${step.title}`,
        status: 'pending',
        createdAt: createTimestamp(),
        updatedAt: createTimestamp(),
        variant,
        escalationLevel,
        estimatedMinutes: Math.max(5, Math.floor(60 / (escalationLevel + 1))),
      };
      return ok(spark);
    }),
  };
}

function createMockReminderService(): IReminderService {
  return {
    scheduleReminders: vi.fn(async (spark: Spark, goal: Goal): AsyncAppResult<readonly ReminderSchedule[]> => {
      return ok([]);
    }),
    cancelReminders: vi.fn(async (sparkId: SparkId): AsyncAppResult<void> => {
      return ok(undefined);
    }),
    getPendingReminders: vi.fn(async (userId: UserId): AsyncAppResult<readonly ReminderSchedule[]> => {
      return ok([]);
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────────────────────────────────────────

function createTestGoal(userId: UserId): Goal {
  return {
    id: createGoalId(),
    userId,
    title: 'Learn Rust',
    description: 'Master Rust programming',
    status: 'active',
    createdAt: createTimestamp(),
    updatedAt: createTimestamp(),
    reminderConfig: {
      enabled: true,
      firstReminderHour: 9,
      lastReminderHour: 19,
      intervalHours: 3,
      channels: { push: true, email: false, sms: false },
      shrinkSparksOnEscalation: true,
      maxRemindersPerDay: 4,
      quietDays: [],
      timezone: 'America/New_York',
    },
  };
}

function createTestQuest(goalId: GoalId): Quest {
  return {
    id: createQuestId(),
    goalId,
    title: 'Week 1: Basics',
    description: 'Learn the basics',
    status: 'pending',
    order: 1,
    createdAt: createTimestamp(),
    updatedAt: createTimestamp(),
    estimatedDays: 7,
  };
}

function createTestStep(questId: QuestId): Step {
  return {
    id: createStepId(),
    questId,
    title: 'Day 1: Hello World',
    description: 'Write your first program',
    status: 'pending',
    order: 1,
    createdAt: createTimestamp(),
    updatedAt: createTimestamp(),
    scheduledDate: '2025-01-01',
    dayNumber: 1,
    estimatedMinutes: 60,
  };
}

function createTestSpark(stepId: StepId): Spark {
  return {
    id: createSparkId(),
    stepId,
    action: 'Open the Rust Book',
    status: 'pending',
    createdAt: createTimestamp(),
    updatedAt: createTimestamp(),
    variant: 'full',
    escalationLevel: 0,
    estimatedMinutes: 10,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// SPARK ENGINE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('SparkEngine', () => {
  let store: ISparkEngineStore;
  let stepGenerator: IStepGenerator;
  let sparkGenerator: ISparkGenerator;
  let reminderService: IReminderService;
  let engine: SparkEngine;

  beforeEach(() => {
    store = createMockStore();
    stepGenerator = createMockStepGenerator();
    sparkGenerator = createMockSparkGenerator();
    reminderService = createMockReminderService();
    engine = new SparkEngine(store, stepGenerator, sparkGenerator, reminderService);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Goal Management
  // ─────────────────────────────────────────────────────────────────────────────

  describe('createGoal', () => {
    it('creates a goal with default status', async () => {
      const userId = createUserId();
      const result = await engine.createGoal({
        userId,
        title: 'Learn Rust',
        description: 'Master Rust programming',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Learn Rust');
        expect(result.value.status).toBe('active');
        expect(result.value.userId).toBe(userId);
      }
    });

    it('creates a goal with learning config', async () => {
      const result = await engine.createGoal({
        userId: createUserId(),
        title: 'Learn Rust',
        description: 'Master Rust',
        learningConfig: {
          userLevel: 'beginner',
          dailyTimeCommitment: 60,
        },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.learningConfig?.userLevel).toBe('beginner');
      }
    });
  });

  describe('getGoal', () => {
    it('returns null for non-existent goal', async () => {
      const result = await engine.getGoal(createGoalId());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns existing goal', async () => {
      const createResult = await engine.createGoal({
        userId: createUserId(),
        title: 'Learn Rust',
        description: 'Master Rust',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const getResult = await engine.getGoal(createResult.value.id);
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value?.title).toBe('Learn Rust');
      }
    });
  });

  describe('updateGoal', () => {
    it('updates goal title', async () => {
      const createResult = await engine.createGoal({
        userId: createUserId(),
        title: 'Learn Rust',
        description: 'Master Rust',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const updateResult = await engine.updateGoal(createResult.value.id, {
        title: 'Master Rust',
      });

      expect(updateResult.ok).toBe(true);
      if (updateResult.ok) {
        expect(updateResult.value.title).toBe('Master Rust');
      }
    });

    it('merges learning config', async () => {
      const createResult = await engine.createGoal({
        userId: createUserId(),
        title: 'Learn Rust',
        description: 'Master Rust',
        learningConfig: { userLevel: 'beginner' },
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const updateResult = await engine.updateGoal(createResult.value.id, {
        learningConfig: { dailyTimeCommitment: 90 },
      });

      expect(updateResult.ok).toBe(true);
      if (updateResult.ok) {
        expect(updateResult.value.learningConfig?.userLevel).toBe('beginner');
        expect(updateResult.value.learningConfig?.dailyTimeCommitment).toBe(90);
      }
    });

    it('returns error for non-existent goal', async () => {
      const result = await engine.updateGoal(createGoalId(), { title: 'New' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Quest Management
  // ─────────────────────────────────────────────────────────────────────────────

  describe('createQuest', () => {
    it('creates a quest', async () => {
      const goalId = createGoalId();
      const result = await engine.createQuest({
        goalId,
        title: 'Week 1',
        description: 'First week',
        order: 1,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Week 1');
        expect(result.value.status).toBe('pending');
        expect(result.value.order).toBe(1);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // onGoalCreated
  // ─────────────────────────────────────────────────────────────────────────────

  describe('onGoalCreated', () => {
    it('generates steps for first quest', async () => {
      const userId = createUserId();
      const goal = createTestGoal(userId);
      const quest = createTestQuest(goal.id);

      const result = await engine.onGoalCreated(goal, [quest]);

      expect(result.ok).toBe(true);
      expect(stepGenerator.generateSteps).toHaveBeenCalledWith(quest, goal);
      expect(store.saveStep).toHaveBeenCalled();
    });

    it('activates first quest', async () => {
      const goal = createTestGoal(createUserId());
      const quest = createTestQuest(goal.id);

      await engine.onGoalCreated(goal, [quest]);

      expect(store.saveQuest).toHaveBeenCalled();
      const calls = (store.saveQuest as ReturnType<typeof vi.fn>).mock.calls;
      const savedQuest = calls[0][0] as Quest;
      expect(savedQuest.status).toBe('active');
    });

    it('generates initial spark', async () => {
      const goal = createTestGoal(createUserId());
      const quest = createTestQuest(goal.id);

      await engine.onGoalCreated(goal, [quest]);

      expect(sparkGenerator.generateSpark).toHaveBeenCalled();
      expect(store.saveSpark).toHaveBeenCalled();
    });

    it('schedules reminders', async () => {
      const goal = createTestGoal(createUserId());
      const quest = createTestQuest(goal.id);

      await engine.onGoalCreated(goal, [quest]);

      expect(reminderService.scheduleReminders).toHaveBeenCalled();
    });

    it('handles empty quests', async () => {
      const goal = createTestGoal(createUserId());

      const result = await engine.onGoalCreated(goal, []);

      expect(result.ok).toBe(true);
      expect(stepGenerator.generateSteps).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // markSparkComplete
  // ─────────────────────────────────────────────────────────────────────────────

  describe('markSparkComplete', () => {
    it('updates spark status to completed', async () => {
      const step = createTestStep(createQuestId());
      const spark = createTestSpark(step.id);

      // Save step and spark
      await store.saveStep(step);
      await store.saveSpark(spark);

      const result = await engine.markSparkComplete(spark.id);

      expect(result.ok).toBe(true);
      expect(store.saveSpark).toHaveBeenCalled();

      const calls = (store.saveSpark as ReturnType<typeof vi.fn>).mock.calls;
      const lastSpark = calls[calls.length - 1][0] as Spark;
      expect(lastSpark.status).toBe('completed');
    });

    it('cancels pending reminders', async () => {
      const step = createTestStep(createQuestId());
      const spark = createTestSpark(step.id);

      await store.saveStep(step);
      await store.saveSpark(spark);

      await engine.markSparkComplete(spark.id);

      expect(reminderService.cancelReminders).toHaveBeenCalledWith(spark.id);
    });

    it('returns error for non-existent spark', async () => {
      const result = await engine.markSparkComplete(createSparkId());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // skipSpark
  // ─────────────────────────────────────────────────────────────────────────────

  describe('skipSpark', () => {
    it('updates spark status to skipped', async () => {
      const step = createTestStep(createQuestId());
      const spark = createTestSpark(step.id);

      await store.saveStep(step);
      await store.saveSpark(spark);

      const result = await engine.skipSpark(spark.id, 'Not today');

      expect(result.ok).toBe(true);

      const calls = (store.saveSpark as ReturnType<typeof vi.fn>).mock.calls;
      const lastSpark = calls[calls.length - 1][0] as Spark;
      expect(lastSpark.status).toBe('skipped');
    });

    it('cancels pending reminders', async () => {
      const step = createTestStep(createQuestId());
      const spark = createTestSpark(step.id);

      await store.saveStep(step);
      await store.saveSpark(spark);

      await engine.skipSpark(spark.id);

      expect(reminderService.cancelReminders).toHaveBeenCalledWith(spark.id);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // rateDifficulty
  // ─────────────────────────────────────────────────────────────────────────────

  describe('rateDifficulty', () => {
    it('updates step difficulty rating', async () => {
      const step = createTestStep(createQuestId());
      await store.saveStep(step);

      const result = await engine.rateDifficulty(step.id, 3);

      expect(result.ok).toBe(true);

      const calls = (store.saveStep as ReturnType<typeof vi.fn>).mock.calls;
      const lastStep = calls[calls.length - 1][0] as Step;
      expect(lastStep.difficultyRating).toBe(3);
    });

    it('returns error for non-existent step', async () => {
      const result = await engine.rateDifficulty(createStepId(), 3);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getPathProgress
  // ─────────────────────────────────────────────────────────────────────────────

  describe('getPathProgress', () => {
    it('calculates progress for goal with steps', async () => {
      const userId = createUserId();
      const goal = createTestGoal(userId);
      const quest = createTestQuest(goal.id);

      // Save goal and quest
      await store.saveGoal(goal);
      await store.saveQuest(quest);

      // Create and save steps
      const step1: Step = {
        id: createStepId(),
        questId: quest.id,
        title: 'Day 1',
        description: 'First',
        status: 'completed',
        order: 1,
        createdAt: createTimestamp(),
        updatedAt: createTimestamp(),
        completedAt: createTimestamp(),
        difficultyRating: 3,
      };

      const step2: Step = {
        id: createStepId(),
        questId: quest.id,
        title: 'Day 2',
        description: 'Second',
        status: 'pending',
        order: 2,
        createdAt: createTimestamp(),
        updatedAt: createTimestamp(),
      };

      await store.saveStep(step1);
      await store.saveStep(step2);

      const result = await engine.getPathProgress(goal.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.totalSteps).toBe(2);
        expect(result.value.completedSteps).toBe(1);
        expect(result.value.overallProgress).toBe(50);
        expect(result.value.averageDifficulty).toBe(3);
      }
    });

    it('returns error for non-existent goal', async () => {
      const result = await engine.getPathProgress(createGoalId());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getTodayForUser
  // ─────────────────────────────────────────────────────────────────────────────

  describe('getTodayForUser', () => {
    it('returns no content when no step scheduled', async () => {
      const userId = createUserId();
      const goal = createTestGoal(userId);
      await store.saveGoal(goal);

      const result = await engine.getTodayForUser(userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hasContent).toBe(false);
        expect(result.value.step).toBeNull();
        expect(result.value.spark).toBeNull();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // generateSparkForStep
  // ─────────────────────────────────────────────────────────────────────────────

  describe('generateSparkForStep', () => {
    it('generates spark at given escalation level', async () => {
      const step = createTestStep(createQuestId());
      await store.saveStep(step);

      const result = await engine.generateSparkForStep(step.id, 2);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.escalationLevel).toBe(2);
        expect(result.value.variant).toBe('reduced');
      }
    });

    it('returns error for non-existent step', async () => {
      const result = await engine.generateSparkForStep(createStepId(), 0);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });
});
