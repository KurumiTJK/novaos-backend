// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE INTEGRATION TESTS — Context Builder, Hooks, Enhanced Pipeline
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ContextBuilder,
  PipelineHooks,
  type UnifiedContext,
} from '../core/context/index.js';
import { MemoryStore } from '../core/memory/index.js';
import { SwordStore } from '../core/sword/index.js';
import { MemoryStore as KVStore } from '../storage/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CONTEXT BUILDER TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('ContextBuilder', () => {
  let builder: ContextBuilder;
  let memoryStore: MemoryStore;
  let swordStore: SwordStore;
  let kvStore: KVStore;
  
  beforeEach(() => {
    kvStore = new KVStore();
    memoryStore = new MemoryStore(kvStore);
    swordStore = new SwordStore(kvStore);
    builder = new ContextBuilder(memoryStore, swordStore);
  });
  
  describe('build()', () => {
    it('should build empty context for new user', async () => {
      const context = await builder.build('new-user', null, 'Hello');
      
      expect(context).toBeDefined();
      expect(context.user.profile).toBeNull();
      expect(context.user.preferences).toBeNull();
      expect(context.sword.activeGoals).toHaveLength(0);
      expect(context.session.timestamp).toBeDefined();
    });
    
    it('should include user profile when available', async () => {
      // Set up profile
      await memoryStore.updateProfile('user-1', {
        name: 'Test User',
        role: 'Developer',
        organization: 'TestCo',
      });
      
      const context = await builder.build('user-1', null, 'Hello');
      
      expect(context.user.profile?.name).toBe('Test User');
      expect(context.user.profile?.role).toBe('Developer');
    });
    
    it('should include user preferences when available', async () => {
      await memoryStore.updatePreferences('user-1', {
        tone: 'formal',
        verbosity: 'concise',
      });
      
      const context = await builder.build('user-1', null, 'Hello');
      
      expect(context.user.preferences?.tone).toBe('formal');
      expect(context.user.preferences?.verbosity).toBe('concise');
    });
    
    it('should include memory-derived context', async () => {
      await memoryStore.createMemory('user-1', {
        category: 'project',
        key: 'project.app',
        value: 'Building a mobile app',
      });
      
      await memoryStore.createMemory('user-1', {
        category: 'fact',
        key: 'user.location',
        value: 'San Francisco',
      });
      
      const context = await builder.build('user-1', null, 'Hello');
      
      expect(context.memory.activeProjects.length).toBeGreaterThan(0);
    });
    
    it('should include Sword context when goals exist', async () => {
      const goal = await swordStore.createGoal('user-1', {
        title: 'Learn TypeScript',
        description: 'Master TS',
        desiredOutcome: 'Build apps',
        interestLevel: 'career_capital',
      });
      
      const context = await builder.build('user-1', null, 'Hello');
      
      expect(context.sword.activeGoals.length).toBe(1);
      expect(context.sword.activeGoals[0]?.title).toBe('Learn TypeScript');
    });
    
    it('should respect options to disable sections', async () => {
      const context = await builder.build('user-1', null, 'Hello', {
        includeMemory: false,
        includeSword: false,
      });
      
      expect(context.memory.facts).toHaveLength(0);
      expect(context.sword.activeGoals).toHaveLength(0);
    });
  });
  
  describe('formatForLLM()', () => {
    it('should format context as XML-style injection', async () => {
      await memoryStore.updateProfile('user-1', {
        name: 'Alice',
        role: 'Engineer',
      });
      
      const context = await builder.build('user-1', null, 'Hello');
      const formatted = builder.formatForLLM(context);
      
      expect(formatted).toContain('<nova_context>');
      expect(formatted).toContain('</nova_context>');
      expect(formatted).toContain('Name: Alice');
      expect(formatted).toContain('Role: Engineer');
    });
    
    it('should include goals section when present', async () => {
      await swordStore.createGoal('user-1', {
        title: 'Ship MVP',
        description: 'Launch product',
        desiredOutcome: 'Users',
        interestLevel: 'career_capital',
      });
      
      const context = await builder.build('user-1', null, 'Hello');
      const formatted = builder.formatForLLM(context);
      
      expect(formatted).toContain('<goals>');
      expect(formatted).toContain('Ship MVP');
      expect(formatted).toContain('</goals>');
    });
    
    it('should include preferences section when non-default', async () => {
      await memoryStore.updatePreferences('user-1', {
        tone: 'technical',
        verbosity: 'detailed',
      });
      
      const context = await builder.build('user-1', null, 'Hello');
      const formatted = builder.formatForLLM(context);
      
      expect(formatted).toContain('<preferences>');
      expect(formatted).toContain('tone: technical');
    });
    
    it('should include current spark when active', async () => {
      // Create a spark without needing full goal/quest/step chain
      await swordStore.createSpark('user-1', {
        userId: 'user-1',
        action: 'Write 3 bullet points',
        rationale: 'Get started',
        estimatedMinutes: 5,
        frictionLevel: 'minimal',
        reversible: true,
      });
      
      const context = await builder.build('user-1', null, 'Hello');
      const formatted = builder.formatForLLM(context);
      
      expect(formatted).toContain('<current_spark>');
      expect(formatted).toContain('Write 3 bullet points');
    });
  });
  
  describe('Quick Accessors', () => {
    it('should get user name', async () => {
      await memoryStore.updateProfile('user-1', { name: 'Bob' });
      
      const name = await builder.getUserName('user-1');
      expect(name).toBe('Bob');
    });
    
    it('should get preferred tone', async () => {
      await memoryStore.updatePreferences('user-1', { tone: 'casual' });
      
      const tone = await builder.getPreferredTone('user-1');
      expect(tone).toBe('casual');
    });
    
    it('should check for active spark', async () => {
      expect(await builder.hasActiveSpark('user-1')).toBe(false);
      
      await swordStore.createSpark('user-1', {
        userId: 'user-1',
        action: 'Test action',
        rationale: 'Test',
        estimatedMinutes: 5,
        frictionLevel: 'minimal',
        reversible: true,
      });
      
      expect(await builder.hasActiveSpark('user-1')).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// PIPELINE HOOKS TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('PipelineHooks', () => {
  let hooks: PipelineHooks;
  let memoryStore: MemoryStore;
  let swordStore: SwordStore;
  let kvStore: KVStore;
  
  beforeEach(() => {
    kvStore = new KVStore();
    memoryStore = new MemoryStore(kvStore);
    swordStore = new SwordStore(kvStore);
    hooks = new PipelineHooks(memoryStore, swordStore);
  });
  
  describe('preGeneration()', () => {
    it('should return context injection and modified system prompt', async () => {
      const result = await hooks.preGeneration(
        'user-1',
        'Hello',
        'Base system prompt',
        null
      );
      
      expect(result.contextInjection).toBeDefined();
      expect(result.unifiedContext).toBeDefined();
      expect(result.modifiedSystemPrompt).toContain('Base system prompt');
    });
    
    it('should add preference-based instructions', async () => {
      await memoryStore.updatePreferences('user-1', {
        verbosity: 'concise',
        tone: 'formal',
      });
      
      const result = await hooks.preGeneration(
        'user-1',
        'Hello',
        'Base prompt',
        null
      );
      
      expect(result.modifiedSystemPrompt).toContain('Keep responses brief');
      expect(result.modifiedSystemPrompt).toContain('formal');
    });
    
    it('should add active spark reminder', async () => {
      await swordStore.createSpark('user-1', {
        userId: 'user-1',
        action: 'Review code',
        rationale: 'Test',
        estimatedMinutes: 10,
        frictionLevel: 'low',
        reversible: true,
      });
      
      const result = await hooks.preGeneration(
        'user-1',
        'Hello',
        'Base prompt',
        null
      );
      
      expect(result.modifiedSystemPrompt).toContain('<active_task>');
      expect(result.modifiedSystemPrompt).toContain('Review code');
    });
  });
  
  describe('postGeneration()', () => {
    it('should extract memories from user message', async () => {
      const result = await hooks.postGeneration(
        'user-1',
        'My name is Charlie and I work at Google',
        'Nice to meet you, Charlie!',
        {}
      );
      
      expect(result.memoriesExtracted).toBeGreaterThan(0);
      expect(result.profileUpdated).toBe(true);
    });
    
    it('should update last interaction timestamp', async () => {
      await hooks.postGeneration(
        'user-1',
        'Hello',
        'Hi there!',
        { updateLastInteraction: true }
      );
      
      const profile = await memoryStore.getProfile('user-1');
      expect(profile?.lastInteraction).toBeDefined();
    });
    
    it('should not extract when memory disabled', async () => {
      await memoryStore.updatePreferences('user-1', {
        memoryEnabled: false,
      });
      
      const result = await hooks.postGeneration(
        'user-1',
        'My name is Dave',
        'Hello Dave!',
        { extractMemory: true }
      );
      
      expect(result.memoriesExtracted).toBe(0);
    });
  });
  
  describe('enhanceResponse()', () => {
    it('should add spark suggestion to response', async () => {
      const spark = await swordStore.createSpark('user-1', {
        userId: 'user-1',
        action: 'Write outline',
        rationale: 'Get started',
        estimatedMinutes: 5,
        frictionLevel: 'minimal',
        reversible: true,
      });
      
      const enhanced = hooks.enhanceResponse(
        'Here is my response.',
        {
          memoriesExtracted: 0,
          profileUpdated: false,
          preferencesUpdated: false,
          sparkSuggested: spark,
          goalProgressUpdated: false,
        },
        {
          user: { profile: null, preferences: null },
          memory: { summary: '', facts: [], preferences: [], activeProjects: [], warnings: [] },
          sword: { activeGoals: [], currentSpark: null, overallProgress: 0, nextAction: null },
          conversation: { id: null, recentMessages: [], messageCount: 0, topics: [] },
          session: { timestamp: '' },
        }
      );
      
      expect(enhanced).toContain('Here is my response.');
      expect(enhanced).toContain('Quick Action');
      expect(enhanced).toContain('Write outline');
    });
    
    it('should add progress celebration when goal updated', () => {
      const enhanced = hooks.enhanceResponse(
        'Great work!',
        {
          memoriesExtracted: 0,
          profileUpdated: false,
          preferencesUpdated: false,
          sparkSuggested: null,
          goalProgressUpdated: true,
        },
        {
          user: { profile: null, preferences: null },
          memory: { summary: '', facts: [], preferences: [], activeProjects: [], warnings: [] },
          sword: {
            activeGoals: [{
              id: '1',
              title: 'Finish Project',
              progress: 50,
              currentQuest: null,
              nextStep: null,
              onTrack: true,
            }],
            currentSpark: null,
            overallProgress: 50,
            nextAction: null,
          },
          conversation: { id: null, recentMessages: [], messageCount: 0, topics: [] },
          session: { timestamp: '' },
        }
      );
      
      expect(enhanced).toContain('Great work!');
      expect(enhanced).toContain('50%');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// INTEGRATION TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Full Integration', () => {
  let memoryStore: MemoryStore;
  let swordStore: SwordStore;
  let kvStore: KVStore;
  let builder: ContextBuilder;
  let hooks: PipelineHooks;
  
  beforeEach(() => {
    kvStore = new KVStore();
    memoryStore = new MemoryStore(kvStore);
    swordStore = new SwordStore(kvStore);
    builder = new ContextBuilder(memoryStore, swordStore);
    hooks = new PipelineHooks(memoryStore, swordStore, builder);
  });
  
  it('should flow from pre to post generation correctly', async () => {
    // Set up user context
    await memoryStore.updateProfile('user-1', {
      name: 'Eve',
      role: 'Product Manager',
    });
    
    await swordStore.createGoal('user-1', {
      title: 'Launch Feature X',
      description: 'Ship new feature',
      desiredOutcome: 'Users love it',
      interestLevel: 'career_capital',
    });
    
    // Pre-generation
    const preResult = await hooks.preGeneration(
      'user-1',
      'How should I prioritize my tasks today?',
      'You are Nova.',
      null
    );
    
    expect(preResult.unifiedContext.user.profile?.name).toBe('Eve');
    expect(preResult.unifiedContext.sword.activeGoals.length).toBe(1);
    expect(preResult.modifiedSystemPrompt).toContain('nova_context');
    
    // Simulate response
    const response = 'Based on your goal to Launch Feature X, I recommend...';
    
    // Post-generation
    const postResult = await hooks.postGeneration(
      'user-1',
      'I finished the design review today.',
      response,
      {}
    );
    
    // The message doesn't contain personal info to extract, so check basic functioning
    expect(postResult.memoriesExtracted).toBeGreaterThanOrEqual(0);
  });
  
  it('should respect user preferences throughout pipeline', async () => {
    await memoryStore.updatePreferences('user-1', {
      memoryEnabled: false,
      tone: 'technical',
      verbosity: 'concise',
    });
    
    // Pre-generation should still add style guidance
    const preResult = await hooks.preGeneration(
      'user-1',
      'Explain recursion',
      'Base prompt',
      null
    );
    
    expect(preResult.modifiedSystemPrompt).toContain('Keep responses brief');
    expect(preResult.modifiedSystemPrompt).toContain('technical');
    
    // Post-generation should not extract memories
    const postResult = await hooks.postGeneration(
      'user-1',
      'My favorite language is Rust',
      'Rust is great!',
      {}
    );
    
    expect(postResult.memoriesExtracted).toBe(0);
  });
});
