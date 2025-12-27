// ═══════════════════════════════════════════════════════════════════════════════
// EXPLORE TYPES — Goal Crystallization Through Dialogue
// NovaOS Gates — Phase 14A: SwordGate Explore Module
// ═══════════════════════════════════════════════════════════════════════════════
//
// Type definitions for the Explore phase:
//   - ExploreState: Persistent state for exploration conversation
//   - ExploreMessage: Single message in exploration dialogue
//   - ExploreContext: Summary passed to Refine phase
//   - ExploreConfig: Configuration for explore behavior
//
// The Explore phase helps users crystallize vague intentions into concrete,
// actionable learning goals through natural conversation.
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { UserId, Timestamp } from '../../../types/branded.js';

// ═══════════════════════════════════════════════════════════════════════════════
// EXPLORE MESSAGE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A single message in the exploration conversation.
 */
export interface ExploreMessage {
  /** Message author */
  readonly role: 'user' | 'assistant';

  /** Message content */
  readonly content: string;

  /** When the message was sent */
  readonly timestamp: Timestamp;

  /** Optional: What the assistant was trying to do */
  readonly intent?: ExploreAssistantIntent;
}

/**
 * What the assistant is trying to accomplish with a message.
 * Used for conversation flow analysis.
 */
export type ExploreAssistantIntent =
  | 'greeting'           // Initial greeting/acknowledgment
  | 'clarifying'         // Asking for clarification
  | 'exploring'          // Exploring interests/motivations
  | 'narrowing'          // Helping narrow scope
  | 'reflecting'         // Reflecting back understanding
  | 'proposing'          // Proposing a crystallized goal
  | 'confirming'         // Confirming user's choice
  | 'transitioning';     // Transitioning to refine phase

// ═══════════════════════════════════════════════════════════════════════════════
// EXPLORE STATE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Persistent state for an exploration session.
 *
 * Tracks the conversation and emerging understanding of what the user
 * wants to learn, building toward a crystallized goal statement.
 */
export interface ExploreState {
  /** User ID */
  readonly userId: UserId;

  // ─────────────────────────────────────────────────────────────────────────────
  // Conversation Tracking
  // ─────────────────────────────────────────────────────────────────────────────

  /** Original statement that started exploration */
  readonly initialStatement: string;

  /** Conversation history for context */
  readonly conversationHistory: readonly ExploreMessage[];

  /** Running summary of what we've learned (LLM-maintained) */
  readonly conversationSummary: string;

  // ─────────────────────────────────────────────────────────────────────────────
  // Emerging Understanding
  // ─────────────────────────────────────────────────────────────────────────────

  /** Interests the user has expressed */
  readonly interests: readonly string[];

  /** Things the user has ruled out or doesn't want */
  readonly constraints: readonly string[];

  /** Background/context shared by user (experience, job, projects) */
  readonly background: readonly string[];

  /** Motivations (career, curiosity, project, certification, etc.) */
  readonly motivations: readonly string[];

  // ─────────────────────────────────────────────────────────────────────────────
  // Goal Crystallization
  // ─────────────────────────────────────────────────────────────────────────────

  /** Candidate goal statements we've reflected back to user */
  readonly candidateGoals: readonly string[];

  /** Final crystallized goal (set when user confirms) */
  readonly crystallizedGoal?: string;

  /** Confidence that goal is clear enough to proceed (0-1) */
  readonly clarityScore: number;

  // ─────────────────────────────────────────────────────────────────────────────
  // Flow Control
  // ─────────────────────────────────────────────────────────────────────────────

  /** Current stage of exploration */
  readonly stage: ExploreStage;

  /** Number of conversation turns */
  readonly turnCount: number;

  /** Maximum allowed turns before forced transition */
  readonly maxTurns: number;

  // ─────────────────────────────────────────────────────────────────────────────
  // Timestamps
  // ─────────────────────────────────────────────────────────────────────────────

  /** When exploration started */
  readonly createdAt: Timestamp;

  /** Last activity */
  readonly updatedAt: Timestamp;

  /** When this session expires (longer TTL than refine) */
  readonly expiresAt: Timestamp;
}

/**
 * Exploration stage.
 */
export type ExploreStage =
  | 'exploring'    // Active exploration conversation
  | 'proposing'    // Proposed a crystallized goal, awaiting confirmation
  | 'confirmed'    // User confirmed, ready to transition
  | 'skipped'      // User requested skip
  | 'expired';     // Timed out or max turns reached

// ═══════════════════════════════════════════════════════════════════════════════
// EXPLORE CONTEXT (Output to Refine)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Context passed from Explore to Refine phase.
 *
 * This captures the insights gained during exploration so the
 * Refine phase can use them for better recommendations.
 */
export interface ExploreContext {
  /** Original vague statement before crystallization */
  readonly originalStatement: string;

  /** The crystallized goal statement */
  readonly crystallizedGoal: string;

  /** User's expressed interests */
  readonly interests: readonly string[];

  /** Things ruled out */
  readonly constraints: readonly string[];

  /** Background shared (experience, context) */
  readonly background: readonly string[];

  /** Motivations (why they want to learn) */
  readonly motivations: readonly string[];

  /** Summary of the exploration conversation */
  readonly summary: string;

