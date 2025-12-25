// ═══════════════════════════════════════════════════════════════════════════════
// SWORD STORE — Persistence for Goals, Quests, Steps, Sparks
// ═══════════════════════════════════════════════════════════════════════════════

import { getStore, type KeyValueStore } from '../../storage/index.js';
import type {
  Goal, GoalStatus,
  Quest, QuestStatus,
  Step,
  Spark, SparkStatus,
  Path, PathBlocker,
  CreateGoalRequest,
  CreateQuestRequest,
  CreateStepRequest,
} from './types.js';
import {
  transitionGoal, transitionQuest, transitionStep, transitionSpark,
  type TransitionResult, type SideEffect,
} from './state-machine.js';
import type { GoalEvent, QuestEvent, StepEvent, SparkEvent } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

const GOAL_TTL = 365 * 24 * 60 * 60;       // 1 year
const QUEST_TTL = 180 * 24 * 60 * 60;      // 6 months
const STEP_TTL = 180 * 24 * 60 * 60;       // 6 months
const SPARK_TTL = 7 * 24 * 60 * 60;        // 7 days
const SPARK_EXPIRY_HOURS = 24;             // Sparks expire after 24 hours

// ─────────────────────────────────────────────────────────────────────────────────
// KEY GENERATION
// ─────────────────────────────────────────────────────────────────────────────────

function goalKey(id: string): string {
  return `sword:goal:${id}`;
}

function userGoalsKey(userId: string): string {
  return `sword:user:${userId}:goals`;
}

function questKey(id: string): string {
  return `sword:quest:${id}`;
}

function goalQuestsKey(goalId: string): string {
  return `sword:goal:${goalId}:quests`;
}

function stepKey(id: string): string {
  return `sword:step:${id}`;
}

function questStepsKey(questId: string): string {
  return `sword:quest:${questId}:steps`;
}

function sparkKey(id: string): string {
  return `sword:spark:${id}`;
}

function userSparksKey(userId: string): string {
  return `sword:user:${userId}:sparks`;
}

