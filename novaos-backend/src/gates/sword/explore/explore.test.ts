// ═══════════════════════════════════════════════════════════════════════════════
// EXPLORE MODULE TESTS — Phase 14A
// NovaOS Gates — SwordGate Explore Module
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { UserId, Timestamp } from '../../../types/branded.js';
import { createUserId, createTimestamp } from '../../../types/branded.js';
import { ok } from '../../../types/result.js';

import type { IRefinementStore, RefinementState } from '../../../services/spark-engine/store/types.js';
import type { ExploreState, ExploreConfig } from './types.js';
import { DEFAULT_EXPLORE_CONFIG, createEmptyExploreContext, buildExploreContext } from './types.js';
import { ExploreStore, createExploreStore } from './explore-store.js';
import { ClarityDetector, createClarityDetector } from './clarity-detector.js';

// ═══════════════════════════════════════════════════════════════════════════════
// MOCKS
// ═══════════════════════════════════════════════════════════════════════════════

// Mock OpenAI
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{
              message: {
                content: JSON.stringify({
                  score: 0.7,
                  extractedGoal: 'Learn Python basics',
                  unclearAspects: ['purpose'],
                  suggestedQuestion: 'What do you want to build with Python?',
                  reasoning: 'Has topic but no clear purpose',
                }),
              },
            }],
          }),
        },
      },
    })),
  };
});

