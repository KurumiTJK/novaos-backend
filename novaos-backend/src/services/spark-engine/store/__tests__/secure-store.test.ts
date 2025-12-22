// ═══════════════════════════════════════════════════════════════════════════════
// SECURE STORE TESTS — Phase 12: Secure Store Layer
// NovaOS Spark Engine
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { KeyValueStore } from '../../../../storage/index.js';
import type { Goal, Quest, Step, Spark, ReminderSchedule } from '../../types.js';
import type { UserId, GoalId, QuestId, StepId, SparkId, ReminderId, Timestamp } from '../../../../types/branded.js';
import { createTimestamp } from '../../../../types/branded.js';

import { GoalStore, createGoalStore } from '../goal-store.js';
import { QuestStore, createQuestStore } from '../quest-store.js';
import { StepStore, createStepStore } from '../step-store.js';
import { SparkStore, createSparkStore } from '../spark-store.js';
import { ReminderStore, createReminderStore } from '../reminder-store.js';
import { RefinementStore, createRefinementStore } from '../refinement-store.js';
import {
  SparkEngineStoreManager,
  createStoreManager,
  resetStoreManager,
} from '../index.js';
import { StoreErrorCode, type SecureStoreConfig, type RefinementState } from '../types.js';
import { computeIntegrityHash, verifyIntegrity } from '../secure-store.js';

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK STORE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * In-memory mock store for testing.
 */
class MockKeyValueStore implements KeyValueStore {
  private data = new Map<string, { value: string; expiresAt?: number }>();
  private sets = new Map<string, Set<string>>();

  async get(key: string): Promise<string | null> {
    const entry = this.data.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.data.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    this.data.set(key, {
      value,
      expiresAt: ttl ? Date.now() + ttl * 1000 : undefined,
    });
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    const entry = this.data.get(key);
    if (!entry) return false;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.data.delete(key);
      return false;
    }
    return true;
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return Array.from(this.data.keys()).filter((k) => regex.test(k));
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    let set = this.sets.get(key);
    if (!set) {
      set = new Set();
      this.sets.set(key, set);
    }
    let added = 0;
    for (const member of members) {
      if (!set.has(member)) {
        set.add(member);
        added++;
      }
    }
    return added;
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const member of members) {
      if (set.delete(member)) {
        removed++;
      }
    }
    return removed;
  }

  async smembers(key: string): Promise<string[]> {
    const set = this.sets.get(key);
    return set ? Array.from(set) : [];
  }

  async scard(key: string): Promise<number> {
    const set = this.sets.get(key);
    return set ? set.size : 0;
  }

  async sismember(key: string, member: string): Promise<boolean> {
    const set = this.sets.get(key);
    return set ? set.has(member) : false;
  }

  // Sorted set operations (simplified)
  async zadd(key: string, score: number, member: string): Promise<number> {
    return this.sadd(key, member);
  }

  async zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]> {
    return this.smembers(key);
  }

  clear(): void {
    this.data.clear();
    this.sets.clear();
  }
}

/**
 * Mock encryption service for testing.
 */
const mockEncryption = {
  encrypt: (data: string) => ({
    v: 1,
    kid: 'test-key',
    kv: 1,
    iv: 'test-iv',
    ct: Buffer.from(data).toString('base64'),
    tag: 'test-tag',
  }),
  decrypt: (envelope: any) => Buffer.from(envelope.ct, 'base64'),
  decryptToString: (envelope: any) => Buffer.from(envelope.ct, 'base64').toString(),
  serialize: (envelope: any) => JSON.stringify(envelope),
  deserialize: (data: string) => JSON.parse(data),
  reencrypt: (envelope: any) => envelope,
};

// ═══════════════════════════════════════════════════════════════════════════════
// TEST FIXTURES
// ═══════════════════════════════════════════════════════════════════════════════

const TEST_USER_ID = 'user-test-123' as UserId;
const TEST_GOAL_ID = 'goal-test-456' as GoalId;
const TEST_QUEST_ID = 'quest-test-789' as QuestId;
const TEST_STEP_ID = 'step-test-abc' as StepId;
const TEST_SPARK_ID = 'spark-test-def' as SparkId;
const TEST_REMINDER_ID = 'reminder-test-ghi' as ReminderId;

