// ═══════════════════════════════════════════════════════════════════════════════
// EXPLORE STORE — Exploration State Persistence
// NovaOS Gates — Phase 14A: SwordGate Explore Module
// ═══════════════════════════════════════════════════════════════════════════════
//
// Adapter layer for ExploreState persistence using the base RefinementStore.
//
// Follows the same pattern as SwordRefinementStore:
//   - Wraps IRefinementStore for actual Redis operations
//   - Converts ExploreState ↔ RefinementState
//   - Uses meta keys (_explore_ prefix) for typed fields
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { UserId, Timestamp } from '../../../types/branded.js';
import { createTimestamp } from '../../../types/branded.js';
import type { AsyncAppResult } from '../../../types/result.js';
import { ok, err, appError } from '../../../types/result.js';

import type { RefinementState, IRefinementStore } from '../../../services/spark-engine/store/types.js';

import type {
  ExploreState,
  ExploreStage,
  ExploreMessage,
  ExploreConfig,
  ExploreContext,
} from './types.js';
import { DEFAULT_EXPLORE_CONFIG, buildExploreContext } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Keys used in the generic inputs record for Explore-specific data.
 * Prefixed with _explore_ to avoid collision with SwordGate keys.
 */
const EXPLORE_META_KEYS = {
  INITIAL_STATEMENT: '_explore_initialStatement',
  CONVERSATION_HISTORY: '_explore_conversationHistory',
  CONVERSATION_SUMMARY: '_explore_conversationSummary',
  INTERESTS: '_explore_interests',
  CONSTRAINTS: '_explore_constraints',
  BACKGROUND: '_explore_background',
  MOTIVATIONS: '_explore_motivations',
  CANDIDATE_GOALS: '_explore_candidateGoals',
  CRYSTALLIZED_GOAL: '_explore_crystallizedGoal',
  CLARITY_SCORE: '_explore_clarityScore',
  EXPLORE_STAGE: '_explore_stage',
  TURN_COUNT: '_explore_turnCount',
  MAX_TURNS: '_explore_maxTurns',
} as const;

/**
 * Stage mapping between ExploreStage and RefinementState stage.
 * We use 'initial' for exploring, 'clarifying' for proposing, 'complete' for terminal.
 */
