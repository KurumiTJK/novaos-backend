// ═══════════════════════════════════════════════════════════════════════════════
// CHANNEL VALIDATOR — Reminder Configuration Validation
// NovaOS Spark Engine — Phase 11: Reminder Service
// ═══════════════════════════════════════════════════════════════════════════════
//
// Validates reminder configuration:
//   - At least one channel must be enabled
//   - Hour ranges must be valid
//   - Timezone must be valid
//   - Interval and max reminders must be sensible
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { ReminderConfig, ReminderChannels } from '../types.js';
import { REMINDER_CONFIG_DEFAULTS } from '../types.js';
import { isValidTimezone } from './scheduler.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Validation issue severity.
 */
export type ValidationSeverity = 'error' | 'warning';

/**
 * A single validation issue.
 */
export interface ValidationIssue {
  /** Field that has the issue */
  readonly field: string;

  /** Issue message */
  readonly message: string;

  /** Severity level */
  readonly severity: ValidationSeverity;

  /** Suggested fix (if any) */
  readonly suggestion?: string;
}

/**
 * Result of configuration validation.
 */
export interface ValidationResult {
  /** Whether the configuration is valid (no errors) */
  readonly valid: boolean;

  /** List of validation issues */
  readonly issues: readonly ValidationIssue[];

  /** Whether there are any errors (not just warnings) */
  readonly hasErrors: boolean;

  /** Whether there are any warnings */
  readonly hasWarnings: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Valid hour range (0-23).
 */
const MIN_HOUR = 0;
const MAX_HOUR = 23;

/**
 * Reasonable bounds for configuration values.
 */
const BOUNDS = {
  /** Minimum interval between reminders (hours) */
  MIN_INTERVAL_HOURS: 1,

  /** Maximum interval between reminders (hours) */
  MAX_INTERVAL_HOURS: 12,

  /** Minimum reminders per day */
  MIN_REMINDERS_PER_DAY: 1,

  /** Maximum reminders per day */
  MAX_REMINDERS_PER_DAY: 10,

  /** Minimum window size (hours between first and last reminder) */
  MIN_WINDOW_SIZE: 2,
} as const;

// ─────────────────────────────────────────────────────────────────────────────────
// VALIDATION FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Validate that at least one notification channel is enabled.
 *
 * @param channels - Channel configuration
 * @returns Validation issues (empty if valid)
 */
export function validateChannels(channels: ReminderChannels): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const hasAnyChannel = channels.push || channels.email || channels.sms;

  if (!hasAnyChannel) {
    issues.push({
      field: 'channels',
      message: 'At least one notification channel must be enabled',
      severity: 'error',
      suggestion: 'Enable push, email, or sms notifications',
    });
  }

  return issues;
}

/**
 * Validate hour configuration.
 *
 * @param firstHour - First reminder hour
 * @param lastHour - Last reminder hour
 * @returns Validation issues (empty if valid)
 */
export function validateHours(firstHour: number, lastHour: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Check first hour bounds
  if (firstHour < MIN_HOUR || firstHour > MAX_HOUR) {
    issues.push({
      field: 'firstReminderHour',
      message: `First reminder hour must be between ${MIN_HOUR} and ${MAX_HOUR}`,
      severity: 'error',
      suggestion: `Use a value between ${MIN_HOUR} and ${MAX_HOUR}`,
    });
  }

  // Check last hour bounds
  if (lastHour < MIN_HOUR || lastHour > MAX_HOUR) {
    issues.push({
      field: 'lastReminderHour',
      message: `Last reminder hour must be between ${MIN_HOUR} and ${MAX_HOUR}`,
      severity: 'error',
      suggestion: `Use a value between ${MIN_HOUR} and ${MAX_HOUR}`,
    });
  }

  // Check order
  if (firstHour > lastHour) {
    issues.push({
      field: 'firstReminderHour',
      message: 'First reminder hour cannot be after last reminder hour',
      severity: 'error',
      suggestion: 'Swap the values or adjust the range',
    });
  }

  // Check window size (warning only)
  const windowSize = lastHour - firstHour;
  if (windowSize < BOUNDS.MIN_WINDOW_SIZE && firstHour <= lastHour) {
    issues.push({
      field: 'lastReminderHour',
      message: `Reminder window is very small (${windowSize} hours)`,
      severity: 'warning',
      suggestion: `Consider a window of at least ${BOUNDS.MIN_WINDOW_SIZE} hours for escalation`,
    });
  }

  // Check for very early or very late hours (warning only)
  if (firstHour < 7) {
    issues.push({
      field: 'firstReminderHour',
      message: 'First reminder is scheduled very early (before 7 AM)',
      severity: 'warning',
      suggestion: 'Consider starting reminders at 7 AM or later',
    });
  }

  if (lastHour > 21) {
    issues.push({
      field: 'lastReminderHour',
      message: 'Last reminder is scheduled very late (after 9 PM)',
      severity: 'warning',
      suggestion: 'Consider ending reminders at 9 PM or earlier',
    });
  }

  return issues;
}

