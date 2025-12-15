// ═══════════════════════════════════════════════════════════════════════════════
// SWORD MODULE TESTS — Goals, Quests, Steps, Sparks
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SwordStore,
  SparkGenerator,
  transitionGoal,
  transitionQuest,
  transitionStep,
  transitionSpark,
  canTransitionGoal,
  canTransitionQuest,
  getAvailableGoalTransitions,
  getAvailableQuestTransitions,
  type Goal,
  type Quest,
  type Step,
  type Spark,
} from '../core/sword/index.js';
import { MemoryStore } from '../storage/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────────────────────────────────────────

function createTestGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-1',
    userId: 'user-1',
    title: 'Launch my startup',
    description: 'Build and launch an MVP',
    desiredOutcome: 'Have 100 paying customers',
    interestLevel: 'financial_stability',
    tags: ['business', 'startup'],
    status: 'active',
    progress: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    questIds: [],
    motivations: ['Financial freedom', 'Impact'],
    constraints: ['Limited budget'],
    successCriteria: ['100 customers', 'Positive unit economics'],
    ...overrides,
  };
}

function createTestQuest(overrides: Partial<Quest> = {}): Quest {
  return {
    id: 'quest-1',
    userId: 'user-1',
    goalId: 'goal-1',
    title: 'Build MVP',
    description: 'Create minimum viable product',
    outcome: 'Working product users can try',
    status: 'not_started',
    priority: 'high',
    progress: 0,
    order: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stepIds: [],
    riskLevel: 'low',
    ...overrides,
  };
}

function createTestStep(overrides: Partial<Step> = {}): Step {
  return {
    id: 'step-1',
    questId: 'quest-1',
    title: 'Set up database',
    description: 'Create PostgreSQL schema',
    type: 'action',
    status: 'pending',
    order: 0,
    createdAt: new Date().toISOString(),
    verificationRequired: false,
    ...overrides,
  };
}

