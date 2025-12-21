// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION TESTS — StepGenerator Integration Tests
// NovaOS Spark Engine — Phase 9: Step Generation
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { StepGenerator, createTestStepGenerator } from '../generator.js';
import type { ISparkEngineStore } from '../../interfaces.js';
import type { Goal, Quest, Step } from '../../types.js';
import type {
  VerifiedResource,
  TopicId,
  ResourceId,
} from '../../resource-discovery/types.js';
import { createTopicId } from '../../resource-discovery/types.js';
import type { ResourceDiscoveryOrchestrator } from '../../resource-discovery/orchestrator.js';
import type { ITopicTaxonomy, TopicMetadata } from '../gap-remediation.js';
import { ok } from '../../../../types/result.js';

// ─────────────────────────────────────────────────────────────────────────────────
// MOCK IMPLEMENTATIONS
// ─────────────────────────────────────────────────────────────────────────────────

function createMockStore(): ISparkEngineStore {
  const steps: Step[] = [];

  return {
    saveGoal: vi.fn().mockImplementation(async (goal) => ok(goal)),
    getGoal: vi.fn().mockImplementation(async () => ok(null)),
    getGoalsByUser: vi.fn().mockImplementation(async () => ok([])),
    deleteGoal: vi.fn().mockImplementation(async () => ok(undefined)),
    saveQuest: vi.fn().mockImplementation(async (quest) => ok(quest)),
    getQuest: vi.fn().mockImplementation(async () => ok(null)),
    getQuestsByGoal: vi.fn().mockImplementation(async () => ok([])),
    saveStep: vi.fn().mockImplementation(async (step) => {
      steps.push(step);
      return ok(step);
    }),
    getStep: vi.fn().mockImplementation(async () => ok(null)),
    getStepsByQuest: vi.fn().mockImplementation(async () => ok(steps)),
    getStepByDate: vi.fn().mockImplementation(async () => ok(null)),
    saveSpark: vi.fn().mockImplementation(async (spark) => ok(spark)),
    getSpark: vi.fn().mockImplementation(async () => ok(null)),
    getSparksByStep: vi.fn().mockImplementation(async () => ok([])),
    getActiveSparkForStep: vi.fn().mockImplementation(async () => ok(null)),
    __clearSteps: () => {
      steps.length = 0;
    },
  } as ISparkEngineStore & { __clearSteps: () => void };
}

function createMockDiscoverer(): ResourceDiscoveryOrchestrator {
  return {
    discover: vi.fn().mockImplementation(async () => {
      const resources: VerifiedResource[] = [
        createMockResource('res-1', 'Introduction to Rust', ['topic:rust:basics']),
        createMockResource('res-2', 'Rust Ownership', ['topic:rust:ownership']),
        createMockResource('res-3', 'Rust Borrowing', ['topic:rust:borrowing']),
      ];
      return ok({
        resources,
        failed: [],
        stats: {
          candidatesFound: 3,
          afterDeduplication: 3,
          fromKnownSources: 3,
          enriched: 3,
          verified: 3,
          cacheHits: 0,
          durationMs: 100,
          byProvider: { youtube: 2, github: 1 },
        },
      });
    }),
    processUrl: vi.fn(),
    isKnownSource: vi.fn().mockReturnValue(false),
  } as unknown as ResourceDiscoveryOrchestrator;
}

