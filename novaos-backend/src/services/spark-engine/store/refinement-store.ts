// ═══════════════════════════════════════════════════════════════════════════════
// REFINEMENT STORE — Encrypted Refinement State Storage
// NovaOS Spark Engine — Phase 12: Secure Store Layer
// ═══════════════════════════════════════════════════════════════════════════════
//
// Persistent storage for SwordGate refinement state with:
//   - Encryption at rest
//   - User-based keying (one active refinement per user)
//   - TTL enforcement (auto-expire stale refinements)
//   - Stage-based workflow tracking
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { KeyValueStore } from '../../../storage/index.js';
import type { EncryptionService } from '../../../security/encryption/service.js';
import { ok, err, type AsyncAppResult } from '../../../types/result.js';
import type { UserId, GoalId, Timestamp } from '../../../types/branded.js';
import { createTimestamp } from '../../../types/branded.js';
import { buildKey, KeyNamespace } from '../../../infrastructure/redis/keys.js';
import { SecureStore, storeError } from './secure-store.js';
import type { IRefinementStore, RefinementState, SecureStoreConfig } from './types.js';
import { StoreErrorCode as ErrorCodes } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Default TTL for refinement state (1 hour).
 */
const DEFAULT_REFINEMENT_TTL_SECONDS = 60 * 60;

/**
 * Valid refinement stages.
 */
const VALID_STAGES = ['initial', 'clarifying', 'confirming', 'complete'] as const;

// ═══════════════════════════════════════════════════════════════════════════════
// REFINEMENT STORE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Encrypted storage for SwordGate refinement state.
 *
 * Features:
 * - One active refinement per user
 * - TTL-based auto-expiration
 * - Stage-based workflow tracking
 * - Atomic updates
 *
 * The refinement state tracks the multi-turn conversation
 * between user and SwordGate while defining a new goal.
 */