/**
 * Validate interval hours.
 *
 * @param intervalHours - Hours between reminders
 * @returns Validation issues (empty if valid)
 */
export function validateInterval(intervalHours: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!Number.isInteger(intervalHours)) {
    issues.push({
      field: 'intervalHours',
      message: 'Interval hours must be a whole number',
      severity: 'error',
      suggestion: 'Use an integer value',
    });
  }

  if (intervalHours < BOUNDS.MIN_INTERVAL_HOURS) {
    issues.push({
      field: 'intervalHours',
      message: `Interval must be at least ${BOUNDS.MIN_INTERVAL_HOURS} hour(s)`,
      severity: 'error',
      suggestion: `Use a value of at least ${BOUNDS.MIN_INTERVAL_HOURS}`,
    });
  }

  if (intervalHours > BOUNDS.MAX_INTERVAL_HOURS) {
    issues.push({
      field: 'intervalHours',
      message: `Interval exceeds maximum of ${BOUNDS.MAX_INTERVAL_HOURS} hours`,
      severity: 'error',
      suggestion: `Use a value of at most ${BOUNDS.MAX_INTERVAL_HOURS}`,
    });
  }

  return issues;
}

/**
 * Validate max reminders per day.
 *
 * @param maxReminders - Maximum reminders per day
 * @returns Validation issues (empty if valid)
 */
export function validateMaxReminders(maxReminders: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!Number.isInteger(maxReminders)) {
    issues.push({
      field: 'maxRemindersPerDay',
      message: 'Max reminders per day must be a whole number',
      severity: 'error',
      suggestion: 'Use an integer value',
    });
  }

  if (maxReminders < BOUNDS.MIN_REMINDERS_PER_DAY) {
    issues.push({
      field: 'maxRemindersPerDay',
      message: `Must allow at least ${BOUNDS.MIN_REMINDERS_PER_DAY} reminder(s) per day`,
      severity: 'error',
      suggestion: `Use a value of at least ${BOUNDS.MIN_REMINDERS_PER_DAY}`,
    });
  }

  if (maxReminders > BOUNDS.MAX_REMINDERS_PER_DAY) {
    issues.push({
      field: 'maxRemindersPerDay',
      message: `Max reminders exceeds reasonable limit of ${BOUNDS.MAX_REMINDERS_PER_DAY}`,
      severity: 'warning',
      suggestion: `Consider using at most ${BOUNDS.MAX_REMINDERS_PER_DAY} reminders per day`,
    });
  }

  return issues;
}

/**
 * Validate timezone.
 *
 * @param timezone - IANA timezone string
 * @returns Validation issues (empty if valid)
 */
export function validateTimezoneConfig(timezone: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!timezone || timezone.trim() === '') {
    issues.push({
      field: 'timezone',
      message: 'Timezone is required',
      severity: 'error',
      suggestion: 'Provide an IANA timezone like "America/New_York"',
    });
    return issues;
  }

  if (!isValidTimezone(timezone)) {
    issues.push({
      field: 'timezone',
      message: `Invalid timezone: "${timezone}"`,
      severity: 'error',
      suggestion: 'Use a valid IANA timezone like "America/New_York" or "Europe/London"',
    });
  }

  return issues;
}

/**
 * Check if the configuration would result in any reminders being scheduled.
 *
 * @param config - Reminder configuration
 * @returns Validation issues (empty if valid)
 */