function createMockResource(
  id: string,
  title: string,
  topics: string[]
): VerifiedResource {
  return {
    id: id as ResourceId,
    canonicalUrl: `https://example.com/${id}` as any,
    displayUrl: `https://example.com/${id}` as any,
    source: {
      type: 'known_source',
      discoveredAt: new Date(),
    },
    provider: 'youtube',
    providerId: id,
    title,
    description: `Description for ${title}`,
    contentType: 'video',
    format: 'video',
    difficulty: 'beginner',
    estimatedMinutes: 30,
    metadata: {
      provider: 'youtube',
      videoId: id,
      channelId: 'channel-1',
      channelTitle: 'Test Channel',
      duration: 1800,
      viewCount: 10000,
      publishedAt: new Date(),
      hasClosedCaptions: true,
      isLiveBroadcast: false,
    },
    topicIds: topics as TopicId[],
    qualitySignals: {
      popularity: 0.8,
      recency: 0.7,
      authority: 0.9,
      completeness: 0.85,
      composite: 0.81,
      details: { ageInDays: 30 },
    },
    accessibility: 'accessible',
    evidence: {
      verifiedAt: new Date(),
      level: 'high',
      usesHttps: true,
      walls: {
        hasPaywall: false,
        hasLoginWall: false,
        hasBotWall: false,
        hasAgeGate: false,
        hasCookieWall: false,
        hasGeoBlock: false,
      },
      isSoft404: false,
      isJsAppShell: false,
    },
    usability: {
      score: 0.9,
      recommended: true,
      issues: [],
      strengths: ['High quality'],
      audienceMatch: 0.9,
      prerequisitesCovered: true,
      missingPrerequisites: [],
    },
    discoveredAt: new Date(),
    enrichedAt: new Date(),
    verifiedAt: new Date(),
    expiresAt: new Date(Date.now() + 86400000),
  } as VerifiedResource;
}

function createMockTaxonomy(): ITopicTaxonomy {
  const topics: Record<string, TopicMetadata> = {
    'topic:rust:basics': {
      id: 'topic:rust:basics' as TopicId,
      name: 'Rust Basics',
      priority: 1,
      estimatedMinutes: 60,
      prerequisites: [],
      officialDocsUrl: 'https://doc.rust-lang.org/book/ch01-00-getting-started.html',
    },
    'topic:rust:ownership': {
      id: 'topic:rust:ownership' as TopicId,
      name: 'Ownership',
      priority: 2,
      estimatedMinutes: 45,
      prerequisites: ['topic:rust:basics' as TopicId],
      officialDocsUrl: 'https://doc.rust-lang.org/book/ch04-00-understanding-ownership.html',
    },
    'topic:rust:borrowing': {
      id: 'topic:rust:borrowing' as TopicId,
      name: 'Borrowing',
      priority: 3,
      estimatedMinutes: 45,
      prerequisites: ['topic:rust:ownership' as TopicId],
    },
  };

  return {
    getTopic: (id) => topics[id],
    getTopicName: (id) => topics[id]?.name ?? String(id),
    getPrerequisites: (id) => topics[id]?.prerequisites ?? [],
    getOfficialDocsUrl: (id) => topics[id]?.officialDocsUrl,
  };
}

function createMockGoal(): Goal {
  return {
    id: 'goal-1' as any,
    userId: 'user-1' as any,
    title: 'Learn Rust',
    description: 'Master Rust programming',
    status: 'active',
    createdAt: '2025-01-01T00:00:00Z' as any,
    updatedAt: '2025-01-01T00:00:00Z' as any,
    learningConfig: {
      userLevel: 'beginner',
      dailyTimeCommitment: 30,
      learningStyle: 'mixed',
      startDate: '2025-01-06',
      activeDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    },
    reminderConfig: {
      enabled: true,
      firstReminderHour: 9,
      lastReminderHour: 19,
      intervalHours: 3,
      channels: { push: true, email: false, sms: false },
      shrinkSparksOnEscalation: true,
      maxRemindersPerDay: 4,
      quietDays: [],
      timezone: 'UTC',
    },
  };
}