export class RefinementStore extends SecureStore<RefinementState, UserId> implements IRefinementStore {
  constructor(
    store: KeyValueStore,
    config: Partial<SecureStoreConfig> = {},
    encryption?: EncryptionService
  ) {
    // Override default TTL for refinement state
    const refinementConfig: Partial<SecureStoreConfig> = {
      ...config,
      defaultTtlSeconds: config.refinementStateTtlSeconds ?? DEFAULT_REFINEMENT_TTL_SECONDS,
    };
    super(store, refinementConfig, encryption);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ABSTRACT METHOD IMPLEMENTATIONS
  // ─────────────────────────────────────────────────────────────────────────────

  protected getKey(userId: UserId): string {
    return buildKey(KeyNamespace.SWORD, 'refinement', userId);
  }

  protected validate(state: RefinementState): string | undefined {
    if (!state.userId) {
      return 'User ID is required';
    }
    if (!VALID_STAGES.includes(state.stage)) {
      return `Invalid refinement stage: ${state.stage}`;
    }
    if (!state.createdAt) {
      return 'Created timestamp is required';
    }
    if (!state.updatedAt) {
      return 'Updated timestamp is required';
    }
    if (!state.expiresAt) {
      return 'Expiration timestamp is required';
    }
    if (state.inputs && typeof state.inputs !== 'object') {
      return 'Inputs must be an object';
    }
    return undefined;
  }

  protected getId(state: RefinementState): UserId {
    return state.userId;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLIC API (IRefinementStore)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Save refinement state.
   */
  async save(state: RefinementState): AsyncAppResult<RefinementState> {
    // Calculate TTL from expiresAt
    const now = Date.now();
    const expiresAt = new Date(state.expiresAt).getTime();
    const ttlSeconds = Math.max(1, Math.floor((expiresAt - now) / 1000));

    // Save with TTL
    const result = await this.saveEntity(state, { ttlSeconds });
    if (!result.ok) {
      return err(result.error);
    }

    return ok(state);
  }

  /**
   * Get refinement state for a user.
   */
  async get(userId: UserId): AsyncAppResult<RefinementState | null> {
    const result = await this.getEntity(userId);
    if (!result.ok) {
      return result;
    }

    // Check if expired (belt-and-suspenders with Redis TTL)
    if (result.value !== null) {
      const expiresAt = new Date(result.value.expiresAt).getTime();
      if (Date.now() > expiresAt) {
        // Expired - delete and return null
        await this.deleteEntity(userId);
        return ok(null);
      }
    }

    return ok(result.value);
  }

  /**
   * Delete refinement state for a user.
   */
  async delete(userId: UserId): AsyncAppResult<boolean> {
    return this.deleteEntity(userId);
  }

  /**
   * Update refinement state.
   */
  async update(
    userId: UserId,
    updates: Partial<RefinementState>
  ): AsyncAppResult<RefinementState> {
    // Get current state
    const result = await this.get(userId);
    if (!result.ok) {
      return result;
    }

    if (result.value === null) {
      return err(
        storeError(ErrorCodes.NOT_FOUND, `Refinement state not found for user: ${userId}`, {
          userId,
        })
      );
    }

    const currentState = result.value;
    const now = createTimestamp();

    // Merge updates
    const updatedState: RefinementState = {
      ...currentState,
      ...updates,
      userId: currentState.userId, // Cannot change userId
      createdAt: currentState.createdAt, // Cannot change createdAt
      updatedAt: now,
      // Extend expiration on update
      expiresAt: updates.expiresAt ?? this.computeNewExpiration(),
      // Merge inputs
      inputs: {
        ...currentState.inputs,
        ...(updates.inputs ?? {}),
      },
    };

    // Save updated state
    return this.save(updatedState);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ADDITIONAL METHODS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a new refinement state for a user.
   * Replaces any existing state.
   */
  async create(userId: UserId, goalId?: GoalId): AsyncAppResult<RefinementState> {
    const now = createTimestamp();
    const expiresAt = this.computeNewExpiration();

    const state: RefinementState = {
      userId,
      goalId,
      stage: 'initial',
      inputs: {},
      createdAt: now,
      updatedAt: now,
      expiresAt,
    };

    return this.save(state);
  }

  /**
   * Advance refinement to the next stage.
   */
  async advanceStage(
    userId: UserId,
    newInputs?: Record<string, unknown>
  ): AsyncAppResult<RefinementState> {
    const result = await this.get(userId);
    if (!result.ok) {
      return result;
    }

    if (result.value === null) {
      return err(
        storeError(ErrorCodes.NOT_FOUND, `Refinement state not found for user: ${userId}`, {
          userId,
        })
      );
    }

    const currentState = result.value;
    const nextStage = this.getNextStage(currentState.stage);

    if (nextStage === null) {
      return err(
        storeError(
          ErrorCodes.INVALID_DATA,
          `Cannot advance from stage: ${currentState.stage}`,
          { currentStage: currentState.stage }
        )
      );
    }

    return this.update(userId, {
      stage: nextStage,
      inputs: newInputs,
    });
  }

  /**
   * Set the goal ID for a refinement (when goal is created).
   */
  async setGoalId(userId: UserId, goalId: GoalId): AsyncAppResult<RefinementState> {
    return this.update(userId, { goalId });
  }

  /**
   * Mark refinement as complete.
   */
  async complete(userId: UserId): AsyncAppResult<RefinementState> {
    return this.update(userId, { stage: 'complete' });
  }

  /**
   * Check if user has active refinement.
   */
  async hasActiveRefinement(userId: UserId): AsyncAppResult<boolean> {
    const result = await this.get(userId);
    if (!result.ok) {
      return err(result.error);
    }

    if (result.value === null) {
      return ok(false);
    }

    // Active if not complete
    return ok(result.value.stage !== 'complete');
  }

  /**
   * Get refinement stage for a user.
   */
  async getStage(
    userId: UserId
  ): AsyncAppResult<RefinementState['stage'] | null> {
    const result = await this.get(userId);
    if (!result.ok) {
      return result;
    }

    return ok(result.value?.stage ?? null);
  }

  /**
   * Add input to refinement state.
   */
  async addInput(
    userId: UserId,
    key: string,
    value: unknown
  ): AsyncAppResult<RefinementState> {
    const result = await this.get(userId);
    if (!result.ok) {
      return result;
    }

    if (result.value === null) {
      return err(
        storeError(ErrorCodes.NOT_FOUND, `Refinement state not found for user: ${userId}`, {
          userId,
        })
      );
    }

    return this.update(userId, {
      inputs: { [key]: value },
    });
  }

  /**
   * Extend the expiration time for a refinement.
   */
  async extendExpiration(
    userId: UserId,
    additionalSeconds?: number
  ): AsyncAppResult<RefinementState> {
    const ttl = additionalSeconds ?? (this.config.refinementStateTtlSeconds || DEFAULT_REFINEMENT_TTL_SECONDS);
    const newExpiration = createTimestamp(new Date(Date.now() + ttl * 1000));

    return this.update(userId, { expiresAt: newExpiration });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HELPER METHODS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Compute new expiration timestamp.
   */
  private computeNewExpiration(): Timestamp {
    const ttl = this.config.refinementStateTtlSeconds || DEFAULT_REFINEMENT_TTL_SECONDS;
    return createTimestamp(new Date(Date.now() + ttl * 1000));
  }

  /**
   * Get the next stage in the workflow.
   */
  private getNextStage(
    currentStage: RefinementState['stage']
  ): RefinementState['stage'] | null {
    switch (currentStage) {
      case 'initial':
        return 'clarifying';
      case 'clarifying':
        return 'confirming';
      case 'confirming':
        return 'complete';
      case 'complete':
        return null; // Already complete
      default:
        return null;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a RefinementStore instance.
 */
export function createRefinementStore(
  store: KeyValueStore,
  config?: Partial<SecureStoreConfig>,
  encryption?: EncryptionService
): RefinementStore {
  return new RefinementStore(store, config, encryption);
}
