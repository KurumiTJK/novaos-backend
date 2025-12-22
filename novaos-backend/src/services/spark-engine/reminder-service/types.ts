// ═══════════════════════════════════════════════════════════════════════════════
// REMINDER SERVICE TYPES — Type Definitions and Re-exports
// NovaOS Spark Engine — Phase 11: Reminder Service
// ═══════════════════════════════════════════════════════════════════════════════
//
// Central type definitions for the reminder service module.
// Re-exports types from submodules for convenient imports.
//
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// RE-EXPORTS FROM PARENT TYPES
// ─────────────────────────────────────────────────────────────────────────────────

// These are the core types defined in spark-engine/types.ts
// Re-exported here for convenience within the reminder service
export type {
  ReminderSchedule,
  ReminderConfig,
  ReminderStatus,
  ReminderTone,
  ReminderChannels,
  SparkVariant,
  DayOfWeek,
} from '../types.js';

export { REMINDER_CONFIG_DEFAULTS, ALL_DAYS, WEEKDAYS } from '../types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// RE-EXPORTS FROM SUBMODULES
// ─────────────────────────────────────────────────────────────────────────────────

// Scheduler types
export type { ReminderSlot, ScheduleResult } from './scheduler.js';

// Validator types
export type {
  ValidationSeverity,
  ValidationIssue,
  ValidationResult,
} from './channel-validator.js';

// Idempotency types
export type {
  IdempotencyCheckResult,
  IdempotencyClaimResult,
  IdempotencyConfig,
} from './idempotency.js';

// Storm protection types
export type {
  ExpirationReason,
  StormCheckResult,
  BatchStormCheckResult,
  StormProtectionConfig,
} from './storm-protection.js';

// Service types
export type {
  ReminderSendResult,
  ProcessingResult,
  INotificationSender,
  IReminderStore,
  ReminderServiceConfig,
} from './service.js';

// Message generator types
export type { MessageContext, GeneratedMessage } from './message-generator.js';

// ─────────────────────────────────────────────────────────────────────────────────
// ADDITIONAL TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Reminder delivery channel.
 */
export type DeliveryChannel = 'push' | 'email' | 'sms';

/**
 * Reminder priority based on escalation level.
 */
export type ReminderPriority = 'normal' | 'high' | 'urgent';

/**
 * Get priority from escalation level.
 */
export function getPriorityForLevel(level: number): ReminderPriority {
  if (level >= 3) return 'urgent';
  if (level >= 2) return 'high';
  return 'normal';
}

/**
 * Reminder metrics for monitoring.
 */
export interface ReminderMetrics {
  /** Total reminders scheduled */
  readonly scheduled: number;

  /** Total reminders sent */
  readonly sent: number;

  /** Total reminders expired */
  readonly expired: number;

  /** Total reminders cancelled */
  readonly cancelled: number;

  /** Average send latency in ms */
  readonly avgSendLatencyMs: number;

  /** Reminders by channel */
  readonly byChannel: {
    readonly push: number;
    readonly email: number;
    readonly sms: number;
  };

  /** Reminders by escalation level */
  readonly byEscalationLevel: {
    readonly level0: number;
    readonly level1: number;
    readonly level2: number;
    readonly level3: number;
  };
}

/**
 * Empty metrics for initialization.
 */
export const EMPTY_METRICS: ReminderMetrics = {
  scheduled: 0,
  sent: 0,
  expired: 0,
  cancelled: 0,
  avgSendLatencyMs: 0,
  byChannel: {
    push: 0,
    email: 0,
    sms: 0,
  },
  byEscalationLevel: {
    level0: 0,
    level1: 0,
    level2: 0,
    level3: 0,
  },
};

/**
 * User notification preferences (for future use).
 */
export interface NotificationPreferences {
  /** Preferred channel order */
  readonly channelPriority: readonly DeliveryChannel[];

  /** Do not disturb start hour (0-23) */
  readonly dndStartHour?: number;

  /** Do not disturb end hour (0-23) */
  readonly dndEndHour?: number;

  /** Whether to batch notifications */
  readonly batchNotifications: boolean;

  /** Maximum notifications per day */
  readonly maxPerDay: number;
}

/**
 * Default notification preferences.
 */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  channelPriority: ['push', 'email', 'sms'],
  batchNotifications: false,
  maxPerDay: 10,
};
