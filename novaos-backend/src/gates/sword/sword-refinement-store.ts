// ═══════════════════════════════════════════════════════════════════════════════
// SWORD REFINEMENT STORE — SwordGate State Persistence
// NovaOS Gates — Phase 13: SwordGate Integration
// ═══════════════════════════════════════════════════════════════════════════════
//
// Adapter layer between SwordGate's typed refinement state and the
// Phase 12 RefinementStore infrastructure.
//
// Responsibilities:
//   - Convert SwordRefinementState ↔ RefinementState
//   - Provide typed access to SwordRefinementInputs
//   - Manage refinement lifecycle (create, update, complete, expire)
//   - Track answered questions and turn counts
//
// Uses the existing RefinementStore for actual persistence.
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { UserId, GoalId, Timestamp } from '../../types/branded.js';
import { createTimestamp } from '../../types/branded.js';
import type { AsyncAppResult, AppError } from '../../types/result.js';
import { ok, err, appError } from '../../types/result.js';

import type { RefinementState, IRefinementStore } from '../../services/spark-engine/store/types.js';
import type { LessonPlanProposal } from './types.js';
import type {
  SwordRefinementState,
  SwordRefinementInputs,
  SwordGateConfig,
  RefinementField,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Keys used in the generic inputs record for SwordGate-specific data.
 */
const SWORD_META_KEYS = {
  CURRENT_QUESTION: '_sword_currentQuestion',
  ANSWERED_QUESTIONS: '_sword_answeredQuestions',
  TURN_COUNT: '_sword_turnCount',
  MAX_TURNS: '_sword_maxTurns',
  LAST_PROPOSED_PLAN: '_sword_lastProposedPlan',
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// CONVERSION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convert SwordRefinementState to base RefinementState for storage.
 */
function toBaseState(state: SwordRefinementState): RefinementState {
  // Merge typed inputs with metadata
  const inputs: Record<string, unknown> = {
    ...state.inputs,
    [SWORD_META_KEYS.CURRENT_QUESTION]: state.currentQuestion,
    [SWORD_META_KEYS.ANSWERED_QUESTIONS]: state.answeredQuestions,
    [SWORD_META_KEYS.TURN_COUNT]: state.turnCount,
    [SWORD_META_KEYS.MAX_TURNS]: state.maxTurns,
  };

  // Store proposed plan if present
  if (state.lastProposedPlan) {
    inputs[SWORD_META_KEYS.LAST_PROPOSED_PLAN] = state.lastProposedPlan;
  }

  return {
    userId: state.userId,
    goalId: state.goalId,
    stage: state.stage,
    inputs,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    expiresAt: state.expiresAt,
  };
}

/**
 * Convert base RefinementState to SwordRefinementState.
 */
function fromBaseState(base: RefinementState): SwordRefinementState {
  const inputs = base.inputs;

  // Extract SwordGate metadata
  const currentQuestion = inputs[SWORD_META_KEYS.CURRENT_QUESTION] as RefinementField | undefined;
  const answeredQuestions = (inputs[SWORD_META_KEYS.ANSWERED_QUESTIONS] as RefinementField[]) ?? [];
  const turnCount = (inputs[SWORD_META_KEYS.TURN_COUNT] as number) ?? 0;
  const maxTurns = (inputs[SWORD_META_KEYS.MAX_TURNS] as number) ?? 10;
  const lastProposedPlan = inputs[SWORD_META_KEYS.LAST_PROPOSED_PLAN] as LessonPlanProposal | undefined;

  // Extract typed inputs (exclude metadata keys)
  const typedInputs: SwordRefinementInputs = {};
  for (const [key, value] of Object.entries(inputs)) {
    if (!key.startsWith('_sword_')) {
      (typedInputs as Record<string, unknown>)[key] = value;
    }
  }

  return {
    userId: base.userId,
    goalId: base.goalId,
    stage: base.stage,
    inputs: typedInputs,
    currentQuestion,
    answeredQuestions,
    turnCount,
    maxTurns,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    expiresAt: base.expiresAt,
    lastProposedPlan,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SWORD REFINEMENT STORE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * SwordGate-specific refinement state storage.
 *
 * Wraps the base RefinementStore with typed access to
 * SwordRefinementState and SwordRefinementInputs.
 */
export class SwordRefinementStore {
  private readonly baseStore: IRefinementStore;
  private readonly config: SwordGateConfig;

  constructor(baseStore: IRefinementStore, config: SwordGateConfig) {
    this.baseStore = baseStore;
    this.config = config;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CRUD OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Save a SwordRefinementState.
   */
  async save(state: SwordRefinementState): AsyncAppResult<SwordRefinementState> {
    const baseState = toBaseState(state);
    const result = await this.baseStore.save(baseState);

    if (!result.ok) {
      return result;
    }

    return ok(fromBaseState(result.value));
  }

  /**
   * Get the current refinement state for a user.
   * Returns null if no active refinement exists.
   */
  async get(userId: UserId): AsyncAppResult<SwordRefinementState | null> {
    const result = await this.baseStore.get(userId);

    if (!result.ok) {
      return result;
    }

    if (result.value === null) {
      return ok(null);
    }

    return ok(fromBaseState(result.value));
  }

  /**
   * Delete the refinement state for a user.
   */
  async delete(userId: UserId): AsyncAppResult<boolean> {
    return this.baseStore.delete(userId);
  }

  /**
   * Update specific fields of the refinement state.
   */
  async update(
    userId: UserId,
    updates: Partial<SwordRefinementState>
  ): AsyncAppResult<SwordRefinementState> {
    // Get current state
    const currentResult = await this.get(userId);
    if (!currentResult.ok) {
      return currentResult;
    }

    if (currentResult.value === null) {
      return err(appError('NOT_FOUND', 'No active refinement session'));
    }

    // Merge updates
    const current = currentResult.value;
    const updated: SwordRefinementState = {
      ...current,
      ...updates,
      inputs: {
        ...current.inputs,
        ...(updates.inputs ?? {}),
      },
      answeredQuestions: updates.answeredQuestions ?? current.answeredQuestions,
      updatedAt: createTimestamp(),
    };

    // Save merged state
    return this.save(updated);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE TRANSITIONS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Advance to the clarifying stage.
   */
  async startClarifying(userId: UserId): AsyncAppResult<SwordRefinementState> {
    return this.update(userId, {
      stage: 'clarifying',
    });
  }

  /**
   * Advance to the confirming stage with a proposed plan.
   */
  async startConfirming(
    userId: UserId,
    proposedPlan: LessonPlanProposal
  ): AsyncAppResult<SwordRefinementState> {
    return this.update(userId, {
      stage: 'confirming',
      lastProposedPlan: proposedPlan,
    });
  }

  /**
   * Mark refinement as complete.
   */
  async complete(userId: UserId, goalId: GoalId): AsyncAppResult<SwordRefinementState> {
    return this.update(userId, {
      stage: 'complete',
      goalId,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // INPUT MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Update inputs and track answered question.
   */
  async addInput(
    userId: UserId,
    field: RefinementField,
    value: unknown
  ): AsyncAppResult<SwordRefinementState> {
    const currentResult = await this.get(userId);
    if (!currentResult.ok) {
      return currentResult;
    }

    if (currentResult.value === null) {
      return err(appError('NOT_FOUND', 'No active refinement session'));
    }

    const current = currentResult.value;
    const newInputs = {
      ...current.inputs,
      [field]: value,
    };

    const answeredQuestions = current.answeredQuestions.includes(field)
      ? current.answeredQuestions
      : [...current.answeredQuestions, field];

    return this.update(userId, {
      inputs: newInputs,
      answeredQuestions,
      turnCount: current.turnCount + 1,
    });
  }

  /**
   * Set the current question being asked.
   */
  async setCurrentQuestion(
    userId: UserId,
    question: RefinementField | undefined
  ): AsyncAppResult<SwordRefinementState> {
    return this.update(userId, {
      currentQuestion: question,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // QUERIES
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Check if a user has an active refinement session.
   */
  async hasActiveRefinement(userId: UserId): AsyncAppResult<boolean> {
    const result = await this.get(userId);
    if (!result.ok) {
      return result;
    }

    const state = result.value;
    if (state === null) {
      return ok(false);
    }

    // Active if not complete and not expired
    return ok(state.stage !== 'complete');
  }

  /**
   * Get the current stage for a user.
   * Returns null if no active refinement.
   */
  async getStage(
    userId: UserId
  ): AsyncAppResult<SwordRefinementState['stage'] | null> {
    const result = await this.get(userId);
    if (!result.ok) {
      return result;
    }

    return ok(result.value?.stage ?? null);
  }

  /**
   * Get typed inputs for a user.
   * Returns null if no active refinement.
   */
  async getInputs(userId: UserId): AsyncAppResult<SwordRefinementInputs | null> {
    const result = await this.get(userId);
    if (!result.ok) {
      return result;
    }

    return ok(result.value?.inputs ?? null);
  }

  /**
   * Get the last proposed plan for a user.
   */
  async getLastProposedPlan(
    userId: UserId
  ): AsyncAppResult<LessonPlanProposal | null> {
    const result = await this.get(userId);
    if (!result.ok) {
      return result;
    }

    return ok(result.value?.lastProposedPlan ?? null);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // EXPIRATION
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Extend the expiration time for an active refinement.
   */
  async extendExpiration(userId: UserId): AsyncAppResult<SwordRefinementState> {
    const newExpiresAt = createTimestamp(
      new Date(Date.now() + this.config.refinementTtlSeconds * 1000)
    );

    return this.update(userId, {
      expiresAt: newExpiresAt,
    });
  }

  /**
   * Check if a refinement is expired.
   */
  isExpired(state: SwordRefinementState): boolean {
    const expiresAt = new Date(state.expiresAt).getTime();
    return Date.now() > expiresAt;
  }

  /**
   * Check if max turns have been exceeded.
   */
  isMaxTurnsExceeded(state: SwordRefinementState): boolean {
    return state.turnCount >= state.maxTurns;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a SwordRefinementStore instance.
 */
export function createSwordRefinementStore(
  baseStore: IRefinementStore,
  config: SwordGateConfig
): SwordRefinementStore {
  return new SwordRefinementStore(baseStore, config);
}
