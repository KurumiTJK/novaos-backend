// ═══════════════════════════════════════════════════════════════════════════════
// STEP STORE — Encrypted Step Storage
// NovaOS Spark Engine — Phase 12: Secure Store Layer
// ═══════════════════════════════════════════════════════════════════════════════
//
// Persistent storage for Step entities with:
//   - Encryption at rest
//   - Quest-based indexing (steps per quest)
//   - Date-based lookup (find step by scheduled date)
//   - Order-based sorting
//   - Cascade delete support
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { KeyValueStore } from '../../../storage/index.js';
import type { EncryptionService } from '../../../security/encryption/service.js';
import { ok, err, type AsyncAppResult } from '../../../types/result.js';
import type { StepId, QuestId, GoalId, UserId } from '../../../types/branded.js';
import { createTimestamp } from '../../../types/branded.js';
import { SwordKeys, buildKey, KeyNamespace } from '../../../infrastructure/redis/keys.js';
import type { Step, StepStatus } from '../types.js';
import { SecureStore, storeError } from './secure-store.js';
import type {
  IStepStore,
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
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Date format for scheduled dates (YYYY-MM-DD).
 */
const DATE_FORMAT_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// ═══════════════════════════════════════════════════════════════════════════════
// STEP STORE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Encrypted storage for Step entities.
 *
 * Features:
 * - Quest-based indexing via Redis sets
 * - Date-based lookup for daily spark delivery
 * - Order-based sorting within quests
 * - Status-based filtering
 * - Cascade delete support (deletes sparks, reminders)
 */
export class StepStore extends SecureStore<Step, StepId> implements IStepStore {
  /**
   * Callback for cascade delete (set by parent store manager).
   */
  private cascadeDeleteCallback?: (stepId: StepId) => Promise<number>;

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

  protected getKey(id: StepId): string {
    return SwordKeys.step(id);
  }

  protected validate(step: Step): string | undefined {
    if (!step.id) {
      return 'Step ID is required';
    }
    if (!step.questId) {
      return 'Quest ID is required';
    }
    if (!step.title || step.title.trim().length === 0) {
      return 'Step title is required';
    }
    if (step.title.length > 500) {
      return 'Step title must be 500 characters or less';
    }
    if (step.description && step.description.length > 5000) {
      return 'Step description must be 5000 characters or less';
    }
    const validStatuses: StepStatus[] = ['pending', 'active', 'completed', 'skipped'];
    if (!validStatuses.includes(step.status)) {
      return `Invalid step status: ${step.status}`;
    }
    if (typeof step.order !== 'number' || step.order < 1) {
      return 'Step order must be a positive integer';
    }
    if (step.scheduledDate && !DATE_FORMAT_REGEX.test(step.scheduledDate)) {
      return 'Scheduled date must be in YYYY-MM-DD format';
    }
    if (step.estimatedMinutes !== undefined) {
      if (typeof step.estimatedMinutes !== 'number' || step.estimatedMinutes < 1) {
        return 'Estimated minutes must be a positive integer';
      }
    }
    return undefined;
  }

  protected getId(step: Step): StepId {
    return step.id;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Save a step (create or update).
   */
  async save(step: Step, options: SaveOptions = {}): AsyncAppResult<SaveResult<Step>> {
    // Get existing step to check for date changes
    const existingResult = await this.getEntity(step.id);
    const existingStep = existingResult.ok ? existingResult.value : null;

    // Save the step entity
    const result = await this.saveEntity(step, options);
    if (!result.ok) {
      return result;
    }

    // Update quest's step index
    const indexResult = await this.addToQuestIndex(step.questId, step.id);
    if (!indexResult.ok) {
      // Rollback: delete the saved step
      await this.deleteEntity(step.id);
      return indexResult;
    }

    // Update date index if scheduled date is set
    if (step.scheduledDate) {
      // Remove from old date index if date changed
      if (existingStep?.scheduledDate && existingStep.scheduledDate !== step.scheduledDate) {
        await this.removeFromDateIndex(step.questId, existingStep.scheduledDate, step.id);
      }
      await this.addToDateIndex(step.questId, step.scheduledDate, step.id);
    } else if (existingStep?.scheduledDate) {
      // Date was removed, clean up old index
      await this.removeFromDateIndex(step.questId, existingStep.scheduledDate, step.id);
    }

    return ok({
      entity: step,
      version: result.value.version,
      created: result.value.created,
    });
  }

  /**
   * Get a step by ID.
   */
  async get(stepId: StepId, options: GetOptions = {}): AsyncAppResult<Step | null> {
    return this.getEntity(stepId, options);
  }

  /**
   * Delete a step and all associated data.
   */
  async delete(stepId: StepId): AsyncAppResult<DeleteResult> {
    // Get the step first to find the questId
    const stepResult = await this.getEntity(stepId);
    if (!stepResult.ok) {
      return err(stepResult.error);
    }

    if (stepResult.value === null) {
      return ok({ deleted: false });
    }

    const step = stepResult.value;

    // Cascade delete (sparks, reminders)
    let cascadeCount = 0;
    if (this.cascadeDeleteCallback) {
      cascadeCount = await this.cascadeDeleteCallback(stepId);
    }

    // Remove from quest's step index
    await this.removeFromQuestIndex(step.questId, stepId);

    // Remove from date index if scheduled
    if (step.scheduledDate) {
      await this.removeFromDateIndex(step.questId, step.scheduledDate, stepId);
    }

    // Delete the step entity
    const deleteResult = await this.deleteEntity(stepId);
    if (!deleteResult.ok) {
      return err(deleteResult.error);
    }

    return ok({
      deleted: deleteResult.value,
      cascadeCount,
    });
  }

  /**
   * Get all steps for a quest.
   */
  async getByQuest(
    questId: QuestId,
    options: ListOptions = {}
  ): AsyncAppResult<ListResult<Step>> {
    const { limit = 100, offset = 0, status, sortOrder = 'asc' } = options;

    try {
      // Get step IDs from quest's index
      const indexKey = SwordKeys.questSteps(questId);
      const stepIds = await this.store.smembers(indexKey);

      if (stepIds.length === 0) {
        return ok({ items: [], total: 0, hasMore: false });
      }

      // Fetch all steps
      const steps: Step[] = [];
      for (const id of stepIds) {
        const result = await this.getEntity(id as StepId);
        if (result.ok && result.value !== null) {
          // Filter by status if specified
          if (!status || result.value.status === status) {
            steps.push(result.value);
          }
        }
      }

      // Sort by order (primary) and dayNumber/createdAt (secondary)
      steps.sort((a, b) => {
        if (a.order !== b.order) {
          return sortOrder === 'asc' ? a.order - b.order : b.order - a.order;
        }
        // Secondary sort by dayNumber if available
        if (a.dayNumber !== undefined && b.dayNumber !== undefined) {
          return sortOrder === 'asc' ? a.dayNumber - b.dayNumber : b.dayNumber - a.dayNumber;
        }
        // Fallback to createdAt
        const aTime = new Date(a.createdAt).getTime();
        const bTime = new Date(b.createdAt).getTime();
        return sortOrder === 'asc' ? aTime - bTime : bTime - aTime;
      });

      // Apply pagination
      const total = steps.length;
      const paged = steps.slice(offset, offset + limit);
      const hasMore = offset + limit < total;

      return ok({ items: paged, total, hasMore });
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to get steps for quest: ${error instanceof Error ? error.message : String(error)}`,
          { questId }
        )
      );
    }
  }

  /**
   * Get a step by scheduled date for a user.
   * Searches across all active goals via goal/quest hierarchy.
   */
  async getByDate(userId: UserId, date: string): AsyncAppResult<Step | null> {
    if (!DATE_FORMAT_REGEX.test(date)) {
      return err(
        storeError(ErrorCodes.INVALID_DATA, 'Date must be in YYYY-MM-DD format', { date })
      );
    }

    try {
      // This requires traversing the goal -> quest -> step hierarchy
      // Use the user's date index pattern
      const pattern = buildKey(KeyNamespace.SWORD, 'date', userId, date);
      const stepIds = await this.store.smembers(pattern);

      if (stepIds.length === 0) {
        return ok(null);
      }

      // Get the first valid step
      for (const id of stepIds) {
        const result = await this.getEntity(id as StepId);
        if (result.ok && result.value !== null) {
          return ok(result.value);
        }
      }

      return ok(null);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to get step by date: ${error instanceof Error ? error.message : String(error)}`,
          { userId, date }
        )
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ADDITIONAL METHODS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get steps by status for a quest.
   */
  async getByStatus(questId: QuestId, status: StepStatus): AsyncAppResult<readonly Step[]> {
    const result = await this.getByQuest(questId, { status, limit: 1000 });
    if (!result.ok) {
      return result;
    }
    return ok(result.value.items);
  }

  /**
   * Get the active step for a quest (status = 'active').
   */
  async getActiveStep(questId: QuestId): AsyncAppResult<Step | null> {
    const result = await this.getByStatus(questId, 'active');
    if (!result.ok) {
      return result;
    }
    return ok(result.value.length > 0 ? result.value[0] ?? null : null);
  }

  /**
   * Get the next pending step for a quest.
   */
  async getNextPendingStep(questId: QuestId): AsyncAppResult<Step | null> {
    const result = await this.getByStatus(questId, 'pending');
    if (!result.ok) {
      return result;
    }
    return ok(result.value.length > 0 ? result.value[0] ?? null : null);
  }

  /**
   * Update a step's status.
   */
  async updateStatus(stepId: StepId, status: StepStatus): AsyncAppResult<Step> {
    // Get current step
    const result = await this.getEntity(stepId);
    if (!result.ok) {
      return result;
    }
    if (result.value === null) {
      return err(
        storeError(ErrorCodes.NOT_FOUND, `Step not found: ${stepId}`, { stepId })
      );
    }

    const step = result.value;

    // Create updated step
    const updatedStep: Step = {
      ...step,
      status,
      updatedAt: createTimestamp(),
      // Set startedAt when becoming active
      startedAt: status === 'active' && !step.startedAt ? createTimestamp() : step.startedAt,
      // Set completedAt when becoming completed
      completedAt: status === 'completed' ? createTimestamp() : step.completedAt,
    };

    // Save updated step
    const saveResult = await this.saveEntity(updatedStep);
    if (!saveResult.ok) {
      return err(saveResult.error);
    }

    return ok(updatedStep);
  }

  /**
   * Count steps for a quest.
   */
  async countByQuest(questId: QuestId): AsyncAppResult<number> {
    try {
      const indexKey = SwordKeys.questSteps(questId);
      const count = await this.store.scard(indexKey);
      return ok(count);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to count steps: ${error instanceof Error ? error.message : String(error)}`,
          { questId }
        )
      );
    }
  }

  /**
   * Delete all steps for a quest.
   * Used for cascade delete from QuestStore.
   */
  async deleteByQuest(questId: QuestId): AsyncAppResult<number> {
    try {
      const indexKey = SwordKeys.questSteps(questId);
      const stepIds = await this.store.smembers(indexKey);

      let deleted = 0;
      for (const id of stepIds) {
        const result = await this.delete(id as StepId);
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
          `Failed to delete steps for quest: ${error instanceof Error ? error.message : String(error)}`,
          { questId }
        )
      );
    }
  }

  /**
   * Register step for date-based lookup by user.
   * Called when scheduling sparks for a step.
   */
  async registerForDate(
    userId: UserId,
    stepId: StepId,
    date: string
  ): AsyncAppResult<void> {
    if (!DATE_FORMAT_REGEX.test(date)) {
      return err(
        storeError(ErrorCodes.INVALID_DATA, 'Date must be in YYYY-MM-DD format', { date })
      );
    }

    try {
      const key = buildKey(KeyNamespace.SWORD, 'date', userId, date);
      await this.store.sadd(key, stepId);
      return ok(undefined);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to register step for date: ${error instanceof Error ? error.message : String(error)}`,
          { userId, stepId, date }
        )
      );
    }
  }

  /**
   * Unregister step from date-based lookup.
   */
  async unregisterFromDate(
    userId: UserId,
    stepId: StepId,
    date: string
  ): AsyncAppResult<void> {
    try {
      const key = buildKey(KeyNamespace.SWORD, 'date', userId, date);
      await this.store.srem(key, stepId);
      return ok(undefined);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to unregister step from date: ${error instanceof Error ? error.message : String(error)}`,
          { userId, stepId, date }
        )
      );
    }
  }

  /**
   * Set cascade delete callback.
   */
  setCascadeDeleteCallback(callback: (stepId: StepId) => Promise<number>): void {
    this.cascadeDeleteCallback = callback;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // INDEX MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Add step to quest's step index.
   */
  private async addToQuestIndex(questId: QuestId, stepId: StepId): AsyncAppResult<void> {
    try {
      const indexKey = SwordKeys.questSteps(questId);
      await this.store.sadd(indexKey, stepId);
      return ok(undefined);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to add step to quest index: ${error instanceof Error ? error.message : String(error)}`,
          { questId, stepId }
        )
      );
    }
  }

  /**
   * Remove step from quest's step index.
   */
  private async removeFromQuestIndex(questId: QuestId, stepId: StepId): AsyncAppResult<void> {
    try {
      const indexKey = SwordKeys.questSteps(questId);
      await this.store.srem(indexKey, stepId);
      return ok(undefined);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to remove step from quest index: ${error instanceof Error ? error.message : String(error)}`,
          { questId, stepId }
        )
      );
    }
  }

  /**
   * Add step to date index (for date-based lookup within quest).
   */
  private async addToDateIndex(
    questId: QuestId,
    date: string,
    stepId: StepId
  ): AsyncAppResult<void> {
    try {
      const key = buildKey(KeyNamespace.SWORD, 'quest', questId, 'date', date);
      await this.store.sadd(key, stepId);
      return ok(undefined);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to add step to date index: ${error instanceof Error ? error.message : String(error)}`,
          { questId, date, stepId }
        )
      );
    }
  }

  /**
   * Remove step from date index.
   */
  private async removeFromDateIndex(
    questId: QuestId,
    date: string,
    stepId: StepId
  ): AsyncAppResult<void> {
    try {
      const key = buildKey(KeyNamespace.SWORD, 'quest', questId, 'date', date);
      await this.store.srem(key, stepId);
      return ok(undefined);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to remove step from date index: ${error instanceof Error ? error.message : String(error)}`,
          { questId, date, stepId }
        )
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a StepStore instance.
 */
export function createStepStore(
  store: KeyValueStore,
  config?: Partial<SecureStoreConfig>,
  encryption?: EncryptionService
): StepStore {
  return new StepStore(store, config, encryption);
}
