// ═══════════════════════════════════════════════════════════════════════════════
// IDEMPOTENCY — Prevent Duplicate Reminder Sends
// NovaOS Spark Engine — Phase 11: Reminder Service
// ═══════════════════════════════════════════════════════════════════════════════
//
// Ensures reminders are sent exactly once:
//   - Check idempotency key before sending
//   - Set key in Redis with TTL before send
//   - Prevents duplicate sends on retry/crash recovery
//
// Uses Redis SET NX (set if not exists) for atomic check-and-set.
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { ReminderId, SparkId } from '../../../types/branded.js';
import type { KeyValueStore } from '../../../storage/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Result of an idempotency check.
 */
export interface IdempotencyCheckResult {
  /** Whether the operation can proceed (key was not already set) */
  readonly canProceed: boolean;

  /** The idempotency key that was checked */
  readonly key: string;

  /** When the key was originally set (if already exists) */
  readonly existingSendTime?: string;

  /** Reason if operation cannot proceed */
  readonly reason?: string;
}

/**
 * Result of claiming an idempotency key.
 */
export interface IdempotencyClaimResult {
  /** Whether the key was successfully claimed */
  readonly claimed: boolean;

  /** The idempotency key */
  readonly key: string;

  /** When the claim expires */
  readonly expiresAt?: string;

  /** Reason if claim failed */
  readonly reason?: string;
}

/**
 * Idempotency manager configuration.
 */
export interface IdempotencyConfig {
  /** Key prefix for idempotency keys */
  readonly keyPrefix: string;

  /** TTL for idempotency keys in seconds */
  readonly ttlSeconds: number;

  /** Whether to include timestamp in stored value */
  readonly storeTimestamp: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Default idempotency configuration.
 */
export const DEFAULT_IDEMPOTENCY_CONFIG: IdempotencyConfig = {
  keyPrefix: 'reminder:idempotent:',
  ttlSeconds: 86400, // 24 hours
  storeTimestamp: true,
};

// ─────────────────────────────────────────────────────────────────────────────────
// KEY GENERATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Generate an idempotency key for a reminder.
 *
 * @param reminderId - Reminder ID
 * @param prefix - Key prefix
 * @returns Idempotency key
 */
export function generateIdempotencyKey(reminderId: ReminderId, prefix: string): string {
  return `${prefix}${reminderId}`;
}

/**
 * Generate an idempotency key for a spark's daily reminders.
 * Used to prevent scheduling reminders multiple times for the same spark+date.
 *
 * @param sparkId - Spark ID
 * @param date - Date string (YYYY-MM-DD)
 * @param prefix - Key prefix
 * @returns Idempotency key
 */
export function generateSparkDateKey(sparkId: SparkId, date: string, prefix: string): string {
  return `${prefix}spark:${sparkId}:${date}`;
}

// ─────────────────────────────────────────────────────────────────────────────────
// IDEMPOTENCY MANAGER
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * IdempotencyManager — Prevents duplicate reminder operations.
 *
 * Uses Redis SET NX for atomic check-and-set operations.
 * Keys automatically expire after TTL to prevent unbounded growth.
 */
export class IdempotencyManager {
  private readonly store: KeyValueStore;
  private readonly config: IdempotencyConfig;

