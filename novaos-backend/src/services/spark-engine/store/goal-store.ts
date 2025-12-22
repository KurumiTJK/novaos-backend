// ═══════════════════════════════════════════════════════════════════════════════
// GOAL STORE — Encrypted Goal Storage
// NovaOS Spark Engine — Phase 12: Secure Store Layer
// ═══════════════════════════════════════════════════════════════════════════════
//
// Persistent storage for Goal entities with:
//   - Encryption at rest
//   - User-based indexing (goals per user)
//   - Status-based filtering
//   - Cascade delete support
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { KeyValueStore } from '../../../storage/index.js';
import type { EncryptionService } from '../../../security/encryption/service.js';
import { ok, err, type AsyncAppResult } from '../../../types/result.js';
import type { GoalId, UserId, Timestamp } from '../../../types/branded.js';
import { createTimestamp } from '../../../types/branded.js';
import { SwordKeys } from '../../../infrastructure/redis/keys.js';
import type { Goal, GoalStatus } from '../types.js';
import { SecureStore, storeError } from './secure-store.js';
import type {
  IGoalStore,
  SecureStoreConfig,
  SaveOptions,
  GetOptions,
  ListOptions,
  SaveResult,
  DeleteResult,
  ListResult,
  StoreErrorCode,
} from './types.js';
import { StoreErrorCode as ErrorCodes } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// GOAL STORE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Encrypted storage for Goal entities.
 *
 * Features:
 * - User-based indexing via Redis sets
 * - Status-based filtering
 * - TTL for completed/abandoned goals
 * - Cascade delete support (deletes quests, steps, sparks)
 */
export class GoalStore extends SecureStore<Goal, GoalId> implements IGoalStore {
  /**
   * Callback for cascade delete (set by parent store manager).
   */
  private cascadeDeleteCallback?: (goalId: GoalId) => Promise<number>;

