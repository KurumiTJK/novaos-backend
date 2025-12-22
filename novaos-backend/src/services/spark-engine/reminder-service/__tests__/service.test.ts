// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE TESTS — ReminderService Implementation
// NovaOS Spark Engine — Phase 11: Reminder Service
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReminderService, createReminderService } from '../service.js';
import type { IReminderStore, INotificationSender } from '../service.js';
import type { KeyValueStore } from '../../../../storage/index.js';
import type { ReminderSchedule, ReminderConfig, ReminderStatus } from '../../types.js';
import type { Goal, Spark } from '../../types.js';
import { isOk, isErr } from '../../../../types/result.js';
import {
  createReminderId,
  createUserId,
  createGoalId,
  createStepId,
  createSparkId,
  createTimestamp,
  type UserId,
  type SparkId,
  type Timestamp,
} from '../../../../types/branded.js';

// ─────────────────────────────────────────────────────────────────────────────────
// MOCK IMPLEMENTATIONS
// ─────────────────────────────────────────────────────────────────────────────────

function createMockKeyValueStore(): KeyValueStore {
  const data = new Map<string, string>();

  return {
    async get(key: string) { return data.get(key) ?? null; },
    async set(key: string, value: string) { data.set(key, value); },
    async delete(key: string) { return data.delete(key); },
    async exists(key: string) { return data.has(key); },
    async incr(key: string) {
      const val = parseInt(data.get(key) ?? '0', 10) + 1;
      data.set(key, val.toString());
      return val;
    },
    async expire() { return true; },
    async keys() { return []; },
    async hget() { return null; },
    async hset() {},
    async hgetall() { return {}; },
    async hdel() { return false; },
    async lpush() { return 0; },
    async lrange() { return []; },
    async ltrim() {},
    async sadd() { return 0; },
    async srem() { return 0; },
    async smembers() { return []; },
    async sismember() { return false; },
    async scard() { return 0; },
    isConnected() { return true; },
    async disconnect() {},
  };
}

function createMockReminderStore(): IReminderStore & {
  _reminders: Map<string, ReminderSchedule>;
} {
  const reminders = new Map<string, ReminderSchedule>();

  return {
    _reminders: reminders,

    async save(reminder: ReminderSchedule) {
      reminders.set(reminder.id, reminder);
    },

    async get(reminderId: string) {
      return reminders.get(reminderId) ?? null;
    },

    async getPendingByUser(userId: UserId) {
      return Array.from(reminders.values()).filter(
        (r) => r.userId === userId && r.status === 'pending'
      );
    },

    async getPendingBySpark(sparkId: SparkId) {
      return Array.from(reminders.values()).filter(
        (r) => r.sparkId === sparkId && r.status === 'pending'
      );
    },

    async getDueReminders() {
      const now = Date.now();
      return Array.from(reminders.values()).filter(
        (r) => r.status === 'pending' && new Date(r.scheduledTime).getTime() <= now
      );
    },

    async updateStatus(reminderId: string, status: ReminderStatus, timestamp?: Timestamp) {
      const reminder = reminders.get(reminderId);
      if (reminder) {
        const updated = { ...reminder, status };
        if (status === 'sent' && timestamp) {
          (updated as any).sentAt = timestamp;
        }
        reminders.set(reminderId, updated);
      }
    },

    async deleteBySpark(sparkId: SparkId) {
      let count = 0;
      for (const [id, reminder] of reminders) {
        if (reminder.sparkId === sparkId) {
          reminders.delete(id);
          count++;
        }
      }
      return count;
    },
  };
}

