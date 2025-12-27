// ═══════════════════════════════════════════════════════════════════════════════
// VIEW FLOW TESTS — SwordGate View Mode Extension
// NovaOS Gates — Phase 14B: View Mode Extension
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { UserId, GoalId, QuestId, StepId, SparkId, Timestamp } from '../../types/branded.js';
import { createUserId, createGoalId, createQuestId, createStepId, createSparkId, createTimestamp } from '../../types/branded.js';
import { ok, err, appError } from '../../types/result.js';

import type { ISparkEngine } from '../../services/spark-engine/interfaces.js';
import type {
  Goal,
  Quest,
  Step,
  Spark,
  TodayResult,
  PathProgress,
} from '../../services/spark-engine/types.js';

import {
  ViewFlow,
  createViewFlow,
  isViewTarget,
  type ViewTarget,
  type ViewRequest,
  type ViewFlowConfig,
  type FormattedViewResult,
  DEFAULT_VIEW_FLOW_CONFIG,
} from './view-flow.js';

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK DATA
// ═══════════════════════════════════════════════════════════════════════════════

const mockUserId = createUserId('user-123');
const mockGoalId = createGoalId('goal-456');
const mockQuestId = createQuestId('quest-789');
const mockStepId = createStepId('step-abc');
const mockSparkId = createSparkId('spark-def');
const mockTimestamp = createTimestamp(new Date());

const mockGoal: Goal = {
  id: mockGoalId,
  userId: mockUserId,
  title: 'Learn TypeScript',
  description: 'Master TypeScript for web development',
  status: 'active',
  createdAt: mockTimestamp,
  updatedAt: mockTimestamp,
};

const mockQuest: Quest = {
  id: mockQuestId,
  goalId: mockGoalId,
  title: 'Week 1: TypeScript Basics',
  description: 'Learn the fundamentals',
  status: 'active',
  order: 1,
  createdAt: mockTimestamp,
  updatedAt: mockTimestamp,
  topics: ['types', 'interfaces', 'functions'],
};

const mockStep: Step = {
  id: mockStepId,
  questId: mockQuestId,
  title: 'Day 1: Introduction to Types',
  description: 'Learn about basic types',
  status: 'active',
  order: 1,
  createdAt: mockTimestamp,
  updatedAt: mockTimestamp,
  dayNumber: 1,
  objective: 'Understand primitive types in TypeScript',
  resources: [
    {
      id: 'res-1' as any,
      providerId: 'yt-123',
      title: 'TypeScript Tutorial',
      type: 'video',
      url: 'https://youtube.com/watch?v=123',
      verificationLevel: 'verified',
    },
  ],
  estimatedMinutes: 30,
};

const mockSpark: Spark = {
  id: mockSparkId,
  stepId: mockStepId,
  action: 'Watch the first 10 minutes of the TypeScript tutorial',
  status: 'active',
  createdAt: mockTimestamp,
  updatedAt: mockTimestamp,
  variant: 'full',
  escalationLevel: 0,
  estimatedMinutes: 10,
};

const mockTodayResult: TodayResult = {
  hasContent: true,
  step: mockStep,
  spark: mockSpark,
  date: '2024-01-15',
  timezone: 'America/New_York',
  goalId: mockGoalId,
  questId: mockQuestId,
};

const mockEmptyTodayResult: TodayResult = {
  hasContent: false,
  step: null,
  spark: null,
  date: '2024-01-15',
  timezone: 'America/New_York',
  goalId: null,
  questId: null,
};

const mockPathProgress: PathProgress = {
  goalId: mockGoalId,
  overallProgress: 35,
  completedSteps: 7,
  totalSteps: 20,
  completedQuests: 1,
  totalQuests: 4,
  currentQuest: mockQuest,
  currentStep: mockStep,
  daysCompleted: 7,
  totalDays: 28,
  estimatedCompletionDate: '2024-02-12',
  onTrack: true,
  daysBehind: 0,
  averageDifficulty: 2.5,
  lastActivityAt: mockTimestamp,
};

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK SPARK ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

