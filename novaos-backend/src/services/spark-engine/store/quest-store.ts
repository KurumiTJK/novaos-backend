// ═══════════════════════════════════════════════════════════════════════════════
// QUEST STORE — Encrypted Quest Storage
// NovaOS Spark Engine — Phase 12: Secure Store Layer
// ═══════════════════════════════════════════════════════════════════════════════
//
// Persistent storage for Quest entities with:
//   - Encryption at rest
//   - Goal-based indexing (quests per goal)
//   - Order-based sorting
//   - Cascade delete support
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { KeyValueStore } from '../../../storage/index.js';
import type { EncryptionService } from '../../../security/encryption/service.js';
import { ok, err, type AsyncAppResult } from '../../../types/result.js';
import type { QuestId, GoalId } from '../../../types/branded.js';
import { createTimestamp } from '../../../types/branded.js';
import { SwordKeys } from '../../../infrastructure/redis/keys.js';
import type { Quest, QuestStatus } from '../types.js';
import { SecureStore, storeError } from './secure-store.js';
import type {
  IQuestStore,
  SecureStoreConfig,
  SaveOptions,
  GetOptions,
  ListOptions,
  SaveResult,
  DeleteResult,
  ListResult,
} from './types.js';
import { StoreErrorCode as ErrorCodes } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// QUEST STORE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Encrypted storage for Quest entities.
 *
 * Features:
 * - Goal-based indexing via Redis sets
 * - Order-based sorting within goals
 * - Status-based filtering
 * - Cascade delete support (deletes steps, sparks)
 */
export class QuestStore extends SecureStore<Quest, QuestId> implements IQuestStore {
  /**
   * Callback for cascade delete (set by parent store manager).
   */
  private cascadeDeleteCallback?: (questId: QuestId) => Promise<number>;

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

  protected getKey(id: QuestId): string {
    return SwordKeys.quest(id);
  }

  protected validate(quest: Quest): string | undefined {
    if (!quest.id) {
      return 'Quest ID is required';
    }
    if (!quest.goalId) {
      return 'Goal ID is required';
    }
    if (!quest.title || quest.title.trim().length === 0) {
      return 'Quest title is required';
    }
    if (quest.title.length > 500) {
      return 'Quest title must be 500 characters or less';
    }
    if (quest.description && quest.description.length > 5000) {
      return 'Quest description must be 5000 characters or less';
    }
    const validStatuses: QuestStatus[] = ['pending', 'active', 'completed'];
    if (!validStatuses.includes(quest.status)) {
      return `Invalid quest status: ${quest.status}`;
    }
    if (typeof quest.order !== 'number' || quest.order < 1) {
      return 'Quest order must be a positive integer';
    }
    return undefined;
  }

