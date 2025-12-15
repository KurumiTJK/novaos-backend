// ═══════════════════════════════════════════════════════════════════════════════
// SWORD TYPES — Goals, Quests, Plans, Sparks (Nova Constitution §2.3)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Sword enables progress through directed action, combining long-term guidance
// with immediate execution.
//
// Hierarchy:
//   Goal → Quest → Step → Spark
//
// - Goal: Long-term desired state (e.g., "Launch my startup")
// - Quest: Milestone toward a goal (e.g., "Complete MVP")
// - Step: Ordered action within a quest (e.g., "Set up database")
// - Spark: Minimal, immediate action (e.g., "Create schema.sql file")
//
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// INTEREST STACK (Constitution §4)
// ─────────────────────────────────────────────────────────────────────────────────

export type InterestLevel = 
  | 'physical_safety'      // 1. Physical safety, mental health, legal safety
  | 'financial_stability'  // 2. Long-term financial stability
  | 'career_capital'       // 3. Career capital and skill development
  | 'reputation'           // 4. Reputation and relationships
  | 'emotional_stability'  // 5. Emotional stability and peace of mind
  | 'comfort';             // 6. Short-term comfort, entertainment

export const INTEREST_PRIORITY: Record<InterestLevel, number> = {
  physical_safety: 1,
  financial_stability: 2,
  career_capital: 3,
  reputation: 4,
  emotional_stability: 5,
  comfort: 6,
};

// ─────────────────────────────────────────────────────────────────────────────────
// GOAL — Long-term desired state
// ─────────────────────────────────────────────────────────────────────────────────

export type GoalStatus = 
  | 'active'       // Currently being pursued
  | 'paused'       // Temporarily on hold
  | 'completed'    // Successfully achieved
  | 'abandoned';   // No longer pursuing

export interface Goal {
  id: string;
  userId: string;
  
  // Core
  title: string;
  description: string;
  desiredOutcome: string;  // What success looks like
  
  // Classification
  interestLevel: InterestLevel;
  tags: string[];
  
  // Status
  status: GoalStatus;
  progress: number;  // 0-100
  
  // Timing
  targetDate?: string;  // ISO date
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  
  // Relations
  questIds: string[];
  
  // Metadata
  motivations: string[];  // Why this matters
  constraints: string[];  // What to avoid
  successCriteria: string[];  // How to measure
}

// ─────────────────────────────────────────────────────────────────────────────────
// QUEST — Milestone toward a goal
// ─────────────────────────────────────────────────────────────────────────────────

export type QuestStatus = 
  | 'not_started'  // Planned but not begun
  | 'active'       // Currently in progress
  | 'blocked'      // Waiting on something
  | 'completed'    // Successfully finished
  | 'skipped';     // Decided not to do

export type QuestPriority = 'critical' | 'high' | 'medium' | 'low';

export interface Quest {
  id: string;
  userId: string;
  goalId: string;
  
  // Core
  title: string;
  description: string;
  outcome: string;  // What completing this achieves
  
  // Status
  status: QuestStatus;
  priority: QuestPriority;
  progress: number;  // 0-100
  
  // Order
  order: number;  // Position in goal's quest sequence
  
  // Timing
  estimatedMinutes?: number;
  targetDate?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  
  // Relations
  stepIds: string[];
  blockedBy?: string[];  // IDs of blocking quests/external factors
  
  // Shield integration
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  riskNotes?: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// STEP — Ordered action within a quest
// ─────────────────────────────────────────────────────────────────────────────────

export type StepStatus = 
  | 'pending'      // Not yet started
  | 'active'       // Currently working on
  | 'completed'    // Done
  | 'skipped';     // Decided to skip

export type StepType = 
  | 'action'       // Something to do
  | 'decision'     // Choice to make
  | 'verification' // Something to check/confirm
  | 'milestone';   // Checkpoint/celebration

export interface Step {
  id: string;
  questId: string;
  
  // Core
  title: string;
  description?: string;
  type: StepType;
  
  // Status
  status: StepStatus;
  order: number;
  
  // Timing
  estimatedMinutes?: number;
  createdAt: string;
  completedAt?: string;
  
  // Spark generation
  sparkPrompt?: string;  // Hint for generating spark
  lastSparkId?: string;
  