export function validateEffectiveness(config: ReminderConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // If not enabled, no need to check effectiveness
  if (!config.enabled) {
    return issues;
  }

  // Calculate how many reminders would actually be scheduled
  const windowSize = config.lastReminderHour - config.firstReminderHour;
  const possibleReminders = Math.floor(windowSize / config.intervalHours) + 1;
  const actualReminders = Math.min(possibleReminders, config.maxRemindersPerDay);

  if (actualReminders === 0) {
    issues.push({
      field: 'intervalHours',
      message: 'Configuration would result in zero reminders',
      severity: 'error',
      suggestion: 'Decrease interval or increase the reminder window',
    });
  }

  if (actualReminders === 1) {
    issues.push({
      field: 'maxRemindersPerDay',
      message: 'Configuration would result in only one reminder (no escalation)',
      severity: 'warning',
      suggestion: 'Consider allowing more reminders for escalation to work',
    });
  }

  // Check if quiet days would block all days
  if (config.quietDays.length >= 7) {
    issues.push({
      field: 'quietDays',
      message: 'All days are marked as quiet days',
      severity: 'error',
      suggestion: 'Remove some days from the quiet days list',
    });
  }

  if (config.quietDays.length >= 5) {
    issues.push({
      field: 'quietDays',
      message: 'Most days are marked as quiet days',
      severity: 'warning',
      suggestion: 'Consider reducing quiet days for better engagement',
    });
  }

  return issues;
}

// ─────────────────────────────────────────────────────────────────────────────────
// MAIN VALIDATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Validate a complete reminder configuration.
 *
 * @param config - Reminder configuration to validate
 * @returns Validation result with all issues
 */
export function validateReminderConfig(config: ReminderConfig): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Validate all aspects
  issues.push(...validateChannels(config.channels));
  issues.push(...validateHours(config.firstReminderHour, config.lastReminderHour));
  issues.push(...validateInterval(config.intervalHours));
  issues.push(...validateMaxReminders(config.maxRemindersPerDay));
  issues.push(...validateTimezoneConfig(config.timezone));
  issues.push(...validateEffectiveness(config));

  // Categorize issues
  const hasErrors = issues.some((issue) => issue.severity === 'error');
  const hasWarnings = issues.some((issue) => issue.severity === 'warning');

  return {
    valid: !hasErrors,
    issues,
    hasErrors,
    hasWarnings,
  };
}

/**
 * Validate a partial reminder configuration (for updates).
 * Only validates fields that are present.
 *
 * @param partial - Partial reminder configuration
 * @returns Validation result
 */
export function validatePartialReminderConfig(
  partial: Partial<ReminderConfig>
): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (partial.channels !== undefined) {
    issues.push(...validateChannels(partial.channels));
  }

  if (partial.firstReminderHour !== undefined || partial.lastReminderHour !== undefined) {
    const firstHour = partial.firstReminderHour ?? REMINDER_CONFIG_DEFAULTS.FIRST_REMINDER_HOUR;
    const lastHour = partial.lastReminderHour ?? REMINDER_CONFIG_DEFAULTS.LAST_REMINDER_HOUR;
    issues.push(...validateHours(firstHour, lastHour));
  }

  if (partial.intervalHours !== undefined) {
    issues.push(...validateInterval(partial.intervalHours));
  }

  if (partial.maxRemindersPerDay !== undefined) {
    issues.push(...validateMaxReminders(partial.maxRemindersPerDay));
  }

  if (partial.timezone !== undefined) {
    issues.push(...validateTimezoneConfig(partial.timezone));
  }

  const hasErrors = issues.some((issue) => issue.severity === 'error');
  const hasWarnings = issues.some((issue) => issue.severity === 'warning');

  return {
    valid: !hasErrors,
    issues,
    hasErrors,
    hasWarnings,
  };
}

/**
 * Get a human-readable summary of validation issues.
 *
 * @param result - Validation result
 * @returns Summary string
 */
export function getValidationSummary(result: ValidationResult): string {
  if (result.valid && !result.hasWarnings) {
    return 'Configuration is valid';
  }

  const errorCount = result.issues.filter((i) => i.severity === 'error').length;
  const warningCount = result.issues.filter((i) => i.severity === 'warning').length;

  const parts: string[] = [];

  if (errorCount > 0) {
    parts.push(`${errorCount} error${errorCount > 1 ? 's' : ''}`);
  }

  if (warningCount > 0) {
    parts.push(`${warningCount} warning${warningCount > 1 ? 's' : ''}`);
  }

  return `Configuration has ${parts.join(' and ')}`;
}
