// ═══════════════════════════════════════════════════════════════════════════════
// REMINDER STORE — Encrypted Reminder Storage
// NovaOS Spark Engine — Phase 12: Secure Store Layer
// ═══════════════════════════════════════════════════════════════════════════════
//
// Persistent storage for ReminderSchedule entities with:
//   - Encryption at rest
//   - Sorted set for time-based due queries
//   - User-based indexing (pending reminders per user)
//   - Spark-based indexing (reminders per spark)
//   - Status management with TTL for expired reminders
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { KeyValueStore } from '../../../storage/index.js';
import type { RedisStore } from '../../../infrastructure/redis/client.js';
import type { EncryptionService } from '../../../security/encryption/service.js';
import { ok, err, type AsyncAppResult } from '../../../types/result.js';
import type { ReminderId, SparkId, UserId, StepId, Timestamp } from '../../../types/branded.js';
import { createTimestamp } from '../../../types/branded.js';
import { buildKey, KeyNamespace } from '../../../infrastructure/redis/keys.js';
import type { ReminderSchedule, ReminderStatus, ReminderTone, SparkVariant, ReminderChannels } from '../types.js';
import { SecureStore, storeError } from '../store/secure-store.js';
import type { IReminderStore, SecureStoreConfig, SaveOptions, GetOptions } from '../store/types.js';
import { StoreErrorCode as ErrorCodes } from '../store/types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * TTL for expired reminders (24 hours).
 */
const EXPIRED_REMINDER_TTL_SECONDS = 24 * 60 * 60;

// ═══════════════════════════════════════════════════════════════════════════════
// REMINDER STORE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Encrypted storage for ReminderSchedule entities.
 *
 * Features:
 * - Sorted set for efficient time-based due queries
 * - User-based indexing for pending reminders
 * - Spark-based indexing for bulk cancellation
 * - Status-based TTL (expired reminders auto-cleanup)
 *
 * Implements IReminderStore from Phase 11.
 */
export class ReminderStore extends SecureStore<ReminderSchedule, ReminderId> implements IReminderStore {
  /**
   * Extended store with sorted set operations.
   */
  private readonly extendedStore: RedisStore | null;

  constructor(
    store: KeyValueStore,
    config: Partial<SecureStoreConfig> = {},
    encryption?: EncryptionService
  ) {
    super(store, config, encryption);
    
    // Check if store supports sorted sets
    this.extendedStore = 'zadd' in store ? (store as unknown as RedisStore) : null;
  }

