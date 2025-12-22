// ═══════════════════════════════════════════════════════════════════════════════
// REMINDER SERVICE — Main Reminder Service Implementation
// NovaOS Spark Engine — Phase 11: Reminder Service
// ═══════════════════════════════════════════════════════════════════════════════
//
// Implements IReminderService interface:
//   - scheduleReminders(spark, goal) → Schedule reminders for a spark
//   - cancelReminders(sparkId) → Cancel pending reminders for a spark
//   - getPendingReminders(userId) → Get pending reminders for a user
//   - processPendingReminders() → Process all due reminders
//
// Orchestrates:
//   - Timezone-aware scheduling
//   - Channel validation
//   - Idempotent sending
//   - Storm protection
//
// ═══════════════════════════════════════════════════════════════════════════════

import { ok, err, isOk } from '../../../types/result.js';
import type { AsyncAppResult } from '../../../types/result.js';
import {
  createReminderId,
  createTimestamp,
  type UserId,
  type SparkId,
  type Timestamp,
} from '../../../types/branded.js';
import type { KeyValueStore } from '../../../storage/index.js';

import type {
  Goal,
  Spark,
  ReminderSchedule,
  ReminderConfig,
  ReminderStatus,
  ReminderChannels,
} from '../types.js';
import { REMINDER_CONFIG_DEFAULTS } from '../types.js';
import type { IReminderService } from '../interfaces.js';

import {
  generateScheduleForDate,
  generateRemainingScheduleForToday,
  todayInTimezone,
  type ReminderSlot,
} from './scheduler.js';
import {
  validateReminderConfig,
  type ValidationResult,
} from './channel-validator.js';
import {
  IdempotencyManager,
  createIdempotencyManager,
  type IdempotencyConfig,
} from './idempotency.js';
import {
  StormProtection,
  createStormProtection,
  expireReminder,
  isProcessedStatus,
  type StormProtectionConfig,
  type ExpirationReason,
} from './storm-protection.js';
import {
  buildReminderMessage,
  buildSmsMessage,
  type MessageContext,
} from './message-generator.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Reminder send result for a single reminder.
 */
export interface ReminderSendResult {
  /** Reminder ID */
  readonly reminderId: string;

  /** Whether the send was successful */
  readonly success: boolean;

  /** Channel used for sending */
  readonly channel?: 'push' | 'email' | 'sms';

  /** Error message if failed */
  readonly error?: string;

  /** Whether skipped due to idempotency */
  readonly skippedDuplicate?: boolean;

  /** Whether expired by storm protection */
  readonly expired?: boolean;

  /** Expiration reason if expired */
  readonly expirationReason?: ExpirationReason;
}

/**
 * Result of processing pending reminders.
 */
export interface ProcessingResult {
  /** Total reminders processed */
  readonly processed: number;

  /** Successfully sent */
  readonly sent: number;

  /** Failed to send */
  readonly failed: number;

  /** Expired by storm protection */
  readonly expired: number;

  /** Skipped (duplicate or already processed) */
  readonly skipped: number;

  /** Individual results */
  readonly results: readonly ReminderSendResult[];

  /** Processing duration in ms */
  readonly durationMs: number;
}

/**
 * Notification sender interface.
 * Implemented by actual notification providers (push, email, SMS).
 */
export interface INotificationSender {
  /** Send a push notification */
  sendPush(userId: UserId, message: string, data?: Record<string, unknown>): Promise<boolean>;

  /** Send an email notification */
  sendEmail(userId: UserId, subject: string, body: string): Promise<boolean>;

  /** Send an SMS notification */
  sendSms(userId: UserId, message: string): Promise<boolean>;
}

/**
 * Reminder store interface for persistence.
 */
export interface IReminderStore {
  /** Save a reminder */
  save(reminder: ReminderSchedule): Promise<void>;

  /** Get a reminder by ID */
  get(reminderId: string): Promise<ReminderSchedule | null>;

