// ═══════════════════════════════════════════════════════════════════════════════
// SWORD STATE MACHINE — Lifecycle Management for Goals, Quests, Steps, Sparks
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  Goal, GoalStatus, GoalEvent,
  Quest, QuestStatus, QuestEvent,
  Step, StepStatus, StepEvent,
  Spark, SparkStatus, SparkEvent,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// STATE TRANSITION RESULT
// ─────────────────────────────────────────────────────────────────────────────────

export interface TransitionResult<T> {
  success: boolean;
  entity: T;
  previousStatus: string;
  newStatus: string;
  error?: string;
  sideEffects?: SideEffect[];
}

export interface SideEffect {
  type: 'update_progress' | 'cascade_complete' | 'generate_spark' | 'notify';
  target: 'goal' | 'quest' | 'step' | 'spark';
  targetId: string;
  action: string;
  data?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────────
// GOAL STATE MACHINE
// ─────────────────────────────────────────────────────────────────────────────────
//
// States: active → paused → active (or) → completed/abandoned
//
// Transitions:
//   active + PAUSE → paused
//   active + COMPLETE → completed
//   active + ABANDON → abandoned
//   paused + RESUME → active
//   paused + ABANDON → abandoned
//

const GOAL_TRANSITIONS: Record<GoalStatus, Partial<Record<GoalEvent['type'], GoalStatus>>> = {
  active: {
    PAUSE: 'paused',
    COMPLETE: 'completed',
    ABANDON: 'abandoned',
  },
  paused: {
    RESUME: 'active',
    ABANDON: 'abandoned',
  },
  completed: {},  // Terminal state
  abandoned: {},  // Terminal state
};

export function transitionGoal(goal: Goal, event: GoalEvent): TransitionResult<Goal> {
  // UPDATE_PROGRESS is special - it doesn't change status but may trigger auto-complete
  if (event.type === 'UPDATE_PROGRESS' && 'progress' in event) {
    const newProgress = Math.min(100, Math.max(0, event.progress));
    const autoComplete = newProgress === 100 && goal.status === 'active';
    
    const updatedGoal: Goal = {
      ...goal,
      progress: newProgress,
      status: autoComplete ? 'completed' : goal.status,
      updatedAt: new Date().toISOString(),
      completedAt: autoComplete ? new Date().toISOString() : goal.completedAt,
    };
    
    return {
      success: true,
      entity: updatedGoal,
      previousStatus: goal.status,
      newStatus: updatedGoal.status,
    };
  }
  
  const transitions = GOAL_TRANSITIONS[goal.status];
  const newStatus = transitions[event.type];
  
  if (!newStatus) {
    return {
      success: false,
      entity: goal,
      previousStatus: goal.status,
      newStatus: goal.status,
      error: `Invalid transition: ${goal.status} + ${event.type}`,
    };
  }
  
  const sideEffects: SideEffect[] = [];
  const updatedGoal: Goal = {
    ...goal,
    status: newStatus,
    updatedAt: new Date().toISOString(),
  };
  
  // Handle specific events
  if (event.type === 'COMPLETE') {
    updatedGoal.completedAt = new Date().toISOString();
    updatedGoal.progress = 100;
  }
  
  return {
    success: true,
    entity: updatedGoal,
    previousStatus: goal.status,
    newStatus: updatedGoal.status,
    sideEffects,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// QUEST STATE MACHINE
// ─────────────────────────────────────────────────────────────────────────────────
//
// States: not_started → active → blocked → active (or) → completed/skipped
//
// Transitions:
//   not_started + START → active
//   active + BLOCK → blocked
//   active + COMPLETE → completed
//   active + SKIP → skipped
//   blocked + UNBLOCK → active
//   blocked + SKIP → skipped
//

const QUEST_TRANSITIONS: Record<QuestStatus, Partial<Record<QuestEvent['type'], QuestStatus>>> = {
  not_started: {
    START: 'active',
    SKIP: 'skipped',
  },
  active: {
    BLOCK: 'blocked',
    COMPLETE: 'completed',
    SKIP: 'skipped',
  },
  blocked: {
    UNBLOCK: 'active',
    SKIP: 'skipped',
  },
  completed: {},  // Terminal state
  skipped: {},    // Terminal state
};

export function transitionQuest(quest: Quest, event: QuestEvent): TransitionResult<Quest> {
  // UPDATE_PROGRESS doesn't change status
  if (event.type === 'UPDATE_PROGRESS') {
    const updatedQuest: Quest = {
      ...quest,
      progress: Math.min(100, Math.max(0, event.progress)),
      updatedAt: new Date().toISOString(),
    };
    
    return {
      success: true,
      entity: updatedQuest,
      previousStatus: quest.status,
      newStatus: quest.status,
    };
  }
  
  const transitions = QUEST_TRANSITIONS[quest.status];
  const newStatus = transitions[event.type];
  
  if (!newStatus) {
    return {
      success: false,
      entity: quest,
      previousStatus: quest.status,
      newStatus: quest.status,
      error: `Invalid transition: ${quest.status} + ${event.type}`,
    };
  }
  
  const sideEffects: SideEffect[] = [];
  const updatedQuest: Quest = {
    ...quest,
    status: newStatus,
    updatedAt: new Date().toISOString(),
  };
  
  // Handle specific events
  if (event.type === 'START') {
    updatedQuest.startedAt = new Date().toISOString();
  }
  
  if (event.type === 'COMPLETE') {
    updatedQuest.completedAt = new Date().toISOString();
    updatedQuest.progress = 100;
    
    // Side effect: update parent goal progress
    sideEffects.push({
      type: 'update_progress',
      target: 'goal',
      targetId: quest.goalId,
      action: 'recalculate',
    });
  }
  
  if (event.type === 'BLOCK' && 'reason' in event) {
    updatedQuest.riskNotes = event.reason;
    if ('blockedBy' in event && event.blockedBy) {
      updatedQuest.blockedBy = event.blockedBy;
    }
  }
  
  if (event.type === 'UNBLOCK') {
    updatedQuest.blockedBy = undefined;
  }
  
  return {
    success: true,
    entity: updatedQuest,
    previousStatus: quest.status,
    newStatus: updatedQuest.status,
    sideEffects,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// STEP STATE MACHINE
// ─────────────────────────────────────────────────────────────────────────────────
//
// States: pending → active → completed/skipped
//
// Transitions:
//   pending + START → active
//   pending + SKIP → skipped
//   active + COMPLETE → completed
//   active + SKIP → skipped
//

const STEP_TRANSITIONS: Record<StepStatus, Partial<Record<StepEvent['type'], StepStatus>>> = {
  pending: {
    START: 'active',
    SKIP: 'skipped',
  },
  active: {
    COMPLETE: 'completed',
    SKIP: 'skipped',
  },
  completed: {},  // Terminal state
  skipped: {},    // Terminal state
};

export function transitionStep(step: Step, event: StepEvent): TransitionResult<Step> {
  const transitions = STEP_TRANSITIONS[step.status];
  const newStatus = transitions[event.type];
  
  if (!newStatus) {
    return {
      success: false,
      entity: step,
      previousStatus: step.status,
      newStatus: step.status,
      error: `Invalid transition: ${step.status} + ${event.type}`,
    };
  }
  
  const sideEffects: SideEffect[] = [];
  const updatedStep: Step = {
    ...step,
    status: newStatus,
  };
  
  // Handle specific events
  if (event.type === 'COMPLETE') {
    updatedStep.completedAt = new Date().toISOString();
    if ('notes' in event && event.notes) {
      updatedStep.completionNotes = event.notes;
    }
    
    // Side effect: update parent quest progress
    sideEffects.push({
      type: 'update_progress',
      target: 'quest',
      targetId: step.questId,
      action: 'recalculate',
    });
    
    // Side effect: potentially generate next spark
    sideEffects.push({
      type: 'generate_spark',
      target: 'quest',
      targetId: step.questId,
      action: 'next_step',
    });
  }
  
  return {
    success: true,
    entity: updatedStep,
    previousStatus: step.status,
    newStatus: updatedStep.status,
    sideEffects,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// SPARK STATE MACHINE
// ─────────────────────────────────────────────────────────────────────────────────
//
// States: suggested → accepted → completed/skipped (or) → expired
//
// Transitions:
//   suggested + ACCEPT → accepted
//   suggested + SKIP → skipped
//   suggested + EXPIRE → expired
//   accepted + COMPLETE → completed
//   accepted + SKIP → skipped
//   accepted + EXPIRE → expired
//

const SPARK_TRANSITIONS: Record<SparkStatus, Partial<Record<SparkEvent['type'], SparkStatus>>> = {
  suggested: {
    ACCEPT: 'accepted',
    SKIP: 'skipped',
    EXPIRE: 'expired',
  },
  accepted: {
    COMPLETE: 'completed',
    SKIP: 'skipped',
    EXPIRE: 'expired',
  },
  completed: {},  // Terminal state
  skipped: {},    // Terminal state
  expired: {},    // Terminal state
};

export function transitionSpark(spark: Spark, event: SparkEvent): TransitionResult<Spark> {
  const transitions = SPARK_TRANSITIONS[spark.status];
  const newStatus = transitions[event.type];
  
  if (!newStatus) {
    return {
      success: false,
      entity: spark,
      previousStatus: spark.status,
      newStatus: spark.status,
      error: `Invalid transition: ${spark.status} + ${event.type}`,
    };
  }
  
  const sideEffects: SideEffect[] = [];
  const updatedSpark: Spark = {
    ...spark,
    status: newStatus,
  };
  
  // Handle specific events
  if (event.type === 'COMPLETE') {
    updatedSpark.completedAt = new Date().toISOString();
    
    // Side effect: complete parent step if exists
    if (spark.stepId) {
      sideEffects.push({
        type: 'cascade_complete',
        target: 'step',
        targetId: spark.stepId,
        action: 'complete',
      });
    }
  }
  
  return {
    success: true,
    entity: updatedSpark,
    previousStatus: spark.status,
    newStatus: updatedSpark.status,
    sideEffects,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

export function canTransitionGoal(goal: Goal, eventType: GoalEvent['type']): boolean {
  if (eventType === 'UPDATE_PROGRESS') return goal.status === 'active';
  const transitions = GOAL_TRANSITIONS[goal.status];
  return eventType in transitions;
}

export function canTransitionQuest(quest: Quest, eventType: QuestEvent['type']): boolean {
  if (eventType === 'UPDATE_PROGRESS') return true;
  const transitions = QUEST_TRANSITIONS[quest.status];
  return eventType in transitions;
}

export function canTransitionStep(step: Step, eventType: StepEvent['type']): boolean {
  const transitions = STEP_TRANSITIONS[step.status];
  return eventType in transitions;
}

export function canTransitionSpark(spark: Spark, eventType: SparkEvent['type']): boolean {
  const transitions = SPARK_TRANSITIONS[spark.status];
  return eventType in transitions;
}

// ─────────────────────────────────────────────────────────────────────────────────
// AVAILABLE TRANSITIONS
// ─────────────────────────────────────────────────────────────────────────────────

export function getAvailableGoalTransitions(goal: Goal): GoalEvent['type'][] {
  const transitions = Object.keys(GOAL_TRANSITIONS[goal.status]) as GoalEvent['type'][];
  if (goal.status === 'active') {
    return ['UPDATE_PROGRESS', ...transitions];
  }
  return transitions;
}

export function getAvailableQuestTransitions(quest: Quest): QuestEvent['type'][] {
  return ['UPDATE_PROGRESS', ...Object.keys(QUEST_TRANSITIONS[quest.status])] as QuestEvent['type'][];
}

export function getAvailableStepTransitions(step: Step): StepEvent['type'][] {
  return Object.keys(STEP_TRANSITIONS[step.status]) as StepEvent['type'][];
}

export function getAvailableSparkTransitions(spark: Spark): SparkEvent['type'][] {
  return Object.keys(SPARK_TRANSITIONS[spark.status]) as SparkEvent['type'][];
}
