// ═══════════════════════════════════════════════════════════════════════════════
// LOCKING TESTS — Distributed Lock Tests
// NovaOS Spark Engine — Phase 9: Step Generation
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Redis } from 'ioredis';

import { DistributedLock, createDistributedLock } from '../locking.js';
import { DEFAULT_LOCK_CONFIG } from '../types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// MOCK REDIS
// ─────────────────────────────────────────────────────────────────────────────────

function createMockRedis(): Redis {
  const storage = new Map<string, any>();
  let lockHeld = false;
  let fencingToken = 0;

  return {
    script: vi.fn().mockImplementation(async (cmd: string, source: string) => {
      // Return a fake SHA for LOAD command
      return `sha-${Math.random().toString(36).slice(2)}`;
    }),

    evalsha: vi.fn().mockImplementation(async (sha: string, numKeys: number, ...args: string[]) => {
      const key = args[0];

      // Simulate lock acquire
      if (sha.includes('sha-') && numKeys === 2) {
        if (!lockHeld) {
          lockHeld = true;
          fencingToken++;
          const expiresAt = Date.now() + 300000;
          return [1, fencingToken, expiresAt]; // acquired
        } else {
          return [0, 0, Date.now() + 60000]; // not acquired
        }
      }

      // Simulate lock release
      if (numKeys === 1 && args.length === 2) {
        if (lockHeld) {
          lockHeld = false;
          return 1; // released
        }
        return 0; // not held
      }

      // Simulate lock extend
      if (numKeys === 1 && args.length === 4) {
        if (lockHeld) {
          const newExpires = Date.now() + parseInt(args[2] ?? '300000');
          return [1, newExpires];
        }
        return [0, 0];
      }

      return [0, 0, 0];
    }),

    exists: vi.fn().mockImplementation(async (key: string) => {
      return lockHeld ? 1 : 0;
    }),

    del: vi.fn().mockImplementation(async (key: string) => {
      lockHeld = false;
      return 1;
    }),

    // Allow tests to manipulate lock state
    __setLockHeld: (held: boolean) => {
      lockHeld = held;
    },
    __isLockHeld: () => lockHeld,
  } as unknown as Redis;
}

// ─────────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('DistributedLock', () => {
  let redis: Redis & { __setLockHeld: (h: boolean) => void; __isLockHeld: () => boolean };
  let lock: DistributedLock;

  beforeEach(() => {
    redis = createMockRedis() as any;
    lock = createDistributedLock(redis, {
      ttlMs: 5000,
      waitTimeoutMs: 1000,
      retryIntervalMs: 50,
      maxRetries: 10,
    });
  });

  describe('loadScripts', () => {
    it('should load Lua scripts into Redis', async () => {
      const result = await lock.loadScripts();

      expect(result.ok).toBe(true);
      expect(redis.script).toHaveBeenCalledTimes(3); // acquire, release, extend
    });

    it('should only load scripts once', async () => {
      await lock.loadScripts();
      await lock.loadScripts();

      expect(redis.script).toHaveBeenCalledTimes(3);
    });
  });

  describe('acquire', () => {
    it('should acquire lock when available', async () => {
      const result = await lock.acquire('quest-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.acquired).toBe(true);
        expect(result.value.fencingToken).toBeGreaterThan(0);
        expect(result.value.key).toContain('quest-123');
      }
    });

    it('should return lock with fencing token', async () => {
      const result = await lock.acquire('quest-456');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(typeof result.value.fencingToken).toBe('number');
        expect(result.value.expiresAt).toBeInstanceOf(Date);
      }
    });

    it('should timeout when lock is held', async () => {
      // First acquire succeeds
      await lock.acquire('quest-789');

      // Create new lock instance (different owner)
      const lock2 = createDistributedLock(redis, {
        ttlMs: 5000,
        waitTimeoutMs: 200,
        retryIntervalMs: 50,
        maxRetries: 3,
      });

      // Second acquire should timeout
      const result = await lock2.acquire('quest-789');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LOCK_TIMEOUT');
      }
    });
  });

  describe('release', () => {
    it('should release held lock', async () => {
      await lock.acquire('quest-release');
      const result = await lock.release('quest-release');

      expect(result.ok).toBe(true);
    });

    it('should fail to release lock not held', async () => {
      // Don't acquire first
      redis.__setLockHeld(false);
      const result = await lock.release('quest-not-held');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LOCK_NOT_HELD');
      }
    });
  });

  describe('extend', () => {
    it('should extend lock TTL', async () => {
      await lock.acquire('quest-extend');
      const result = await lock.extend('quest-extend', 60000);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeInstanceOf(Date);
        expect(result.value.getTime()).toBeGreaterThan(Date.now());
      }
    });

    it('should fail to extend lock not held', async () => {
      redis.__setLockHeld(false);
      const result = await lock.extend('quest-not-held');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LOCK_NOT_HELD');
      }
    });
  });

  describe('withLock', () => {
    it('should execute function while holding lock', async () => {
      let executed = false;

      const result = await lock.withLock('quest-with', async (lockState) => {
        expect(lockState.acquired).toBe(true);
        executed = true;
        return 'result';
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('result');
      }
      expect(executed).toBe(true);
    });

    it('should release lock after function completes', async () => {
      await lock.withLock('quest-auto-release', async () => {
        expect(redis.__isLockHeld()).toBe(true);
        return 'done';
      });

      // Lock should be released after withLock completes
      // Note: In mock, release sets lockHeld = false
      expect(redis.__isLockHeld()).toBe(false);
    });

    it('should release lock even if function throws', async () => {
      try {
        await lock.withLock('quest-throw', async () => {
          throw new Error('Test error');
        });
      } catch {
        // Expected
      }

      expect(redis.__isLockHeld()).toBe(false);
    });
  });

  describe('isLocked', () => {
    it('should return true when lock is held', async () => {
      await lock.acquire('quest-check');
      const isLocked = await lock.isLocked('quest-check');

      expect(isLocked).toBe(true);
    });

    it('should return false when lock is not held', async () => {
      redis.__setLockHeld(false);
      const isLocked = await lock.isLocked('quest-check');

      expect(isLocked).toBe(false);
    });
  });

  describe('forceRelease', () => {
    it('should force release lock regardless of owner', async () => {
      await lock.acquire('quest-force');
      const result = await lock.forceRelease('quest-force');

      expect(result.ok).toBe(true);
      expect(redis.__isLockHeld()).toBe(false);
    });
  });

  describe('getOwnerId', () => {
    it('should return unique owner ID', () => {
      const ownerId = lock.getOwnerId();

      expect(ownerId).toMatch(/^lock-owner-/);
    });

    it('should return different IDs for different instances', () => {
      const lock2 = createDistributedLock(redis);
      
      expect(lock.getOwnerId()).not.toBe(lock2.getOwnerId());
    });
  });
});
