// ═══════════════════════════════════════════════════════════════════════════════
// STORM PROTECTION TESTS — Prevent Reminder Floods
// NovaOS Spark Engine — Phase 11: Reminder Service
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  StormProtection,
  createStormProtection,
  isTooOld,
  formatAge,
  expireReminder,
  isProcessedStatus,
  DEFAULT_STORM_PROTECTION_CONFIG,
} from '../storm-protection.js';
import type { ReminderSchedule, ReminderStatus } from '../../types.js';
import {
  createReminderId,
  createUserId,
  createStepId,
  createSparkId,
} from '../../../../types/branded.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────────────────────────────────────────

function createTestReminder(overrides?: Partial<ReminderSchedule>): ReminderSchedule {
  return {
    id: createReminderId(),
    userId: createUserId(),
    stepId: createStepId(),
    sparkId: createSparkId(),
    scheduledTime: new Date().toISOString(),
    escalationLevel: 0,
    sparkVariant: 'full',
    tone: 'encouraging',
    status: 'pending',
    channels: { push: true, email: false, sms: false },
    ...overrides,
  };
}

function createReminderAtTime(hoursAgo: number): ReminderSchedule {
  const scheduledTime = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
  return createTestReminder({ scheduledTime });
}

function createFutureReminder(hoursFromNow: number): ReminderSchedule {
  const scheduledTime = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
  return createTestReminder({ scheduledTime });
}

// ─────────────────────────────────────────────────────────────────────────────────
// formatAge
// ─────────────────────────────────────────────────────────────────────────────────