  constructor(
    store: KeyValueStore,
    config: Partial<SecureStoreConfig> = {},
    encryption?: EncryptionService
  ) {
    super(store, config, encryption);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ABSTRACT METHOD IMPLEMENTATIONS
  // ─────────────────────────────────────────────────────────────────────────────

  protected getKey(id: GoalId): string {
    return SwordKeys.goal(id);
  }

  protected validate(goal: Goal): string | undefined {
    if (!goal.id) {
      return 'Goal ID is required';
    }
    if (!goal.userId) {
      return 'User ID is required';
    }
    if (!goal.title || goal.title.trim().length === 0) {
      return 'Goal title is required';
    }
    if (goal.title.length > 500) {
      return 'Goal title must be 500 characters or less';
    }
    if (goal.description && goal.description.length > 10000) {
      return 'Goal description must be 10000 characters or less';
    }
    const validStatuses: GoalStatus[] = ['active', 'paused', 'completed', 'abandoned'];
    if (!validStatuses.includes(goal.status)) {
      return `Invalid goal status: ${goal.status}`;
    }
    return undefined;
  }

  protected getId(goal: Goal): GoalId {
    return goal.id;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Save a goal (create or update).
   */
  async save(goal: Goal, options: SaveOptions = {}): AsyncAppResult<SaveResult<Goal>> {
    // Determine TTL based on status
    let ttl = options.ttlSeconds;
    if (ttl === undefined && (goal.status === 'completed' || goal.status === 'abandoned')) {
      ttl = this.config.completedGoalTtlSeconds;
    }

    // Save the goal entity
    const result = await this.saveEntity(goal, { ...options, ttlSeconds: ttl });
    if (!result.ok) {
      return result;
    }

    // Update user's goal index
    const indexResult = await this.addToUserIndex(goal.userId, goal.id);
    if (!indexResult.ok) {
      // Rollback: delete the saved goal
      await this.deleteEntity(goal.id);
      return indexResult;
    }

    // Update status index if active
    if (goal.status === 'active') {
      await this.addToActiveIndex(goal.userId, goal.id);
    } else {
      await this.removeFromActiveIndex(goal.userId, goal.id);
    }

    return ok({
      entity: goal,
      version: result.value.version,
      created: result.value.created,
    });
  }

  /**
   * Get a goal by ID.
   */
  async get(goalId: GoalId, options: GetOptions = {}): AsyncAppResult<Goal | null> {
    return this.getEntity(goalId, options);
  }

  /**
   * Delete a goal and all associated data.
   */
  async delete(goalId: GoalId): AsyncAppResult<DeleteResult> {
    // Get the goal first to find the userId
    const goalResult = await this.getEntity(goalId);
    if (!goalResult.ok) {
      return err(goalResult.error);
    }

    if (goalResult.value === null) {
      return ok({ deleted: false });
    }

    const goal = goalResult.value;

    // Cascade delete (quests, steps, sparks, reminders)
    let cascadeCount = 0;
    if (this.cascadeDeleteCallback) {
      cascadeCount = await this.cascadeDeleteCallback(goalId);
    }

    // Remove from user indexes
    await this.removeFromUserIndex(goal.userId, goalId);
    await this.removeFromActiveIndex(goal.userId, goalId);

    // Delete the goal entity
    const deleteResult = await this.deleteEntity(goalId);
    if (!deleteResult.ok) {
      return err(deleteResult.error);
    }

    return ok({
      deleted: deleteResult.value,
      cascadeCount,
    });
  }

  /**
   * Get all goals for a user.
   */
  async getByUser(
    userId: UserId,
    options: ListOptions = {}
  ): AsyncAppResult<ListResult<Goal>> {
    const { limit = 100, offset = 0, status, sortOrder = 'asc' } = options;

    try {
      // Get goal IDs from user's index
      const indexKey = SwordKeys.userGoals(userId);
      const goalIds = await this.store.smembers(indexKey);

      if (goalIds.length === 0) {
        return ok({ items: [], total: 0, hasMore: false });
      }

      // Fetch all goals
      const goals: Goal[] = [];
      for (const id of goalIds) {
        const result = await this.getEntity(id as GoalId);
        if (result.ok && result.value !== null) {
          // Filter by status if specified
          if (!status || result.value.status === status) {
            goals.push(result.value);
          }
        }
      }

      // Sort by createdAt
      goals.sort((a, b) => {
        const aTime = new Date(a.createdAt).getTime();
        const bTime = new Date(b.createdAt).getTime();
        return sortOrder === 'asc' ? aTime - bTime : bTime - aTime;
      });

      // Apply pagination
      const total = goals.length;
      const paged = goals.slice(offset, offset + limit);
      const hasMore = offset + limit < total;

      return ok({ items: paged, total, hasMore });
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to get goals for user: ${error instanceof Error ? error.message : String(error)}`,
          { userId }
        )
      );
    }
  }

  /**
   * Get goals by status for a user.
   */
  async getByStatus(userId: UserId, status: GoalStatus): AsyncAppResult<readonly Goal[]> {
    const result = await this.getByUser(userId, { status, limit: 1000 });
    if (!result.ok) {
      return result;
    }
    return ok(result.value.items);
  }

  /**
   * Update a goal's status.
   */
  async updateStatus(goalId: GoalId, status: GoalStatus): AsyncAppResult<Goal> {
    // Get current goal
    const result = await this.getEntity(goalId);
    if (!result.ok) {
      return result;
    }
    if (result.value === null) {
      return err(
        storeError(ErrorCodes.NOT_FOUND, `Goal not found: ${goalId}`, { goalId })
      );
    }

    const goal = result.value;
    const previousStatus = goal.status;

    // Create updated goal
    const updatedGoal: Goal = {
      ...goal,
      status,
      updatedAt: createTimestamp(),
    };

    // Determine TTL based on new status
    let ttl: number | undefined;
    if (status === 'completed' || status === 'abandoned') {
      ttl = this.config.completedGoalTtlSeconds;
    }

    // Save updated goal
    const saveResult = await this.saveEntity(updatedGoal, { ttlSeconds: ttl });
    if (!saveResult.ok) {
      return err(saveResult.error);
    }

    // Update active index if status changed
    if (previousStatus !== status) {
      if (status === 'active') {
        await this.addToActiveIndex(goal.userId, goalId);
      } else if (previousStatus === 'active') {
        await this.removeFromActiveIndex(goal.userId, goalId);
      }
    }

    return ok(updatedGoal);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ADDITIONAL METHODS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get active goals for a user (optimized via active index).
   */
  async getActiveGoals(userId: UserId): AsyncAppResult<readonly Goal[]> {
    try {
      const indexKey = SwordKeys.userActiveGoals(userId);
      const goalIds = await this.store.smembers(indexKey);

      if (goalIds.length === 0) {
        return ok([]);
      }

      const goals: Goal[] = [];
      for (const id of goalIds) {
        const result = await this.getEntity(id as GoalId);
        if (result.ok && result.value !== null) {
          // Verify still active (index may be stale)
          if (result.value.status === 'active') {
            goals.push(result.value);
          } else {
            // Clean up stale index entry
            await this.removeFromActiveIndex(userId, id as GoalId);
          }
        }
      }

      return ok(goals);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to get active goals: ${error instanceof Error ? error.message : String(error)}`,
          { userId }
        )
      );
    }
  }