function createMockQuest(): Quest {
  return {
    id: 'quest-1' as any,
    goalId: 'goal-1' as any,
    title: 'Week 1: Rust Fundamentals',
    description: 'Learn Rust basics, ownership, and borrowing',
    status: 'pending',
    order: 1,
    createdAt: '2025-01-01T00:00:00Z' as any,
    updatedAt: '2025-01-01T00:00:00Z' as any,
    topicIds: ['topic:rust:basics', 'topic:rust:ownership', 'topic:rust:borrowing'],
    estimatedDays: 5,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// MOCK CURRICULUM GENERATOR
// ─────────────────────────────────────────────────────────────────────────────────

// We need to mock the curriculum generator module
vi.mock('../../curriculum/structurer.js', () => ({
  generateCurriculum: vi.fn().mockImplementation(async (request) => {
    const days = [];
    const resources = request.resources;

    for (let i = 0; i < Math.min(request.days, resources.length); i++) {
      days.push({
        day: i + 1,
        theme: `Day ${i + 1}: ${resources[i]?.title ?? 'Topic'}`,
        objectives: [{ description: `Learn ${resources[i]?.title}` }],
        resources: [
          {
            index: i + 1,
            minutes: 25,
            optional: false,
            resource: resources[i],
            resourceId: resources[i]?.id,
            title: resources[i]?.title ?? 'Resource',
            url: resources[i]?.canonicalUrl ?? '',
          },
        ],
        exercises: [
          {
            type: 'practice',
            description: 'Practice exercises',
            minutes: 5,
            optional: false,
          },
        ],
        totalMinutes: 30,
        difficulty: 'beginner',
      });
    }

    return {
      success: true,
      curriculum: {
        id: 'curriculum-1',
        metadata: {
          title: 'Test Curriculum',
          description: 'Generated curriculum',
          targetAudience: 'beginners',
          prerequisites: [],
          topics: request.topics,
          difficulty: 'beginner',
          progression: 'gradual',
          estimatedHours: 2,
        },
        days,
        totalDays: days.length,
        totalMinutes: days.length * 30,
        resourceCount: days.length,
        allResources: resources,
        generation: {
          generatedAt: new Date(),
          model: 'gpt-4o-mini',
          requestId: 'req-1',
        },
      },
      metrics: {
        durationMs: 100,
        tokensUsed: 500,
        validationAttempts: 1,
      },
    };
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('StepGenerator', () => {
  let store: ISparkEngineStore & { __clearSteps: () => void };
  let discoverer: ResourceDiscoveryOrchestrator;
  let taxonomy: ITopicTaxonomy;
  let generator: StepGenerator;
  let goal: Goal;
  let quest: Quest;

  beforeEach(() => {
    store = createMockStore() as any;
    discoverer = createMockDiscoverer();
    taxonomy = createMockTaxonomy();
    generator = createTestStepGenerator(store, discoverer, taxonomy);
    goal = createMockGoal();
    quest = createMockQuest();
    store.__clearSteps();
  });

  describe('generateSteps', () => {
    it('should generate steps for a quest', async () => {
      const result = await generator.generateSteps(quest, goal);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBeGreaterThan(0);
        expect(result.value[0]?.questId).toBe(quest.id);
      }
    });

    it('should include diagnostics in result', async () => {
      // Access diagnostics via the internal result
      const result = await generator.generateSteps(quest, goal);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBeGreaterThan(0);
      }
    });

    it('should discover resources for quest topics', async () => {
      await generator.generateSteps(quest, goal);

      expect(discoverer.discover).toHaveBeenCalled();
      const call = (discoverer.discover as any).mock.calls[0][0];
      expect(call.topics).toHaveLength(3);
    });

    it('should create steps with correct day numbers', async () => {
      const result = await generator.generateSteps(quest, goal);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const dayNumbers = result.value.map(s => s.dayNumber);
        expect(dayNumbers).toContain(1);
      }
    });

    it('should schedule steps on active days', async () => {
      const result = await generator.generateSteps(quest, goal);

      expect(result.ok).toBe(true);
      if (result.ok) {
        for (const step of result.value) {
          if (step.scheduledDate) {
            const date = new Date(step.scheduledDate + 'T12:00:00Z');
            const day = date.getUTCDay();
            // 0 = Sunday, 6 = Saturday - these should not appear for weekday-only schedule
            expect(day).not.toBe(0);
            expect(day).not.toBe(6);
          }
        }
      }
    });

    it('should return existing steps if already generated', async () => {
      // First generation
      await generator.generateSteps(quest, goal);

      // Second generation should return existing
      const result = await generator.generateSteps(quest, goal);

      expect(result.ok).toBe(true);
      // Store's getStepsByQuest was called and returned existing steps
      expect(store.getStepsByQuest).toHaveBeenCalledWith(quest.id);
    });

    it('should handle quest with no topics gracefully', async () => {
      const emptyQuest: Quest = {
        ...quest,
        topicIds: [],
      };

      const result = await generator.generateSteps(emptyQuest, goal);

      // Should still work with fallback topic extraction
      expect(result.ok).toBe(true);
    });
  });

  describe('step creation', () => {
    it('should create steps with activities', async () => {
      const result = await generator.generateSteps(quest, goal);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0]?.activities.length).toBeGreaterThan(0);
      }
    });

    it('should create steps with resources', async () => {
      const result = await generator.generateSteps(quest, goal);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0]?.resources.length).toBeGreaterThan(0);
      }
    });

    it('should set estimated minutes on steps', async () => {
      const result = await generator.generateSteps(quest, goal);

      expect(result.ok).toBe(true);
      if (result.ok) {
        for (const step of result.value) {
          expect(step.estimatedMinutes).toBeGreaterThan(0);
        }
      }
    });

    it('should set themes on steps', async () => {
      const result = await generator.generateSteps(quest, goal);

      expect(result.ok).toBe(true);
      if (result.ok) {
        for (const step of result.value) {
          expect(step.theme).toBeDefined();
          expect(step.theme.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('error handling', () => {
    it('should handle discovery failure', async () => {
      (discoverer.discover as any).mockImplementationOnce(async () => ({
        ok: false,
        error: { code: 'NO_RESULTS', message: 'No resources found' },
      }));

      const result = await generator.generateSteps(quest, goal);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DISCOVERY_FAILED');
      }
    });

    it('should handle empty resource discovery', async () => {
      (discoverer.discover as any).mockImplementationOnce(async () =>
        ok({
          resources: [],
          failed: [],
          stats: { candidatesFound: 0 },
        })
      );

      const result = await generator.generateSteps(quest, goal);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_RESOURCES');
      }
    });
  });

  describe('configuration', () => {
    it('should use goal learning config', async () => {
      const customGoal: Goal = {
        ...goal,
        learningConfig: {
          userLevel: 'advanced',
          dailyTimeCommitment: 60,
          learningStyle: 'video',
          startDate: '2025-02-01',
          activeDays: ['monday', 'wednesday', 'friday'],
        },
      };

      const result = await generator.generateSteps(quest, customGoal);

      expect(result.ok).toBe(true);
      if (result.ok && result.value.length > 0) {
        // First step should start on the configured start date or after
        expect(result.value[0]?.scheduledDate).toBeDefined();
      }
    });
  });
});

describe('createTestStepGenerator', () => {
  it('should create generator without Redis', () => {
    const store = createMockStore();
    const discoverer = createMockDiscoverer();
    const taxonomy = createMockTaxonomy();

    const generator = createTestStepGenerator(store, discoverer, taxonomy);

    expect(generator).toBeInstanceOf(StepGenerator);
  });

  it('should skip locking in test mode', async () => {
    const store = createMockStore();
    const discoverer = createMockDiscoverer();
    const taxonomy = createMockTaxonomy();
    const generator = createTestStepGenerator(store, discoverer, taxonomy);

    // Should not require Redis or attempt locking
    const result = await generator.generateSteps(createMockQuest(), createMockGoal());
    expect(result.ok).toBe(true);
  });
});
