// ═══════════════════════════════════════════════════════════════════════════════
// REMINDER SERVICE — Module Exports
// NovaOS Spark Engine — Phase 11: Reminder Service
// ═══════════════════════════════════════════════════════════════════════════════
//
// Usage:
//   import {
//     ReminderService,
//     createReminderService,
//     validateReminderConfig,
//   } from './reminder-service/index.js';
//
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// MAIN SERVICE
// ─────────────────────────────────────────────────────────────────────────────────

export {
  ReminderService,
  createReminderService,
  DEFAULT_SERVICE_CONFIG,
} from './service.js';

// ─────────────────────────────────────────────────────────────────────────────────
// SCHEDULER
// ─────────────────────────────────────────────────────────────────────────────────

export {
  calculateReminderTime,
  calculateEscalationHours,
  generateScheduleForDate,
  generateRemainingScheduleForToday,
  nowInTimezone,
  todayInTimezone,
  isQuietDay,
  isWithinReminderWindow,
  getSparkVariantForLevel,
  getToneForLevel,
  parseScheduledTime,
  isInPast,
  getScheduledTimeAgeMs,
  isValidTimezone,
  MAX_ESCALATION_LEVEL,
} from './scheduler.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CHANNEL VALIDATOR
// ─────────────────────────────────────────────────────────────────────────────────

export {
  validateReminderConfig,
  validatePartialReminderConfig,
  validateChannels,
  validateHours,
  validateInterval,
  validateMaxReminders,
  validateTimezoneConfig,
  validateEffectiveness,
  getValidationSummary,
} from './channel-validator.js';

// ─────────────────────────────────────────────────────────────────────────────────
// IDEMPOTENCY
// ─────────────────────────────────────────────────────────────────────────────────

export {
  IdempotencyManager,
  createIdempotencyManager,
  generateIdempotencyKey,
  generateSparkDateKey,
  DEFAULT_IDEMPOTENCY_CONFIG,
} from './idempotency.js';

// ─────────────────────────────────────────────────────────────────────────────────
// STORM PROTECTION
// ─────────────────────────────────────────────────────────────────────────────────

export {
  StormProtection,
  createStormProtection,
  isTooOld,
  formatAge,
  expireReminder,
  isProcessedStatus,
  DEFAULT_STORM_PROTECTION_CONFIG,
} from './storm-protection.js';

// ─────────────────────────────────────────────────────────────────────────────────
// MESSAGE GENERATOR
// ─────────────────────────────────────────────────────────────────────────────────

export {
  buildReminderMessage,
  buildSimpleMessage,
  buildPushPayload,
  buildEmailPayload,
  buildSmsMessage,
} from './message-generator.js';

export type { MessageContext, GeneratedMessage } from './message-generator.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export type {
  // Core types (re-exported from parent)
  ReminderSchedule,
  ReminderConfig,
  ReminderStatus,
  ReminderTone,
  ReminderChannels,
  SparkVariant,
  DayOfWeek,

  // Scheduler types
  ReminderSlot,
  ScheduleResult,

  // Validator types
  ValidationSeverity,
  ValidationIssue,
  ValidationResult,

  // Idempotency types
  IdempotencyCheckResult,
  IdempotencyClaimResult,
  IdempotencyConfig,

  // Storm protection types
  ExpirationReason,
  StormCheckResult,
  BatchStormCheckResult,
  StormProtectionConfig,

  // Service types
  ReminderSendResult,
  ProcessingResult,
  INotificationSender,
  IReminderStore,
  ReminderServiceConfig,

  // Message generator types
  MessageContext,
  GeneratedMessage,

  // Additional types
  DeliveryChannel,
  ReminderPriority,
  ReminderMetrics,
  NotificationPreferences,
} from './types.js';

export {
  REMINDER_CONFIG_DEFAULTS,
  ALL_DAYS,
  WEEKDAYS,
  getPriorityForLevel,
  EMPTY_METRICS,
  DEFAULT_NOTIFICATION_PREFERENCES,
} from './types.js';