  /**
   * Get the Redis store, throwing if not available.
   * Used for Redis-specific operations (sets, sorted sets, etc.)
   */
  private get redis(): RedisStore {
    if (!this.extendedStore) {
      throw new Error('ReminderStore requires Redis for set operations');
    }
    return this.extendedStore;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ABSTRACT METHOD IMPLEMENTATIONS
  // ─────────────────────────────────────────────────────────────────────────────

  protected getKey(id: ReminderId): string {
    return buildKey(KeyNamespace.SWORD, 'reminder', id);
  }

  protected validate(reminder: ReminderSchedule): string | undefined {
    if (!reminder.id) {
      return 'Reminder ID is required';
    }
    if (!reminder.userId) {
      return 'User ID is required';
    }
    if (!reminder.stepId) {
      return 'Step ID is required';
    }
    if (!reminder.sparkId) {
      return 'Spark ID is required';
    }
    if (!reminder.scheduledTime) {
      return 'Scheduled time is required';
    }
    // Validate scheduledTime is ISO 8601
    if (isNaN(new Date(reminder.scheduledTime).getTime())) {
      return 'Scheduled time must be valid ISO 8601 format';
    }
    const validStatuses: ReminderStatus[] = ['pending', 'sent', 'cancelled', 'acknowledged', 'expired'];
    if (!validStatuses.includes(reminder.status)) {
      return `Invalid reminder status: ${reminder.status}`;
    }
    const validTones: ReminderTone[] = ['encouraging', 'gentle', 'last_chance'];
    if (!validTones.includes(reminder.tone)) {
      return `Invalid reminder tone: ${reminder.tone}`;
    }
    const validVariants: SparkVariant[] = ['full', 'reduced', 'minimal'];
    if (!validVariants.includes(reminder.sparkVariant)) {
      return `Invalid spark variant: ${reminder.sparkVariant}`;
    }
    if (typeof reminder.escalationLevel !== 'number' || reminder.escalationLevel < 0 || reminder.escalationLevel > 3) {
      return 'Escalation level must be between 0 and 3';
    }
    if (!reminder.channels || typeof reminder.channels !== 'object') {
      return 'Channels configuration is required';
    }
    return undefined;
  }

  protected getId(reminder: ReminderSchedule): ReminderId {
    return reminder.id;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLIC API (IReminderStore)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Save a reminder.
   */
  async save(reminder: ReminderSchedule): AsyncAppResult<ReminderSchedule> {
    // Determine TTL based on status
    let ttl: number | undefined;
    if (reminder.status === 'expired' || reminder.status === 'cancelled') {
      // Use constant for expired reminder TTL (config extension not needed)
      ttl = EXPIRED_REMINDER_TTL_SECONDS;
    }

    // Save the reminder entity
    const result = await this.saveEntity(reminder, { ttlSeconds: ttl });
    if (!result.ok) {
      return err(result.error);
    }

    // Update indexes based on status
    if (reminder.status === 'pending') {
      // Add to due queue (sorted set by scheduled time)
      await this.addToDueQueue(reminder);
      
      // Add to user's pending index
      await this.addToUserIndex(reminder.userId, reminder.id);
      
      // Add to spark's reminder index
      await this.addToSparkIndex(reminder.sparkId, reminder.id);
    } else {
      // Remove from pending indexes
      await this.removeFromDueQueue(reminder.id);
      await this.removeFromUserIndex(reminder.userId, reminder.id);
      // Keep in spark index for reference until cascade delete
    }

    return ok(reminder);
  }

  /**
   * Get a reminder by ID.
   */
  async get(reminderId: ReminderId): AsyncAppResult<ReminderSchedule | null> {
    return this.getEntity(reminderId);
  }

  /**
   * Delete a reminder.
   */
  async delete(reminderId: ReminderId): AsyncAppResult<boolean> {
    // Get the reminder first to clean up indexes
    const reminderResult = await this.getEntity(reminderId);
    if (!reminderResult.ok) {
      return err(reminderResult.error);
    }

    if (reminderResult.value === null) {
      return ok(false);
    }

    const reminder = reminderResult.value;

    // Remove from all indexes
    await this.removeFromDueQueue(reminderId);
    await this.removeFromUserIndex(reminder.userId, reminderId);
    await this.removeFromSparkIndex(reminder.sparkId, reminderId);

    // Delete the entity
    const result = await this.deleteEntity(reminderId);
    return result;
  }

  /**
   * Get pending reminders for a user.
   */
  async getPendingByUser(userId: UserId): AsyncAppResult<readonly ReminderSchedule[]> {
    try {
      const indexKey = this.getUserPendingKey(userId);
      const reminderIds = await this.redis.smembers(indexKey);

      if (reminderIds.length === 0) {
        return ok([]);
      }

      const reminders: ReminderSchedule[] = [];
      for (const id of reminderIds) {
        const result = await this.getEntity(id as ReminderId);
        if (result.ok && result.value !== null) {
          // Verify still pending
          if (result.value.status === 'pending') {
            reminders.push(result.value);
          } else {
            // Clean up stale index entry
            await this.removeFromUserIndex(userId, id as ReminderId);
          }
        }
      }

      // Sort by scheduled time
      reminders.sort((a, b) => {
        return new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime();
      });

      return ok(reminders);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to get pending reminders for user: ${error instanceof Error ? error.message : String(error)}`,
          { userId }
        )
      );
    }
  }

  /**
   * Get pending reminders for a spark.
   */
  async getPendingBySpark(sparkId: SparkId): AsyncAppResult<readonly ReminderSchedule[]> {
    try {
      const indexKey = this.getSparkRemindersKey(sparkId);
      const reminderIds = await this.redis.smembers(indexKey);

      if (reminderIds.length === 0) {
        return ok([]);
      }

      const reminders: ReminderSchedule[] = [];
      for (const id of reminderIds) {
        const result = await this.getEntity(id as ReminderId);
        if (result.ok && result.value !== null) {
          if (result.value.status === 'pending') {
            reminders.push(result.value);
          }
        }
      }

      // Sort by scheduled time
      reminders.sort((a, b) => {
        return new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime();
      });

      return ok(reminders);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to get pending reminders for spark: ${error instanceof Error ? error.message : String(error)}`,
          { sparkId }
        )
      );
    }
  }