  /** Get pending reminders for a user */
  getPendingByUser(userId: UserId): Promise<readonly ReminderSchedule[]>;

  /** Get pending reminders for a spark */
  getPendingBySpark(sparkId: SparkId): Promise<readonly ReminderSchedule[]>;

  /** Get all due reminders (scheduled time in the past, status = pending) */
  getDueReminders(): Promise<readonly ReminderSchedule[]>;

  /** Update reminder status */
  updateStatus(reminderId: string, status: ReminderStatus, timestamp?: Timestamp): Promise<void>;

  /** Delete reminders for a spark */
  deleteBySpark(sparkId: SparkId): Promise<number>;
}

/**
 * ReminderService configuration.
 */
export interface ReminderServiceConfig {
  /** Idempotency configuration */
  readonly idempotency: Partial<IdempotencyConfig>;

  /** Storm protection configuration */
  readonly stormProtection: Partial<StormProtectionConfig>;

  /** Whether to validate config before scheduling */
  readonly validateBeforeScheduling: boolean;

  /** Default reminder config if goal doesn't have one */
  readonly defaultReminderConfig: ReminderConfig;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Default reminder configuration.
 */
const DEFAULT_REMINDER_CONFIG: ReminderConfig = {
  enabled: true,
  firstReminderHour: REMINDER_CONFIG_DEFAULTS.FIRST_REMINDER_HOUR,
  lastReminderHour: REMINDER_CONFIG_DEFAULTS.LAST_REMINDER_HOUR,
  intervalHours: REMINDER_CONFIG_DEFAULTS.INTERVAL_HOURS,
  maxRemindersPerDay: REMINDER_CONFIG_DEFAULTS.MAX_REMINDERS_PER_DAY,
  channels: {
    push: true,
    email: false,
    sms: false,
  },
  shrinkSparksOnEscalation: true,
  quietDays: [],
  timezone: 'UTC',
};

/**
 * Default service configuration.
 */
export const DEFAULT_SERVICE_CONFIG: ReminderServiceConfig = {
  idempotency: {},
  stormProtection: {},
  validateBeforeScheduling: true,
  defaultReminderConfig: DEFAULT_REMINDER_CONFIG,
};

// ─────────────────────────────────────────────────────────────────────────────────
// REMINDER SERVICE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * ReminderService — Manages reminder scheduling and delivery.
 *
 * Implements IReminderService interface for SparkEngine integration.
 */
export class ReminderService implements IReminderService {
  private readonly store: IReminderStore;
  private readonly notificationSender: INotificationSender;
  private readonly idempotency: IdempotencyManager;
  private readonly stormProtection: StormProtection;
  private readonly config: ReminderServiceConfig;