function createTestSpark(overrides: Partial<Spark> = {}): Spark {
  return {
    id: 'spark-1',
    userId: 'user-1',
    stepId: 'step-1',
    questId: 'quest-1',
    action: 'Create schema.sql file with user table',
    rationale: 'Starting with the core table establishes the foundation',
    estimatedMinutes: 10,
    frictionLevel: 'minimal',
    reversible: true,
    status: 'suggested',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// STATE MACHINE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Sword State Machine', () => {
  describe('Goal Transitions', () => {
    it('should transition active goal to paused', () => {
      const goal = createTestGoal({ status: 'active' });
      const result = transitionGoal(goal, { type: 'PAUSE' });
      
      expect(result.success).toBe(true);
      expect(result.entity.status).toBe('paused');
      expect(result.previousStatus).toBe('active');
      expect(result.newStatus).toBe('paused');
    });
    
    it('should transition active goal to completed', () => {
      const goal = createTestGoal({ status: 'active' });
      const result = transitionGoal(goal, { type: 'COMPLETE' });
      
      expect(result.success).toBe(true);
      expect(result.entity.status).toBe('completed');
      expect(result.entity.completedAt).toBeDefined();
      expect(result.entity.progress).toBe(100);
    });
    
    it('should transition paused goal to active (resume)', () => {
      const goal = createTestGoal({ status: 'paused' });
      const result = transitionGoal(goal, { type: 'RESUME' });
      
      expect(result.success).toBe(true);
      expect(result.entity.status).toBe('active');
    });
    
    it('should reject invalid transitions', () => {
      const goal = createTestGoal({ status: 'completed' });
      const result = transitionGoal(goal, { type: 'PAUSE' });
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid transition');
    });
    
    it('should auto-complete at 100% progress', () => {
      const goal = createTestGoal({ status: 'active', progress: 50 });
      const result = transitionGoal(goal, { type: 'UPDATE_PROGRESS', progress: 100 });
      
      expect(result.success).toBe(true);
      expect(result.entity.status).toBe('completed');
      expect(result.entity.progress).toBe(100);
    });
    
    it('should provide available transitions', () => {
      const goal = createTestGoal({ status: 'active' });
      const transitions = getAvailableGoalTransitions(goal);
      
      expect(transitions).toContain('PAUSE');
      expect(transitions).toContain('COMPLETE');
      expect(transitions).toContain('ABANDON');
      expect(transitions).not.toContain('RESUME');
    });
  });
  
  describe('Quest Transitions', () => {
    it('should transition not_started to active', () => {
      const quest = createTestQuest({ status: 'not_started' });
      const result = transitionQuest(quest, { type: 'START' });
      
      expect(result.success).toBe(true);
      expect(result.entity.status).toBe('active');
      expect(result.entity.startedAt).toBeDefined();
    });
    
    it('should transition active to blocked', () => {
      const quest = createTestQuest({ status: 'active' });
      const result = transitionQuest(quest, { type: 'BLOCK', reason: 'Waiting for API access' });
      
      expect(result.success).toBe(true);
      expect(result.entity.status).toBe('blocked');
      expect(result.entity.riskNotes).toBe('Waiting for API access');
    });
    
    it('should transition blocked to active (unblock)', () => {
      const quest = createTestQuest({ status: 'blocked', blockedBy: ['ext-1'] });
      const result = transitionQuest(quest, { type: 'UNBLOCK' });
      
      expect(result.success).toBe(true);
      expect(result.entity.status).toBe('active');
      expect(result.entity.blockedBy).toBeUndefined();
    });
    
    it('should update progress without changing status', () => {
      const quest = createTestQuest({ status: 'active', progress: 25 });
      const result = transitionQuest(quest, { type: 'UPDATE_PROGRESS', progress: 50 });
      
      expect(result.success).toBe(true);
      expect(result.entity.status).toBe('active');
      expect(result.entity.progress).toBe(50);
    });
    
    it('should generate side effects on complete', () => {
      const quest = createTestQuest({ status: 'active' });
      const result = transitionQuest(quest, { type: 'COMPLETE' });
      
      expect(result.success).toBe(true);
      expect(result.sideEffects).toBeDefined();
      expect(result.sideEffects?.length).toBeGreaterThan(0);
      expect(result.sideEffects?.[0]?.type).toBe('update_progress');
    });
    
    it('should validate transitions', () => {
      const quest = createTestQuest({ status: 'not_started' });
      
      expect(canTransitionQuest(quest, 'START')).toBe(true);
      expect(canTransitionQuest(quest, 'COMPLETE')).toBe(false);
      expect(canTransitionQuest(quest, 'UPDATE_PROGRESS')).toBe(true);
    });
  });
  
  describe('Step Transitions', () => {
    it('should transition pending to active', () => {
      const step = createTestStep({ status: 'pending' });
      const result = transitionStep(step, { type: 'START' });
      
      expect(result.success).toBe(true);
      expect(result.entity.status).toBe('active');
    });
    
    it('should transition active to completed with notes', () => {
      const step = createTestStep({ status: 'active' });
      const result = transitionStep(step, { type: 'COMPLETE', notes: 'Done with minor changes' });
      
      expect(result.success).toBe(true);
      expect(result.entity.status).toBe('completed');
      expect(result.entity.completionNotes).toBe('Done with minor changes');
      expect(result.entity.completedAt).toBeDefined();
    });
    
    it('should allow skipping steps', () => {
      const step = createTestStep({ status: 'pending' });
      const result = transitionStep(step, { type: 'SKIP' });
      
      expect(result.success).toBe(true);
      expect(result.entity.status).toBe('skipped');
    });
  });
  
  describe('Spark Transitions', () => {
    it('should transition suggested to accepted', () => {
      const spark = createTestSpark({ status: 'suggested' });
      const result = transitionSpark(spark, { type: 'ACCEPT' });
      
      expect(result.success).toBe(true);
      expect(result.entity.status).toBe('accepted');
    });
    
    it('should transition accepted to completed', () => {
      const spark = createTestSpark({ status: 'accepted' });
      const result = transitionSpark(spark, { type: 'COMPLETE' });
      
      expect(result.success).toBe(true);
      expect(result.entity.status).toBe('completed');
      expect(result.entity.completedAt).toBeDefined();
    });
    
    it('should handle expiration', () => {
      const spark = createTestSpark({ status: 'suggested' });
      const result = transitionSpark(spark, { type: 'EXPIRE' });
      
      expect(result.success).toBe(true);
      expect(result.entity.status).toBe('expired');
    });
    
    it('should generate cascade side effect on complete', () => {
      const spark = createTestSpark({ status: 'accepted', stepId: 'step-1' });
      const result = transitionSpark(spark, { type: 'COMPLETE' });
      
      expect(result.sideEffects).toBeDefined();
      expect(result.sideEffects?.some(e => e.type === 'cascade_complete')).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// SWORD STORE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('SwordStore', () => {
  let store: SwordStore;
  let memoryStore: MemoryStore;
  
  beforeEach(() => {
    memoryStore = new MemoryStore();
    store = new SwordStore(memoryStore);
  });
  
  describe('Goal Operations', () => {
    it('should create a goal', async () => {
      const goal = await store.createGoal('user-1', {
        title: 'Learn TypeScript',
        description: 'Master TypeScript for backend development',
        desiredOutcome: 'Build a production app with TypeScript',
      });
      
      expect(goal.id).toBeDefined();
      expect(goal.userId).toBe('user-1');
      expect(goal.title).toBe('Learn TypeScript');
      expect(goal.status).toBe('active');
      expect(goal.progress).toBe(0);
    });
    
    it('should retrieve a goal', async () => {
      const created = await store.createGoal('user-1', {
        title: 'Test Goal',
        description: 'Test',
        desiredOutcome: 'Test',
      });
      
      const retrieved = await store.getGoal(created.id);
      
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
    });
    
    it('should list user goals', async () => {
      await store.createGoal('user-1', {
        title: 'Goal 1',
        description: 'Test',
        desiredOutcome: 'Test',
      });
      await store.createGoal('user-1', {
        title: 'Goal 2',
        description: 'Test',
        desiredOutcome: 'Test',
      });
      await store.createGoal('user-2', {
        title: 'Other user goal',
        description: 'Test',
        desiredOutcome: 'Test',
      });
      
      const goals = await store.getUserGoals('user-1');
      
      expect(goals.length).toBe(2);
      expect(goals.every(g => g.userId === 'user-1')).toBe(true);
    });
    
    it('should filter goals by status', async () => {
      const goal = await store.createGoal('user-1', {
        title: 'Active Goal',
        description: 'Test',
        desiredOutcome: 'Test',
      });
      await store.transitionGoalState(goal.id, { type: 'PAUSE' });
      
      await store.createGoal('user-1', {
        title: 'Another Active Goal',
        description: 'Test',
        desiredOutcome: 'Test',
      });
      
      const activeGoals = await store.getUserGoals('user-1', 'active');
      const pausedGoals = await store.getUserGoals('user-1', 'paused');
      
      expect(activeGoals.length).toBe(1);
      expect(pausedGoals.length).toBe(1);
    });
  });
  
  describe('Quest Operations', () => {
    it('should create a quest linked to goal', async () => {
      const goal = await store.createGoal('user-1', {
        title: 'Main Goal',
        description: 'Test',
        desiredOutcome: 'Test',
      });
      
      const quest = await store.createQuest('user-1', {
        goalId: goal.id,
        title: 'First Milestone',
        description: 'Initial work',
        outcome: 'Foundation complete',
      });
      
      expect(quest).toBeDefined();
      expect(quest?.goalId).toBe(goal.id);
      expect(quest?.status).toBe('not_started');
      
      // Check goal was updated
      const updatedGoal = await store.getGoal(goal.id);
      expect(updatedGoal?.questIds).toContain(quest?.id);
    });
    
    it('should get quests for goal in order', async () => {
      const goal = await store.createGoal('user-1', {
        title: 'Goal',
        description: 'Test',
        desiredOutcome: 'Test',
      });
      
      await store.createQuest('user-1', {
        goalId: goal.id,
        title: 'Second Quest',
        description: 'Test',
        outcome: 'Test',
        order: 1,
      });
      await store.createQuest('user-1', {
        goalId: goal.id,
        title: 'First Quest',
        description: 'Test',
        outcome: 'Test',
        order: 0,
      });
      
      const quests = await store.getQuestsForGoal(goal.id);
      
      expect(quests.length).toBe(2);
      expect(quests[0]?.title).toBe('First Quest');
      expect(quests[1]?.title).toBe('Second Quest');
    });
  });
  
  describe('Step Operations', () => {
    it('should create steps for quest', async () => {
      const goal = await store.createGoal('user-1', {
        title: 'Goal',
        description: 'Test',
        desiredOutcome: 'Test',
      });
      const quest = await store.createQuest('user-1', {
        goalId: goal.id,
        title: 'Quest',
        description: 'Test',
        outcome: 'Test',
      });
      
      const step = await store.createStep({
        questId: quest!.id,
        title: 'Do something',
        type: 'action',
      });
      
      expect(step).toBeDefined();
      expect(step?.questId).toBe(quest!.id);
      expect(step?.status).toBe('pending');
    });
    
    it('should get next pending step', async () => {
      const goal = await store.createGoal('user-1', {
        title: 'Goal',
        description: 'Test',
        desiredOutcome: 'Test',
      });
      const quest = await store.createQuest('user-1', {
        goalId: goal.id,
        title: 'Quest',
        description: 'Test',
        outcome: 'Test',
      });
      
      const step1 = await store.createStep({
        questId: quest!.id,
        title: 'Step 1',
        order: 0,
      });
      await store.createStep({
        questId: quest!.id,
        title: 'Step 2',
        order: 1,
      });
      
      // Complete first step
      await store.transitionStepState(step1!.id, { type: 'START' });
      await store.transitionStepState(step1!.id, { type: 'COMPLETE' });
      
      const nextStep = await store.getNextStep(quest!.id);
      
      expect(nextStep?.title).toBe('Step 2');
    });
  });
  
  describe('Spark Operations', () => {
    it('should create and retrieve sparks', async () => {
      const spark = await store.createSpark('user-1', {
        action: 'Open IDE and create file',
        rationale: 'Starting is the hardest part',
        estimatedMinutes: 5,
        frictionLevel: 'minimal',
        reversible: true,
      });
      
      expect(spark.id).toBeDefined();
      expect(spark.status).toBe('suggested');
      expect(spark.expiresAt).toBeDefined();
      
      const retrieved = await store.getSpark(spark.id);
      expect(retrieved?.action).toBe('Open IDE and create file');
    });
    
    it('should get active spark for user', async () => {
      await store.createSpark('user-1', {
        action: 'First action',
        rationale: 'Test',
        estimatedMinutes: 5,
        frictionLevel: 'minimal',
        reversible: true,
      });
      
      const active = await store.getActiveSpark('user-1');
      
      expect(active).toBeDefined();
      expect(active?.action).toBe('First action');
    });
    
    it('should transition spark states', async () => {
      const spark = await store.createSpark('user-1', {
        action: 'Test action',
        rationale: 'Test',
        estimatedMinutes: 5,
        frictionLevel: 'minimal',
        reversible: true,
      });
      
      await store.transitionSparkState(spark.id, { type: 'ACCEPT' });
      let updated = await store.getSpark(spark.id);
      expect(updated?.status).toBe('accepted');
      
      await store.transitionSparkState(spark.id, { type: 'COMPLETE' });
      updated = await store.getSpark(spark.id);
      expect(updated?.status).toBe('completed');
    });
  });
  
  describe('Path Operations', () => {
    it('should calculate path for goal', async () => {
      const goal = await store.createGoal('user-1', {
        title: 'Test Goal',
        description: 'Test',
        desiredOutcome: 'Test',
      });
      
      const quest1 = await store.createQuest('user-1', {
        goalId: goal.id,
        title: 'Quest 1',
        description: 'Test',
        outcome: 'Test',
      });
      await store.createQuest('user-1', {
        goalId: goal.id,
        title: 'Quest 2',
        description: 'Test',
        outcome: 'Test',
      });
      
      // Start first quest
      await store.transitionQuestState(quest1!.id, { type: 'START' });
      
      const path = await store.getPath(goal.id, 'user-1');
      
      expect(path).toBeDefined();
      expect(path?.totalQuests).toBe(2);
      expect(path?.completedQuests).toBe(0);
      expect(path?.currentQuestId).toBe(quest1!.id);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// SPARK GENERATOR TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('SparkGenerator', () => {
  let store: SwordStore;
  let generator: SparkGenerator;
  
  beforeEach(() => {
    const memoryStore = new MemoryStore();
    store = new SwordStore(memoryStore);
    generator = new SparkGenerator(store);
  });
  
  it('should generate spark from template for research task', async () => {
    const goal = await store.createGoal('user-1', {
      title: 'Research competitors',
      description: 'Understand the market',
      desiredOutcome: 'Competitive analysis doc',
    });
    
    const quest = await store.createQuest('user-1', {
      goalId: goal.id,
      title: 'Research market leaders',
      description: 'Find and analyze top 5 competitors',
      outcome: 'List of competitors with analysis',
    });
    
    const spark = await generator.generate('user-1', {
      questId: quest!.id,
    });
    
    expect(spark).toBeDefined();
    expect(spark.action).toContain('search');
    expect(spark.frictionLevel).toBe('minimal');
    expect(spark.estimatedMinutes).toBeLessThanOrEqual(15);
  });
  
  it('should generate spark for writing task', async () => {
    const goal = await store.createGoal('user-1', {
      title: 'Write blog post',
      description: 'Create content',
      desiredOutcome: 'Published post',
    });
    
    const spark = await generator.generate('user-1', {
      goalId: goal.id,
      context: 'draft article about AI',
    });
    
    expect(spark).toBeDefined();
    expect(spark.action.toLowerCase()).toMatch(/document|title|bullet/);
  });
  
  it('should generate fallback spark when no template matches', async () => {
    const spark = await generator.generate('user-1', {
      context: 'something completely unique and unusual xyz123',
    });
    
    expect(spark).toBeDefined();
    expect(spark.estimatedMinutes).toBe(5);
    expect(spark.frictionLevel).toBe('minimal');
  });
  
  it('should respect maxMinutes constraint', async () => {
    const goal = await store.createGoal('user-1', {
      title: 'Quick task',
      description: 'Fast',
      desiredOutcome: 'Done',
    });
    
    const spark = await generator.generate('user-1', {
      goalId: goal.id,
      maxMinutes: 3,
    });
    
    expect(spark.estimatedMinutes).toBeLessThanOrEqual(3);
  });
  
  it('should generate next spark for path', async () => {
    const goal = await store.createGoal('user-1', {
      title: 'Test Goal',
      description: 'Test',
      desiredOutcome: 'Test',
    });
    
    const quest = await store.createQuest('user-1', {
      goalId: goal.id,
      title: 'Research task',
      description: 'Do research',
      outcome: 'Findings',
    });
    
    await store.createStep({
      questId: quest!.id,
      title: 'First research step',
      sparkPrompt: 'Start with Google search',
    });
    
    await store.transitionQuestState(quest!.id, { type: 'START' });
    
    const spark = await generator.generateNextSpark('user-1', goal.id);
    
    expect(spark).toBeDefined();
    expect(spark?.userId).toBe('user-1');
  });
});