  /**
   * Get due reminders (scheduled time < beforeTime).
   * 
   * ✅ FIX: Uses exclusive upper bound to return reminders with
   * scheduledTime STRICTLY LESS than beforeTime (not <=).
   */
  async getDueReminders(beforeTime?: Date): AsyncAppResult<readonly ReminderSchedule[]> {
    const cutoff = beforeTime ?? new Date();
    const cutoffScore = cutoff.getTime();

    try {
      // Use sorted set for efficient time-based query
      if (this.extendedStore) {
        const dueKey = this.getDueQueueKey();
        // ✅ FIX: Use exclusive upper bound with "(" prefix
        const reminderIds = await this.extendedStore.zrangebyscore(dueKey, '-inf', `(${cutoffScore}`);

        if (reminderIds.length === 0) {
          return ok([]);
        }

        const reminders: ReminderSchedule[] = [];
        for (const id of reminderIds) {
          const result = await this.getEntity(id as ReminderId);
          if (result.ok && result.value !== null) {
            // Verify still pending
            if (result.value.status === 'pending') {
              reminders.push(result.value);
            } else {
              // Clean up stale entry
              await this.removeFromDueQueue(id as ReminderId);
            }
          }
        }

        // Already sorted by scheduled time (from sorted set)
        return ok(reminders);
      }

      // Fallback: scan all pending reminders (less efficient)
      return this.getDueRemindersFallback(cutoff);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to get due reminders: ${error instanceof Error ? error.message : String(error)}`,
          { beforeTime: cutoff.toISOString() }
        )
      );
    }
  }

  /**
   * Update a reminder's status.
   */
  async updateStatus(
    reminderId: ReminderId,
    status: ReminderStatus,
    timestamp?: Timestamp
  ): AsyncAppResult<void> {
    // Get current reminder
    const result = await this.getEntity(reminderId);
    if (!result.ok) {
      return err(result.error);
    }
    if (result.value === null) {
      return err(
        storeError(ErrorCodes.NOT_FOUND, `Reminder not found: ${reminderId}`, { reminderId })
      );
    }

    const reminder = result.value;
    const now = timestamp ?? createTimestamp();

    // Create updated reminder
    const updatedReminder: ReminderSchedule = {
      ...reminder,
      status,
      // Set sentAt when becoming sent
      sentAt: status === 'sent' ? now : reminder.sentAt,
      // Set acknowledgedAt when becoming acknowledged
      acknowledgedAt: status === 'acknowledged' ? now : reminder.acknowledgedAt,
    };

    // Save updated reminder
    const saveResult = await this.save(updatedReminder);
    if (!saveResult.ok) {
      return err(saveResult.error);
    }

    return ok(undefined);
  }

  /**
   * Delete all reminders for a spark.
   */
  async deleteBySpark(sparkId: SparkId): AsyncAppResult<number> {
    try {
      const indexKey = this.getSparkRemindersKey(sparkId);
      const reminderIds = await this.redis.smembers(indexKey);

      let deleted = 0;
      for (const id of reminderIds) {
        const result = await this.delete(id as ReminderId);
        if (result.ok && result.value) {
          deleted++;
        }
      }

      // Clean up the index
      await this.redis.delete(indexKey);

      return ok(deleted);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to delete reminders for spark: ${error instanceof Error ? error.message : String(error)}`,
          { sparkId }
        )
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ADDITIONAL METHODS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Cancel all pending reminders for a spark.
   */
  async cancelBySpark(sparkId: SparkId): AsyncAppResult<number> {
    const pendingResult = await this.getPendingBySpark(sparkId);
    if (!pendingResult.ok) {
      return err(pendingResult.error);
    }

    let cancelled = 0;
    for (const reminder of pendingResult.value) {
      const result = await this.updateStatus(reminder.id, 'cancelled');
      if (result.ok) {
        cancelled++;
      }
    }

    return ok(cancelled);
  }

  /**
   * Mark overdue pending reminders as expired.
   * Called periodically to clean up missed reminders.
   */
  async expireOverdue(maxAgeMs: number = 2 * 60 * 60 * 1000): AsyncAppResult<number> {
    const cutoff = new Date(Date.now() - maxAgeMs);

    try {
      // Get all due reminders older than cutoff
      const dueResult = await this.getDueReminders(cutoff);
      if (!dueResult.ok) {
        return err(dueResult.error);
      }

      let expired = 0;
      for (const reminder of dueResult.value) {
        const scheduledTime = new Date(reminder.scheduledTime).getTime();
        if (scheduledTime < cutoff.getTime()) {
          const result = await this.updateStatus(reminder.id, 'expired');
          if (result.ok) {
            expired++;
          }
        }
      }

      return ok(expired);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to expire overdue reminders: ${error instanceof Error ? error.message : String(error)}`,
          { maxAgeMs }
        )
      );
    }
  }

  /**
   * Count pending reminders for a user.
   */
  async countPendingByUser(userId: UserId): AsyncAppResult<number> {
    try {
      const indexKey = this.getUserPendingKey(userId);
      const count = await this.redis.scard(indexKey);
      return ok(count);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to count pending reminders: ${error instanceof Error ? error.message : String(error)}`,
          { userId }
        )
      );
    }
  }

  /**
   * Get reminder by step and escalation level.
   */
  async getByStepAndLevel(
    stepId: StepId,
    escalationLevel: number
  ): AsyncAppResult<ReminderSchedule | null> {
    // This requires scanning - could be optimized with additional index
    try {
      const pattern = buildKey(KeyNamespace.SWORD, 'reminder', '*');
      const keys = await this.redis.keys(pattern);

      for (const key of keys) {
        const data = await this.redis.get(key);
        if (!data) continue;

        try {
          const parsed = JSON.parse(data);
          if (parsed.data) {
            const reminderResult = await this.getEntity(parsed.data?.id as ReminderId);
            if (reminderResult.ok && reminderResult.value) {
              const reminder = reminderResult.value;
              if (reminder.stepId === stepId && reminder.escalationLevel === escalationLevel) {
                return ok(reminder);
              }
            }
          }
        } catch {
          continue;
        }
      }

      return ok(null);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to get reminder by step and level: ${error instanceof Error ? error.message : String(error)}`,
          { stepId, escalationLevel }
        )
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // KEY HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get the key for the global due queue (sorted set).
   */
  private getDueQueueKey(): string {
    return buildKey(KeyNamespace.SWORD, 'reminders', 'due');
  }

  /**
   * Get the key for user's pending reminders.
   */
  private getUserPendingKey(userId: UserId): string {
    return buildKey(KeyNamespace.SWORD, 'user', userId, 'reminders');
  }

  /**
   * Get the key for spark's reminders.
   */
  private getSparkRemindersKey(sparkId: SparkId): string {
    return buildKey(KeyNamespace.SWORD, 'spark', sparkId, 'reminders');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // INDEX MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Add reminder to due queue (sorted set).
   */
  private async addToDueQueue(reminder: ReminderSchedule): AsyncAppResult<void> {
    try {
      const score = new Date(reminder.scheduledTime).getTime();
      const key = this.getDueQueueKey();

      if (this.extendedStore) {
        await this.extendedStore.zadd(key, score, reminder.id);
      } else {
        // Fallback: use a set (loses time ordering)
        await this.redis.sadd(key, reminder.id);
      }

      return ok(undefined);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to add reminder to due queue: ${error instanceof Error ? error.message : String(error)}`,
          { reminderId: reminder.id }
        )
      );
    }
  }

  /**
   * Remove reminder from due queue.
   */
  private async removeFromDueQueue(reminderId: ReminderId): AsyncAppResult<void> {
    try {
      const key = this.getDueQueueKey();

      if (this.extendedStore) {
        // Use ZREM for sorted set
        await this.redis.srem(key, reminderId);
      } else {
        await this.redis.srem(key, reminderId);
      }

      return ok(undefined);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to remove reminder from due queue: ${error instanceof Error ? error.message : String(error)}`,
          { reminderId }
        )
      );
    }
  }

  /**
   * Add reminder to user's pending index.
   */
  private async addToUserIndex(userId: UserId, reminderId: ReminderId): AsyncAppResult<void> {
    try {
      const key = this.getUserPendingKey(userId);
      await this.redis.sadd(key, reminderId);
      return ok(undefined);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to add reminder to user index: ${error instanceof Error ? error.message : String(error)}`,
          { userId, reminderId }
        )
      );
    }
  }

  /**
   * Remove reminder from user's pending index.
   */
  private async removeFromUserIndex(userId: UserId, reminderId: ReminderId): AsyncAppResult<void> {
    try {
      const key = this.getUserPendingKey(userId);
      await this.redis.srem(key, reminderId);
      return ok(undefined);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to remove reminder from user index: ${error instanceof Error ? error.message : String(error)}`,
          { userId, reminderId }
        )
      );
    }
  }

  /**
   * Add reminder to spark's reminder index.
   */
  private async addToSparkIndex(sparkId: SparkId, reminderId: ReminderId): AsyncAppResult<void> {
    try {
      const key = this.getSparkRemindersKey(sparkId);
      await this.redis.sadd(key, reminderId);
      return ok(undefined);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to add reminder to spark index: ${error instanceof Error ? error.message : String(error)}`,
          { sparkId, reminderId }
        )
      );
    }
  }

  /**
   * Remove reminder from spark's reminder index.
   */
  private async removeFromSparkIndex(sparkId: SparkId, reminderId: ReminderId): AsyncAppResult<void> {
    try {
      const key = this.getSparkRemindersKey(sparkId);
      await this.redis.srem(key, reminderId);
      return ok(undefined);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to remove reminder from spark index: ${error instanceof Error ? error.message : String(error)}`,
          { sparkId, reminderId }
        )
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // FALLBACK METHODS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Fallback for getDueReminders when sorted sets not available.
   * ✅ FIX: Uses strict less-than for consistency with sorted set query
   */
  private async getDueRemindersFallback(cutoff: Date): AsyncAppResult<readonly ReminderSchedule[]> {
    try {
      const key = this.getDueQueueKey();
      const reminderIds = await this.redis.smembers(key);

      const reminders: ReminderSchedule[] = [];
      for (const id of reminderIds) {
        const result = await this.getEntity(id as ReminderId);
        if (result.ok && result.value !== null) {
          if (result.value.status === 'pending') {
            const scheduledTime = new Date(result.value.scheduledTime).getTime();
            // ✅ FIX: Use strict less-than for consistency
            if (scheduledTime < cutoff.getTime()) {
              reminders.push(result.value);
            }
          }
        }
      }

      // Sort by scheduled time
      reminders.sort((a, b) => {
        return new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime();
      });

      return ok(reminders);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to get due reminders (fallback): ${error instanceof Error ? error.message : String(error)}`,
          { cutoff: cutoff.toISOString() }
        )
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a ReminderStore instance.
 */
export function createReminderStore(
  store: KeyValueStore,
  config?: Partial<SecureStoreConfig>,
  encryption?: EncryptionService
): ReminderStore {
  return new ReminderStore(store, config, encryption);
}