const now = createTimestamp();

function createTestGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: TEST_GOAL_ID,
    userId: TEST_USER_ID,
    title: 'Learn TypeScript',
    description: 'Master TypeScript fundamentals',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createTestQuest(overrides: Partial<Quest> = {}): Quest {
  return {
    id: TEST_QUEST_ID,
    goalId: TEST_GOAL_ID,
    title: 'Basic Types',
    description: 'Learn basic TypeScript types',
    status: 'active',
    order: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createTestStep(overrides: Partial<Step> = {}): Step {
  return {
    id: TEST_STEP_ID,
    questId: TEST_QUEST_ID,
    title: 'Primitive Types',
    description: 'Learn string, number, boolean',
    status: 'pending',
    order: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createTestSpark(overrides: Partial<Spark> = {}): Spark {
  return {
    id: TEST_SPARK_ID,
    stepId: TEST_STEP_ID,
    action: 'Read TypeScript documentation on primitive types',
    status: 'pending',
    variant: 'full',
    escalationLevel: 0,
    estimatedMinutes: 15,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createTestReminder(overrides: Partial<ReminderSchedule> = {}): ReminderSchedule {
  return {
    id: TEST_REMINDER_ID,
    userId: TEST_USER_ID,
    stepId: TEST_STEP_ID,
    sparkId: TEST_SPARK_ID,
    scheduledTime: new Date(Date.now() + 3600000).toISOString(),
    escalationLevel: 0,
    sparkVariant: 'full',
    tone: 'encouraging',
    status: 'pending',
    channels: { push: true, email: false, sms: false },
    ...overrides,
  };
}

const testConfig: Partial<SecureStoreConfig> = {
  encryptionEnabled: true,
  integrityCheckEnabled: true,
  defaultTtlSeconds: 0,
  completedGoalTtlSeconds: 86400,
  expiredReminderTtlSeconds: 3600,
  refinementStateTtlSeconds: 3600,
};

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRITY TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Integrity Functions', () => {
  it('should compute consistent hash for same data', () => {
    const data = 'test data';
    const hash1 = computeIntegrityHash(data);
    const hash2 = computeIntegrityHash(data);
    expect(hash1).toBe(hash2);
  });

  it('should compute different hash for different data', () => {
    const hash1 = computeIntegrityHash('data1');
    const hash2 = computeIntegrityHash('data2');
    expect(hash1).not.toBe(hash2);
  });

  it('should verify integrity correctly', () => {
    const data = 'test data';
    const hash = computeIntegrityHash(data);
    expect(verifyIntegrity(data, hash)).toBe(true);
    expect(verifyIntegrity('modified data', hash)).toBe(false);
  });

  it('should handle invalid hash format', () => {
    expect(verifyIntegrity('data', 'invalid-hash')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GOAL STORE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('GoalStore', () => {
  let store: MockKeyValueStore;
  let goalStore: GoalStore;

  beforeEach(() => {
    store = new MockKeyValueStore();
    goalStore = createGoalStore(store, testConfig, mockEncryption as any);
  });

  afterEach(() => {
    store.clear();
  });

  describe('save', () => {
    it('should save a new goal', async () => {
      const goal = createTestGoal();
      const result = await goalStore.save(goal);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.entity).toEqual(goal);
        expect(result.value.version).toBe(1);
        expect(result.value.created).toBe(true);
      }
    });

    it('should update existing goal with incremented version', async () => {
      const goal = createTestGoal();
      await goalStore.save(goal);

      const updated = { ...goal, title: 'Updated Title' };
      const result = await goalStore.save(updated);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.version).toBe(2);
        expect(result.value.created).toBe(false);
      }
    });

    it('should reject invalid goal', async () => {
      const invalid = createTestGoal({ title: '' });
      const result = await goalStore.save(invalid);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(StoreErrorCode.INVALID_DATA);
      }
    });

    it('should enforce optimistic locking', async () => {
      const goal = createTestGoal();
      await goalStore.save(goal);

      const result = await goalStore.save(goal, { expectedVersion: 999 });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(StoreErrorCode.VERSION_CONFLICT);
      }
    });
  });

  describe('get', () => {
    it('should retrieve saved goal', async () => {
      const goal = createTestGoal();
      await goalStore.save(goal);

      const result = await goalStore.get(goal.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(goal);
      }
    });

    it('should return null for non-existent goal', async () => {
      const result = await goalStore.get('nonexistent' as GoalId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });
  });

  describe('delete', () => {
    it('should delete existing goal', async () => {
      const goal = createTestGoal();
      await goalStore.save(goal);

      const result = await goalStore.delete(goal.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.deleted).toBe(true);
      }

      const getResult = await goalStore.get(goal.id);
      expect(getResult.ok && getResult.value).toBeNull();
    });

    it('should return deleted=false for non-existent goal', async () => {
      const result = await goalStore.delete('nonexistent' as GoalId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.deleted).toBe(false);
      }
    });
  });

  describe('getByUser', () => {
    it('should return empty list for user with no goals', async () => {
      const result = await goalStore.getByUser(TEST_USER_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.items).toHaveLength(0);
        expect(result.value.total).toBe(0);
      }
    });

    it('should return all goals for user', async () => {
      const goal1 = createTestGoal({ id: 'goal-1' as GoalId });
      const goal2 = createTestGoal({ id: 'goal-2' as GoalId });
      await goalStore.save(goal1);
      await goalStore.save(goal2);

      const result = await goalStore.getByUser(TEST_USER_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.items).toHaveLength(2);
        expect(result.value.total).toBe(2);
      }
    });

    it('should filter by status', async () => {
      const active = createTestGoal({ id: 'goal-1' as GoalId, status: 'active' });
      const paused = createTestGoal({ id: 'goal-2' as GoalId, status: 'paused' });
      await goalStore.save(active);
      await goalStore.save(paused);

      const result = await goalStore.getByUser(TEST_USER_ID, { status: 'active' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.items).toHaveLength(1);
        expect(result.value.items[0].status).toBe('active');
      }
    });

    it('should paginate results', async () => {
      for (let i = 0; i < 5; i++) {
        await goalStore.save(createTestGoal({ id: `goal-${i}` as GoalId }));
      }

      const result = await goalStore.getByUser(TEST_USER_ID, { limit: 2, offset: 0 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.items).toHaveLength(2);
        expect(result.value.total).toBe(5);
        expect(result.value.hasMore).toBe(true);
      }
    });
  });

  describe('updateStatus', () => {
    it('should update goal status', async () => {
      const goal = createTestGoal();
      await goalStore.save(goal);

      const result = await goalStore.updateStatus(goal.id, 'completed');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('completed');
      }
    });

    it('should return error for non-existent goal', async () => {
      const result = await goalStore.updateStatus('nonexistent' as GoalId, 'completed');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(StoreErrorCode.NOT_FOUND);
      }
    });
  });

  describe('getActiveGoals', () => {
    it('should return only active goals', async () => {
      const active = createTestGoal({ id: 'goal-1' as GoalId, status: 'active' });
      const completed = createTestGoal({ id: 'goal-2' as GoalId, status: 'completed' });
      await goalStore.save(active);
      await goalStore.save(completed);

      const result = await goalStore.getActiveGoals(TEST_USER_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].id).toBe('goal-1');
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// QUEST STORE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('QuestStore', () => {
  let store: MockKeyValueStore;
  let questStore: QuestStore;

  beforeEach(() => {
    store = new MockKeyValueStore();
    questStore = createQuestStore(store, testConfig, mockEncryption as any);
  });

  afterEach(() => {
    store.clear();
  });

  describe('save and get', () => {
    it('should save and retrieve quest', async () => {
      const quest = createTestQuest();
      await questStore.save(quest);

      const result = await questStore.get(quest.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(quest);
      }
    });
  });

  describe('getByGoal', () => {
    it('should return quests sorted by order', async () => {
      const quest1 = createTestQuest({ id: 'quest-1' as QuestId, order: 2 });
      const quest2 = createTestQuest({ id: 'quest-2' as QuestId, order: 1 });
      await questStore.save(quest1);
      await questStore.save(quest2);

      const result = await questStore.getByGoal(TEST_GOAL_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.items).toHaveLength(2);
        expect(result.value.items[0].order).toBe(1);
        expect(result.value.items[1].order).toBe(2);
      }
    });
  });

  describe('getActiveQuest', () => {
    it('should return first active quest', async () => {
      const pending = createTestQuest({ id: 'quest-1' as QuestId, status: 'pending', order: 1 });
      const active = createTestQuest({ id: 'quest-2' as QuestId, status: 'active', order: 2 });
      await questStore.save(pending);
      await questStore.save(active);

      const result = await questStore.getActiveQuest(TEST_GOAL_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.id).toBe('quest-2');
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// STEP STORE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('StepStore', () => {
  let store: MockKeyValueStore;
  let stepStore: StepStore;

  beforeEach(() => {
    store = new MockKeyValueStore();
    stepStore = createStepStore(store, testConfig, mockEncryption as any);
  });

  afterEach(() => {
    store.clear();
  });

  describe('save and get', () => {
    it('should save and retrieve step', async () => {
      const step = createTestStep();
      await stepStore.save(step);

      const result = await stepStore.get(step.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(step);
      }
    });
  });

  describe('getByQuest', () => {
    it('should return steps sorted by order', async () => {
      const step1 = createTestStep({ id: 'step-1' as StepId, order: 2 });
      const step2 = createTestStep({ id: 'step-2' as StepId, order: 1 });
      await stepStore.save(step1);
      await stepStore.save(step2);

      const result = await stepStore.getByQuest(TEST_QUEST_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.items).toHaveLength(2);
        expect(result.value.items[0].order).toBe(1);
      }
    });
  });

  describe('updateStatus', () => {
    it('should set startedAt when becoming active', async () => {
      const step = createTestStep({ status: 'pending' });
      await stepStore.save(step);

      const result = await stepStore.updateStatus(step.id, 'active');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('active');
        expect(result.value.startedAt).toBeDefined();
      }
    });

    it('should set completedAt when becoming completed', async () => {
      const step = createTestStep({ status: 'active' });
      await stepStore.save(step);

      const result = await stepStore.updateStatus(step.id, 'completed');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('completed');
        expect(result.value.completedAt).toBeDefined();
      }
    });
  });

  describe('date indexing', () => {
    it('should register and find step by date', async () => {
      const step = createTestStep({ scheduledDate: '2025-01-15' });
      await stepStore.save(step);
      await stepStore.registerForDate(TEST_USER_ID, step.id, '2025-01-15');

      const result = await stepStore.getByDate(TEST_USER_ID, '2025-01-15');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.id).toBe(step.id);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SPARK STORE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('SparkStore', () => {
  let store: MockKeyValueStore;
  let sparkStore: SparkStore;

  beforeEach(() => {
    store = new MockKeyValueStore();
    sparkStore = createSparkStore(store, testConfig, mockEncryption as any);
  });

  afterEach(() => {
    store.clear();
  });

  describe('save and get', () => {
    it('should save and retrieve spark', async () => {
      const spark = createTestSpark();
      await sparkStore.save(spark);

      const result = await sparkStore.get(spark.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(spark);
      }
    });

    it('should reject invalid estimatedMinutes', async () => {
      const invalid = createTestSpark({ estimatedMinutes: 1 }); // Below MIN
      const result = await sparkStore.save(invalid);

      expect(result.ok).toBe(false);
    });
  });

  describe('getActiveForStep', () => {
    it('should return active spark', async () => {
      const pending = createTestSpark({ id: 'spark-1' as SparkId, status: 'pending' });
      const completed = createTestSpark({ id: 'spark-2' as SparkId, status: 'completed' });
      await sparkStore.save(pending);
      await sparkStore.save(completed);

      const result = await sparkStore.getActiveForStep(TEST_STEP_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.id).toBe('spark-1');
      }
    });
  });

  describe('updateEscalation', () => {
    it('should update escalation level and variant', async () => {
      const spark = createTestSpark();
      await sparkStore.save(spark);

      const result = await sparkStore.updateEscalation(spark.id, 2, 'reduced');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.escalationLevel).toBe(2);
        expect(result.value.variant).toBe('reduced');
      }
    });

    it('should reject invalid escalation level', async () => {
      const spark = createTestSpark();
      await sparkStore.save(spark);

      const result = await sparkStore.updateEscalation(spark.id, 5, 'full');

      expect(result.ok).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REMINDER STORE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('ReminderStore', () => {
  let store: MockKeyValueStore;
  let reminderStore: ReminderStore;

  beforeEach(() => {
    store = new MockKeyValueStore();
    reminderStore = createReminderStore(store, testConfig, mockEncryption as any);
  });

  afterEach(() => {
    store.clear();
  });

  describe('save and get', () => {
    it('should save and retrieve reminder', async () => {
      const reminder = createTestReminder();
      await reminderStore.save(reminder);

      const result = await reminderStore.get(reminder.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(reminder);
      }
    });
  });

  describe('getPendingByUser', () => {
    it('should return pending reminders for user', async () => {
      const pending = createTestReminder({ id: 'rem-1' as ReminderId, status: 'pending' });
      const sent = createTestReminder({ id: 'rem-2' as ReminderId, status: 'sent' });
      await reminderStore.save(pending);
      await reminderStore.save(sent);

      const result = await reminderStore.getPendingByUser(TEST_USER_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].id).toBe('rem-1');
      }
    });
  });

  describe('getDueReminders', () => {
    it('should return reminders due before cutoff', async () => {
      const past = createTestReminder({
        id: 'rem-1' as ReminderId,
        scheduledTime: new Date(Date.now() - 3600000).toISOString(),
      });
      const future = createTestReminder({
        id: 'rem-2' as ReminderId,
        scheduledTime: new Date(Date.now() + 3600000).toISOString(),
      });
      await reminderStore.save(past);
      await reminderStore.save(future);

      const result = await reminderStore.getDueReminders(new Date());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].id).toBe('rem-1');
      }
    });
  });

  describe('updateStatus', () => {
    it('should update status and set sentAt', async () => {
      const reminder = createTestReminder();
      await reminderStore.save(reminder);

      const result = await reminderStore.updateStatus(reminder.id, 'sent');

      expect(result.ok).toBe(true);

      const getResult = await reminderStore.get(reminder.id);
      expect(getResult.ok && getResult.value?.status).toBe('sent');
      expect(getResult.ok && getResult.value?.sentAt).toBeDefined();
    });
  });

  describe('deleteBySpark', () => {
    it('should delete all reminders for spark', async () => {
      const rem1 = createTestReminder({ id: 'rem-1' as ReminderId });
      const rem2 = createTestReminder({ id: 'rem-2' as ReminderId });
      await reminderStore.save(rem1);
      await reminderStore.save(rem2);

      const result = await reminderStore.deleteBySpark(TEST_SPARK_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(2);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REFINEMENT STORE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('RefinementStore', () => {
  let store: MockKeyValueStore;
  let refinementStore: RefinementStore;

  beforeEach(() => {
    store = new MockKeyValueStore();
    refinementStore = createRefinementStore(store, testConfig, mockEncryption as any);
  });

  afterEach(() => {
    store.clear();
  });

  describe('create and get', () => {
    it('should create and retrieve refinement state', async () => {
      const result = await refinementStore.create(TEST_USER_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.userId).toBe(TEST_USER_ID);
        expect(result.value.stage).toBe('initial');
      }

      const getResult = await refinementStore.get(TEST_USER_ID);
      expect(getResult.ok && getResult.value?.stage).toBe('initial');
    });
  });

  describe('update', () => {
    it('should merge inputs on update', async () => {
      await refinementStore.create(TEST_USER_ID);
      await refinementStore.addInput(TEST_USER_ID, 'topic', 'TypeScript');
      await refinementStore.addInput(TEST_USER_ID, 'duration', '30 days');

      const result = await refinementStore.get(TEST_USER_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.inputs.topic).toBe('TypeScript');
        expect(result.value?.inputs.duration).toBe('30 days');
      }
    });
  });

  describe('advanceStage', () => {
    it('should advance through stages', async () => {
      await refinementStore.create(TEST_USER_ID);

      await refinementStore.advanceStage(TEST_USER_ID);
      let result = await refinementStore.getStage(TEST_USER_ID);
      expect(result.ok && result.value).toBe('clarifying');

      await refinementStore.advanceStage(TEST_USER_ID);
      result = await refinementStore.getStage(TEST_USER_ID);
      expect(result.ok && result.value).toBe('confirming');

      await refinementStore.advanceStage(TEST_USER_ID);
      result = await refinementStore.getStage(TEST_USER_ID);
      expect(result.ok && result.value).toBe('complete');
    });

    it('should not advance past complete', async () => {
      await refinementStore.create(TEST_USER_ID);
      await refinementStore.complete(TEST_USER_ID);

      const result = await refinementStore.advanceStage(TEST_USER_ID);

      expect(result.ok).toBe(false);
    });
  });

  describe('hasActiveRefinement', () => {
    it('should return true for non-complete refinement', async () => {
      await refinementStore.create(TEST_USER_ID);

      const result = await refinementStore.hasActiveRefinement(TEST_USER_ID);

      expect(result.ok && result.value).toBe(true);
    });

    it('should return false for complete refinement', async () => {
      await refinementStore.create(TEST_USER_ID);
      await refinementStore.complete(TEST_USER_ID);

      const result = await refinementStore.hasActiveRefinement(TEST_USER_ID);

      expect(result.ok && result.value).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// STORE MANAGER TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('SparkEngineStoreManager', () => {
  let store: MockKeyValueStore;
  let manager: SparkEngineStoreManager;

  beforeEach(() => {
    resetStoreManager();
    store = new MockKeyValueStore();
    manager = createStoreManager(store, testConfig, mockEncryption as any);
  });

  afterEach(() => {
    store.clear();
    resetStoreManager();
  });

  describe('cascade delete', () => {
    it('should cascade delete from goal to reminders', async () => {
      // Create full hierarchy
      const goal = createTestGoal();
      const quest = createTestQuest();
      const step = createTestStep();
      const spark = createTestSpark();
      const reminder = createTestReminder();

      await manager.goals.save(goal);
      await manager.quests.save(quest);
      await manager.steps.save(step);
      await manager.sparks.save(spark);
      await manager.reminders.save(reminder);

      // Delete goal
      const result = await manager.goals.delete(goal.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.deleted).toBe(true);
        expect(result.value.cascadeCount).toBeGreaterThan(0);
      }

      // Verify all deleted
      expect((await manager.quests.get(quest.id)).ok && (await manager.quests.get(quest.id)).value).toBeNull();
      expect((await manager.steps.get(step.id)).ok && (await manager.steps.get(step.id)).value).toBeNull();
      expect((await manager.sparks.get(spark.id)).ok && (await manager.sparks.get(spark.id)).value).toBeNull();
      expect((await manager.reminders.get(reminder.id)).ok && (await manager.reminders.get(reminder.id)).value).toBeNull();
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status', async () => {
      const result = await manager.healthCheck();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.healthy).toBe(true);
        expect(result.value.backend).toBe(true);
        expect(result.value.encryption).toBe(true);
      }
    });
  });

  describe('getMetrics', () => {
    it('should return metrics', () => {
      const metrics = manager.getMetrics();

      expect(metrics.encryptionEnabled).toBe(true);
      expect(metrics.integrityCheckEnabled).toBe(true);
    });
  });

  describe('getUserStats', () => {
    it('should return user statistics', async () => {
      const goal = createTestGoal();
      await manager.goals.save(goal);

      const result = await manager.getUserStats(TEST_USER_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.totalGoals).toBe(1);
        expect(result.value.activeGoals).toBe(1);
      }
    });
  });

  describe('deleteAllUserData', () => {
    it('should delete all user data', async () => {
      const goal = createTestGoal();
      await manager.goals.save(goal);
      await manager.refinement.create(TEST_USER_ID);

      const result = await manager.deleteAllUserData(TEST_USER_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeGreaterThan(0);
      }

      const goalsResult = await manager.goals.getByUser(TEST_USER_ID);
      expect(goalsResult.ok && goalsResult.value.total).toBe(0);
    });
  });
});
