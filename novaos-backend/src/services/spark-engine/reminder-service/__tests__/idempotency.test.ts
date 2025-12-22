// ═══════════════════════════════════════════════════════════════════════════════
// IDEMPOTENCY TESTS — Prevent Duplicate Reminder Sends
// NovaOS Spark Engine — Phase 11: Reminder Service
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  IdempotencyManager,
  createIdempotencyManager,
  generateIdempotencyKey,
  generateSparkDateKey,
  DEFAULT_IDEMPOTENCY_CONFIG,
} from '../idempotency.js';
import type { KeyValueStore } from '../../../../storage/index.js';
import { createReminderId, createSparkId } from '../../../../types/branded.js';

// ─────────────────────────────────────────────────────────────────────────────────
// MOCK STORE
// ─────────────────────────────────────────────────────────────────────────────────

function createMockStore(): KeyValueStore & { _data: Map<string, string> } {
  const data = new Map<string, string>();

  return {
    _data: data,

    async get(key: string): Promise<string | null> {
      return data.get(key) ?? null;
    },

    async set(key: string, value: string, _ttl?: number): Promise<void> {
      data.set(key, value);
    },

    async delete(key: string): Promise<boolean> {
      return data.delete(key);
    },

    async exists(key: string): Promise<boolean> {
      return data.has(key);
    },

    async incr(key: string): Promise<number> {
      const current = parseInt(data.get(key) ?? '0', 10);
      const next = current + 1;
      data.set(key, next.toString());
      return next;
    },

    async expire(_key: string, _ttl: number): Promise<boolean> {
      return true;
    },

    async keys(pattern: string): Promise<string[]> {
      const regex = new RegExp(pattern.replace('*', '.*'));
      return Array.from(data.keys()).filter((k) => regex.test(k));
    },

    // Hash operations (stub)
    async hget(): Promise<string | null> { return null; },
    async hset(): Promise<void> {},
    async hgetall(): Promise<Record<string, string>> { return {}; },
    async hdel(): Promise<boolean> { return false; },

    // List operations (stub)
    async lpush(): Promise<number> { return 0; },
    async lrange(): Promise<string[]> { return []; },
    async ltrim(): Promise<void> {},

    // Set operations (stub)
    async sadd(): Promise<number> { return 0; },
    async srem(): Promise<number> { return 0; },
    async smembers(): Promise<string[]> { return []; },
    async sismember(): Promise<boolean> { return false; },
    async scard(): Promise<number> { return 0; },

    isConnected(): boolean { return true; },
    async disconnect(): Promise<void> {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// KEY GENERATION
// ─────────────────────────────────────────────────────────────────────────────────

describe('generateIdempotencyKey', () => {
  it('should generate key with prefix and reminder ID', () => {
    const reminderId = createReminderId('reminder-123');
    const key = generateIdempotencyKey(reminderId, 'prefix:');

    expect(key).toBe('prefix:reminder-123');
  });

  it('should handle default prefix', () => {
    const reminderId = createReminderId('reminder-abc');
    const key = generateIdempotencyKey(reminderId, DEFAULT_IDEMPOTENCY_CONFIG.keyPrefix);

    expect(key).toBe('reminder:idempotent:reminder-abc');
  });
});

describe('generateSparkDateKey', () => {
  it('should generate key with spark ID and date', () => {
    const sparkId = createSparkId('spark-456');
    const key = generateSparkDateKey(sparkId, '2025-06-15', 'prefix:');

    expect(key).toBe('prefix:spark:spark-456:2025-06-15');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// IdempotencyManager
// ─────────────────────────────────────────────────────────────────────────────────

describe('IdempotencyManager', () => {
  let store: ReturnType<typeof createMockStore>;
  let manager: IdempotencyManager;

  beforeEach(() => {
    store = createMockStore();
    manager = createIdempotencyManager(store);
  });

  describe('checkCanSend', () => {
    it('should allow send when key does not exist', async () => {
      const reminderId = createReminderId();
      const result = await manager.checkCanSend(reminderId);

      expect(result.canProceed).toBe(true);
      expect(result.key).toContain(reminderId);
    });

    it('should deny send when key exists', async () => {
      const reminderId = createReminderId();
      const key = generateIdempotencyKey(reminderId, DEFAULT_IDEMPOTENCY_CONFIG.keyPrefix);

      // Pre-set the key
      await store.set(key, new Date().toISOString());

      const result = await manager.checkCanSend(reminderId);

      expect(result.canProceed).toBe(false);
      expect(result.reason).toBe('Reminder already sent');
      expect(result.existingSendTime).toBeDefined();
    });

    it('should fail-open on store error', async () => {
      const reminderId = createReminderId();

      // Make store throw
      vi.spyOn(store, 'get').mockRejectedValueOnce(new Error('Redis error'));

      const result = await manager.checkCanSend(reminderId);

      expect(result.canProceed).toBe(true);
      expect(result.reason).toContain('Idempotency check failed');
    });
  });

  describe('claimForSend', () => {
    it('should claim key when not exists', async () => {
      const reminderId = createReminderId();
      const result = await manager.claimForSend(reminderId);

      expect(result.claimed).toBe(true);
      expect(result.expiresAt).toBeDefined();

      // Key should now exist
      const check = await manager.checkCanSend(reminderId);
      expect(check.canProceed).toBe(false);
    });

    it('should not claim when key already exists', async () => {
      const reminderId = createReminderId();

      // First claim
      await manager.claimForSend(reminderId);

      // Second claim should fail
      const result = await manager.claimForSend(reminderId);

      expect(result.claimed).toBe(false);
      expect(result.reason).toBe('Key already claimed');
    });

    it('should store timestamp when configured', async () => {
      const reminderId = createReminderId();
      await manager.claimForSend(reminderId);

      const key = generateIdempotencyKey(reminderId, DEFAULT_IDEMPOTENCY_CONFIG.keyPrefix);
      const value = await store.get(key);

      // Should be an ISO timestamp
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('checkAndClaim', () => {
    it('should atomically check and claim', async () => {
      const reminderId = createReminderId();

      const result1 = await manager.checkAndClaim(reminderId);
      expect(result1.claimed).toBe(true);

      const result2 = await manager.checkAndClaim(reminderId);
      expect(result2.claimed).toBe(false);
    });
  });

  describe('release', () => {
    it('should release claimed key', async () => {
      const reminderId = createReminderId();

      // Claim
      await manager.claimForSend(reminderId);
      expect((await manager.checkCanSend(reminderId)).canProceed).toBe(false);

      // Release
      const released = await manager.release(reminderId);
      expect(released).toBe(true);

      // Should be able to claim again
      expect((await manager.checkCanSend(reminderId)).canProceed).toBe(true);
    });

    it('should return false for non-existent key', async () => {
      const reminderId = createReminderId();
      const released = await manager.release(reminderId);

      expect(released).toBe(false);
    });
  });

  describe('spark date scheduling', () => {
    it('should track spark scheduled for date', async () => {
      const sparkId = createSparkId();
      const date = '2025-06-15';

      // Initially not scheduled
      expect(await manager.isSparkScheduledForDate(sparkId, date)).toBe(false);

      // Mark as scheduled
      await manager.markSparkScheduledForDate(sparkId, date);

      // Now should be scheduled
      expect(await manager.isSparkScheduledForDate(sparkId, date)).toBe(true);
    });

    it('should track different dates independently', async () => {
      const sparkId = createSparkId();

      await manager.markSparkScheduledForDate(sparkId, '2025-06-15');

      expect(await manager.isSparkScheduledForDate(sparkId, '2025-06-15')).toBe(true);
      expect(await manager.isSparkScheduledForDate(sparkId, '2025-06-16')).toBe(false);
    });

    it('should track different sparks independently', async () => {
      const spark1 = createSparkId();
      const spark2 = createSparkId();
      const date = '2025-06-15';

      await manager.markSparkScheduledForDate(spark1, date);

      expect(await manager.isSparkScheduledForDate(spark1, date)).toBe(true);
      expect(await manager.isSparkScheduledForDate(spark2, date)).toBe(false);
    });
  });

  describe('batch operations', () => {
    it('should check multiple reminders', async () => {
      const ids = [createReminderId(), createReminderId(), createReminderId()];

      // Claim first one
      await manager.claimForSend(ids[0]);

      const results = await manager.checkMultiple(ids);

      expect(results.get(ids[0])?.canProceed).toBe(false);
      expect(results.get(ids[1])?.canProceed).toBe(true);
      expect(results.get(ids[2])?.canProceed).toBe(true);
    });

    it('should filter sendable reminders', async () => {
      const ids = [createReminderId(), createReminderId(), createReminderId()];

      // Claim first and third
      await manager.claimForSend(ids[0]);
      await manager.claimForSend(ids[2]);

      const sendable = await manager.filterSendable(ids);

      expect(sendable).toHaveLength(1);
      expect(sendable[0]).toBe(ids[1]);
    });
  });

  describe('health check', () => {
    it('should return healthy for working store', async () => {
      const healthy = await manager.isHealthy();
      expect(healthy).toBe(true);
    });

    it('should return unhealthy for failing store', async () => {
      vi.spyOn(store, 'set').mockRejectedValue(new Error('Redis error'));

      const healthy = await manager.isHealthy();
      expect(healthy).toBe(false);
    });
  });

  describe('configuration', () => {
    it('should use custom configuration', () => {
      const customManager = createIdempotencyManager(store, {
        keyPrefix: 'custom:',
        ttlSeconds: 3600,
      });

      const config = customManager.getConfig();

      expect(config.keyPrefix).toBe('custom:');
      expect(config.ttlSeconds).toBe(3600);
    });
  });
});