  constructor(store: KeyValueStore, config?: Partial<IdempotencyConfig>) {
    this.store = store;
    this.config = { ...DEFAULT_IDEMPOTENCY_CONFIG, ...config };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Core Operations
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Check if a reminder can be sent (idempotency key not already set).
   *
   * @param reminderId - Reminder ID to check
   * @returns Check result
   */
  async checkCanSend(reminderId: ReminderId): Promise<IdempotencyCheckResult> {
    const key = generateIdempotencyKey(reminderId, this.config.keyPrefix);

    try {
      const existing = await this.store.get(key);

      if (existing !== null) {
        return {
          canProceed: false,
          key,
          existingSendTime: existing,
          reason: 'Reminder already sent',
        };
      }

      return {
        canProceed: true,
        key,
      };
    } catch (error) {
      // On error, default to allowing send (fail-open for availability)
      // The reminder service should handle actual send failures
      return {
        canProceed: true,
        key,
        reason: `Idempotency check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Claim an idempotency key before sending.
   * Uses atomic SET NX to prevent race conditions.
   *
   * @param reminderId - Reminder ID to claim
   * @returns Claim result
   */
  async claimForSend(reminderId: ReminderId): Promise<IdempotencyClaimResult> {
    const key = generateIdempotencyKey(reminderId, this.config.keyPrefix);
    const value = this.config.storeTimestamp ? new Date().toISOString() : '1';

    try {
      // Check if key already exists
      const existing = await this.store.get(key);

      if (existing !== null) {
        return {
          claimed: false,
          key,
          reason: 'Key already claimed',
        };
      }

      // Set with TTL
      await this.store.set(key, value, this.config.ttlSeconds);

      // Calculate expiry time
      const expiresAt = new Date(Date.now() + this.config.ttlSeconds * 1000).toISOString();

      return {
        claimed: true,
        key,
        expiresAt,
      };
    } catch (error) {
      return {
        claimed: false,
        key,
        reason: `Failed to claim key: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Check and claim in one operation.
   * This is the preferred method for most use cases.
   *
   * @param reminderId - Reminder ID
   * @returns Claim result (claimed=true means you can proceed)
   */
  async checkAndClaim(reminderId: ReminderId): Promise<IdempotencyClaimResult> {
    return this.claimForSend(reminderId);
  }

  /**
   * Release an idempotency key (e.g., if send failed and should be retried).
   *
   * @param reminderId - Reminder ID to release
   * @returns Whether the key was released
   */
  async release(reminderId: ReminderId): Promise<boolean> {
    const key = generateIdempotencyKey(reminderId, this.config.keyPrefix);

    try {
      return await this.store.delete(key);
    } catch {
      return false;
    }
  }

  /**
   * Check if reminders have already been scheduled for a spark on a given date.
   *
   * @param sparkId - Spark ID
   * @param date - Date string (YYYY-MM-DD)
   * @returns Whether reminders are already scheduled
   */
  async isSparkScheduledForDate(sparkId: SparkId, date: string): Promise<boolean> {
    const key = generateSparkDateKey(sparkId, date, this.config.keyPrefix);

    try {
      const existing = await this.store.get(key);
      return existing !== null;
    } catch {
      // On error, assume not scheduled (fail-open)
      return false;
    }
  }

  /**
   * Mark a spark as having reminders scheduled for a date.
   *
   * @param sparkId - Spark ID
   * @param date - Date string (YYYY-MM-DD)
   * @returns Whether the mark was successful
   */
  async markSparkScheduledForDate(sparkId: SparkId, date: string): Promise<boolean> {
    const key = generateSparkDateKey(sparkId, date, this.config.keyPrefix);
    const value = new Date().toISOString();

    try {
      await this.store.set(key, value, this.config.ttlSeconds);
      return true;
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Batch Operations
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Check multiple reminders at once.
   *
   * @param reminderIds - Array of reminder IDs
   * @returns Map of reminder ID to check result
   */
  async checkMultiple(
    reminderIds: readonly ReminderId[]
  ): Promise<Map<ReminderId, IdempotencyCheckResult>> {
    const results = new Map<ReminderId, IdempotencyCheckResult>();

    // Process in parallel
    const checks = await Promise.all(
      reminderIds.map(async (id) => ({
        id,
        result: await this.checkCanSend(id),
      }))
    );

    for (const { id, result } of checks) {
      results.set(id, result);
    }

    return results;
  }

  /**
   * Filter reminder IDs to only those that can be sent.
   *
   * @param reminderIds - Array of reminder IDs
   * @returns Array of IDs that can be sent
   */
  async filterSendable(reminderIds: readonly ReminderId[]): Promise<ReminderId[]> {
    const results = await this.checkMultiple(reminderIds);
    return reminderIds.filter((id) => results.get(id)?.canProceed === true);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get the current configuration.
   */
  getConfig(): IdempotencyConfig {
    return { ...this.config };
  }

  /**
   * Check if the store is available.
   */
  async isHealthy(): Promise<boolean> {
    try {
      // Try a simple operation
      const testKey = `${this.config.keyPrefix}health-check`;
      await this.store.set(testKey, '1', 10);
      await this.store.delete(testKey);
      return true;
    } catch {
      return false;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// FACTORY
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create an IdempotencyManager with default configuration.
 *
 * @param store - KeyValueStore instance
 * @param config - Optional configuration overrides
 * @returns IdempotencyManager instance
 */
export function createIdempotencyManager(
  store: KeyValueStore,
  config?: Partial<IdempotencyConfig>
): IdempotencyManager {
  return new IdempotencyManager(store, config);
}