function stepSparksKey(stepId: string): string {
  return `sword:step:${stepId}:sparks`;
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────────────────────────────────────────────────────────────────
// SWORD STORE CLASS
// ─────────────────────────────────────────────────────────────────────────────────

export class SwordStore {
  private store: KeyValueStore;
  
  constructor(store?: KeyValueStore) {
    this.store = store ?? getStore();
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // GOAL OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  async createGoal(userId: string, request: CreateGoalRequest): Promise<Goal> {
    const id = generateId();
    const now = new Date().toISOString();
    
    const goal: Goal = {
      id,
      userId,
      title: request.title,
      description: request.description,
      desiredOutcome: request.desiredOutcome,
      interestLevel: request.interestLevel ?? 'comfort',
      tags: request.tags ?? [],
      status: 'active',
      progress: 0,
      targetDate: request.targetDate,
      createdAt: now,
      updatedAt: now,
      questIds: [],
      motivations: request.motivations ?? [],
      constraints: request.constraints ?? [],
      successCriteria: request.successCriteria ?? [],
    };
    
    // Save goal
    await this.store.set(goalKey(id), JSON.stringify(goal), GOAL_TTL);
    
    // Add to user's goals list
    const userGoals = await this.getUserGoalIds(userId);
    userGoals.push(id);
    await this.store.set(userGoalsKey(userId), JSON.stringify(userGoals), GOAL_TTL);
    
    return goal;
  }
  
  async getGoal(id: string): Promise<Goal | null> {
    const data = await this.store.get(goalKey(id));
    return data ? JSON.parse(data) : null;
  }
  
  async updateGoal(id: string, updates: Partial<Goal>): Promise<Goal | null> {
    const goal = await this.getGoal(id);
    if (!goal) return null;
    
    const updated: Goal = {
      ...goal,
      ...updates,
      id: goal.id,  // Prevent ID change
      userId: goal.userId,  // Prevent user change
      updatedAt: new Date().toISOString(),
    };
    
    await this.store.set(goalKey(id), JSON.stringify(updated), GOAL_TTL);
    return updated;
  }
  
  async deleteGoal(id: string): Promise<boolean> {
    const goal = await this.getGoal(id);
    if (!goal) return false;
    
    // Delete all quests for this goal (cascade)
    const questIds = await this.getGoalQuestIds(id);
    for (const questId of questIds) {
      await this.deleteQuest(questId);
    }
    
    // Remove from user's goals list
    const userGoals = await this.getUserGoalIds(goal.userId);
    const filteredGoals = userGoals.filter(gid => gid !== id);
    await this.store.set(userGoalsKey(goal.userId), JSON.stringify(filteredGoals), GOAL_TTL);
    
    // Delete goal quests index
    await this.store.delete(goalQuestsKey(id));
    
    // Delete goal itself
    await this.store.delete(goalKey(id));
    
    return true;
  }
  
  async transitionGoalState(id: string, event: GoalEvent): Promise<TransitionResult<Goal> | null> {
    const goal = await this.getGoal(id);
    if (!goal) return null;
    
    const result = transitionGoal(goal, event);
    
    if (result.success) {
      await this.store.set(goalKey(id), JSON.stringify(result.entity), GOAL_TTL);
      await this.processSideEffects(result.sideEffects ?? []);
    }
    
    return result;
  }
  
  async getUserGoals(userId: string, status?: GoalStatus): Promise<Goal[]> {
    const ids = await this.getUserGoalIds(userId);
    const goals: Goal[] = [];
    
    for (const id of ids) {
      const goal = await this.getGoal(id);
      if (goal && (!status || goal.status === status)) {
        goals.push(goal);
      }
    }
    
    return goals;
  }
  
  private async getUserGoalIds(userId: string): Promise<string[]> {
    const data = await this.store.get(userGoalsKey(userId));
    return data ? JSON.parse(data) : [];
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // QUEST OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  async createQuest(userId: string, request: CreateQuestRequest): Promise<Quest | null> {
    const goal = await this.getGoal(request.goalId);
    if (!goal || goal.userId !== userId) return null;
    
    const id = generateId();
    const now = new Date().toISOString();
    
    // Determine order
    const existingQuests = await this.getQuestsForGoal(request.goalId);
    const order = request.order ?? existingQuests.length;
    
    const quest: Quest = {
      id,
      userId,
      goalId: request.goalId,
      title: request.title,
      description: request.description,
      outcome: request.outcome,
      status: 'not_started',
      priority: request.priority ?? 'medium',
      progress: 0,
      order,
      estimatedMinutes: request.estimatedMinutes,
      targetDate: request.targetDate,
      createdAt: now,
      updatedAt: now,
      stepIds: [],
      riskLevel: 'none',
    };
    
    // Save quest
    await this.store.set(questKey(id), JSON.stringify(quest), QUEST_TTL);
    
    // Add to goal's quests list
    const goalQuests = await this.getGoalQuestIds(request.goalId);
    goalQuests.push(id);
    await this.store.set(goalQuestsKey(request.goalId), JSON.stringify(goalQuests), QUEST_TTL);
    
    // Update goal
    await this.updateGoal(request.goalId, { questIds: goalQuests });
    
    return quest;
  }
  
  async getQuest(id: string): Promise<Quest | null> {
    const data = await this.store.get(questKey(id));
    return data ? JSON.parse(data) : null;
  }
  
  async updateQuest(id: string, updates: Partial<Quest>): Promise<Quest | null> {
    const quest = await this.getQuest(id);
    if (!quest) return null;
    
    const updated: Quest = {
      ...quest,
      ...updates,
      id: quest.id,
      userId: quest.userId,
      goalId: quest.goalId,
      updatedAt: new Date().toISOString(),
    };
    
    await this.store.set(questKey(id), JSON.stringify(updated), QUEST_TTL);
    return updated;
  }
  
  async deleteQuest(id: string): Promise<boolean> {
    const quest = await this.getQuest(id);
    if (!quest) return false;
    
    // Delete all steps for this quest (cascade)
    const stepIds = await this.getQuestStepIds(id);
    for (const stepId of stepIds) {
      await this.deleteStep(stepId);
    }
    
    // Remove from goal's quests list
    const goalQuests = await this.getGoalQuestIds(quest.goalId);
    const filteredQuests = goalQuests.filter(qid => qid !== id);
    await this.store.set(goalQuestsKey(quest.goalId), JSON.stringify(filteredQuests), QUEST_TTL);
    
    // Update goal's questIds
    await this.updateGoal(quest.goalId, { questIds: filteredQuests });
    
    // Delete quest steps index
    await this.store.delete(questStepsKey(id));
    
    // Delete quest itself
    await this.store.delete(questKey(id));
    
    return true;
  }
  
  async transitionQuestState(id: string, event: QuestEvent): Promise<TransitionResult<Quest> | null> {
    const quest = await this.getQuest(id);
    if (!quest) return null;
    
    const result = transitionQuest(quest, event);
    
    if (result.success) {
      await this.store.set(questKey(id), JSON.stringify(result.entity), QUEST_TTL);
      await this.processSideEffects(result.sideEffects ?? []);
    }
    
    return result;
  }
  
  async getQuestsForGoal(goalId: string): Promise<Quest[]> {
    const ids = await this.getGoalQuestIds(goalId);
    const quests: Quest[] = [];
    
    for (const id of ids) {
      const quest = await this.getQuest(id);
      if (quest) quests.push(quest);
    }
    
    return quests.sort((a, b) => a.order - b.order);
  }
  
  async getUserQuests(userId: string, status?: QuestStatus): Promise<Quest[]> {
    const goals = await this.getUserGoals(userId);
    const quests: Quest[] = [];
    
    for (const goal of goals) {
      const goalQuests = await this.getQuestsForGoal(goal.id);
      for (const quest of goalQuests) {
        if (!status || quest.status === status) {
          quests.push(quest);
        }
      }
    }
    
    return quests;
  }
  
  private async getGoalQuestIds(goalId: string): Promise<string[]> {
    const data = await this.store.get(goalQuestsKey(goalId));
    return data ? JSON.parse(data) : [];
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // STEP OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  async createStep(request: CreateStepRequest): Promise<Step | null> {
    const quest = await this.getQuest(request.questId);
    if (!quest) return null;
    
    const id = generateId();
    const now = new Date().toISOString();
    
    // Determine order
    const existingSteps = await this.getStepsForQuest(request.questId);
    const order = request.order ?? existingSteps.length;
    
    const step: Step = {
      id,
      questId: request.questId,
      title: request.title,
      description: request.description,
      type: request.type ?? 'action',
      status: 'pending',
      order,
      estimatedMinutes: request.estimatedMinutes,
      createdAt: now,
      sparkPrompt: request.sparkPrompt,
      verificationRequired: request.verificationRequired ?? false,
    };
    
    // Save step
    await this.store.set(stepKey(id), JSON.stringify(step), STEP_TTL);
    
    // Add to quest's steps list
    const questSteps = await this.getQuestStepIds(request.questId);
    questSteps.push(id);
    await this.store.set(questStepsKey(request.questId), JSON.stringify(questSteps), STEP_TTL);
    
    // Update quest
    await this.updateQuest(request.questId, { stepIds: questSteps });
    
    return step;
  }
  
  async getStep(id: string): Promise<Step | null> {
    const data = await this.store.get(stepKey(id));
    return data ? JSON.parse(data) : null;
  }
  
  async updateStep(id: string, updates: Partial<Step>): Promise<Step | null> {
    const step = await this.getStep(id);
    if (!step) return null;
    
    const updated: Step = {
      ...step,
      ...updates,
      id: step.id,
      questId: step.questId,
    };
    
    await this.store.set(stepKey(id), JSON.stringify(updated), STEP_TTL);
    return updated;
  }
  
  async deleteStep(id: string): Promise<boolean> {
    const step = await this.getStep(id);
    if (!step) return false;
    
    // Remove from quest's steps list
    const questSteps = await this.getQuestStepIds(step.questId);
    const filteredSteps = questSteps.filter(sid => sid !== id);
    await this.store.set(questStepsKey(step.questId), JSON.stringify(filteredSteps), STEP_TTL);
    
    // Update quest's stepIds
    await this.updateQuest(step.questId, { stepIds: filteredSteps });
    
    // Delete step's sparks index (sparks themselves remain for history)
    await this.store.delete(stepSparksKey(id));
    
    // Delete step itself
    await this.store.delete(stepKey(id));
    
    return true;
  }
  
  async transitionStepState(id: string, event: StepEvent): Promise<TransitionResult<Step> | null> {
    const step = await this.getStep(id);
    if (!step) return null;
    
    const result = transitionStep(step, event);
    
    if (result.success) {
      await this.store.set(stepKey(id), JSON.stringify(result.entity), STEP_TTL);
      await this.processSideEffects(result.sideEffects ?? []);
    }
    
    return result;
  }
  
  async getStepsForQuest(questId: string): Promise<Step[]> {
    const ids = await this.getQuestStepIds(questId);
    const steps: Step[] = [];
    
    for (const id of ids) {
      const step = await this.getStep(id);
      if (step) steps.push(step);
    }
    
    return steps.sort((a, b) => a.order - b.order);
  }
  
  async getNextStep(questId: string): Promise<Step | null> {
    const steps = await this.getStepsForQuest(questId);
    return steps.find(s => s.status === 'pending' || s.status === 'active') ?? null;
  }
  
  private async getQuestStepIds(questId: string): Promise<string[]> {
    const data = await this.store.get(questStepsKey(questId));
    return data ? JSON.parse(data) : [];
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // SPARK OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  async createSpark(userId: string, spark: Omit<Spark, 'id' | 'createdAt' | 'expiresAt' | 'status'>): Promise<Spark> {
    const id = generateId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SPARK_EXPIRY_HOURS * 60 * 60 * 1000);
    
    const fullSpark: Spark = {
      ...spark,
      id,
      userId,
      status: 'suggested',
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    
    // Save spark
    await this.store.set(sparkKey(id), JSON.stringify(fullSpark), SPARK_TTL);
    
    // Add to user's sparks list
    const userSparks = await this.getUserSparkIds(userId);
    userSparks.push(id);
    await this.store.set(userSparksKey(userId), JSON.stringify(userSparks), SPARK_TTL);
    
    // Link to step if applicable
    if (spark.stepId) {
      await this.updateStep(spark.stepId, { lastSparkId: id });
      // Also add to step's sparks list
      const stepSparks = await this.getStepSparkIds(spark.stepId);
      stepSparks.push(id);
      await this.store.set(stepSparksKey(spark.stepId), JSON.stringify(stepSparks), SPARK_TTL);
    }
    
    return fullSpark;
  }
  
  async getSpark(id: string): Promise<Spark | null> {
    const data = await this.store.get(sparkKey(id));
    if (!data) return null;
    
    const spark: Spark = JSON.parse(data);
    
    // Check expiration
    if (new Date(spark.expiresAt) < new Date() && spark.status !== 'completed' && spark.status !== 'skipped') {
      await this.transitionSparkState(id, { type: 'EXPIRE' });
      spark.status = 'expired';
    }
    
    return spark;
  }
  
  async updateSpark(id: string, updates: Partial<Spark>): Promise<Spark | null> {
    const spark = await this.getSpark(id);
    if (!spark) return null;
    
    const updated: Spark = {
      ...spark,
      ...updates,
      id: spark.id,  // Prevent ID change
      userId: spark.userId,  // Prevent user change
    };
    
    await this.store.set(sparkKey(id), JSON.stringify(updated), SPARK_TTL);
    return updated;
  }
  
  async deleteSpark(id: string): Promise<boolean> {
    const spark = await this.getSpark(id);
    if (!spark) return false;
    
    // Remove from user's sparks list
    const userSparks = await this.getUserSparkIds(spark.userId);
    const filteredUserSparks = userSparks.filter(sid => sid !== id);
    await this.store.set(userSparksKey(spark.userId), JSON.stringify(filteredUserSparks), SPARK_TTL);
    
    // Remove from step's sparks list if applicable
    if (spark.stepId) {
      const stepSparks = await this.getStepSparkIds(spark.stepId);
      const filteredStepSparks = stepSparks.filter(sid => sid !== id);
      await this.store.set(stepSparksKey(spark.stepId), JSON.stringify(filteredStepSparks), SPARK_TTL);
    }
    
    // Delete spark itself
    await this.store.delete(sparkKey(id));
    
    return true;
  }
  
  async transitionSparkState(id: string, event: SparkEvent): Promise<TransitionResult<Spark> | null> {
    const data = await this.store.get(sparkKey(id));
    if (!data) return null;
    
    const spark: Spark = JSON.parse(data);
    const result = transitionSpark(spark, event);
    
    if (result.success) {
      await this.store.set(sparkKey(id), JSON.stringify(result.entity), SPARK_TTL);
      await this.processSideEffects(result.sideEffects ?? []);
    }
    
    return result;
  }
  
  async getActiveSpark(userId: string): Promise<Spark | null> {
    const ids = await this.getUserSparkIds(userId);
    
    // Get most recent active spark
    for (let i = ids.length - 1; i >= 0; i--) {
      const spark = await this.getSpark(ids[i]!);
      if (spark && (spark.status === 'suggested' || spark.status === 'accepted')) {
        return spark;
      }
    }
    
    return null;
  }
  
  async getUserSparks(userId: string, limit: number = 10): Promise<Spark[]> {
    const ids = await this.getUserSparkIds(userId);
    const sparks: Spark[] = [];
    
    // Get most recent sparks
    for (let i = ids.length - 1; i >= 0 && sparks.length < limit; i--) {
      const spark = await this.getSpark(ids[i]!);
      if (spark) sparks.push(spark);
    }
    
    return sparks;
  }
  
  async getSparksByStatus(userId: string, status: SparkStatus): Promise<Spark[]> {
    const allSparks = await this.getUserSparks(userId, 100);
    return allSparks.filter(s => s.status === status);
  }
  
  async getSparksForStep(stepId: string): Promise<Spark[]> {
    const ids = await this.getStepSparkIds(stepId);
    const sparks: Spark[] = [];
    
    for (const id of ids) {
      const spark = await this.getSpark(id);
      if (spark) sparks.push(spark);
    }
    
    // Sort by createdAt descending (newest first)
    return sparks.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }
  
  private async getStepSparkIds(stepId: string): Promise<string[]> {
    const data = await this.store.get(stepSparksKey(stepId));
    return data ? JSON.parse(data) : [];
  }
  
  private async getUserSparkIds(userId: string): Promise<string[]> {
    const data = await this.store.get(userSparksKey(userId));
    return data ? JSON.parse(data) : [];
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // PATH OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  async getPath(goalId: string, userId: string): Promise<Path | null> {
    const goal = await this.getGoal(goalId);
    if (!goal || goal.userId !== userId) return null;
    
    const quests = await this.getQuestsForGoal(goalId);
    const completedQuests = quests.filter(q => q.status === 'completed').length;
    
    // Find current quest (first non-completed)
    const currentQuest = quests.find(q => q.status === 'active' || q.status === 'not_started');
    let currentStep: Step | null = null;
    let nextStep: Step | null = null;
    
    if (currentQuest) {
      const steps = await this.getStepsForQuest(currentQuest.id);
      currentStep = steps.find(s => s.status === 'active') ?? null;
      nextStep = steps.find(s => s.status === 'pending') ?? null;
      
      if (!currentStep && nextStep) {
        currentStep = nextStep;
        nextStep = steps.find(s => s.status === 'pending' && s.id !== currentStep?.id) ?? null;
      }
    }
    
    // Get active spark
    const activeSpark = await this.getActiveSpark(userId);
    
    // Calculate blockers
    const blockers: PathBlocker[] = [];
    for (const quest of quests) {
      if (quest.status === 'blocked' && quest.riskNotes) {
        blockers.push({
          type: 'quest_dependency',
          description: quest.riskNotes,
          questId: quest.id,
        });
      }
    }
    
    // Calculate progress
    const totalWeight = quests.length || 1;
    const questProgress = quests.reduce((sum, q) => sum + q.progress, 0);
    const overallProgress = Math.round(questProgress / totalWeight);
    
    // Estimate completion
    let estimatedCompletionDate: string | undefined;
    let daysRemaining: number | undefined;
    
    if (goal.targetDate) {
      const target = new Date(goal.targetDate);
      const now = new Date();
      daysRemaining = Math.max(0, Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      estimatedCompletionDate = goal.targetDate;
    }
    
    return {
      goalId,
      currentQuestId: currentQuest?.id,
      currentStepId: currentStep?.id,
      completedQuests,
      totalQuests: quests.length,
      overallProgress,
      nextStep: nextStep ?? currentStep ?? undefined,
      activeSpark: activeSpark ?? undefined,
      blockers,
      estimatedCompletionDate,
      daysRemaining,
      onTrack: blockers.length === 0 && (daysRemaining === undefined || overallProgress >= (100 - daysRemaining)),
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // SIDE EFFECTS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  private async processSideEffects(effects: SideEffect[]): Promise<void> {
    for (const effect of effects) {
      switch (effect.type) {
        case 'update_progress':
          if (effect.target === 'goal') {
            await this.recalculateGoalProgress(effect.targetId);
          } else if (effect.target === 'quest') {
            await this.recalculateQuestProgress(effect.targetId);
          }
          break;
          
        case 'cascade_complete':
          if (effect.target === 'step') {
            await this.transitionStepState(effect.targetId, { type: 'COMPLETE' });
          }
          break;
          
        // Other effects can be added as needed
      }
    }
  }
  
  private async recalculateGoalProgress(goalId: string): Promise<void> {
    const quests = await this.getQuestsForGoal(goalId);
    if (quests.length === 0) return;
    
    const totalProgress = quests.reduce((sum, q) => sum + q.progress, 0);
    const avgProgress = Math.round(totalProgress / quests.length);
    
    await this.updateGoal(goalId, { progress: avgProgress });
    
    // Check for auto-complete
    if (avgProgress === 100) {
      const goal = await this.getGoal(goalId);
      if (goal && goal.status === 'active') {
        await this.transitionGoalState(goalId, { type: 'COMPLETE' });
      }
    }
  }
  
  private async recalculateQuestProgress(questId: string): Promise<void> {
    const steps = await this.getStepsForQuest(questId);
    if (steps.length === 0) return;
    
    const completedSteps = steps.filter(s => s.status === 'completed').length;
    const progress = Math.round((completedSteps / steps.length) * 100);
    
    await this.updateQuest(questId, { progress });
    
    // Check for auto-complete
    if (progress === 100) {
      const quest = await this.getQuest(questId);
      if (quest && quest.status === 'active') {
        await this.transitionQuestState(questId, { type: 'COMPLETE' });
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let swordStore: SwordStore | null = null;

export function getSwordStore(): SwordStore {
  if (!swordStore) {
    swordStore = new SwordStore();
  }
  return swordStore;
}

/**
 * Reset the singleton instance (for testing).
 * @internal
 */
export function resetSwordStore(): void {
  swordStore = null;
}