  /** How many turns it took to crystallize */
  readonly turnsToClarity: number;

  /** Final clarity score when confirmed */
  readonly clarityScore: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Configuration for explore behavior.
 */
export interface ExploreConfig {
  /** Maximum turns before forcing transition (default: 12) */
  readonly maxTurns: number;

  /** Clarity threshold to auto-propose goal (default: 0.8) */
  readonly clarityThreshold: number;

  /** Minimum turns before allowing auto-transition (default: 2) */
  readonly minTurnsBeforeTransition: number;

  /** TTL for explore state in seconds (default: 7200 = 2 hours) */
  readonly exploreTtlSeconds: number;

  /** Whether to use LLM for clarity detection (default: true) */
  readonly useLlmClarityDetection: boolean;

  /** OpenAI model for exploration (default: gpt-4o-mini) */
  readonly llmModel: string;

  /** Temperature for exploration responses (default: 0.7) */
  readonly llmTemperature: number;
}

/**
 * Default explore configuration.
 */
export const DEFAULT_EXPLORE_CONFIG: ExploreConfig = {
  maxTurns: 12,
  clarityThreshold: 0.8,
  minTurnsBeforeTransition: 2,
  exploreTtlSeconds: 2 * 60 * 60, // 2 hours
  useLlmClarityDetection: true,
  llmModel: 'gpt-4o-mini',
  llmTemperature: 0.7,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// CLARITY DETECTION TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Result of clarity detection.
 */
export interface ClarityDetectionResult {
  /** Clarity score (0-1) */
  readonly score: number;

  /** Whether goal is clear enough to proceed */
  readonly isClear: boolean;

  /** Extracted goal statement if clear */
  readonly extractedGoal?: string;

  /** What's still unclear */
  readonly unclearAspects: readonly string[];

  /** Suggested question to ask next */
  readonly suggestedQuestion?: string;

  /** Detection method used */
  readonly method: 'pattern' | 'llm' | 'hybrid';

  /** Reasoning for the score */
  readonly reasoning?: string;
}

/**
 * Signals that indicate goal clarity.
 */
export interface ClaritySignal {
  /** Signal name */
  readonly signal: string;

  /** Weight contribution to clarity score (-1 to 1) */
  readonly weight: number;

  /** Whether signal is present */
  readonly present: boolean;

  /** Evidence for the signal */
  readonly evidence?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPLORE FLOW TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Input to the explore flow.
 */
export interface ExploreFlowInput {
  /** User's message */
  readonly message: string;

  /** Current explore state (null if starting new exploration) */
  readonly currentState: ExploreState | null;

  /** User's timezone (for personalization) */
  readonly timezone?: string;
}

/**
 * Output from the explore flow.
 */
export interface ExploreFlowOutput {
  /** Updated explore state */
  readonly state: ExploreState;

  /** Response message to user */
  readonly response: string;

  /** Whether to transition to refine phase */
  readonly shouldTransition: boolean;

  /** If transitioning, the context to pass */
  readonly transitionContext?: ExploreContext;

  /** Reason for transition (if transitioning) */
  readonly transitionReason?: ExploreTransitionReason;
}

/**
 * Reasons for transitioning out of explore.
 */
export type ExploreTransitionReason =
  | 'goal_confirmed'     // User confirmed a proposed goal
  | 'clarity_threshold'  // Clarity score exceeded threshold
  | 'max_turns'          // Reached maximum turns
  | 'user_skip'          // User requested to skip
  | 'explicit_goal';     // User stated a clear goal directly

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE GUARDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check if a value is a valid ExploreStage.
 */
export function isExploreStage(value: unknown): value is ExploreStage {
  return (
    typeof value === 'string' &&
    ['exploring', 'proposing', 'confirmed', 'skipped', 'expired'].includes(value)
  );
}

/**
 * Check if exploration is in a terminal state.
 */
export function isExploreTerminal(stage: ExploreStage): boolean {
  return stage === 'confirmed' || stage === 'skipped' || stage === 'expired';
}

/**
 * Check if exploration can accept more input.
 */
export function canContinueExploring(state: ExploreState): boolean {
  return (
    !isExploreTerminal(state.stage) &&
    state.turnCount < state.maxTurns &&
    new Date(state.expiresAt).getTime() > Date.now()
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create an empty ExploreContext (for when explore is skipped).
 */
export function createEmptyExploreContext(goalStatement: string): ExploreContext {
  return {
    originalStatement: goalStatement,
    crystallizedGoal: goalStatement,
    interests: [],
    constraints: [],
    background: [],
    motivations: [],
    summary: 'Exploration skipped - user provided clear goal.',
    turnsToClarity: 0,
    clarityScore: 1.0,
  };
}

/**
 * Build ExploreContext from completed ExploreState.
 */
export function buildExploreContext(state: ExploreState): ExploreContext {
  return {
    originalStatement: state.initialStatement,
    crystallizedGoal: state.crystallizedGoal ?? state.initialStatement,
    interests: state.interests,
    constraints: state.constraints,
    background: state.background,
    motivations: state.motivations,
    summary: state.conversationSummary,
    turnsToClarity: state.turnCount,
    clarityScore: state.clarityScore,
  };
}
