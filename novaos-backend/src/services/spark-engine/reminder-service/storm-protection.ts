// ═══════════════════════════════════════════════════════════════════════════════
// STORM PROTECTION — Prevent Reminder Floods After Downtime
// NovaOS Spark Engine — Phase 11: Reminder Service
// ═══════════════════════════════════════════════════════════════════════════════
//
// Prevents notification flooding when the system recovers from downtime:
//   - Skip reminders older than maxAge (default: 2 hours)
//   - Mark skipped reminders as 'expired' with reason
//   - Configurable thresholds per severity level
//
// Without storm protection, a 6-hour outage could send 4+ reminders
// per user simultaneously upon recovery — overwhelming users.
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { ReminderSchedule, ReminderStatus } from '../types.js';
import { getScheduledTimeAgeMs, isInPast } from './scheduler.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Reason a reminder was expired by storm protection.
 */
export type ExpirationReason =
  | 'too_old' // Reminder exceeded max age
  | 'batch_limit' // Too many reminders in batch
  | 'rate_limit' // Would exceed user's rate limit
  | 'manual'; // Manually expired

/**
 * Result of storm protection check for a single reminder.
 */
export interface StormCheckResult {
  /** Whether the reminder should be sent */
  readonly shouldSend: boolean;

  /** Whether the reminder should be expired */
  readonly shouldExpire: boolean;

  /** Reason for expiration (if shouldExpire is true) */
  readonly expirationReason?: ExpirationReason;

  /** Age of the reminder in milliseconds */
  readonly ageMs: number;

  /** Human-readable age description */
  readonly ageDescription: string;

  /** Additional context for logging */
  readonly context?: string;
}

/**
 * Result of storm protection check for a batch of reminders.
 */
export interface BatchStormCheckResult {
  /** Reminders that should be sent */
  readonly toSend: readonly ReminderSchedule[];

  /** Reminders that should be expired */
  readonly toExpire: readonly {
    readonly reminder: ReminderSchedule;
    readonly reason: ExpirationReason;
  }[];

  /** Total reminders checked */
  readonly totalChecked: number;

  /** Whether any reminders were filtered out */
  readonly hadExpired: boolean;

  /** Summary for logging */
  readonly summary: string;
}

/**
 * Storm protection configuration.
 */
export interface StormProtectionConfig {
  /** Maximum age in milliseconds before a reminder is considered stale */
  readonly maxAgeMs: number;

  /** Maximum reminders to send per user in a single batch */
  readonly maxBatchPerUser: number;

  /** Whether to enable storm protection */
  readonly enabled: boolean;

  /** Grace period after scheduled time (to account for processing delays) */
  readonly graceMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Default storm protection configuration.
 */
export const DEFAULT_STORM_PROTECTION_CONFIG: StormProtectionConfig = {
  maxAgeMs: 2 * 60 * 60 * 1000, // 2 hours
  maxBatchPerUser: 2, // Max 2 reminders per user per batch
  enabled: true,
  graceMs: 5 * 60 * 1000, // 5 minutes grace period
};

/**
 * Time thresholds for human-readable descriptions.
 */
const TIME_THRESHOLDS = {
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
} as const;

// ─────────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Format age in milliseconds to a human-readable string.
 *
 * @param ageMs - Age in milliseconds
 * @returns Human-readable age description
 */
export function formatAge(ageMs: number): string {
  const absAge = Math.abs(ageMs);

  if (absAge < TIME_THRESHOLDS.MINUTE) {
    return `${Math.round(absAge / 1000)} seconds`;
  }

  if (absAge < TIME_THRESHOLDS.HOUR) {
    return `${Math.round(absAge / TIME_THRESHOLDS.MINUTE)} minutes`;
  }

  if (absAge < TIME_THRESHOLDS.DAY) {
    const hours = absAge / TIME_THRESHOLDS.HOUR;
    return `${hours.toFixed(1)} hours`;
  }

  const days = absAge / TIME_THRESHOLDS.DAY;
  return `${days.toFixed(1)} days`;
}

/**
 * Check if a reminder is too old based on configuration.
 *
 * @param scheduledTime - ISO 8601 timestamp
 * @param config - Storm protection configuration
 * @returns Whether the reminder is too old
 */
export function isTooOld(scheduledTime: string, config: StormProtectionConfig): boolean {
  const ageMs = getScheduledTimeAgeMs(scheduledTime);

  // If age is negative (future), it's not too old
  if (ageMs < 0) {
    return false;
  }

  // Account for grace period
  const effectiveAge = ageMs - config.graceMs;

  return effectiveAge > config.maxAgeMs;
}

// ─────────────────────────────────────────────────────────────────────────────────
// STORM PROTECTION MANAGER
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * StormProtection — Prevents reminder flooding after downtime.
 *
 * Key behaviors:
 * - Reminders older than maxAge are expired, not sent
 * - Limits how many reminders can be sent per user in a batch
 * - Provides detailed logging for operations decisions
 */
export class StormProtection {
  private readonly config: StormProtectionConfig;

