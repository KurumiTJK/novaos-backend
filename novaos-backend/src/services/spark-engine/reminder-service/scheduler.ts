// ═══════════════════════════════════════════════════════════════════════════════
// REMINDER SCHEDULER — Timezone-Aware Scheduling
// NovaOS Spark Engine — Phase 11: Reminder Service
// ═══════════════════════════════════════════════════════════════════════════════
//
// Handles timezone-aware reminder scheduling:
//   - Calculate reminder times in user's timezone
//   - Generate escalation schedule
//   - Respect quiet hours and quiet days
//
// Uses Luxon for robust timezone handling.
//
// ═══════════════════════════════════════════════════════════════════════════════

import { DateTime } from 'luxon';
import type { ReminderConfig, ReminderTone, SparkVariant, DayOfWeek } from '../types.js';
import { REMINDER_CONFIG_DEFAULTS } from '../types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * A scheduled reminder slot with all computed properties.
 */
export interface ReminderSlot {
  /** ISO 8601 timestamp with timezone */
  readonly scheduledTime: string;

  /** Escalation level (0-3) */
  readonly escalationLevel: number;

  /** Spark variant for this level */
  readonly sparkVariant: SparkVariant;

  /** Tone for the reminder message */
  readonly tone: ReminderTone;
}

/**
 * Result of schedule generation.
 */
export interface ScheduleResult {
  /** Whether scheduling was successful */
  readonly success: boolean;

  /** Generated reminder slots */
  readonly slots: readonly ReminderSlot[];

  /** Reason if scheduling failed or was skipped */
  readonly reason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Maximum escalation level.
 */
export const MAX_ESCALATION_LEVEL = 3;

/**
 * Mapping from Luxon weekday (1=Monday) to DayOfWeek.
 */
const WEEKDAY_MAP: Record<number, DayOfWeek> = {
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
  7: 'sunday',
};

// ─────────────────────────────────────────────────────────────────────────────────
// CORE SCHEDULING FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Calculate a reminder time for a specific date, hour, and timezone.
 *
 * @param date - Date string (YYYY-MM-DD) or Date object
 * @param hour - Hour of day (0-23)
 * @param timezone - IANA timezone (e.g., "America/New_York")
 * @returns ISO 8601 string with timezone offset
 */
export function calculateReminderTime(
  date: string | Date,
  hour: number,
  timezone: string
): string {
  // Parse date
  const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0];

  // Create DateTime in the user's timezone
  const dt = DateTime.fromISO(`${dateStr}T${hour.toString().padStart(2, '0')}:00:00`, {
    zone: timezone,
  });

  if (!dt.isValid) {
    throw new Error(`Invalid date/timezone: ${dateStr}, ${timezone} - ${dt.invalidReason}`);
  }

  // Return ISO string (includes timezone offset)
  return dt.toISO()!;
}

/**
 * Get the current time in a specific timezone.
 *
 * @param timezone - IANA timezone
 * @returns DateTime in the specified timezone
 */
export function nowInTimezone(timezone: string): DateTime {
  return DateTime.now().setZone(timezone);
}

/**
 * Get today's date string in a specific timezone.
 *
 * @param timezone - IANA timezone
 * @returns Date string (YYYY-MM-DD)
 */
export function todayInTimezone(timezone: string): string {
  return nowInTimezone(timezone).toISODate()!;
}

/**
 * Check if a given date falls on a quiet day.
 *
 * @param date - Date string (YYYY-MM-DD)
 * @param quietDays - Array of quiet days
 * @param timezone - IANA timezone
 * @returns Whether the date is a quiet day
 */
export function isQuietDay(
  date: string,
  quietDays: readonly DayOfWeek[],
  timezone: string
): boolean {
  if (quietDays.length === 0) {
    return false;
  }

  const dt = DateTime.fromISO(date, { zone: timezone });
  const dayOfWeek = WEEKDAY_MAP[dt.weekday];

  return quietDays.includes(dayOfWeek);
}

/**
 * Check if a given hour is within the reminder window.
 *
 * @param hour - Hour to check (0-23)
 * @param firstHour - First reminder hour
 * @param lastHour - Last reminder hour
 * @returns Whether the hour is within the window
 */
export function isWithinReminderWindow(
  hour: number,
  firstHour: number,
  lastHour: number
): boolean {
  return hour >= firstHour && hour <= lastHour;
}

// ─────────────────────────────────────────────────────────────────────────────────
// ESCALATION LOGIC
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Get the spark variant for an escalation level.
 *
 * @param level - Escalation level (0-3)
 * @param shrinkOnEscalation - Whether to shrink sparks on escalation
 * @returns Spark variant
 */
export function getSparkVariantForLevel(
  level: number,
  shrinkOnEscalation: boolean
): SparkVariant {
  if (!shrinkOnEscalation) {
    return 'full';
  }

  switch (level) {
    case 0:
    case 1:
      return 'full';
    case 2:
      return 'reduced';
    case 3:
    default:
      return 'minimal';
  }
}

/**
 * Get the reminder tone for an escalation level.
 *
 * @param level - Escalation level (0-3)
 * @returns Reminder tone
 */
export function getToneForLevel(level: number): ReminderTone {
  switch (level) {
    case 0:
      return 'encouraging';
    case 1:
    case 2:
      return 'gentle';
    case 3:
    default:
      return 'last_chance';
  }
}