  protected getId(quest: Quest): QuestId {
    return quest.id;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Save a quest (create or update).
   */
  async save(quest: Quest, options: SaveOptions = {}): AsyncAppResult<SaveResult<Quest>> {
    // Save the quest entity
    const result = await this.saveEntity(quest, options);
    if (!result.ok) {
      return result;
    }

    // Update goal's quest index
    const indexResult = await this.addToGoalIndex(quest.goalId, quest.id);
    if (!indexResult.ok) {
      // Rollback: delete the saved quest
      await this.deleteEntity(quest.id);
      return indexResult;
    }

    return ok({
      entity: quest,
      version: result.value.version,
      created: result.value.created,
    });
  }

  /**
   * Get a quest by ID.
   */
  async get(questId: QuestId, options: GetOptions = {}): AsyncAppResult<Quest | null> {
    return this.getEntity(questId, options);
  }

  /**
   * Delete a quest and all associated data.
   */
  async delete(questId: QuestId): AsyncAppResult<DeleteResult> {
    // Get the quest first to find the goalId
    const questResult = await this.getEntity(questId);
    if (!questResult.ok) {
      return err(questResult.error);
    }

    if (questResult.value === null) {
      return ok({ deleted: false });
    }

    const quest = questResult.value;

    // Cascade delete (steps, sparks, reminders)
    let cascadeCount = 0;
    if (this.cascadeDeleteCallback) {
      cascadeCount = await this.cascadeDeleteCallback(questId);
    }

    // Remove from goal's quest index
    await this.removeFromGoalIndex(quest.goalId, questId);

    // Delete the quest entity
    const deleteResult = await this.deleteEntity(questId);
    if (!deleteResult.ok) {
      return err(deleteResult.error);
    }

    return ok({
      deleted: deleteResult.value,
      cascadeCount,
    });
  }

  /**
   * Get all quests for a goal.
   */
  async getByGoal(
    goalId: GoalId,
    options: ListOptions = {}
  ): AsyncAppResult<ListResult<Quest>> {
    const { limit = 100, offset = 0, status, sortOrder = 'asc' } = options;

    try {
      // Get quest IDs from goal's index
      const indexKey = SwordKeys.goalQuests(goalId);
      const questIds = await this.store.smembers(indexKey);

      if (questIds.length === 0) {
        return ok({ items: [], total: 0, hasMore: false });
      }

      // Fetch all quests
      const quests: Quest[] = [];
      for (const id of questIds) {
        const result = await this.getEntity(id as QuestId);
        if (result.ok && result.value !== null) {
          // Filter by status if specified
          if (!status || result.value.status === status) {
            quests.push(result.value);
          }
        }
      }

      // Sort by order (primary) and createdAt (secondary)
      quests.sort((a, b) => {
        if (a.order !== b.order) {
          return sortOrder === 'asc' ? a.order - b.order : b.order - a.order;
        }
        const aTime = new Date(a.createdAt).getTime();
        const bTime = new Date(b.createdAt).getTime();
        return sortOrder === 'asc' ? aTime - bTime : bTime - aTime;
      });

      // Apply pagination
      const total = quests.length;
      const paged = quests.slice(offset, offset + limit);
      const hasMore = offset + limit < total;

      return ok({ items: paged, total, hasMore });
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to get quests for goal: ${error instanceof Error ? error.message : String(error)}`,
          { goalId }
        )
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ADDITIONAL METHODS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get quests by status for a goal.
   */
  async getByStatus(goalId: GoalId, status: QuestStatus): AsyncAppResult<readonly Quest[]> {
    const result = await this.getByGoal(goalId, { status, limit: 1000 });
    if (!result.ok) {
      return result;
    }
    return ok(result.value.items);
  }

  /**
   * Get the active quest for a goal (status = 'active').
   */
  async getActiveQuest(goalId: GoalId): AsyncAppResult<Quest | null> {
    const result = await this.getByStatus(goalId, 'active');
    if (!result.ok) {
      return result;
    }
    // Return the first active quest (by order)
    return ok(result.value.length > 0 ? result.value[0] : null);
  }

  /**
   * Get the next pending quest for a goal.
   */
  async getNextPendingQuest(goalId: GoalId): AsyncAppResult<Quest | null> {
    const result = await this.getByStatus(goalId, 'pending');
    if (!result.ok) {
      return result;
    }
    // Return the first pending quest (by order)
    return ok(result.value.length > 0 ? result.value[0] : null);
  }

  /**
   * Update a quest's status.
   */
  async updateStatus(questId: QuestId, status: QuestStatus): AsyncAppResult<Quest> {
    // Get current quest
    const result = await this.getEntity(questId);
    if (!result.ok) {
      return result;
    }
    if (result.value === null) {
      return err(
        storeError(ErrorCodes.NOT_FOUND, `Quest not found: ${questId}`, { questId })
      );
    }

    const quest = result.value;

    // Create updated quest
    const updatedQuest: Quest = {
      ...quest,
      status,
      updatedAt: createTimestamp(),
    };

    // Save updated quest
    const saveResult = await this.saveEntity(updatedQuest);
    if (!saveResult.ok) {
      return err(saveResult.error);
    }

    return ok(updatedQuest);
  }

  /**
   * Count quests for a goal.
   */
  async countByGoal(goalId: GoalId): AsyncAppResult<number> {
    try {
      const indexKey = SwordKeys.goalQuests(goalId);
      const count = await this.store.scard(indexKey);
      return ok(count);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to count quests: ${error instanceof Error ? error.message : String(error)}`,
          { goalId }
        )
      );
    }
  }

  /**
   * Delete all quests for a goal.
   * Used for cascade delete from GoalStore.
   */
  async deleteByGoal(goalId: GoalId): AsyncAppResult<number> {
    try {
      const indexKey = SwordKeys.goalQuests(goalId);
      const questIds = await this.store.smembers(indexKey);

      let deleted = 0;
      for (const id of questIds) {
        const result = await this.delete(id as QuestId);
        if (result.ok && result.value.deleted) {
          deleted++;
        }
      }

      // Clean up the index
      await this.store.delete(indexKey);

      return ok(deleted);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to delete quests for goal: ${error instanceof Error ? error.message : String(error)}`,
          { goalId }
        )
      );
    }
  }

  /**
   * Set cascade delete callback.
   */
  setCascadeDeleteCallback(callback: (questId: QuestId) => Promise<number>): void {
    this.cascadeDeleteCallback = callback;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // INDEX MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Add quest to goal's quest index.
   */
  private async addToGoalIndex(goalId: GoalId, questId: QuestId): AsyncAppResult<void> {
    try {
      const indexKey = SwordKeys.goalQuests(goalId);
      await this.store.sadd(indexKey, questId);
      return ok(undefined);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to add quest to goal index: ${error instanceof Error ? error.message : String(error)}`,
          { goalId, questId }
        )
      );
    }
  }

  /**
   * Remove quest from goal's quest index.
   */
  private async removeFromGoalIndex(goalId: GoalId, questId: QuestId): AsyncAppResult<void> {
    try {
      const indexKey = SwordKeys.goalQuests(goalId);
      await this.store.srem(indexKey, questId);
      return ok(undefined);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to remove quest from goal index: ${error instanceof Error ? error.message : String(error)}`,
          { goalId, questId }
        )
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a QuestStore instance.
 */
export function createQuestStore(
  store: KeyValueStore,
  config?: Partial<SecureStoreConfig>,
  encryption?: EncryptionService
): QuestStore {
  return new QuestStore(store, config, encryption);
}