  constructor(config?: Partial<StormProtectionConfig>) {
    this.config = { ...DEFAULT_STORM_PROTECTION_CONFIG, ...config };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Single Reminder Checks
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Check a single reminder against storm protection rules.
   *
   * @param reminder - Reminder to check
   * @returns Check result
   */
  check(reminder: ReminderSchedule): StormCheckResult {
    // If storm protection is disabled, allow all
    if (!this.config.enabled) {
      return {
        shouldSend: true,
        shouldExpire: false,
        ageMs: getScheduledTimeAgeMs(reminder.scheduledTime),
        ageDescription: 'storm protection disabled',
      };
    }

    const ageMs = getScheduledTimeAgeMs(reminder.scheduledTime);
    const ageDescription = formatAge(ageMs);

    // Future reminders are fine
    if (ageMs < 0) {
      return {
        shouldSend: false, // Not yet time to send
        shouldExpire: false,
        ageMs,
        ageDescription: `scheduled for ${formatAge(-ageMs)} from now`,
        context: 'Future reminder, will be processed when due',
      };
    }

    // Check if too old
    if (isTooOld(reminder.scheduledTime, this.config)) {
      return {
        shouldSend: false,
        shouldExpire: true,
        expirationReason: 'too_old',
        ageMs,
        ageDescription: `${ageDescription} old`,
        context: `Exceeded max age of ${formatAge(this.config.maxAgeMs)}`,
      };
    }

    // Within acceptable age
    return {
      shouldSend: true,
      shouldExpire: false,
      ageMs,
      ageDescription: `${ageDescription} old`,
      context: 'Within acceptable age window',
    };
  }

  /**
   * Check if a reminder is ready to be sent (due and not too old).
   *
   * @param reminder - Reminder to check
   * @returns Whether the reminder is ready
   */
  isReady(reminder: ReminderSchedule): boolean {
    // Must be in the past (due)
    if (!isInPast(reminder.scheduledTime)) {
      return false;
    }

    // Must pass storm protection
    const result = this.check(reminder);
    return result.shouldSend;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Batch Processing
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Process a batch of reminders through storm protection.
   *
   * @param reminders - Reminders to process
   * @returns Batch check result with send/expire lists
   */
  processBatch(reminders: readonly ReminderSchedule[]): BatchStormCheckResult {
    const toSend: ReminderSchedule[] = [];
    const toExpire: { reminder: ReminderSchedule; reason: ExpirationReason }[] = [];

    // Group by user for rate limiting
    const byUser = new Map<string, ReminderSchedule[]>();

    for (const reminder of reminders) {
      const userId = reminder.userId as string;
      const existing = byUser.get(userId) ?? [];
      existing.push(reminder);
      byUser.set(userId, existing);
    }

    // Process each user's reminders
    for (const [_userId, userReminders] of byUser) {
      // Sort by scheduled time (oldest first)
      const sorted = [...userReminders].sort(
        (a, b) =>
          new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime()
      );

      let sentCount = 0;

      for (const reminder of sorted) {
        const result = this.check(reminder);

        if (result.shouldExpire) {
          toExpire.push({
            reminder,
            reason: result.expirationReason!,
          });
        } else if (result.shouldSend) {
          // Check batch limit per user
          if (sentCount >= this.config.maxBatchPerUser) {
            toExpire.push({
              reminder,
              reason: 'batch_limit',
            });
          } else {
            toSend.push(reminder);
            sentCount++;
          }
        }
        // If neither shouldSend nor shouldExpire, it's a future reminder - skip
      }
    }

    // Sort toSend by scheduled time for consistent ordering
    toSend.sort(
      (a, b) =>
        new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime()
    );

    const summary = this.buildSummary(reminders.length, toSend.length, toExpire.length);

    return {
      toSend,
      toExpire,
      totalChecked: reminders.length,
      hadExpired: toExpire.length > 0,
      summary,
    };
  }

  /**
   * Filter reminders to only those ready to send (convenience method).
   *
   * @param reminders - Reminders to filter
   * @returns Reminders ready to send
   */
  filterReady(reminders: readonly ReminderSchedule[]): ReminderSchedule[] {
    return this.processBatch(reminders).toSend.slice();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Build a summary string for logging.
   */
  private buildSummary(total: number, sending: number, expiring: number): string {
    if (total === 0) {
      return 'No reminders to process';
    }

    if (expiring === 0) {
      return `Processing ${sending}/${total} reminders (all eligible)`;
    }

    const skipped = total - sending - expiring;
    const parts = [`Processing ${sending}/${total} reminders`];

    if (expiring > 0) {
      parts.push(`${expiring} expired by storm protection`);
    }

    if (skipped > 0) {
      parts.push(`${skipped} not yet due`);
    }

    return parts.join(', ');
  }

  /**
   * Get current configuration.
   */
  getConfig(): StormProtectionConfig {
    return { ...this.config };
  }

  /**
   * Check if storm protection is enabled.
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// FACTORY
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create a StormProtection instance with default configuration.
 *
 * @param config - Optional configuration overrides
 * @returns StormProtection instance
 */
export function createStormProtection(
  config?: Partial<StormProtectionConfig>
): StormProtection {
  return new StormProtection(config);
}

// ─────────────────────────────────────────────────────────────────────────────────
// STATUS HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create an expired reminder with reason.
 *
 * @param reminder - Original reminder
 * @param reason - Expiration reason
 * @returns Updated reminder with expired status
 */
export function expireReminder(
  reminder: ReminderSchedule,
  _reason: ExpirationReason
): ReminderSchedule {
  return {
    ...reminder,
    status: 'expired' as ReminderStatus,
  };
}

/**
 * Check if a reminder status indicates it's already processed.
 *
 * @param status - Reminder status
 * @returns Whether the reminder is already processed
 */
export function isProcessedStatus(status: ReminderStatus): boolean {
  return status === 'sent' || status === 'cancelled' || status === 'expired' || status === 'acknowledged';
}