describe('formatAge', () => {
  it('should format seconds', () => {
    expect(formatAge(30000)).toBe('30 seconds');
    expect(formatAge(45000)).toBe('45 seconds');
  });

  it('should format minutes', () => {
    expect(formatAge(60000)).toBe('1 minutes');
    expect(formatAge(5 * 60 * 1000)).toBe('5 minutes');
    expect(formatAge(30 * 60 * 1000)).toBe('30 minutes');
  });

  it('should format hours', () => {
    expect(formatAge(60 * 60 * 1000)).toBe('1.0 hours');
    expect(formatAge(2.5 * 60 * 60 * 1000)).toBe('2.5 hours');
    expect(formatAge(12 * 60 * 60 * 1000)).toBe('12.0 hours');
  });

  it('should format days', () => {
    expect(formatAge(24 * 60 * 60 * 1000)).toBe('1.0 days');
    expect(formatAge(2.5 * 24 * 60 * 60 * 1000)).toBe('2.5 days');
  });

  it('should handle negative values (absolute)', () => {
    expect(formatAge(-60000)).toBe('1 minutes');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// isTooOld
// ─────────────────────────────────────────────────────────────────────────────────

describe('isTooOld', () => {
  const config = DEFAULT_STORM_PROTECTION_CONFIG;

  it('should return false for recent reminder', () => {
    const recent = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago
    expect(isTooOld(recent, config)).toBe(false);
  });

  it('should return true for old reminder', () => {
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(); // 3 hours ago
    expect(isTooOld(old, config)).toBe(true);
  });

  it('should return false for future reminder', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour from now
    expect(isTooOld(future, config)).toBe(false);
  });

  it('should respect grace period', () => {
    // Just past maxAge but within grace
    const borderline = new Date(
      Date.now() - config.maxAgeMs - config.graceMs / 2
    ).toISOString();
    expect(isTooOld(borderline, config)).toBe(false);

    // Past maxAge + grace
    const tooOld = new Date(
      Date.now() - config.maxAgeMs - config.graceMs - 1000
    ).toISOString();
    expect(isTooOld(tooOld, config)).toBe(true);
  });

  it('should use custom config', () => {
    const customConfig = {
      ...config,
      maxAgeMs: 30 * 60 * 1000, // 30 minutes
      graceMs: 0,
    };

    const fortyMinAgo = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    expect(isTooOld(fortyMinAgo, customConfig)).toBe(true);

    const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    expect(isTooOld(twentyMinAgo, customConfig)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// StormProtection.check
// ─────────────────────────────────────────────────────────────────────────────────

describe('StormProtection.check', () => {
  let storm: StormProtection;

  beforeEach(() => {
    storm = createStormProtection();
  });

  it('should allow recent reminder', () => {
    const reminder = createReminderAtTime(0.5); // 30 min ago
    const result = storm.check(reminder);

    expect(result.shouldSend).toBe(true);
    expect(result.shouldExpire).toBe(false);
  });

  it('should expire old reminder', () => {
    const reminder = createReminderAtTime(3); // 3 hours ago
    const result = storm.check(reminder);

    expect(result.shouldSend).toBe(false);
    expect(result.shouldExpire).toBe(true);
    expect(result.expirationReason).toBe('too_old');
  });

  it('should not send future reminder but not expire it', () => {
    const reminder = createFutureReminder(1); // 1 hour from now
    const result = storm.check(reminder);

    expect(result.shouldSend).toBe(false);
    expect(result.shouldExpire).toBe(false);
    expect(result.context).toContain('Future reminder');
  });

  it('should include age information', () => {
    const reminder = createReminderAtTime(1);
    const result = storm.check(reminder);

    expect(result.ageMs).toBeGreaterThan(0);
    expect(result.ageDescription).toContain('hour');
  });

  it('should allow all when disabled', () => {
    const disabledStorm = createStormProtection({ enabled: false });
    const oldReminder = createReminderAtTime(10); // 10 hours ago

    const result = disabledStorm.check(oldReminder);

    expect(result.shouldSend).toBe(true);
    expect(result.shouldExpire).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// StormProtection.isReady
// ─────────────────────────────────────────────────────────────────────────────────

describe('StormProtection.isReady', () => {
  let storm: StormProtection;

  beforeEach(() => {
    storm = createStormProtection();
  });

  it('should return true for due and valid reminder', () => {
    const reminder = createReminderAtTime(0.5);
    expect(storm.isReady(reminder)).toBe(true);
  });

  it('should return false for future reminder', () => {
    const reminder = createFutureReminder(1);
    expect(storm.isReady(reminder)).toBe(false);
  });

  it('should return false for too old reminder', () => {
    const reminder = createReminderAtTime(5);
    expect(storm.isReady(reminder)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// StormProtection.processBatch
// ─────────────────────────────────────────────────────────────────────────────────

describe('StormProtection.processBatch', () => {
  let storm: StormProtection;

  beforeEach(() => {
    storm = createStormProtection();
  });

  it('should separate sendable and expirable reminders', () => {
    const reminders = [
      createReminderAtTime(0.5), // Valid
      createReminderAtTime(3), // Too old
      createReminderAtTime(1), // Valid
      createReminderAtTime(5), // Too old
    ];

    const result = storm.processBatch(reminders);

    expect(result.toSend).toHaveLength(2);
    expect(result.toExpire).toHaveLength(2);
    expect(result.totalChecked).toBe(4);
    expect(result.hadExpired).toBe(true);
  });

  it('should exclude future reminders from both lists', () => {
    const reminders = [
      createReminderAtTime(0.5), // Valid
      createFutureReminder(1), // Future
      createFutureReminder(2), // Future
    ];

    const result = storm.processBatch(reminders);

    expect(result.toSend).toHaveLength(1);
    expect(result.toExpire).toHaveLength(0);
  });

  it('should respect batch limit per user', () => {
    const userId = createUserId();
    const reminders = [
      createTestReminder({ userId, scheduledTime: new Date(Date.now() - 60000).toISOString() }),
      createTestReminder({ userId, scheduledTime: new Date(Date.now() - 50000).toISOString() }),
      createTestReminder({ userId, scheduledTime: new Date(Date.now() - 40000).toISOString() }),
      createTestReminder({ userId, scheduledTime: new Date(Date.now() - 30000).toISOString() }),
    ];

    const result = storm.processBatch(reminders);

    // Default maxBatchPerUser is 2
    expect(result.toSend).toHaveLength(2);
    expect(result.toExpire).toHaveLength(2);
    expect(result.toExpire.every((e) => e.reason === 'batch_limit')).toBe(true);
  });

  it('should process different users independently', () => {
    const user1 = createUserId();
    const user2 = createUserId();

    const reminders = [
      createTestReminder({ userId: user1, scheduledTime: new Date(Date.now() - 60000).toISOString() }),
      createTestReminder({ userId: user1, scheduledTime: new Date(Date.now() - 50000).toISOString() }),
      createTestReminder({ userId: user2, scheduledTime: new Date(Date.now() - 40000).toISOString() }),
      createTestReminder({ userId: user2, scheduledTime: new Date(Date.now() - 30000).toISOString() }),
    ];

    const result = storm.processBatch(reminders);

    // 2 per user = 4 total
    expect(result.toSend).toHaveLength(4);
    expect(result.toExpire).toHaveLength(0);
  });

  it('should sort toSend by scheduled time', () => {
    const reminders = [
      createReminderAtTime(0.5), // 30 min ago
      createReminderAtTime(1), // 1 hour ago (older)
      createReminderAtTime(0.25), // 15 min ago (newer)
    ];

    const result = storm.processBatch(reminders);

    // Should be sorted oldest first
    const times = result.toSend.map((r) => new Date(r.scheduledTime).getTime());
    expect(times[0]).toBeLessThan(times[1]);
    expect(times[1]).toBeLessThan(times[2]);
  });

  it('should handle empty batch', () => {
    const result = storm.processBatch([]);

    expect(result.toSend).toHaveLength(0);
    expect(result.toExpire).toHaveLength(0);
    expect(result.summary).toBe('No reminders to process');
  });

  it('should generate meaningful summary', () => {
    const reminders = [
      createReminderAtTime(0.5),
      createReminderAtTime(3),
    ];

    const result = storm.processBatch(reminders);

    expect(result.summary).toContain('Processing');
    expect(result.summary).toContain('1/2');
    expect(result.summary).toContain('expired');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// StormProtection.filterReady
// ─────────────────────────────────────────────────────────────────────────────────

describe('StormProtection.filterReady', () => {
  it('should filter to only ready reminders', () => {
    const storm = createStormProtection();

    const reminders = [
      createReminderAtTime(0.5), // Valid
      createReminderAtTime(5), // Too old
      createFutureReminder(1), // Future
    ];

    const ready = storm.filterReady(reminders);

    expect(ready).toHaveLength(1);
    expect(ready[0].scheduledTime).toBe(reminders[0].scheduledTime);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────────────────────────────────────────────

describe('expireReminder', () => {
  it('should create expired copy of reminder', () => {
    const original = createTestReminder({ status: 'pending' });
    const expired = expireReminder(original, 'too_old');

    expect(expired.status).toBe('expired');
    expect(expired.id).toBe(original.id);
    expect(expired.scheduledTime).toBe(original.scheduledTime);
  });
});

describe('isProcessedStatus', () => {
  it('should return true for processed statuses', () => {
    expect(isProcessedStatus('sent')).toBe(true);
    expect(isProcessedStatus('cancelled')).toBe(true);
    expect(isProcessedStatus('expired')).toBe(true);
    expect(isProcessedStatus('acknowledged')).toBe(true);
  });

  it('should return false for pending status', () => {
    expect(isProcessedStatus('pending')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────────

describe('StormProtection configuration', () => {
  it('should use custom maxAgeMs', () => {
    const storm = createStormProtection({ maxAgeMs: 30 * 60 * 1000 }); // 30 min

    const fortyMinAgo = createReminderAtTime(40 / 60);
    const twentyMinAgo = createReminderAtTime(20 / 60);

    expect(storm.check(fortyMinAgo).shouldExpire).toBe(true);
    expect(storm.check(twentyMinAgo).shouldExpire).toBe(false);
  });

  it('should use custom maxBatchPerUser', () => {
    const storm = createStormProtection({ maxBatchPerUser: 1 });
    const userId = createUserId();

    const reminders = [
      createTestReminder({ userId, scheduledTime: new Date(Date.now() - 60000).toISOString() }),
      createTestReminder({ userId, scheduledTime: new Date(Date.now() - 50000).toISOString() }),
    ];

    const result = storm.processBatch(reminders);

    expect(result.toSend).toHaveLength(1);
    expect(result.toExpire).toHaveLength(1);
  });

  it('should expose config via getConfig', () => {
    const storm = createStormProtection({ maxAgeMs: 1000 });
    const config = storm.getConfig();

    expect(config.maxAgeMs).toBe(1000);
    expect(config.enabled).toBe(true);
  });

  it('should report enabled status', () => {
    const enabled = createStormProtection({ enabled: true });
    const disabled = createStormProtection({ enabled: false });

    expect(enabled.isEnabled()).toBe(true);
    expect(disabled.isEnabled()).toBe(false);
  });
});