/**
 * Calculate escalation hours for a day.
 *
 * @param config - Reminder configuration
 * @returns Array of hours for each escalation level
 */
export function calculateEscalationHours(config: ReminderConfig): number[] {
  const {
    firstReminderHour = REMINDER_CONFIG_DEFAULTS.FIRST_REMINDER_HOUR,
    lastReminderHour = REMINDER_CONFIG_DEFAULTS.LAST_REMINDER_HOUR,
    intervalHours = REMINDER_CONFIG_DEFAULTS.INTERVAL_HOURS,
    maxRemindersPerDay = REMINDER_CONFIG_DEFAULTS.MAX_REMINDERS_PER_DAY,
  } = config;

  const hours: number[] = [];
  let currentHour = firstReminderHour;

  while (
    currentHour <= lastReminderHour &&
    hours.length < maxRemindersPerDay &&
    hours.length <= MAX_ESCALATION_LEVEL
  ) {
    hours.push(currentHour);
    currentHour += intervalHours;
  }

  return hours;
}

// ─────────────────────────────────────────────────────────────────────────────────
// SCHEDULE GENERATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Generate a reminder schedule for a specific date.
 *
 * @param date - Date string (YYYY-MM-DD)
 * @param config - Reminder configuration
 * @returns Schedule result with slots
 */
export function generateScheduleForDate(
  date: string,
  config: ReminderConfig
): ScheduleResult {
  // Check if reminders are enabled
  if (!config.enabled) {
    return {
      success: false,
      slots: [],
      reason: 'Reminders disabled',
    };
  }

  // Check if it's a quiet day
  if (isQuietDay(date, config.quietDays, config.timezone)) {
    return {
      success: false,
      slots: [],
      reason: 'Quiet day',
    };
  }

  // Calculate escalation hours
  const hours = calculateEscalationHours(config);

  if (hours.length === 0) {
    return {
      success: false,
      slots: [],
      reason: 'No valid reminder hours',
    };
  }

  // Generate slots
  const slots: ReminderSlot[] = hours.map((hour, index) => ({
    scheduledTime: calculateReminderTime(date, hour, config.timezone),
    escalationLevel: index,
    sparkVariant: getSparkVariantForLevel(index, config.shrinkSparksOnEscalation),
    tone: getToneForLevel(index),
  }));

  return {
    success: true,
    slots,
  };
}

/**
 * Generate remaining reminders for today (starting from current time).
 *
 * @param config - Reminder configuration
 * @returns Schedule result with remaining slots for today
 */
export function generateRemainingScheduleForToday(config: ReminderConfig): ScheduleResult {
  if (!config.enabled) {
    return {
      success: false,
      slots: [],
      reason: 'Reminders disabled',
    };
  }

  const now = nowInTimezone(config.timezone);
  const today = now.toISODate()!;
  const currentHour = now.hour;

  // Check if it's a quiet day
  if (isQuietDay(today, config.quietDays, config.timezone)) {
    return {
      success: false,
      slots: [],
      reason: 'Quiet day',
    };
  }

  // Calculate all escalation hours
  const allHours = calculateEscalationHours(config);

  // Filter to only future hours (at least 1 hour from now to avoid immediate send)
  const futureHours = allHours.filter((hour) => hour > currentHour);

  if (futureHours.length === 0) {
    return {
      success: false,
      slots: [],
      reason: 'No remaining reminder hours today',
    };
  }

  // Generate slots with correct escalation levels
  // The escalation level should be based on position in original array
  const slots: ReminderSlot[] = futureHours.map((hour) => {
    const originalIndex = allHours.indexOf(hour);
    return {
      scheduledTime: calculateReminderTime(today, hour, config.timezone),
      escalationLevel: originalIndex,
      sparkVariant: getSparkVariantForLevel(originalIndex, config.shrinkSparksOnEscalation),
      tone: getToneForLevel(originalIndex),
    };
  });

  return {
    success: true,
    slots,
  };
}

/**
 * Parse an ISO timestamp and return a DateTime.
 *
 * @param isoString - ISO 8601 timestamp
 * @returns DateTime object
 */
export function parseScheduledTime(isoString: string): DateTime {
  return DateTime.fromISO(isoString);
}

/**
 * Check if a scheduled time is in the past.
 *
 * @param scheduledTime - ISO 8601 timestamp
 * @returns Whether the time is in the past
 */
export function isInPast(scheduledTime: string): boolean {
  const scheduled = parseScheduledTime(scheduledTime);
  return scheduled < DateTime.now();
}

/**
 * Get the age of a scheduled time in milliseconds.
 *
 * @param scheduledTime - ISO 8601 timestamp
 * @returns Age in milliseconds (negative if in future)
 */
export function getScheduledTimeAgeMs(scheduledTime: string): number {
  const scheduled = parseScheduledTime(scheduledTime);
  return DateTime.now().toMillis() - scheduled.toMillis();
}

/**
 * Validate a timezone string.
 *
 * @param timezone - IANA timezone string
 * @returns Whether the timezone is valid
 */
export function isValidTimezone(timezone: string): boolean {
  const dt = DateTime.now().setZone(timezone);
  return dt.isValid;
}