// Mock base refinement store
function createMockRefinementStore(): IRefinementStore {
  const store = new Map<string, RefinementState>();

  return {
    save: vi.fn(async (state: RefinementState) => {
      store.set(state.userId, state);
      return ok(state);
    }),
    get: vi.fn(async (userId: UserId) => {
      return ok(store.get(userId) ?? null);
    }),
    delete: vi.fn(async (userId: UserId) => {
      const existed = store.has(userId);
      store.delete(userId);
      return ok(existed);
    }),
    update: vi.fn(async (userId: UserId, updates: Partial<RefinementState>) => {
      const current = store.get(userId);
      if (!current) {
        return ok(null as any);
      }
      const updated = { ...current, ...updates };
      store.set(userId, updated);
      return ok(updated);
    }),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPLORE STORE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('ExploreStore', () => {
  let baseStore: IRefinementStore;
  let exploreStore: ExploreStore;
  const testUserId = createUserId('user-test-123');

  beforeEach(() => {
    baseStore = createMockRefinementStore();
    exploreStore = createExploreStore(baseStore);
  });

  describe('create()', () => {
    it('should create a new exploration session', async () => {
      const result = await exploreStore.create(testUserId, 'I want to learn something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.userId).toBe(testUserId);
        expect(result.value.initialStatement).toBe('I want to learn something');
        expect(result.value.stage).toBe('exploring');
        expect(result.value.turnCount).toBe(0);
        expect(result.value.clarityScore).toBe(0);
        expect(result.value.conversationHistory).toHaveLength(0);
      }
    });

    it('should set correct TTL', async () => {
      const result = await exploreStore.create(testUserId, 'test');

      expect(result.ok).toBe(true);
      if (result.ok) {
        const expiresAt = new Date(result.value.expiresAt).getTime();
        const now = Date.now();
        const ttl = expiresAt - now;
        // Should be approximately 2 hours (7200 seconds)
        expect(ttl).toBeGreaterThan(7100 * 1000);
        expect(ttl).toBeLessThan(7300 * 1000);
      }
    });
  });

  describe('get()', () => {
    it('should return null for non-existent session', async () => {
      const result = await exploreStore.get(testUserId);

      expect(result.ok).toBe(true);
      expect(result.value).toBeNull();
    });

    it('should return existing session', async () => {
      await exploreStore.create(testUserId, 'test goal');
      const result = await exploreStore.get(testUserId);

      expect(result.ok).toBe(true);
      expect(result.value).not.toBeNull();
      expect(result.value?.initialStatement).toBe('test goal');
    });

    it('should return null for non-explore state', async () => {
      // Save a non-explore state directly to base store
      await baseStore.save({
        userId: testUserId,
        stage: 'initial',
        inputs: { someOtherKey: 'value' }, // No _explore_ keys
        createdAt: createTimestamp(),
        updatedAt: createTimestamp(),
        expiresAt: createTimestamp(),
      });

      const result = await exploreStore.get(testUserId);

      expect(result.ok).toBe(true);
      expect(result.value).toBeNull(); // Should not return non-explore state
    });
  });

  describe('addMessage()', () => {
    it('should add message to conversation history', async () => {
      await exploreStore.create(testUserId, 'initial');
      
      const result = await exploreStore.addMessage(testUserId, {
        role: 'user',
        content: 'I like Python',
        timestamp: createTimestamp(),
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.conversationHistory).toHaveLength(1);
        expect(result.value.conversationHistory[0]?.content).toBe('I like Python');
        expect(result.value.turnCount).toBe(1); // Incremented for user message
      }
    });

    it('should not increment turnCount for assistant messages', async () => {
      await exploreStore.create(testUserId, 'initial');
      
      await exploreStore.addMessage(testUserId, {
        role: 'user',
        content: 'test',
        timestamp: createTimestamp(),
      });
      
      const result = await exploreStore.addMessage(testUserId, {
        role: 'assistant',
        content: 'response',
        timestamp: createTimestamp(),
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.conversationHistory).toHaveLength(2);
        expect(result.value.turnCount).toBe(1); // Only user message counted
      }
    });
  });

  describe('addInterests()', () => {
    it('should accumulate interests without duplicates', async () => {
      await exploreStore.create(testUserId, 'initial');
      
      await exploreStore.addInterests(testUserId, ['Python', 'AI']);
      const result = await exploreStore.addInterests(testUserId, ['Python', 'ML']);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.interests).toContain('Python');
        expect(result.value.interests).toContain('AI');
        expect(result.value.interests).toContain('ML');
        expect(result.value.interests.filter(i => i === 'Python')).toHaveLength(1);
      }
    });
  });

  describe('crystallizeGoal()', () => {
    it('should set crystallized goal and update stage', async () => {
      await exploreStore.create(testUserId, 'initial');
      
      const result = await exploreStore.crystallizeGoal(testUserId, 'Learn Python for data science');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.crystallizedGoal).toBe('Learn Python for data science');
        expect(result.value.stage).toBe('confirmed');
        expect(result.value.clarityScore).toBe(1.0);
      }
    });
  });

  describe('getContext()', () => {
    it('should build ExploreContext from state', async () => {
      await exploreStore.create(testUserId, 'I want to do something with AI');
      await exploreStore.addInterests(testUserId, ['machine learning']);
      await exploreStore.addMotivations(testUserId, ['career change']);
      await exploreStore.crystallizeGoal(testUserId, 'Learn ML for career transition');

      const result = await exploreStore.getContext(testUserId);

      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.originalStatement).toBe('I want to do something with AI');
        expect(result.value.crystallizedGoal).toBe('Learn ML for career transition');
        expect(result.value.interests).toContain('machine learning');
        expect(result.value.motivations).toContain('career change');
      }
    });
  });

  describe('isExpired()', () => {
    it('should return false for fresh state', async () => {
      const createResult = await exploreStore.create(testUserId, 'test');
      
      expect(createResult.ok).toBe(true);
      if (createResult.ok) {
        expect(exploreStore.isExpired(createResult.value)).toBe(false);
      }
    });

    it('should return true for expired state', async () => {
      const createResult = await exploreStore.create(testUserId, 'test');
      
      expect(createResult.ok).toBe(true);
      if (createResult.ok) {
        // Manually set expired
        const expiredState: ExploreState = {
          ...createResult.value,
          expiresAt: createTimestamp(new Date(Date.now() - 1000)),
        };
        expect(exploreStore.isExpired(expiredState)).toBe(true);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CLARITY DETECTOR TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('ClarityDetector', () => {
  let detector: ClarityDetector;

  beforeEach(() => {
    // Create detector without LLM for pattern-only testing
    detector = createClarityDetector({ useLlmClarityDetection: false });
  });

  describe('Pattern-based detection', () => {
    it('should detect clear goals with specific technology + purpose', async () => {
      const result = await detector.assess('I want to learn React to build my portfolio');

      expect(result.score).toBeGreaterThan(0.7);
      expect(result.isClear).toBe(true);
      expect(result.extractedGoal).toBeDefined();
    });

    it('should detect vague goals', async () => {
      const result = await detector.assess('something with AI');

      expect(result.score).toBeLessThan(0.5);
      expect(result.isClear).toBe(false);
      expect(result.unclearAspects.length).toBeGreaterThan(0);
    });

    it('should detect very vague "anything" patterns', async () => {
      const result = await detector.assess('something about programming');

      expect(result.score).toBeLessThan(0.4);
    });

    it('should give higher score for level indication', async () => {
      const withLevel = await detector.assess('learn python basics as a beginner');
      const withoutLevel = await detector.assess('learn python');

      expect(withLevel.score).toBeGreaterThan(withoutLevel.score);
    });

    it('should give higher score for career context', async () => {
      const withCareer = await detector.assess('learn python for my job');
      const withoutCareer = await detector.assess('learn python');

      expect(withCareer.score).toBeGreaterThan(withoutCareer.score);
    });
  });

  describe('Confirmation detection', () => {
    it('should detect "yes" as confirmation', () => {
      expect(detector.isConfirmation('yes')).toBe(true);
      expect(detector.isConfirmation('Yes!')).toBe(true);
      expect(detector.isConfirmation('yeah')).toBe(true);
      expect(detector.isConfirmation('yep')).toBe(true);
    });

    it('should detect "that\'s it" as confirmation', () => {
      expect(detector.isConfirmation("that's it")).toBe(true);
      expect(detector.isConfirmation("that's right")).toBe(true);
      expect(detector.isConfirmation("that's perfect")).toBe(true);
    });

    it('should detect "sounds good" as confirmation', () => {
      expect(detector.isConfirmation('sounds good')).toBe(true);
      expect(detector.isConfirmation('looks good')).toBe(true);
    });

    it('should not detect questions as confirmation', () => {
      expect(detector.isConfirmation('yes, but what about X?')).toBe(false);
    });
  });

  describe('Skip detection', () => {
    it('should detect "just build me a plan"', () => {
      expect(detector.isSkipRequest('just build me a plan')).toBe(true);
      expect(detector.isSkipRequest('just create a plan')).toBe(true);
    });

    it('should detect "skip"', () => {
      expect(detector.isSkipRequest('skip')).toBe(true);
      expect(detector.isSkipRequest('skip this')).toBe(true);
    });

    it('should detect "I know what I want"', () => {
      expect(detector.isSkipRequest('I know what I want')).toBe(true);
      expect(detector.isSkipRequest("i'm sure")).toBe(true);
    });

    it('should detect "let\'s just start"', () => {
      expect(detector.isSkipRequest("let's just start")).toBe(true);
      expect(detector.isSkipRequest('just go')).toBe(true);
    });
  });

  describe('Suggested questions', () => {
    it('should suggest topic clarification for vague AI goals', async () => {
      const result = await detector.assess('something with AI');

      expect(result.suggestedQuestion).toBeDefined();
      expect(result.suggestedQuestion?.toLowerCase()).toContain('ai');
    });

    it('should suggest topic clarification for vague programming goals', async () => {
      const result = await detector.assess('learn programming');

      expect(result.suggestedQuestion).toBeDefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE HELPER TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Type helpers', () => {
  describe('createEmptyExploreContext()', () => {
    it('should create context for skipped exploration', () => {
      const context = createEmptyExploreContext('Learn Rust');

      expect(context.originalStatement).toBe('Learn Rust');
      expect(context.crystallizedGoal).toBe('Learn Rust');
      expect(context.turnsToClarity).toBe(0);
      expect(context.clarityScore).toBe(1.0);
      expect(context.interests).toHaveLength(0);
    });
  });

  describe('buildExploreContext()', () => {
    it('should build context from explore state', () => {
      const state: ExploreState = {
        userId: createUserId('test'),
        initialStatement: 'something with AI',
        conversationHistory: [],
        conversationSummary: 'User wants ML for career',
        interests: ['machine learning', 'Python'],
        constraints: ['no math heavy stuff'],
        background: ['software developer'],
        motivations: ['career change'],
        candidateGoals: ['Learn ML basics'],
        crystallizedGoal: 'Learn practical ML with Python',
        clarityScore: 0.9,
        stage: 'confirmed',
        turnCount: 5,
        maxTurns: 12,
        createdAt: createTimestamp(),
        updatedAt: createTimestamp(),
        expiresAt: createTimestamp(),
      };

      const context = buildExploreContext(state);

      expect(context.originalStatement).toBe('something with AI');
      expect(context.crystallizedGoal).toBe('Learn practical ML with Python');
      expect(context.interests).toContain('machine learning');
      expect(context.constraints).toContain('no math heavy stuff');
      expect(context.motivations).toContain('career change');
      expect(context.turnsToClarity).toBe(5);
      expect(context.clarityScore).toBe(0.9);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION TESTS (would require real OpenAI)
// ═══════════════════════════════════════════════════════════════════════════════

describe.skip('ExploreFlow integration', () => {
  // These tests require actual OpenAI API calls
  // Run with: OPENAI_API_KEY=xxx vitest run --grep "ExploreFlow integration"

  it('should start exploration for vague goal', async () => {
    // Implementation would go here
  });

  it('should transition to refine when goal is confirmed', async () => {
    // Implementation would go here
  });
});