  // Completion
  completionNotes?: string;
  verificationRequired: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────
// SPARK — Minimal, immediate action (Constitution §2.3)
// ─────────────────────────────────────────────────────────────────────────────────
//
// "Spark — produces a minimal, low-friction action that creates immediate
// forward motion. Sword exists to convert intention into motion without
// relying on motivation or willpower."
//

export type SparkStatus = 
  | 'suggested'    // Generated, not yet acted on
  | 'accepted'     // User said they'll do it
  | 'completed'    // User confirmed done
  | 'skipped'      // User skipped it
  | 'expired';     // Too old, no longer relevant

export interface Spark {
  id: string;
  userId: string;
  stepId?: string;  // May be generated without a step
  questId?: string;
  
  // Core
  action: string;           // The specific action (imperative, < 100 chars)
  rationale: string;        // Why this action (1-2 sentences)
  estimatedMinutes: number; // Should be small (2-15 min typical)
  
  // Design principles
  frictionLevel: 'minimal' | 'low' | 'medium';  // How easy to start
  reversible: boolean;      // Can it be undone?
  
  // Status
  status: SparkStatus;
  
  // Timing
  createdAt: string;
  expiresAt: string;        // Sparks are time-limited
  completedAt?: string;
  
  // Follow-up
  nextSparkHint?: string;   // What might come next
  completionPrompt?: string; // What to ask when done
}

// ─────────────────────────────────────────────────────────────────────────────────
// PATH — The route from current state to desired state
// ─────────────────────────────────────────────────────────────────────────────────
//
// "Path — defines the route from the user's current state to a desired
// future state through ordered milestones and constraints"
//

export interface Path {
  goalId: string;
  
  // Current position
  currentQuestId?: string;
  currentStepId?: string;
  
  // Progress
  completedQuests: number;
  totalQuests: number;
  overallProgress: number;  // 0-100
  
  // Next actions
  nextStep?: Step;
  activeSpark?: Spark;
  
  // Blockers
  blockers: PathBlocker[];
  
  // Timeline
  estimatedCompletionDate?: string;
  daysRemaining?: number;
  onTrack: boolean;
}

export interface PathBlocker {
  type: 'quest_dependency' | 'external' | 'resource' | 'decision';
  description: string;
  questId?: string;
  suggestedAction?: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CREATE/UPDATE REQUESTS
// ─────────────────────────────────────────────────────────────────────────────────

export interface CreateGoalRequest {
  title: string;
  description: string;
  desiredOutcome: string;
  interestLevel?: InterestLevel;
  targetDate?: string;
  motivations?: string[];
  constraints?: string[];
  successCriteria?: string[];
  tags?: string[];
}

export interface CreateQuestRequest {
  goalId: string;
  title: string;
  description: string;
  outcome: string;
  priority?: QuestPriority;
  estimatedMinutes?: number;
  targetDate?: string;
  order?: number;
}

export interface CreateStepRequest {
  questId: string;
  title: string;
  description?: string;
  type?: StepType;
  estimatedMinutes?: number;
  sparkPrompt?: string;
  verificationRequired?: boolean;
  order?: number;
}

export interface GenerateSparkRequest {
  stepId?: string;
  questId?: string;
  goalId?: string;
  context?: string;  // Additional context for generation
  maxMinutes?: number;
  frictionLevel?: 'minimal' | 'low' | 'medium';
}

// ─────────────────────────────────────────────────────────────────────────────────
// EVENTS (for state machine)
// ─────────────────────────────────────────────────────────────────────────────────

export type GoalEvent = 
  | { type: 'START' }
  | { type: 'PAUSE'; reason?: string }
  | { type: 'RESUME' }
  | { type: 'COMPLETE' }
  | { type: 'ABANDON'; reason: string }
  | { type: 'UPDATE_PROGRESS'; progress: number };

export type QuestEvent = 
  | { type: 'START' }
  | { type: 'BLOCK'; reason: string; blockedBy?: string[] }
  | { type: 'UNBLOCK' }
  | { type: 'COMPLETE' }
  | { type: 'SKIP'; reason: string }
  | { type: 'UPDATE_PROGRESS'; progress: number };

export type StepEvent = 
  | { type: 'START' }
  | { type: 'COMPLETE'; notes?: string }
  | { type: 'SKIP'; reason?: string };

export type SparkEvent = 
  | { type: 'ACCEPT' }
  | { type: 'COMPLETE' }
  | { type: 'SKIP'; reason?: string }
  | { type: 'EXPIRE' };