function mapExploreStageToBase(stage: ExploreStage): RefinementState['stage'] {
  switch (stage) {
    case 'exploring':
      return 'initial';
    case 'proposing':
      return 'clarifying';
    case 'confirmed':
    case 'skipped':
    case 'expired':
      return 'complete';
    default:
      return 'initial';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONVERSION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convert ExploreState to base RefinementState for storage.
 */
function toBaseState(state: ExploreState): RefinementState {
  const inputs: Record<string, unknown> = {
    [EXPLORE_META_KEYS.INITIAL_STATEMENT]: state.initialStatement,
    [EXPLORE_META_KEYS.CONVERSATION_HISTORY]: state.conversationHistory,
    [EXPLORE_META_KEYS.CONVERSATION_SUMMARY]: state.conversationSummary,
    [EXPLORE_META_KEYS.INTERESTS]: state.interests,
    [EXPLORE_META_KEYS.CONSTRAINTS]: state.constraints,
    [EXPLORE_META_KEYS.BACKGROUND]: state.background,
    [EXPLORE_META_KEYS.MOTIVATIONS]: state.motivations,
    [EXPLORE_META_KEYS.CANDIDATE_GOALS]: state.candidateGoals,
    [EXPLORE_META_KEYS.CLARITY_SCORE]: state.clarityScore,
    [EXPLORE_META_KEYS.EXPLORE_STAGE]: state.stage,
    [EXPLORE_META_KEYS.TURN_COUNT]: state.turnCount,
    [EXPLORE_META_KEYS.MAX_TURNS]: state.maxTurns,
  };

  if (state.crystallizedGoal) {
    inputs[EXPLORE_META_KEYS.CRYSTALLIZED_GOAL] = state.crystallizedGoal;
  }

  return {
    userId: state.userId,
    goalId: undefined,
    stage: mapExploreStageToBase(state.stage),
    inputs,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    expiresAt: state.expiresAt,
  };
}

/**
 * Convert base RefinementState to ExploreState.
 */
function fromBaseState(base: RefinementState): ExploreState {
  const inputs = base.inputs;

  return {
    userId: base.userId,
    initialStatement: (inputs[EXPLORE_META_KEYS.INITIAL_STATEMENT] as string) ?? '',
    conversationHistory: (inputs[EXPLORE_META_KEYS.CONVERSATION_HISTORY] as ExploreMessage[]) ?? [],
    conversationSummary: (inputs[EXPLORE_META_KEYS.CONVERSATION_SUMMARY] as string) ?? '',
    interests: (inputs[EXPLORE_META_KEYS.INTERESTS] as string[]) ?? [],
    constraints: (inputs[EXPLORE_META_KEYS.CONSTRAINTS] as string[]) ?? [],
    background: (inputs[EXPLORE_META_KEYS.BACKGROUND] as string[]) ?? [],
    motivations: (inputs[EXPLORE_META_KEYS.MOTIVATIONS] as string[]) ?? [],
    candidateGoals: (inputs[EXPLORE_META_KEYS.CANDIDATE_GOALS] as string[]) ?? [],
    crystallizedGoal: inputs[EXPLORE_META_KEYS.CRYSTALLIZED_GOAL] as string | undefined,
    clarityScore: (inputs[EXPLORE_META_KEYS.CLARITY_SCORE] as number) ?? 0,
    stage: (inputs[EXPLORE_META_KEYS.EXPLORE_STAGE] as ExploreStage) ?? 'exploring',
    turnCount: (inputs[EXPLORE_META_KEYS.TURN_COUNT] as number) ?? 0,
    maxTurns: (inputs[EXPLORE_META_KEYS.MAX_TURNS] as number) ?? DEFAULT_EXPLORE_CONFIG.maxTurns,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    expiresAt: base.expiresAt,
  };
}

/**
 * Check if a RefinementState is an ExploreState (vs SwordRefinementState).
 */
function isExploreState(base: RefinementState): boolean {
  return EXPLORE_META_KEYS.INITIAL_STATEMENT in base.inputs;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPLORE STORE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Explore-specific state storage.
 *
 * Wraps the base RefinementStore with typed access to ExploreState.
 * Uses a separate key namespace (_explore_ prefix) to coexist with SwordRefinementState.
 */
export class ExploreStore {
  private readonly baseStore: IRefinementStore;
  private readonly config: ExploreConfig;

  constructor(baseStore: IRefinementStore, config: Partial<ExploreConfig> = {}) {
    this.baseStore = baseStore;
    this.config = { ...DEFAULT_EXPLORE_CONFIG, ...config };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CRUD OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a new exploration session.
   */
  async create(
    userId: UserId,
    initialStatement: string
  ): AsyncAppResult<ExploreState> {
    const now = createTimestamp();
    const expiresAt = createTimestamp(
      new Date(Date.now() + this.config.exploreTtlSeconds * 1000)
    );

    const state: ExploreState = {
      userId,
      initialStatement,
      conversationHistory: [],
      conversationSummary: '',
      interests: [],
      constraints: [],
      background: [],
      motivations: [],
      candidateGoals: [],
      crystallizedGoal: undefined,
      clarityScore: 0,
      stage: 'exploring',
      turnCount: 0,
      maxTurns: this.config.maxTurns,
      createdAt: now,
      updatedAt: now,
      expiresAt,
    };

    return this.save(state);
  }

  /**
   * Save an ExploreState.
   */
  async save(state: ExploreState): AsyncAppResult<ExploreState> {
    const baseState = toBaseState(state);
    const result = await this.baseStore.save(baseState);

    if (!result.ok) {
      return result;
    }

    return ok(fromBaseState(result.value));
  }

  /**
   * Get the current exploration state for a user.
   * Returns null if no active exploration exists or if it's a SwordRefinementState.
   */
  async get(userId: UserId): AsyncAppResult<ExploreState | null> {
    const result = await this.baseStore.get(userId);

    if (!result.ok) {
      return result;
    }

    if (result.value === null) {
      return ok(null);
    }

    // Check if this is actually an ExploreState
    if (!isExploreState(result.value)) {
      return ok(null);
    }

    return ok(fromBaseState(result.value));
  }

  /**
   * Delete the exploration state for a user.
   */
  async delete(userId: UserId): AsyncAppResult<boolean> {
    // Only delete if it's an explore state
    const existing = await this.get(userId);
    if (!existing.ok) {
      return existing;
    }
    if (existing.value === null) {
      return ok(false);
    }

    return this.baseStore.delete(userId);
  }

  /**
   * Update specific fields of the exploration state.
   */
  async update(
    userId: UserId,
    updates: Partial<ExploreState>
  ): AsyncAppResult<ExploreState> {
    const currentResult = await this.get(userId);
    if (!currentResult.ok) {
      return currentResult;
    }

    if (currentResult.value === null) {
      return err(appError('NOT_FOUND', 'No active exploration session'));
    }

    const current = currentResult.value;
    const updated: ExploreState = {
      ...current,
      ...updates,
      // Preserve arrays by spreading if provided
      conversationHistory: updates.conversationHistory ?? current.conversationHistory,
      interests: updates.interests ?? current.interests,
      constraints: updates.constraints ?? current.constraints,
      background: updates.background ?? current.background,
      motivations: updates.motivations ?? current.motivations,
      candidateGoals: updates.candidateGoals ?? current.candidateGoals,
      updatedAt: createTimestamp(),
    };

    return this.save(updated);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MESSAGE MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Add a message to the conversation history.
   */
  async addMessage(
    userId: UserId,
    message: ExploreMessage
  ): AsyncAppResult<ExploreState> {
    const currentResult = await this.get(userId);
    if (!currentResult.ok) {
      return currentResult;
    }

    if (currentResult.value === null) {
      return err(appError('NOT_FOUND', 'No active exploration session'));
    }

    const current = currentResult.value;
    const newHistory = [...current.conversationHistory, message];

    // Increment turn count only for user messages
    const newTurnCount = message.role === 'user'
      ? current.turnCount + 1
      : current.turnCount;

    return this.update(userId, {
      conversationHistory: newHistory,
      turnCount: newTurnCount,
    });
  }

  /**
   * Add both user and assistant messages in one operation.
   */
  async addExchange(
    userId: UserId,
    userMessage: string,
    assistantMessage: string,
    assistantIntent?: ExploreMessage['intent']
  ): AsyncAppResult<ExploreState> {
    const now = createTimestamp();

    const currentResult = await this.get(userId);
    if (!currentResult.ok) {
      return currentResult;
    }

    if (currentResult.value === null) {
      return err(appError('NOT_FOUND', 'No active exploration session'));
    }

    const current = currentResult.value;
    const newHistory: ExploreMessage[] = [
      ...current.conversationHistory,
      { role: 'user', content: userMessage, timestamp: now },
      { role: 'assistant', content: assistantMessage, timestamp: now, intent: assistantIntent },
    ];

    return this.update(userId, {
      conversationHistory: newHistory,
      turnCount: current.turnCount + 1,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // INSIGHT ACCUMULATION
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Add new interests discovered during conversation.
   */
  async addInterests(userId: UserId, newInterests: string[]): AsyncAppResult<ExploreState> {
    const currentResult = await this.get(userId);
    if (!currentResult.ok) return currentResult;
    if (currentResult.value === null) {
      return err(appError('NOT_FOUND', 'No active exploration session'));
    }

    const current = currentResult.value;
    const combined = [...new Set([...current.interests, ...newInterests])];
    return this.update(userId, { interests: combined });
  }

  /**
   * Add new constraints (things ruled out).
   */
  async addConstraints(userId: UserId, newConstraints: string[]): AsyncAppResult<ExploreState> {
    const currentResult = await this.get(userId);
    if (!currentResult.ok) return currentResult;
    if (currentResult.value === null) {
      return err(appError('NOT_FOUND', 'No active exploration session'));
    }

    const current = currentResult.value;
    const combined = [...new Set([...current.constraints, ...newConstraints])];
    return this.update(userId, { constraints: combined });
  }

  /**
   * Add background information.
   */
  async addBackground(userId: UserId, newBackground: string[]): AsyncAppResult<ExploreState> {
    const currentResult = await this.get(userId);
    if (!currentResult.ok) return currentResult;
    if (currentResult.value === null) {
      return err(appError('NOT_FOUND', 'No active exploration session'));
    }

    const current = currentResult.value;
    const combined = [...new Set([...current.background, ...newBackground])];
    return this.update(userId, { background: combined });
  }

  /**
   * Add motivations.
   */
  async addMotivations(userId: UserId, newMotivations: string[]): AsyncAppResult<ExploreState> {
    const currentResult = await this.get(userId);
    if (!currentResult.ok) return currentResult;
    if (currentResult.value === null) {
      return err(appError('NOT_FOUND', 'No active exploration session'));
    }

    const current = currentResult.value;
    const combined = [...new Set([...current.motivations, ...newMotivations])];
    return this.update(userId, { motivations: combined });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GOAL CRYSTALLIZATION
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Add a candidate goal that was proposed to the user.
   */
  async addCandidateGoal(userId: UserId, goal: string): AsyncAppResult<ExploreState> {
    const currentResult = await this.get(userId);
    if (!currentResult.ok) return currentResult;
    if (currentResult.value === null) {
      return err(appError('NOT_FOUND', 'No active exploration session'));
    }

    const current = currentResult.value;
    const candidates = [...current.candidateGoals, goal];
    return this.update(userId, {
      candidateGoals: candidates,
      stage: 'proposing',
    });
  }

  /**
   * Crystallize the final goal (user confirmed).
   */
  async crystallizeGoal(userId: UserId, goal: string): AsyncAppResult<ExploreState> {
    return this.update(userId, {
      crystallizedGoal: goal,
      stage: 'confirmed',
      clarityScore: 1.0,
    });
  }

  /**
   * Update clarity score and summary.
   */
  async updateClarity(
    userId: UserId,
    score: number,
    summary: string
  ): AsyncAppResult<ExploreState> {
    return this.update(userId, {
      clarityScore: Math.max(0, Math.min(1, score)),
      conversationSummary: summary,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE TRANSITIONS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Mark exploration as skipped (user wants to proceed without exploring).
   */
  async skip(userId: UserId): AsyncAppResult<ExploreState> {
    return this.update(userId, { stage: 'skipped' });
  }

  /**
   * Mark exploration as expired.
   */
  async expire(userId: UserId): AsyncAppResult<ExploreState> {
    return this.update(userId, { stage: 'expired' });
  }

  /**
   * Transition back to exploring (user didn't confirm proposal).
   */
  async continueExploring(userId: UserId): AsyncAppResult<ExploreState> {
    return this.update(userId, { stage: 'exploring' });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // QUERIES
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Check if a user has an active exploration session.
   */
  async hasActiveExploration(userId: UserId): AsyncAppResult<boolean> {
    const result = await this.get(userId);
    if (!result.ok) return result;

    const state = result.value;
    if (state === null) return ok(false);

    // Active if not in terminal state and not expired
    return ok(
      state.stage !== 'confirmed' &&
      state.stage !== 'skipped' &&
      state.stage !== 'expired' &&
      !this.isExpired(state)
    );
  }

  /**
   * Get ExploreContext for transition to refine phase.
   */
  async getContext(userId: UserId): AsyncAppResult<ExploreContext | null> {
    const result = await this.get(userId);
    if (!result.ok) return result;
    if (result.value === null) return ok(null);

    return ok(buildExploreContext(result.value));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // EXPIRATION
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Check if an exploration is expired.
   */
  isExpired(state: ExploreState): boolean {
    return new Date(state.expiresAt).getTime() < Date.now();
  }

  /**
   * Check if max turns have been exceeded.
   */
  isMaxTurnsExceeded(state: ExploreState): boolean {
    return state.turnCount >= state.maxTurns;
  }

  /**
   * Extend the expiration time.
   */
  async extendExpiration(userId: UserId): AsyncAppResult<ExploreState> {
    const newExpiresAt = createTimestamp(
      new Date(Date.now() + this.config.exploreTtlSeconds * 1000)
    );
    return this.update(userId, { expiresAt: newExpiresAt });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create an ExploreStore instance.
 */
export function createExploreStore(
  baseStore: IRefinementStore,
  config?: Partial<ExploreConfig>
): ExploreStore {
  return new ExploreStore(baseStore, config);
}