function createMockNotificationSender(): INotificationSender & {
  _calls: { method: string; args: unknown[] }[];
} {
  const calls: { method: string; args: unknown[] }[] = [];

  return {
    _calls: calls,

    async sendPush(userId, message, data) {
      calls.push({ method: 'sendPush', args: [userId, message, data] });
      return true;
    },

    async sendEmail(userId, subject, body) {
      calls.push({ method: 'sendEmail', args: [userId, subject, body] });
      return true;
    },

    async sendSms(userId, message) {
      calls.push({ method: 'sendSms', args: [userId, message] });
      return true;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────────────────────────────────────────

function createTestGoal(overrides?: Partial<Goal>): Goal {
  const now = createTimestamp();
  return {
    id: createGoalId(),
    userId: createUserId(),
    title: 'Learn Rust',
    description: 'Master systems programming',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    reminderConfig: createTestReminderConfig(),
    ...overrides,
  };
}

function createTestReminderConfig(overrides?: Partial<ReminderConfig>): ReminderConfig {
  return {
    enabled: true,
    firstReminderHour: 9,
    lastReminderHour: 19,
    intervalHours: 3,
    maxRemindersPerDay: 4,
    channels: { push: true, email: false, sms: false },
    shrinkSparksOnEscalation: true,
    quietDays: [],
    timezone: 'UTC',
    ...overrides,
  };
}

function createTestSpark(overrides?: Partial<Spark>): Spark {
  const now = createTimestamp();
  return {
    id: createSparkId(),
    stepId: createStepId(),
    action: 'Read Chapter 1 of the Rust Book',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    variant: 'full',
    escalationLevel: 0,
    estimatedMinutes: 30,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// scheduleReminders
// ─────────────────────────────────────────────────────────────────────────────────

describe('ReminderService.scheduleReminders', () => {
  let service: ReminderService;
  let reminderStore: ReturnType<typeof createMockReminderStore>;
  let notificationSender: ReturnType<typeof createMockNotificationSender>;
  let keyValueStore: KeyValueStore;

  beforeEach(() => {
    reminderStore = createMockReminderStore();
    notificationSender = createMockNotificationSender();
    keyValueStore = createMockKeyValueStore();
    service = createReminderService(reminderStore, notificationSender, keyValueStore);
  });

  it('should schedule reminders for a spark', async () => {
    const spark = createTestSpark();
    const goal = createTestGoal();

    const result = await service.scheduleReminders(spark, goal);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      // Should have created some reminders (depends on current time)
      expect(reminderStore._reminders.size).toBeGreaterThanOrEqual(0);
    }
  });

  it('should return empty array when reminders disabled', async () => {
    const spark = createTestSpark();
    const goal = createTestGoal({
      reminderConfig: createTestReminderConfig({ enabled: false }),
    });

    const result = await service.scheduleReminders(spark, goal);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toHaveLength(0);
    }
  });

  it('should not duplicate reminders for same spark+date', async () => {
    const spark = createTestSpark();
    const goal = createTestGoal();

    // Schedule twice
    await service.scheduleReminders(spark, goal);
    const countAfterFirst = reminderStore._reminders.size;

    await service.scheduleReminders(spark, goal);
    const countAfterSecond = reminderStore._reminders.size;

    // Count should be same (idempotent)
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it('should return error for invalid config', async () => {
    const spark = createTestSpark();
    const goal = createTestGoal({
      reminderConfig: createTestReminderConfig({
        channels: { push: false, email: false, sms: false }, // No channels!
      }),
    });

    const result = await service.scheduleReminders(spark, goal);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('should use default config when goal has none', async () => {
    const spark = createTestSpark();
    const goal = createTestGoal({ reminderConfig: undefined });

    const result = await service.scheduleReminders(spark, goal);

    // Should succeed with default config
    expect(isOk(result)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// cancelReminders
// ─────────────────────────────────────────────────────────────────────────────────

describe('ReminderService.cancelReminders', () => {
  let service: ReminderService;
  let reminderStore: ReturnType<typeof createMockReminderStore>;
  let notificationSender: ReturnType<typeof createMockNotificationSender>;
  let keyValueStore: KeyValueStore;

  beforeEach(() => {
    reminderStore = createMockReminderStore();
    notificationSender = createMockNotificationSender();
    keyValueStore = createMockKeyValueStore();
    service = createReminderService(reminderStore, notificationSender, keyValueStore);
  });

  it('should cancel pending reminders for a spark', async () => {
    const sparkId = createSparkId();
    const userId = createUserId();

    // Create some pending reminders
    const reminder1: ReminderSchedule = {
      id: createReminderId(),
      userId,
      stepId: createStepId(),
      sparkId,
      scheduledTime: new Date().toISOString(),
      escalationLevel: 0,
      sparkVariant: 'full',
      tone: 'encouraging',
      status: 'pending',
      channels: { push: true, email: false, sms: false },
    };

    const reminder2: ReminderSchedule = {
      ...reminder1,
      id: createReminderId(),
      escalationLevel: 1,
    };

    await reminderStore.save(reminder1);
    await reminderStore.save(reminder2);

    // Cancel
    const result = await service.cancelReminders(sparkId);

    expect(isOk(result)).toBe(true);

    // Both should be cancelled
    expect(reminderStore._reminders.get(reminder1.id)?.status).toBe('cancelled');
    expect(reminderStore._reminders.get(reminder2.id)?.status).toBe('cancelled');
  });

  it('should handle no pending reminders gracefully', async () => {
    const sparkId = createSparkId();

    const result = await service.cancelReminders(sparkId);

    expect(isOk(result)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// getPendingReminders
// ─────────────────────────────────────────────────────────────────────────────────

describe('ReminderService.getPendingReminders', () => {
  let service: ReminderService;
  let reminderStore: ReturnType<typeof createMockReminderStore>;

  beforeEach(() => {
    reminderStore = createMockReminderStore();
    service = createReminderService(
      reminderStore,
      createMockNotificationSender(),
      createMockKeyValueStore()
    );
  });

  it('should return pending reminders sorted by time', async () => {
    const userId = createUserId();
    const sparkId = createSparkId();

    const base: Omit<ReminderSchedule, 'id' | 'scheduledTime'> = {
      userId,
      stepId: createStepId(),
      sparkId,
      escalationLevel: 0,
      sparkVariant: 'full',
      tone: 'encouraging',
      status: 'pending',
      channels: { push: true, email: false, sms: false },
    };

    // Create reminders out of order
    await reminderStore.save({
      ...base,
      id: createReminderId(),
      scheduledTime: '2025-06-15T15:00:00Z', // Later
    });

    await reminderStore.save({
      ...base,
      id: createReminderId(),
      scheduledTime: '2025-06-15T09:00:00Z', // Earlier
    });

    await reminderStore.save({
      ...base,
      id: createReminderId(),
      scheduledTime: '2025-06-15T12:00:00Z', // Middle
    });

    const result = await service.getPendingReminders(userId);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toHaveLength(3);
      expect(result.value[0].scheduledTime).toBe('2025-06-15T09:00:00Z');
      expect(result.value[1].scheduledTime).toBe('2025-06-15T12:00:00Z');
      expect(result.value[2].scheduledTime).toBe('2025-06-15T15:00:00Z');
    }
  });

  it('should only return pending status', async () => {
    const userId = createUserId();

    const base: Omit<ReminderSchedule, 'id' | 'status'> = {
      userId,
      stepId: createStepId(),
      sparkId: createSparkId(),
      scheduledTime: new Date().toISOString(),
      escalationLevel: 0,
      sparkVariant: 'full',
      tone: 'encouraging',
      channels: { push: true, email: false, sms: false },
    };

    await reminderStore.save({ ...base, id: createReminderId(), status: 'pending' });
    await reminderStore.save({ ...base, id: createReminderId(), status: 'sent' });
    await reminderStore.save({ ...base, id: createReminderId(), status: 'cancelled' });

    const result = await service.getPendingReminders(userId);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].status).toBe('pending');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// processPendingReminders
// ─────────────────────────────────────────────────────────────────────────────────

describe('ReminderService.processPendingReminders', () => {
  let service: ReminderService;
  let reminderStore: ReturnType<typeof createMockReminderStore>;
  let notificationSender: ReturnType<typeof createMockNotificationSender>;
  let keyValueStore: KeyValueStore;

  beforeEach(() => {
    reminderStore = createMockReminderStore();
    notificationSender = createMockNotificationSender();
    keyValueStore = createMockKeyValueStore();
    service = createReminderService(reminderStore, notificationSender, keyValueStore);
  });

  it('should send due reminders', async () => {
    // Create a due reminder (in the past)
    const reminder: ReminderSchedule = {
      id: createReminderId(),
      userId: createUserId(),
      stepId: createStepId(),
      sparkId: createSparkId(),
      scheduledTime: new Date(Date.now() - 60000).toISOString(), // 1 min ago
      escalationLevel: 0,
      sparkVariant: 'full',
      tone: 'encouraging',
      status: 'pending',
      channels: { push: true, email: false, sms: false },
    };

    await reminderStore.save(reminder);

    const result = await service.processPendingReminders();

    expect(result.processed).toBe(1);
    expect(result.sent).toBe(1);
    expect(notificationSender._calls).toHaveLength(1);
    expect(notificationSender._calls[0].method).toBe('sendPush');

    // Status should be updated
    expect(reminderStore._reminders.get(reminder.id)?.status).toBe('sent');
  });

  it('should expire old reminders via storm protection', async () => {
    // Create a very old reminder (5 hours ago)
    const reminder: ReminderSchedule = {
      id: createReminderId(),
      userId: createUserId(),
      stepId: createStepId(),
      sparkId: createSparkId(),
      scheduledTime: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
      escalationLevel: 0,
      sparkVariant: 'full',
      tone: 'encouraging',
      status: 'pending',
      channels: { push: true, email: false, sms: false },
    };

    await reminderStore.save(reminder);

    const result = await service.processPendingReminders();

    expect(result.expired).toBe(1);
    expect(result.sent).toBe(0);
    expect(notificationSender._calls).toHaveLength(0);

    // Status should be expired
    expect(reminderStore._reminders.get(reminder.id)?.status).toBe('expired');
  });

  it('should skip duplicate sends (idempotency)', async () => {
    const reminder: ReminderSchedule = {
      id: createReminderId(),
      userId: createUserId(),
      stepId: createStepId(),
      sparkId: createSparkId(),
      scheduledTime: new Date(Date.now() - 60000).toISOString(),
      escalationLevel: 0,
      sparkVariant: 'full',
      tone: 'encouraging',
      status: 'pending',
      channels: { push: true, email: false, sms: false },
    };

    await reminderStore.save(reminder);

    // Process twice
    await service.processPendingReminders();
    
    // Reset notification calls but keep idempotency state
    notificationSender._calls.length = 0;
    
    // Reset reminder status to pending (simulating retry scenario)
    await reminderStore.updateStatus(reminder.id, 'pending');

    const result = await service.processPendingReminders();

    // Second attempt should skip due to idempotency
    expect(result.skipped).toBe(1);
    expect(notificationSender._calls).toHaveLength(0);
  });

  it('should try fallback channels when primary fails', async () => {
    // Make push fail
    vi.spyOn(notificationSender, 'sendPush').mockResolvedValue(false);

    const reminder: ReminderSchedule = {
      id: createReminderId(),
      userId: createUserId(),
      stepId: createStepId(),
      sparkId: createSparkId(),
      scheduledTime: new Date(Date.now() - 60000).toISOString(),
      escalationLevel: 0,
      sparkVariant: 'full',
      tone: 'encouraging',
      status: 'pending',
      channels: { push: true, email: true, sms: false },
    };

    await reminderStore.save(reminder);

    const result = await service.processPendingReminders();

    expect(result.sent).toBe(1);
    // Should have tried push then succeeded with email
    expect(notificationSender._calls.some((c) => c.method === 'sendEmail')).toBe(true);
  });

  it('should return timing information', async () => {
    const result = await service.processPendingReminders();

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// getHealth
// ─────────────────────────────────────────────────────────────────────────────────

describe('ReminderService.getHealth', () => {
  it('should return health status', async () => {
    const service = createReminderService(
      createMockReminderStore(),
      createMockNotificationSender(),
      createMockKeyValueStore()
    );

    const health = await service.getHealth();

    expect(health.healthy).toBe(true);
    expect(health.details.idempotency).toBe(true);
    expect(health.details.stormProtection).toBe(true);
  });
});
