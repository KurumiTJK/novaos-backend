// ═══════════════════════════════════════════════════════════════════════════════
// SPARK STORE — Encrypted Spark Storage
// NovaOS Spark Engine — Phase 12: Secure Store Layer
// ═══════════════════════════════════════════════════════════════════════════════
//
// Persistent storage for Spark entities with:
//   - Encryption at rest
//   - Step-based indexing (sparks per step)
//   - Active spark tracking (one active spark per step)
//   - Escalation level tracking
//   - Cascade delete support
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { KeyValueStore } from '../../../storage/index.js';
import type { EncryptionService } from '../../../security/encryption/service.js';
import { ok, err, type AsyncAppResult } from '../../../types/result.js';
import type { SparkId, StepId } from '../../../types/branded.js';
import { createTimestamp } from '../../../types/branded.js';
import { SwordKeys, buildKey, KeyNamespace } from '../../../infrastructure/redis/keys.js';
import type { Spark, SparkStatus, SparkVariant } from '../types.js';
import { SPARK_MINUTES_BOUNDS } from '../types.js';
import { SecureStore, storeError } from './secure-store.js';
import type {
  ISparkStore,
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
// SPARK STORE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Encrypted storage for Spark entities.
 *
 * Features:
 * - Step-based indexing via Redis sets
 * - Active spark tracking (one active per step)
 * - Escalation level tracking
 * - Status-based filtering
 * - Cascade delete support (deletes reminders)
 */
export class SparkStore extends SecureStore<Spark, SparkId> implements ISparkStore {
  /**
   * Callback for cascade delete (set by parent store manager).
   */
  private cascadeDeleteCallback?: (sparkId: SparkId) => Promise<number>;

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

  protected getKey(id: SparkId): string {
    return SwordKeys.spark(id);
  }

  protected validate(spark: Spark): string | undefined {
    if (!spark.id) {
      return 'Spark ID is required';
    }
    if (!spark.stepId) {
      return 'Step ID is required';
    }
    if (!spark.action || spark.action.trim().length === 0) {
      return 'Spark action is required';
    }
    if (spark.action.length > 1000) {
      return 'Spark action must be 1000 characters or less';
    }
    const validStatuses: SparkStatus[] = ['pending', 'active', 'completed', 'skipped'];
    if (!validStatuses.includes(spark.status)) {
      return `Invalid spark status: ${spark.status}`;
    }
    const validVariants: SparkVariant[] = ['full', 'reduced', 'minimal'];
    if (!validVariants.includes(spark.variant)) {
      return `Invalid spark variant: ${spark.variant}`;
    }
    if (typeof spark.escalationLevel !== 'number' || spark.escalationLevel < 0 || spark.escalationLevel > 3) {
      return 'Escalation level must be between 0 and 3';
    }
    if (typeof spark.estimatedMinutes !== 'number') {
      return 'Estimated minutes is required';
    }
    if (spark.estimatedMinutes < SPARK_MINUTES_BOUNDS.MIN || spark.estimatedMinutes > SPARK_MINUTES_BOUNDS.MAX) {
      return `Estimated minutes must be between ${SPARK_MINUTES_BOUNDS.MIN} and ${SPARK_MINUTES_BOUNDS.MAX}`;
    }
    return undefined;
  }

  protected getId(spark: Spark): SparkId {
    return spark.id;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Save a spark (create or update).
   */
  async save(spark: Spark, options: SaveOptions = {}): AsyncAppResult<SaveResult<Spark>> {
    // Get existing spark to check for status changes
    const existingResult = await this.getEntity(spark.id);
    const existingSpark = existingResult.ok ? existingResult.value : null;

    // Save the spark entity
    const result = await this.saveEntity(spark, options);
    if (!result.ok) {
      return result;
    }

    // Update step's spark index
    const indexResult = await this.addToStepIndex(spark.stepId, spark.id);
    if (!indexResult.ok) {
      // Rollback: delete the saved spark
      await this.deleteEntity(spark.id);
      return indexResult;
    }

    // Update active spark tracking
    const isActive = spark.status === 'active' || spark.status === 'pending';
    const wasActive = existingSpark && (existingSpark.status === 'active' || existingSpark.status === 'pending');

    if (isActive && !wasActive) {
      // Becoming active - set as active spark for step
      await this.setActiveSparkForStep(spark.stepId, spark.id);
    } else if (!isActive && wasActive) {
      // No longer active - clear active spark reference
      await this.clearActiveSparkForStep(spark.stepId, spark.id);
    }

    return ok({
      entity: spark,
      version: result.value.version,
      created: result.value.created,
    });
  }

  /**
   * Get a spark by ID.
   */
  async get(sparkId: SparkId, options: GetOptions = {}): AsyncAppResult<Spark | null> {
    return this.getEntity(sparkId, options);
  }

  /**
   * Delete a spark and all associated data.
   */
  async delete(sparkId: SparkId): AsyncAppResult<DeleteResult> {
    // Get the spark first to find the stepId
    const sparkResult = await this.getEntity(sparkId);
    if (!sparkResult.ok) {
      return err(sparkResult.error);
    }

    if (sparkResult.value === null) {
      return ok({ deleted: false });
    }

    const spark = sparkResult.value;

    // Cascade delete (reminders)
    let cascadeCount = 0;
    if (this.cascadeDeleteCallback) {
      cascadeCount = await this.cascadeDeleteCallback(sparkId);
    }

    // Remove from step's spark index
    await this.removeFromStepIndex(spark.stepId, sparkId);

    // Clear active spark reference if this was active
    if (spark.status === 'active' || spark.status === 'pending') {
      await this.clearActiveSparkForStep(spark.stepId, sparkId);
    }

    // Delete the spark entity
    const deleteResult = await this.deleteEntity(sparkId);
    if (!deleteResult.ok) {
      return err(deleteResult.error);
    }

    return ok({
      deleted: deleteResult.value,
      cascadeCount,
    });
  }

  /**
   * Get all sparks for a step.
   */
  async getByStep(
    stepId: StepId,
    options: ListOptions = {}
  ): AsyncAppResult<ListResult<Spark>> {
    const { limit = 100, offset = 0, status, sortOrder = 'asc' } = options;

    try {
      // Get spark IDs from step's index
      const indexKey = this.getStepSparksKey(stepId);
      const sparkIds = await this.store.smembers(indexKey);

      if (sparkIds.length === 0) {
        return ok({ items: [], total: 0, hasMore: false });
      }

      // Fetch all sparks
      const sparks: Spark[] = [];
      for (const id of sparkIds) {
        const result = await this.getEntity(id as SparkId);
        if (result.ok && result.value !== null) {
          // Filter by status if specified
          if (!status || result.value.status === status) {
            sparks.push(result.value);
          }
        }
      }

      // Sort by escalationLevel (primary) and createdAt (secondary)
      sparks.sort((a, b) => {
        if (a.escalationLevel !== b.escalationLevel) {
          return sortOrder === 'asc'
            ? a.escalationLevel - b.escalationLevel
            : b.escalationLevel - a.escalationLevel;
        }
        const aTime = new Date(a.createdAt).getTime();
        const bTime = new Date(b.createdAt).getTime();
        return sortOrder === 'asc' ? aTime - bTime : bTime - aTime;
      });

      // Apply pagination
      const total = sparks.length;
      const paged = sparks.slice(offset, offset + limit);
      const hasMore = offset + limit < total;

      return ok({ items: paged, total, hasMore });
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to get sparks for step: ${error instanceof Error ? error.message : String(error)}`,
          { stepId }
        )
      );
    }
  }

  /**
   * Get the active spark for a step (status = 'active' or 'pending').
   */
  async getActiveForStep(stepId: StepId): AsyncAppResult<Spark | null> {
    try {
      // Check the active spark reference first
      const activeKey = this.getActiveSparkKey(stepId);
      const activeSparkId = await this.store.get(activeKey);

      if (activeSparkId) {
        const result = await this.getEntity(activeSparkId as SparkId);
        if (result.ok && result.value !== null) {
          // Verify still active
          if (result.value.status === 'active' || result.value.status === 'pending') {
            return ok(result.value);
          }
          // Stale reference, clear it
          await this.store.delete(activeKey);
        }
      }

      // Fallback: search through all sparks for step
      const sparksResult = await this.getByStep(stepId, { limit: 100 });
      if (!sparksResult.ok) {
        return sparksResult;
      }

      for (const spark of sparksResult.value.items) {
        if (spark.status === 'active' || spark.status === 'pending') {
          // Update the active reference
          await this.setActiveSparkForStep(stepId, spark.id);
          return ok(spark);
        }
      }

      return ok(null);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to get active spark: ${error instanceof Error ? error.message : String(error)}`,
          { stepId }
        )
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ADDITIONAL METHODS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get sparks by status for a step.
   */
  async getByStatus(stepId: StepId, status: SparkStatus): AsyncAppResult<readonly Spark[]> {
    const result = await this.getByStep(stepId, { status, limit: 1000 });
    if (!result.ok) {
      return result;
    }
    return ok(result.value.items);
  }

  /**
   * Update a spark's status.
   */
  async updateStatus(sparkId: SparkId, status: SparkStatus): AsyncAppResult<Spark> {
    // Get current spark
    const result = await this.getEntity(sparkId);
    if (!result.ok) {
      return result;
    }
    if (result.value === null) {
      return err(
        storeError(ErrorCodes.NOT_FOUND, `Spark not found: ${sparkId}`, { sparkId })
      );
    }

    const spark = result.value;
    const previousStatus = spark.status;

    // Create updated spark
    const updatedSpark: Spark = {
      ...spark,
      status,
      updatedAt: createTimestamp(),
    };

    // Save updated spark
    const saveResult = await this.saveEntity(updatedSpark);
    if (!saveResult.ok) {
      return err(saveResult.error);
    }

    // Update active spark tracking
    const isActive = status === 'active' || status === 'pending';
    const wasActive = previousStatus === 'active' || previousStatus === 'pending';

    if (isActive && !wasActive) {
      await this.setActiveSparkForStep(spark.stepId, sparkId);
    } else if (!isActive && wasActive) {
      await this.clearActiveSparkForStep(spark.stepId, sparkId);
    }

    return ok(updatedSpark);
  }

  /**
   * Update a spark's escalation level.
   */
  async updateEscalation(
    sparkId: SparkId,
    escalationLevel: number,
    variant: SparkVariant
  ): AsyncAppResult<Spark> {
    if (escalationLevel < 0 || escalationLevel > 3) {
      return err(
        storeError(ErrorCodes.INVALID_DATA, 'Escalation level must be between 0 and 3', {
          escalationLevel,
        })
      );
    }

    // Get current spark
    const result = await this.getEntity(sparkId);
    if (!result.ok) {
      return result;
    }
    if (result.value === null) {
      return err(
        storeError(ErrorCodes.NOT_FOUND, `Spark not found: ${sparkId}`, { sparkId })
      );
    }

    const spark = result.value;

    // Create updated spark
    const updatedSpark: Spark = {
      ...spark,
      escalationLevel,
      variant,
      updatedAt: createTimestamp(),
    };

    // Save updated spark
    const saveResult = await this.saveEntity(updatedSpark);
    if (!saveResult.ok) {
      return err(saveResult.error);
    }

    return ok(updatedSpark);
  }

  /**
   * Count sparks for a step.
   */
  async countByStep(stepId: StepId): AsyncAppResult<number> {
    try {
      const indexKey = this.getStepSparksKey(stepId);
      const count = await this.store.scard(indexKey);
      return ok(count);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to count sparks: ${error instanceof Error ? error.message : String(error)}`,
          { stepId }
        )
      );
    }
  }

  /**
   * Delete all sparks for a step.
   * Used for cascade delete from StepStore.
   */
  async deleteByStep(stepId: StepId): AsyncAppResult<number> {
    try {
      const indexKey = this.getStepSparksKey(stepId);
      const sparkIds = await this.store.smembers(indexKey);

      let deleted = 0;
      for (const id of sparkIds) {
        const result = await this.delete(id as SparkId);
        if (result.ok && result.value.deleted) {
          deleted++;
        }
      }

      // Clean up indexes
      await this.store.delete(indexKey);
      await this.store.delete(this.getActiveSparkKey(stepId));

      return ok(deleted);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to delete sparks for step: ${error instanceof Error ? error.message : String(error)}`,
          { stepId }
        )
      );
    }
  }

  /**
   * Get the latest spark for a step by escalation level.
   */
  async getLatestByEscalation(stepId: StepId): AsyncAppResult<Spark | null> {
    const sparksResult = await this.getByStep(stepId, { sortOrder: 'desc', limit: 1 });
    if (!sparksResult.ok) {
      return sparksResult;
    }
    return ok(sparksResult.value.items.length > 0 ? sparksResult.value.items[0] : null);
  }

  /**
   * Set cascade delete callback.
   */
  setCascadeDeleteCallback(callback: (sparkId: SparkId) => Promise<number>): void {
    this.cascadeDeleteCallback = callback;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // KEY HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get the key for step's spark set.
   */
  private getStepSparksKey(stepId: StepId): string {
    return buildKey(KeyNamespace.SWORD, 'step', stepId, 'sparks');
  }

  /**
   * Get the key for step's active spark reference.
   */
  private getActiveSparkKey(stepId: StepId): string {
    return buildKey(KeyNamespace.SWORD, 'step', stepId, 'active');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // INDEX MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Add spark to step's spark index.
   */
  private async addToStepIndex(stepId: StepId, sparkId: SparkId): AsyncAppResult<void> {
    try {
      const indexKey = this.getStepSparksKey(stepId);
      await this.store.sadd(indexKey, sparkId);
      return ok(undefined);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to add spark to step index: ${error instanceof Error ? error.message : String(error)}`,
          { stepId, sparkId }
        )
      );
    }
  }

  /**
   * Remove spark from step's spark index.
   */
  private async removeFromStepIndex(stepId: StepId, sparkId: SparkId): AsyncAppResult<void> {
    try {
      const indexKey = this.getStepSparksKey(stepId);
      await this.store.srem(indexKey, sparkId);
      return ok(undefined);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to remove spark from step index: ${error instanceof Error ? error.message : String(error)}`,
          { stepId, sparkId }
        )
      );
    }
  }

  /**
   * Set active spark for a step.
   */
  private async setActiveSparkForStep(stepId: StepId, sparkId: SparkId): AsyncAppResult<void> {
    try {
      const key = this.getActiveSparkKey(stepId);
      await this.store.set(key, sparkId);
      return ok(undefined);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to set active spark: ${error instanceof Error ? error.message : String(error)}`,
          { stepId, sparkId }
        )
      );
    }
  }

  /**
   * Clear active spark reference for a step (if it matches).
   */
  private async clearActiveSparkForStep(stepId: StepId, sparkId: SparkId): AsyncAppResult<void> {
    try {
      const key = this.getActiveSparkKey(stepId);
      const currentActive = await this.store.get(key);
      if (currentActive === sparkId) {
        await this.store.delete(key);
      }
      return ok(undefined);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to clear active spark: ${error instanceof Error ? error.message : String(error)}`,
          { stepId, sparkId }
        )
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a SparkStore instance.
 */
export function createSparkStore(
  store: KeyValueStore,
  config?: Partial<SecureStoreConfig>,
  encryption?: EncryptionService
): SparkStore {
  return new SparkStore(store, config, encryption);
}