  constructor(
    reminderStore: IReminderStore,
    notificationSender: INotificationSender,
    keyValueStore: KeyValueStore,
    config?: Partial<ReminderServiceConfig>
  ) {
    this.store = reminderStore;
    this.notificationSender = notificationSender;
    this.config = { ...DEFAULT_SERVICE_CONFIG, ...config };

    // Initialize subsystems
    this.idempotency = createIdempotencyManager(keyValueStore, this.config.idempotency);
    this.stormProtection = createStormProtection(this.config.stormProtection);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // IReminderService Implementation
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Schedule reminders for a spark.
   *
   * @param spark - The spark to schedule reminders for
   * @param goal - The parent goal (for reminder config)
   * @returns Scheduled reminders
   */
  async scheduleReminders(
    spark: Spark,
    goal: Goal
  ): AsyncAppResult<readonly ReminderSchedule[]> {
    // Get reminder config from goal or use default
    const reminderConfig = goal.reminderConfig ?? this.config.defaultReminderConfig;

    // Check if reminders are enabled
    if (!reminderConfig.enabled) {
      return ok([]);
    }

    // Validate configuration if enabled
    if (this.config.validateBeforeScheduling) {
      const validation = validateReminderConfig(reminderConfig);
      if (!validation.valid) {
        return err({
          code: 'VALIDATION_ERROR',
          message: `Invalid reminder configuration: ${this.formatValidationErrors(validation)}`,
        });
      }
    }

    // Check idempotency - don't schedule twice for same spark+date
    const today = todayInTimezone(reminderConfig.timezone);
    const alreadyScheduled = await this.idempotency.isSparkScheduledForDate(spark.id, today);

    if (alreadyScheduled) {
      // Return existing reminders instead of creating new ones
      const existing = await this.store.getPendingBySpark(spark.id);
      return ok(existing);
    }

    // Generate schedule for remaining time today
    const scheduleResult = generateRemainingScheduleForToday(reminderConfig);

    if (!scheduleResult.success || scheduleResult.slots.length === 0) {
      return ok([]);
    }

    // Create reminder records
    const reminders = this.createRemindersFromSlots(
      scheduleResult.slots,
      spark,
      goal.userId,
      reminderConfig.channels
    );

    // Save all reminders
    for (const reminder of reminders) {
      await this.store.save(reminder);
    }

    // Mark spark as scheduled for today
    await this.idempotency.markSparkScheduledForDate(spark.id, today);

    return ok(reminders);
  }

  /**
   * Cancel pending reminders for a spark.
   *
   * @param sparkId - The spark to cancel reminders for
   */
  async cancelReminders(sparkId: SparkId): AsyncAppResult<void> {
    try {
      // Get pending reminders
      const pending = await this.store.getPendingBySpark(sparkId);

      // Update each to cancelled
      const now = createTimestamp();
      for (const reminder of pending) {
        await this.store.updateStatus(reminder.id, 'cancelled', now);
      }

      return ok(undefined);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to cancel reminders: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  /**
   * Get pending reminders for a user.
   *
   * @param userId - The user to get reminders for
   * @returns Pending reminders sorted by scheduled time
   */
  async getPendingReminders(
    userId: UserId
  ): AsyncAppResult<readonly ReminderSchedule[]> {
    try {
      const reminders = await this.store.getPendingByUser(userId);

      // Sort by scheduled time
      const sorted = [...reminders].sort(
        (a, b) =>
          new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime()
      );

      return ok(sorted);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to get pending reminders: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Processing
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Process all due reminders.
   * Should be called by a background job/cron.
   *
   * @returns Processing result with statistics
   */
  async processPendingReminders(): Promise<ProcessingResult> {
    const startTime = Date.now();
    const results: ReminderSendResult[] = [];

    // Get all due reminders
    const dueReminders = await this.store.getDueReminders();

    // Apply storm protection
    const stormResult = this.stormProtection.processBatch(dueReminders);

    // Process reminders to expire
    for (const { reminder, reason } of stormResult.toExpire) {
      await this.store.updateStatus(reminder.id, 'expired');
      results.push({
        reminderId: reminder.id,
        success: false,
        expired: true,
        expirationReason: reason,
      });
    }

    // Process reminders to send
    for (const reminder of stormResult.toSend) {
      const result = await this.sendReminder(reminder);
      results.push(result);
    }

    // Calculate statistics
    const sent = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success && !r.expired && !r.skippedDuplicate).length;
    const expired = results.filter((r) => r.expired).length;
    const skipped = results.filter((r) => r.skippedDuplicate).length;

    return {
      processed: results.length,
      sent,
      failed,
      expired,
      skipped,
      results,
      durationMs: Date.now() - startTime,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Send a single reminder.
   */
  private async sendReminder(
    reminder: ReminderSchedule,
    spark?: Spark
  ): Promise<ReminderSendResult> {
    // Check idempotency
    const claimResult = await this.idempotency.checkAndClaim(reminder.id);

    if (!claimResult.claimed) {
      return {
        reminderId: reminder.id,
        success: false,
        skippedDuplicate: true,
      };
    }

    try {
      // Build message context
      const messageContext: MessageContext = {
        reminder,
        spark,
      };

      // Try each enabled channel in priority order
      const sent = await this.trySendToChannels(reminder, messageContext);

      if (sent.success) {
        // Update status to sent
        await this.store.updateStatus(reminder.id, 'sent', createTimestamp());

        return {
          reminderId: reminder.id,
          success: true,
          channel: sent.channel,
        };
      }

      // All channels failed - release idempotency key for retry
      await this.idempotency.release(reminder.id);

      return {
        reminderId: reminder.id,
        success: false,
        error: 'All notification channels failed',
      };
    } catch (error) {
      // Release idempotency key for retry
      await this.idempotency.release(reminder.id);

      return {
        reminderId: reminder.id,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Try to send notification through enabled channels.
   */
  private async trySendToChannels(
    reminder: ReminderSchedule,
    context: MessageContext
  ): Promise<{ success: boolean; channel?: 'push' | 'email' | 'sms' }> {
    const { channels } = reminder;
    const message = buildReminderMessage(context);

    // Try push first (highest priority)
    if (channels.push) {
      try {
        const success = await this.notificationSender.sendPush(
          reminder.userId,
          message.text,
          {
            reminderId: reminder.id,
            sparkId: reminder.sparkId,
            stepId: reminder.stepId,
            escalationLevel: reminder.escalationLevel,
          }
        );
        if (success) {
          return { success: true, channel: 'push' };
        }
      } catch {
        // Fall through to next channel
      }
    }

    // Try email
    if (channels.email) {
      try {
        const success = await this.notificationSender.sendEmail(
          reminder.userId,
          message.subject,
          message.text
        );
        if (success) {
          return { success: true, channel: 'email' };
        }
      } catch {
        // Fall through to next channel
      }
    }

    // Try SMS (last resort, most expensive)
    if (channels.sms) {
      try {
        const smsText = buildSmsMessage(context);
        const success = await this.notificationSender.sendSms(reminder.userId, smsText);
        if (success) {
          return { success: true, channel: 'sms' };
        }
      } catch {
        // All channels failed
      }
    }

    return { success: false };
  }

  /**
   * Create reminder records from schedule slots.
   */
  private createRemindersFromSlots(
    slots: readonly ReminderSlot[],
    spark: Spark,
    userId: UserId,
    channels: ReminderChannels
  ): ReminderSchedule[] {
    return slots.map((slot) => ({
      id: createReminderId(),
      userId,
      stepId: spark.stepId,
      sparkId: spark.id,
      scheduledTime: slot.scheduledTime,
      escalationLevel: slot.escalationLevel,
      sparkVariant: slot.sparkVariant,
      tone: slot.tone,
      status: 'pending' as ReminderStatus,
      channels,
    }));
  }

  /**
   * Format validation errors for error message.
   */
  private formatValidationErrors(validation: ValidationResult): string {
    return validation.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => `${issue.field}: ${issue.message}`)
      .join('; ');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get service health status.
   */
  async getHealth(): Promise<{ healthy: boolean; details: Record<string, boolean> }> {
    const idempotencyHealthy = await this.idempotency.isHealthy();

    return {
      healthy: idempotencyHealthy,
      details: {
        idempotency: idempotencyHealthy,
        stormProtection: this.stormProtection.isEnabled(),
      },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// FACTORY
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create a ReminderService instance.
 *
 * @param reminderStore - Store for reminder persistence
 * @param notificationSender - Notification sending interface
 * @param keyValueStore - Store for idempotency keys
 * @param config - Optional configuration
 * @returns ReminderService instance
 */
export function createReminderService(
  reminderStore: IReminderStore,
  notificationSender: INotificationSender,
  keyValueStore: KeyValueStore,
  config?: Partial<ReminderServiceConfig>
): ReminderService {
  return new ReminderService(reminderStore, notificationSender, keyValueStore, config);
}
