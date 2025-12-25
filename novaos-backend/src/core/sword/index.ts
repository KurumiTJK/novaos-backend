// ═══════════════════════════════════════════════════════════════════════════════
// SWORD MODULE — Path/Spark Engine (Nova Constitution §2.3)
// ═══════════════════════════════════════════════════════════════════════════════
//
// "Sword enables progress through directed action, combining long-term
// guidance with immediate execution."
//
// Components:
// - Path: defines the route from current state to desired future state
// - Spark: produces minimal, low-friction action for immediate forward motion
//
// ═══════════════════════════════════════════════════════════════════════════════

// Types
export type {
  InterestLevel,
  GoalStatus,
  Goal,
  QuestStatus,
  QuestPriority,
  Quest,
  StepStatus,
  StepType,
  Step,
  SparkStatus,
  Spark,
  Path,
  PathBlocker,
  CreateGoalRequest,
  CreateQuestRequest,
  CreateStepRequest,
  GenerateSparkRequest,
  GoalEvent,
  QuestEvent,
  StepEvent,
  SparkEvent,
} from './types.js';

export { INTEREST_PRIORITY } from './types.js';

// State Machine
export {
  transitionGoal,
  transitionQuest,
  transitionStep,
  transitionSpark,
  canTransitionGoal,
  canTransitionQuest,
  canTransitionStep,
  canTransitionSpark,
  getAvailableGoalTransitions,
  getAvailableQuestTransitions,
  getAvailableStepTransitions,
  getAvailableSparkTransitions,
  type TransitionResult,
  type SideEffect,
} from './state-machine.js';

// Store
export {
  SwordStore,
  getSwordStore,
  resetSwordStore,
} from './store.js';

// Spark Generator
export {
  SparkGenerator,
  getSparkGenerator,
  createSparkGenerator,
} from './spark-generator.js';
