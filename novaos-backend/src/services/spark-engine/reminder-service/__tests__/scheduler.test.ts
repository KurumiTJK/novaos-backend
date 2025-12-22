// ═══════════════════════════════════════════════════════════════════════════════
// SCHEDULER TESTS — Timezone-Aware Scheduling
// NovaOS Spark Engine — Phase 11: Reminder Service
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateReminderTime,
  calculateEscalationHours,
  generateScheduleForDate,
  generateRemainingScheduleForToday,
  isQuietDay,
  isWithinReminderWindow,
  getSparkVariantForLevel,
  getToneForLevel,
  isInPast,
  getScheduledTimeAgeMs,
  isValidTimezone,
  todayInTimezone,
  MAX_ESCALATION_LEVEL,
} from '../scheduler.js';
import type { ReminderConfig } from '../../types.js';
import { REMINDER_CONFIG_DEFAULTS } from '../../types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────────────────────────────────────────

function createTestConfig(overrides?: Partial<ReminderConfig>): ReminderConfig {
  return {
    enabled: true,
    firstReminderHour: REMINDER_CONFIG_DEFAULTS.FIRST_REMINDER_HOUR,
    lastReminderHour: REMINDER_CONFIG_DEFAULTS.LAST_REMINDER_HOUR,
    intervalHours: REMINDER_CONFIG_DEFAULTS.INTERVAL_HOURS,
    maxRemindersPerDay: REMINDER_CONFIG_DEFAULTS.MAX_REMINDERS_PER_DAY,
    channels: { push: true, email: false, sms: false },
    shrinkSparksOnEscalation: true,
    quietDays: [],
    timezone: 'America/New_York',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// calculateReminderTime
// ─────────────────────────────────────────────────────────────────────────────────

describe('calculateReminderTime', () => {
  it('should calculate time in specified timezone', () => {
    const result = calculateReminderTime('2025-06-15', 9, 'America/New_York');

    // Should be 9 AM in New York
    expect(result).toContain('2025-06-15');
    expect(result).toContain('09:00:00');
    // During EDT (summer), New York is UTC-4
    expect(result).toContain('-04:00');
  });

  it('should handle different timezones', () => {
    const nyTime = calculateReminderTime('2025-06-15', 9, 'America/New_York');
    const laTime = calculateReminderTime('2025-06-15', 9, 'America/Los_Angeles');

    // Both should be 9 AM in their respective timezones
    expect(nyTime).toContain('09:00:00');
    expect(laTime).toContain('09:00:00');

    // But different UTC offsets
    expect(nyTime).toContain('-04:00'); // EDT
    expect(laTime).toContain('-07:00'); // PDT
  });

  it('should handle winter time (standard time)', () => {
    const result = calculateReminderTime('2025-01-15', 9, 'America/New_York');

    // During EST (winter), New York is UTC-5
    expect(result).toContain('-05:00');
  });

  it('should accept Date object', () => {
    const date = new Date('2025-06-15T00:00:00Z');
    const result = calculateReminderTime(date, 14, 'Europe/London');

    expect(result).toContain('14:00:00');
  });

  it('should throw for invalid timezone', () => {
    expect(() => {
      calculateReminderTime('2025-06-15', 9, 'Invalid/Timezone');
    }).toThrow();
  });

  it('should handle UTC timezone', () => {
    const result = calculateReminderTime('2025-06-15', 12, 'UTC');

    expect(result).toContain('12:00:00');
    expect(result).toContain('+00:00');
  });

  it('should handle edge hours (0 and 23)', () => {
    const midnight = calculateReminderTime('2025-06-15', 0, 'UTC');
    const lateNight = calculateReminderTime('2025-06-15', 23, 'UTC');

    expect(midnight).toContain('00:00:00');
    expect(lateNight).toContain('23:00:00');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// calculateEscalationHours
// ─────────────────────────────────────────────────────────────────────────────────

describe('calculateEscalationHours', () => {
  it('should calculate default escalation hours', () => {
    const config = createTestConfig();
    const hours = calculateEscalationHours(config);

    // Default: 9 AM, 12 PM, 3 PM, 6 PM (interval 3, max 4)
    expect(hours).toEqual([9, 12, 15, 18]);
  });

  it('should respect maxRemindersPerDay', () => {
    const config = createTestConfig({ maxRemindersPerDay: 2 });
    const hours = calculateEscalationHours(config);

    expect(hours).toEqual([9, 12]);
    expect(hours.length).toBe(2);
  });

  it('should respect intervalHours', () => {
    const config = createTestConfig({ intervalHours: 2 });
    const hours = calculateEscalationHours(config);

    // 9, 11, 13, 15 (then 17, 19 would be included, but max 4)
    expect(hours).toEqual([9, 11, 13, 15]);
  });

  it('should respect lastReminderHour', () => {
    const config = createTestConfig({
      firstReminderHour: 9,
      lastReminderHour: 15,
      intervalHours: 3,
    });
    const hours = calculateEscalationHours(config);

    // 9, 12, 15 — stops at lastReminderHour
    expect(hours).toEqual([9, 12, 15]);
  });

  it('should not exceed MAX_ESCALATION_LEVEL + 1 hours', () => {
    const config = createTestConfig({
      firstReminderHour: 6,
      lastReminderHour: 22,
      intervalHours: 1,
      maxRemindersPerDay: 20,
    });
    const hours = calculateEscalationHours(config);

    // Should stop at MAX_ESCALATION_LEVEL + 1 (4 reminders for levels 0-3)
    expect(hours.length).toBeLessThanOrEqual(MAX_ESCALATION_LEVEL + 1);
  });

  it('should return empty array for invalid window', () => {
    const config = createTestConfig({
      firstReminderHour: 20,
      lastReminderHour: 10,
    });
    const hours = calculateEscalationHours(config);

    expect(hours).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// generateScheduleForDate
// ─────────────────────────────────────────────────────────────────────────────────

describe('generateScheduleForDate', () => {
  it('should generate schedule with correct slots', () => {
    const config = createTestConfig();
    const result = generateScheduleForDate('2025-06-15', config);

    expect(result.success).toBe(true);
    expect(result.slots.length).toBe(4);

    // Check escalation levels
    expect(result.slots[0].escalationLevel).toBe(0);
    expect(result.slots[1].escalationLevel).toBe(1);
    expect(result.slots[2].escalationLevel).toBe(2);
    expect(result.slots[3].escalationLevel).toBe(3);
  });

  it('should assign correct tones', () => {
    const config = createTestConfig();
    const result = generateScheduleForDate('2025-06-15', config);

    expect(result.slots[0].tone).toBe('encouraging');
    expect(result.slots[1].tone).toBe('gentle');
    expect(result.slots[2].tone).toBe('gentle');
    expect(result.slots[3].tone).toBe('last_chance');
  });

  it('should assign correct spark variants when shrinking enabled', () => {
    const config = createTestConfig({ shrinkSparksOnEscalation: true });
    const result = generateScheduleForDate('2025-06-15', config);

    expect(result.slots[0].sparkVariant).toBe('full');
    expect(result.slots[1].sparkVariant).toBe('full');
    expect(result.slots[2].sparkVariant).toBe('reduced');
    expect(result.slots[3].sparkVariant).toBe('minimal');
  });

  it('should keep full variant when shrinking disabled', () => {
    const config = createTestConfig({ shrinkSparksOnEscalation: false });
    const result = generateScheduleForDate('2025-06-15', config);

    expect(result.slots.every((s) => s.sparkVariant === 'full')).toBe(true);
  });

  it('should return empty for disabled reminders', () => {
    const config = createTestConfig({ enabled: false });
    const result = generateScheduleForDate('2025-06-15', config);

    expect(result.success).toBe(false);
    expect(result.slots).toEqual([]);
    expect(result.reason).toBe('Reminders disabled');
  });

  it('should return empty for quiet days', () => {
    const config = createTestConfig({ quietDays: ['sunday'] });
    // June 15, 2025 is a Sunday
    const result = generateScheduleForDate('2025-06-15', config);

    expect(result.success).toBe(false);
    expect(result.slots).toEqual([]);
    expect(result.reason).toBe('Quiet day');
  });

  it('should include correct scheduled times', () => {
    const config = createTestConfig({ timezone: 'UTC' });
    const result = generateScheduleForDate('2025-06-15', config);

    expect(result.slots[0].scheduledTime).toContain('2025-06-15T09:00:00');
    expect(result.slots[1].scheduledTime).toContain('2025-06-15T12:00:00');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// isQuietDay
// ─────────────────────────────────────────────────────────────────────────────────

describe('isQuietDay', () => {
  it('should return true for quiet day', () => {
    // June 15, 2025 is a Sunday
    expect(isQuietDay('2025-06-15', ['sunday'], 'UTC')).toBe(true);
  });

  it('should return false for non-quiet day', () => {
    // June 16, 2025 is a Monday
    expect(isQuietDay('2025-06-16', ['sunday'], 'UTC')).toBe(false);
  });

  it('should return false for empty quiet days', () => {
    expect(isQuietDay('2025-06-15', [], 'UTC')).toBe(false);
  });

  it('should handle multiple quiet days', () => {
    expect(isQuietDay('2025-06-14', ['saturday', 'sunday'], 'UTC')).toBe(true); // Saturday
    expect(isQuietDay('2025-06-15', ['saturday', 'sunday'], 'UTC')).toBe(true); // Sunday
    expect(isQuietDay('2025-06-16', ['saturday', 'sunday'], 'UTC')).toBe(false); // Monday
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// getSparkVariantForLevel / getToneForLevel
// ─────────────────────────────────────────────────────────────────────────────────

describe('getSparkVariantForLevel', () => {
  it('should return full for levels 0-1 when shrinking', () => {
    expect(getSparkVariantForLevel(0, true)).toBe('full');
    expect(getSparkVariantForLevel(1, true)).toBe('full');
  });

  it('should return reduced for level 2 when shrinking', () => {
    expect(getSparkVariantForLevel(2, true)).toBe('reduced');
  });

  it('should return minimal for level 3+ when shrinking', () => {
    expect(getSparkVariantForLevel(3, true)).toBe('minimal');
    expect(getSparkVariantForLevel(4, true)).toBe('minimal');
  });

  it('should always return full when not shrinking', () => {
    expect(getSparkVariantForLevel(0, false)).toBe('full');
    expect(getSparkVariantForLevel(3, false)).toBe('full');
  });
});

describe('getToneForLevel', () => {
  it('should return encouraging for level 0', () => {
    expect(getToneForLevel(0)).toBe('encouraging');
  });

  it('should return gentle for levels 1-2', () => {
    expect(getToneForLevel(1)).toBe('gentle');
    expect(getToneForLevel(2)).toBe('gentle');
  });

  it('should return last_chance for level 3+', () => {
    expect(getToneForLevel(3)).toBe('last_chance');
    expect(getToneForLevel(4)).toBe('last_chance');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// Time utilities
// ─────────────────────────────────────────────────────────────────────────────────

describe('isInPast', () => {
  it('should return true for past time', () => {
    const pastTime = new Date(Date.now() - 60000).toISOString();
    expect(isInPast(pastTime)).toBe(true);
  });

  it('should return false for future time', () => {
    const futureTime = new Date(Date.now() + 60000).toISOString();
    expect(isInPast(futureTime)).toBe(false);
  });
});

describe('getScheduledTimeAgeMs', () => {
  it('should return positive for past time', () => {
    const pastTime = new Date(Date.now() - 60000).toISOString();
    const age = getScheduledTimeAgeMs(pastTime);
    expect(age).toBeGreaterThan(50000);
    expect(age).toBeLessThan(70000);
  });

  it('should return negative for future time', () => {
    const futureTime = new Date(Date.now() + 60000).toISOString();
    const age = getScheduledTimeAgeMs(futureTime);
    expect(age).toBeLessThan(0);
  });
});

describe('isValidTimezone', () => {
  it('should return true for valid timezones', () => {
    expect(isValidTimezone('America/New_York')).toBe(true);
    expect(isValidTimezone('Europe/London')).toBe(true);
    expect(isValidTimezone('Asia/Tokyo')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
  });

  it('should return false for invalid timezones', () => {
    expect(isValidTimezone('Invalid/Timezone')).toBe(false);
    expect(isValidTimezone('New_York')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
  });
});

describe('isWithinReminderWindow', () => {
  it('should return true for hours within window', () => {
    expect(isWithinReminderWindow(9, 9, 19)).toBe(true);
    expect(isWithinReminderWindow(14, 9, 19)).toBe(true);
    expect(isWithinReminderWindow(19, 9, 19)).toBe(true);
  });

  it('should return false for hours outside window', () => {
    expect(isWithinReminderWindow(8, 9, 19)).toBe(false);
    expect(isWithinReminderWindow(20, 9, 19)).toBe(false);
  });
});