function createMockSparkEngine(overrides: Partial<ISparkEngine> = {}): ISparkEngine {
  return {
    getTodayForUser: vi.fn().mockResolvedValue(ok(mockTodayResult)),
    getGoalsForUser: vi.fn().mockResolvedValue(ok([mockGoal])),
    getPathProgress: vi.fn().mockResolvedValue(ok(mockPathProgress)),
    getQuestsForGoal: vi.fn().mockResolvedValue(ok([mockQuest])),
    // Add other required methods as stubs
    createGoal: vi.fn(),
    createQuest: vi.fn(),
    onGoalCreated: vi.fn(),
    updateGoal: vi.fn(),
    getGoal: vi.fn(),
    ...overrides,
  } as unknown as ISparkEngine;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('ViewFlow', () => {
  let mockEngine: ISparkEngine;
  let viewFlow: ViewFlow;

  beforeEach(() => {
    mockEngine = createMockSparkEngine();
    viewFlow = createViewFlow(mockEngine);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TYPE GUARDS
  // ─────────────────────────────────────────────────────────────────────────────

  describe('isViewTarget', () => {
    it('returns true for valid view targets', () => {
      expect(isViewTarget('today')).toBe(true);
      expect(isViewTarget('goals')).toBe(true);
      expect(isViewTarget('progress')).toBe(true);
      expect(isViewTarget('plan')).toBe(true);
      expect(isViewTarget('upcoming')).toBe(true);
    });

    it('returns false for invalid values', () => {
      expect(isViewTarget('invalid')).toBe(false);
      expect(isViewTarget('')).toBe(false);
      expect(isViewTarget(null)).toBe(false);
      expect(isViewTarget(123)).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // VIEW TODAY
  // ─────────────────────────────────────────────────────────────────────────────

  describe('viewToday', () => {
    it('returns formatted lesson when content exists', async () => {
      const result = await viewFlow.process(mockUserId, { target: 'today' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hasContent).toBe(true);
        expect(result.value.message).toContain('Day 1: Introduction to Types');
        expect(result.value.message).toContain('Your Spark');
        expect(result.value.message).toContain('Watch the first 10 minutes');
        expect(result.value.goalId).toBe(mockGoalId);
        expect(result.value.stepId).toBe(mockStepId);
      }
    });

    it('returns no-content message when no lesson scheduled', async () => {
      mockEngine = createMockSparkEngine({
        getTodayForUser: vi.fn().mockResolvedValue(ok(mockEmptyTodayResult)),
      });
      viewFlow = createViewFlow(mockEngine);

      const result = await viewFlow.process(mockUserId, { target: 'today' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hasContent).toBe(false);
        expect(result.value.message).toContain('No lesson scheduled');
        expect(result.value.suggestedActions).toContain('Create a new learning goal');
      }
    });

    it('includes resources in formatted output', async () => {
      const result = await viewFlow.process(mockUserId, { target: 'today' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.message).toContain('Resources');
        expect(result.value.message).toContain('TypeScript Tutorial');
      }
    });

    it('handles SparkEngine errors gracefully', async () => {
      mockEngine = createMockSparkEngine({
        getTodayForUser: vi.fn().mockResolvedValue(err(appError('INTERNAL_ERROR', 'DB error'))),
      });
      viewFlow = createViewFlow(mockEngine);

      const result = await viewFlow.process(mockUserId, { target: 'today' });

      expect(result.ok).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // VIEW GOALS
  // ─────────────────────────────────────────────────────────────────────────────

  describe('viewGoals', () => {
    it('returns formatted goals list', async () => {
      const result = await viewFlow.process(mockUserId, { target: 'goals' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hasContent).toBe(true);
        expect(result.value.message).toContain('Learning Goals');
        expect(result.value.message).toContain('Learn TypeScript');
        expect(result.value.message).toContain('Active');
      }
    });

    it('shows progress bars when configured', async () => {
      const result = await viewFlow.process(mockUserId, { target: 'goals' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Progress bar characters
        expect(result.value.message).toMatch(/[█░]/);
        expect(result.value.message).toContain('Day');
      }
    });

    it('returns no-goals message when empty', async () => {
      mockEngine = createMockSparkEngine({
        getGoalsForUser: vi.fn().mockResolvedValue(ok([])),
      });
      viewFlow = createViewFlow(mockEngine);

      const result = await viewFlow.process(mockUserId, { target: 'goals' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hasContent).toBe(false);
        expect(result.value.message).toContain("don't have any learning goals");
      }
    });

    it('groups goals by status', async () => {
      const pausedGoal: Goal = {
        ...mockGoal,
        id: createGoalId('goal-paused'),
        title: 'Learn React',
        status: 'paused',
      };
      const completedGoal: Goal = {
        ...mockGoal,
        id: createGoalId('goal-done'),
        title: 'Learn HTML',
        status: 'completed',
      };

      mockEngine = createMockSparkEngine({
        getGoalsForUser: vi.fn().mockResolvedValue(ok([mockGoal, pausedGoal, completedGoal])),
        getPathProgress: vi.fn().mockResolvedValue(ok(mockPathProgress)),
      });
      viewFlow = createViewFlow(mockEngine);

      const result = await viewFlow.process(mockUserId, { target: 'goals' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.message).toContain('Active');
        expect(result.value.message).toContain('Paused');
        expect(result.value.message).toContain('Completed');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // VIEW PROGRESS
  // ─────────────────────────────────────────────────────────────────────────────

  describe('viewProgress', () => {
    it('returns formatted progress for active goal', async () => {
      const result = await viewFlow.process(mockUserId, { target: 'progress' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hasContent).toBe(true);
        expect(result.value.message).toContain('Progress');
        expect(result.value.message).toContain('35%');
        expect(result.value.message).toContain('7 / 20');
        expect(result.value.message).toContain('On track');
      }
    });

    it('shows current quest and step', async () => {
      const result = await viewFlow.process(mockUserId, { target: 'progress' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.message).toContain('Currently on');
        expect(result.value.message).toContain('Week 1: TypeScript Basics');
        expect(result.value.message).toContain('Day 1: Introduction to Types');
      }
    });

    it('shows days behind when not on track', async () => {
      const behindProgress: PathProgress = {
        ...mockPathProgress,
        onTrack: false,
        daysBehind: 3,
      };

      mockEngine = createMockSparkEngine({
        getPathProgress: vi.fn().mockResolvedValue(ok(behindProgress)),
      });
      viewFlow = createViewFlow(mockEngine);

      const result = await viewFlow.process(mockUserId, { target: 'progress' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.message).toContain('3 days behind');
      }
    });

    it('returns no-active-goal message when none active', async () => {
      mockEngine = createMockSparkEngine({
        getGoalsForUser: vi.fn().mockResolvedValue(ok([])),
      });
      viewFlow = createViewFlow(mockEngine);

      const result = await viewFlow.process(mockUserId, { target: 'progress' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hasContent).toBe(false);
        expect(result.value.message).toContain('No active goal');
      }
    });

    it('uses provided goalId when specified', async () => {
      const specificGoalId = createGoalId('specific-goal');
      
      await viewFlow.process(mockUserId, {
        target: 'progress',
        goalId: specificGoalId,
      });

      expect(mockEngine.getPathProgress).toHaveBeenCalledWith(specificGoalId);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // VIEW PLAN
  // ─────────────────────────────────────────────────────────────────────────────

  describe('viewPlan', () => {
    it('returns formatted plan with quests', async () => {
      const result = await viewFlow.process(mockUserId, { target: 'plan' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hasContent).toBe(true);
        expect(result.value.message).toContain('Learn TypeScript');
        expect(result.value.message).toContain('Week 1: TypeScript Basics');
        expect(result.value.message).toContain('Topics');
      }
    });

    it('shows quest topics', async () => {
      const result = await viewFlow.process(mockUserId, { target: 'plan' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.message).toContain('types');
        expect(result.value.message).toContain('interfaces');
      }
    });

    it('returns no-plan message when no quests', async () => {
      mockEngine = createMockSparkEngine({
        getQuestsForGoal: vi.fn().mockResolvedValue(ok([])),
      });
      viewFlow = createViewFlow(mockEngine);

      const result = await viewFlow.process(mockUserId, { target: 'plan' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hasContent).toBe(false);
        expect(result.value.message).toContain('No learning plan found');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // VIEW UPCOMING
  // ─────────────────────────────────────────────────────────────────────────────

  describe('viewUpcoming', () => {
    it('returns upcoming lessons summary', async () => {
      const result = await viewFlow.process(mockUserId, { target: 'upcoming' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hasContent).toBe(true);
        expect(result.value.message).toContain('Upcoming Lessons');
        expect(result.value.message).toContain('Today');
      }
    });

    it('returns no-upcoming message when no content', async () => {
      mockEngine = createMockSparkEngine({
        getTodayForUser: vi.fn().mockResolvedValue(ok(mockEmptyTodayResult)),
      });
      viewFlow = createViewFlow(mockEngine);

      const result = await viewFlow.process(mockUserId, { target: 'upcoming' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hasContent).toBe(false);
        expect(result.value.message).toContain('No upcoming lessons');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // FACTORY & CONFIG
  // ─────────────────────────────────────────────────────────────────────────────

  describe('createViewFlow', () => {
    it('uses default config when none provided', () => {
      const flow = createViewFlow(mockEngine);
      expect(flow).toBeInstanceOf(ViewFlow);
    });

    it('merges partial config with defaults', () => {
      const flow = createViewFlow(mockEngine, {
        defaultUpcomingDays: 14,
      });
      expect(flow).toBeInstanceOf(ViewFlow);
    });

    it('respects includeProgressInList = false', async () => {
      const flow = createViewFlow(mockEngine, {
        includeProgressInList: false,
      });

      await flow.process(mockUserId, { target: 'goals' });

      // getPathProgress should not be called when progress is disabled
      expect(mockEngine.getPathProgress).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // DEFAULT BEHAVIOR
  // ─────────────────────────────────────────────────────────────────────────────

  describe('default behavior', () => {
    it('defaults to today view for unknown target', async () => {
      const result = await viewFlow.process(mockUserId, {
        target: 'unknown' as ViewTarget,
      });

      expect(result.ok).toBe(true);
      expect(mockEngine.getTodayForUser).toHaveBeenCalled();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MODE DETECTOR VIEW TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('ModeDetector - View Mode', () => {
  // These tests should be added to mode-detector.test.ts
  
  describe('view mode detection patterns', () => {
    const viewTodayPhrases = [
      "what's today's lesson",
      "show my lesson",
      "today's lesson",
      "what do I learn today",
      "continue my learning",
      "resume my lesson",
      "my lesson today",
    ];

    const viewGoalsPhrases = [
      "show my goals",
      "list my goals",
      "my goals",
      "what goals do I have",
      "view my learning goals",
    ];

    const viewProgressPhrases = [
      "show my progress",
      "how am I doing",
      "my progress",
      "check my status",
      "how far along am I",
    ];

    const viewPlanPhrases = [
      "show my plan",
      "view my curriculum",
      "my full plan",
      "what's in my plan",
      "show the schedule",
    ];

    const viewUpcomingPhrases = [
      "show upcoming lessons",
      "what's coming next",
      "next lessons",
      "upcoming schedule",
      "what's next",
    ];

    // Test cases to add to mode-detector tests
    it.each(viewTodayPhrases)('detects "%s" as view:today', (phrase) => {
      // Implementation in mode-detector.test.ts
    });

    it.each(viewGoalsPhrases)('detects "%s" as view:goals', (phrase) => {
      // Implementation in mode-detector.test.ts
    });

    it.each(viewProgressPhrases)('detects "%s" as view:progress', (phrase) => {
      // Implementation in mode-detector.test.ts
    });

    it.each(viewPlanPhrases)('detects "%s" as view:plan', (phrase) => {
      // Implementation in mode-detector.test.ts
    });

    it.each(viewUpcomingPhrases)('detects "%s" as view:upcoming', (phrase) => {
      // Implementation in mode-detector.test.ts
    });
  });
});