  /**
   * Count goals for a user.
   */
  async countByUser(userId: UserId): AsyncAppResult<number> {
    try {
      const indexKey = SwordKeys.userGoals(userId);
      const count = await this.store.scard(indexKey);
      return ok(count);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to count goals: ${error instanceof Error ? error.message : String(error)}`,
          { userId }
        )
      );
    }
  }

  /**
   * Set cascade delete callback.
   */
  setCascadeDeleteCallback(callback: (goalId: GoalId) => Promise<number>): void {
    this.cascadeDeleteCallback = callback;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // INDEX MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Add goal to user's goal index.
   */
  private async addToUserIndex(userId: UserId, goalId: GoalId): AsyncAppResult<void> {
    try {
      const indexKey = SwordKeys.userGoals(userId);
      await this.store.sadd(indexKey, goalId);
      return ok(undefined);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to add goal to user index: ${error instanceof Error ? error.message : String(error)}`,
          { userId, goalId }
        )
      );
    }
  }

  /**
   * Remove goal from user's goal index.
   */
  private async removeFromUserIndex(userId: UserId, goalId: GoalId): AsyncAppResult<void> {
    try {
      const indexKey = SwordKeys.userGoals(userId);
      await this.store.srem(indexKey, goalId);
      return ok(undefined);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to remove goal from user index: ${error instanceof Error ? error.message : String(error)}`,
          { userId, goalId }
        )
      );
    }
  }

  /**
   * Add goal to user's active goals index.
   */
  private async addToActiveIndex(userId: UserId, goalId: GoalId): AsyncAppResult<void> {
    try {
      const indexKey = SwordKeys.userActiveGoals(userId);
      await this.store.sadd(indexKey, goalId);
      return ok(undefined);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to add goal to active index: ${error instanceof Error ? error.message : String(error)}`,
          { userId, goalId }
        )
      );
    }
  }

  /**
   * Remove goal from user's active goals index.
   */
  private async removeFromActiveIndex(userId: UserId, goalId: GoalId): AsyncAppResult<void> {
    try {
      const indexKey = SwordKeys.userActiveGoals(userId);
      await this.store.srem(indexKey, goalId);
      return ok(undefined);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to remove goal from active index: ${error instanceof Error ? error.message : String(error)}`,
          { userId, goalId }
        )
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a GoalStore instance.
 */
export function createGoalStore(
  store: KeyValueStore,
  config?: Partial<SecureStoreConfig>,
  encryption?: EncryptionService
): GoalStore {
  return new GoalStore(store, config, encryption);
}
