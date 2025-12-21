// ═══════════════════════════════════════════════════════════════════════════════
// SPARK ENGINE TYPES TESTS — Type Validation Tests
// NovaOS Spark Engine — Phase 8: Core Types & SparkEngine
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  createGoalId,
  createQuestId,
  createStepId,
  createSparkId,
  createReminderId,
  createResourceId,
  createUserId,
  createTimestamp,
  isGoalId,
  isQuestId,
  isStepId,
  isSparkId,
} from '../../../types/branded.js';
import type {
  Goal,
  Quest,
  Step,
  Spark,
  Activity,
  StepResource,
  ReminderSchedule,
  ReminderConfig,
  LearningConfig,
  DayOfWeek,
  GoalStatus,
  QuestStatus,
  StepStatus,
  SparkStatus,
  SparkVariant,
  DifficultyRating,
  ActivityType,
  VerificationLevel,
} from '../types.js';
import {
  ALL_DAYS,
  WEEKDAYS,
  SPARK_MINUTES_BOUNDS,
  REMINDER_CONFIG_DEFAULTS,
} from '../types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// BRANDED ID TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Branded IDs', () => {
  it('creates valid GoalId', () => {
    const id = createGoalId();
    expect(id).toMatch(/^goal-[0-9a-f-]+$/);
    expect(isGoalId(id)).toBe(true);
  });

  it('creates valid QuestId', () => {
    const id = createQuestId();
    expect(id).toMatch(/^quest-[0-9a-f-]+$/);
    expect(isQuestId(id)).toBe(true);
  });

  it('creates valid StepId', () => {
    const id = createStepId();
    expect(id).toMatch(/^step-[0-9a-f-]+$/);
    expect(isStepId(id)).toBe(true);
  });

  it('creates valid SparkId', () => {
    const id = createSparkId();
    expect(id).toMatch(/^spark-[0-9a-f-]+$/);
    expect(isSparkId(id)).toBe(true);
  });

  it('creates valid ReminderId', () => {
    const id = createReminderId();
    expect(id).toMatch(/^reminder-[0-9a-f-]+$/);
  });

  it('creates valid ResourceId', () => {
    const id = createResourceId();
    expect(id).toMatch(/^resource-[0-9a-f-]+$/);
  });

  it('creates valid UserId', () => {
    const id = createUserId();
    expect(id).toMatch(/^user-[0-9a-f-]+$/);
  });

  it('creates valid Timestamp', () => {
    const ts = createTimestamp();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(new Date(ts).toISOString()).toBe(ts);
  });

  it('creates IDs with custom values', () => {
    const goalId = createGoalId('goal-custom-123');
    expect(goalId).toBe('goal-custom-123');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// GOAL TYPE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Goal type', () => {
  it('creates valid Goal', () => {
    const goal: Goal = {
      id: createGoalId(),
      userId: createUserId(),
      title: 'Learn Rust',
      description: 'Master Rust programming language',
      status: 'active',
      createdAt: createTimestamp(),
      updatedAt: createTimestamp(),
    };

    expect(goal.title).toBe('Learn Rust');
    expect(goal.status).toBe('active');
  });

  it('creates Goal with learning config', () => {
    const learningConfig: LearningConfig = {
      userLevel: 'beginner',
      dailyTimeCommitment: 60,
      learningStyle: 'mixed',
      totalDuration: '6 weeks',
      startDate: '2025-01-01',
      activeDays: ['monday', 'wednesday', 'friday'],
    };

    const goal: Goal = {
      id: createGoalId(),
      userId: createUserId(),
      title: 'Learn Rust',
      description: 'Master Rust',
      status: 'active',
      createdAt: createTimestamp(),
      updatedAt: createTimestamp(),
      learningConfig,
    };

    expect(goal.learningConfig?.userLevel).toBe('beginner');
    expect(goal.learningConfig?.activeDays).toHaveLength(3);
  });

  it('validates GoalStatus values', () => {
    const statuses: GoalStatus[] = ['active', 'paused', 'completed', 'abandoned'];
    expect(statuses).toHaveLength(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// QUEST TYPE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Quest type', () => {
  it('creates valid Quest', () => {
    const quest: Quest = {
      id: createQuestId(),
      goalId: createGoalId(),
      title: 'Week 1: Rust Basics',
      description: 'Learn the fundamentals',
      status: 'pending',
      order: 1,
      createdAt: createTimestamp(),
      updatedAt: createTimestamp(),
    };

    expect(quest.title).toBe('Week 1: Rust Basics');
    expect(quest.order).toBe(1);
  });

  it('validates QuestStatus values', () => {
    const statuses: QuestStatus[] = ['pending', 'active', 'completed'];
    expect(statuses).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// STEP TYPE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Step type', () => {
  it('creates valid Step', () => {
    const step: Step = {
      id: createStepId(),
      questId: createQuestId(),
      title: 'Day 1: Hello World',
      description: 'Write your first Rust program',
      status: 'pending',
      order: 1,
      createdAt: createTimestamp(),
      updatedAt: createTimestamp(),
    };

    expect(step.title).toBe('Day 1: Hello World');
    expect(step.status).toBe('pending');
  });

  it('creates Step with activities', () => {
    const activity: Activity = {
      type: 'read',
      resourceId: createResourceId(),
      section: 'Chapter 1',
      task: 'Read introduction',
      minutes: 30,
    };

    const step: Step = {
      id: createStepId(),
      questId: createQuestId(),
      title: 'Day 1',
      description: 'First day',
      status: 'pending',
      order: 1,
      createdAt: createTimestamp(),
      updatedAt: createTimestamp(),
      activities: [activity],
      estimatedMinutes: 60,
    };

    expect(step.activities).toHaveLength(1);
    expect(step.activities![0].type).toBe('read');
  });

  it('validates DifficultyRating values', () => {
    const ratings: DifficultyRating[] = [1, 2, 3, 4, 5];
    expect(ratings).toHaveLength(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// ACTIVITY & STEP RESOURCE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Activity type', () => {
  it('creates valid Activity', () => {
    const activity: Activity = {
      type: 'watch',
      resourceId: createResourceId(),
      section: '0:00:00-0:15:00',
      minutes: 15,
    };

    expect(activity.type).toBe('watch');
    expect(activity.minutes).toBe(15);
  });

  it('validates ActivityType values', () => {
    const types: ActivityType[] = ['read', 'watch', 'code', 'exercise', 'quiz', 'project'];
    expect(types).toHaveLength(6);
  });
});

describe('StepResource type', () => {
  it('creates valid StepResource', () => {
    const resource: StepResource = {
      id: createResourceId(),
      providerId: 'dQw4w9WgXcQ',
      title: 'Rust Crash Course',
      type: 'video',
      url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
      verificationLevel: 'strong',
    };

    expect(resource.verificationLevel).toBe('strong');
  });

  it('validates VerificationLevel values', () => {
    const levels: VerificationLevel[] = ['strong', 'standard', 'weak'];
    expect(levels).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// SPARK TYPE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Spark type', () => {
  it('creates valid Spark', () => {
    const spark: Spark = {
      id: createSparkId(),
      stepId: createStepId(),
      action: 'Open Chapter 1 of the Rust Book',
      status: 'pending',
      createdAt: createTimestamp(),
      updatedAt: createTimestamp(),
      variant: 'full',
      escalationLevel: 0,
      estimatedMinutes: 10,
    };

    expect(spark.action).toBe('Open Chapter 1 of the Rust Book');
    expect(spark.variant).toBe('full');
    expect(spark.escalationLevel).toBe(0);
  });

  it('creates Spark with resource link', () => {
    const spark: Spark = {
      id: createSparkId(),
      stepId: createStepId(),
      action: 'Watch first 5 minutes',
      status: 'active',
      createdAt: createTimestamp(),
      updatedAt: createTimestamp(),
      variant: 'reduced',
      escalationLevel: 2,
      estimatedMinutes: 5,
      resourceId: createResourceId(),
      resourceUrl: 'https://youtube.com/watch?v=xxx',
      resourceSection: '0:00:00-0:05:00',
    };

    expect(spark.resourceUrl).toBeDefined();
  });

  it('validates SparkStatus values', () => {
    const statuses: SparkStatus[] = ['pending', 'active', 'completed', 'skipped'];
    expect(statuses).toHaveLength(4);
  });

  it('validates SparkVariant values', () => {
    const variants: SparkVariant[] = ['full', 'reduced', 'minimal'];
    expect(variants).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// REMINDER TYPE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Reminder types', () => {
  it('creates valid ReminderSchedule', () => {
    const reminder: ReminderSchedule = {
      id: createReminderId(),
      userId: createUserId(),
      stepId: createStepId(),
      sparkId: createSparkId(),
      scheduledTime: '2025-01-01T09:00:00-05:00',
      escalationLevel: 0,
      sparkVariant: 'full',
      tone: 'encouraging',
      status: 'pending',
      channels: { push: true, email: false, sms: false },
    };

    expect(reminder.tone).toBe('encouraging');
    expect(reminder.channels.push).toBe(true);
  });

  it('creates valid ReminderConfig', () => {
    const config: ReminderConfig = {
      enabled: true,
      firstReminderHour: 9,
      lastReminderHour: 19,
      intervalHours: 3,
      channels: { push: true, email: true, sms: false },
      shrinkSparksOnEscalation: true,
      maxRemindersPerDay: 4,
      quietDays: ['saturday', 'sunday'],
      timezone: 'America/New_York',
    };

    expect(config.shrinkSparksOnEscalation).toBe(true);
    expect(config.quietDays).toContain('saturday');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Constants', () => {
  it('has correct ALL_DAYS', () => {
    expect(ALL_DAYS).toHaveLength(7);
    expect(ALL_DAYS).toContain('monday');
    expect(ALL_DAYS).toContain('sunday');
  });

  it('has correct WEEKDAYS', () => {
    expect(WEEKDAYS).toHaveLength(5);
    expect(WEEKDAYS).not.toContain('saturday');
    expect(WEEKDAYS).not.toContain('sunday');
  });

  it('has correct SPARK_MINUTES_BOUNDS', () => {
    expect(SPARK_MINUTES_BOUNDS.MIN).toBe(5);
    expect(SPARK_MINUTES_BOUNDS.MAX).toBe(120);
  });

  it('has correct REMINDER_CONFIG_DEFAULTS', () => {
    expect(REMINDER_CONFIG_DEFAULTS.FIRST_REMINDER_HOUR).toBe(9);
    expect(REMINDER_CONFIG_DEFAULTS.LAST_REMINDER_HOUR).toBe(19);
    expect(REMINDER_CONFIG_DEFAULTS.INTERVAL_HOURS).toBe(3);
    expect(REMINDER_CONFIG_DEFAULTS.MAX_REMINDERS_PER_DAY).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// DAY OF WEEK TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('DayOfWeek', () => {
  it('validates DayOfWeek values', () => {
    const days: DayOfWeek[] = [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ];
    expect(days).toHaveLength(7);
  });
});
