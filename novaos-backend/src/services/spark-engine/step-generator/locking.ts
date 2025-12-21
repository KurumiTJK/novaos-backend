// ═══════════════════════════════════════════════════════════════════════════════
// DISTRIBUTED LOCKING — Redis-Based Lock for Step Generation
// NovaOS Spark Engine — Phase 9: Step Generation
// ═══════════════════════════════════════════════════════════════════════════════
//
// Prevents concurrent step generation for the same quest using Redis locks.
//
// Features:
//   - Fencing tokens for correctness
//   - Automatic retry with exponential backoff
//   - Lock extension for long operations
//   - Safe release (only owner can release)
//
// Lock key format: sword:lock:step-generation:{questId}
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

import type { Result } from '../../../types/result.js';
import { ok, err } from '../../../types/result.js';
import { getLogger } from '../../../observability/logging/index.js';
import { incCounter, observeHistogram } from '../../../observability/metrics/index.js';

import type { StepGenerationLock, LockConfig } from './types.js';
import { DEFAULT_LOCK_CONFIG, STEP_GENERATION_LOCK_PREFIX } from './types.js';

import {
  LOCK_ACQUIRE_SCRIPT,
  LOCK_RELEASE_SCRIPT,
  LOCK_EXTEND_SCRIPT,
  parseLockResult,
  type LuaScript,
} from '../../../infrastructure/redis/scripts.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'step-generator-lock' });

// ─────────────────────────────────────────────────────────────────────────────────
// ERROR TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Lock error codes.
 */
export type LockErrorCode =
  | 'LOCK_HELD'           // Lock is held by another owner
  | 'LOCK_TIMEOUT'        // Timed out waiting for lock
  | 'LOCK_NOT_HELD'       // Tried to release lock we don't hold
  | 'REDIS_ERROR'         // Redis operation failed
  | 'SCRIPT_NOT_LOADED';  // Lua script not loaded

/**
 * Lock error.
 */
export interface LockError {
  readonly code: LockErrorCode;
  readonly message: string;
  readonly cause?: Error;
}

// ─────────────────────────────────────────────────────────────────────────────────
// DISTRIBUTED LOCK
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Distributed lock manager for step generation.
 *
 * Uses Redis Lua scripts for atomic operations.
 */
export class DistributedLock {
  private readonly redis: Redis;
  private readonly config: LockConfig;
  private readonly ownerId: string;
  private readonly scriptShas: Map<string, string> = new Map();
  private scriptsLoaded = false;

  constructor(redis: Redis, config?: Partial<LockConfig>) {
    this.redis = redis;
    this.config = { ...DEFAULT_LOCK_CONFIG, ...config };
    this.ownerId = `lock-owner-${uuidv4()}`;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Script Loading
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Load Lua scripts into Redis.
   * Must be called before using the lock.
   */
  async loadScripts(): Promise<Result<void, LockError>> {
    if (this.scriptsLoaded) {
      return ok(undefined);
    }

    try {
      const scripts: LuaScript[] = [
        LOCK_ACQUIRE_SCRIPT,
        LOCK_RELEASE_SCRIPT,
        LOCK_EXTEND_SCRIPT,
      ];

      for (const script of scripts) {
        const sha = await this.redis.script('LOAD', script.source) as string;
        this.scriptShas.set(script.name, sha);
        logger.debug('Loaded Lua script', { name: script.name, sha });
      }

      this.scriptsLoaded = true;
      return ok(undefined);
    } catch (error) {
      logger.error('Failed to load Lua scripts', { error });
      return err({
        code: 'REDIS_ERROR',
        message: 'Failed to load Lua scripts',
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Lock Acquisition
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Acquire a distributed lock.
   *
   * @param key - Lock key (e.g., questId)
   * @returns Lock state if acquired, error otherwise
   */
  async acquire(key: string): Promise<Result<StepGenerationLock, LockError>> {
    const fullKey = this.buildKey(key);
    const tokenKey = `${fullKey}:token`;
    const startTime = Date.now();

    logger.info('Attempting to acquire lock', { key: fullKey, ownerId: this.ownerId });

    // Ensure scripts are loaded
    if (!this.scriptsLoaded) {
      const loadResult = await this.loadScripts();
      if (!loadResult.ok) {
        return err(loadResult.error);
      }
    }

    const sha = this.scriptShas.get(LOCK_ACQUIRE_SCRIPT.name);
    if (!sha) {
      return err({
        code: 'SCRIPT_NOT_LOADED',
        message: 'Lock acquire script not loaded',
      });
    }

    // Retry loop with backoff
    let attempts = 0;
    let lastError: LockError | undefined;

    while (attempts < this.config.maxRetries) {
      const elapsed = Date.now() - startTime;
      if (elapsed >= this.config.waitTimeoutMs) {
        logger.warn('Lock acquisition timed out', {
          key: fullKey,
          attempts,
          elapsedMs: elapsed,
        });
        incCounter('step_generation_lock_timeout_total', { key: fullKey });
        return err({
          code: 'LOCK_TIMEOUT',
          message: `Lock acquisition timed out after ${elapsed}ms`,
        });
      }

      try {
        const now = Date.now();
        const result = await this.redis.evalsha(
          sha,
          2,
          fullKey,
          tokenKey,
          this.ownerId,
          this.config.ttlMs.toString(),
          now.toString()
        ) as [number, number, number];

        const lockResult = parseLockResult(result);

        if (lockResult.acquired) {
          const lock: StepGenerationLock = {
            key: fullKey,
            ownerId: this.ownerId,
            fencingToken: lockResult.fencingToken,
            expiresAt: new Date(lockResult.expiresAt),
            acquired: true,
          };

          logger.info('Lock acquired', {
            key: fullKey,
            fencingToken: lock.fencingToken,
            attempts: attempts + 1,
            durationMs: Date.now() - startTime,
          });

          incCounter('step_generation_lock_acquired_total', { key: fullKey });
          observeHistogram(
            'step_generation_lock_acquire_duration_ms',
            Date.now() - startTime
          );

          return ok(lock);
        }

        // Lock is held by someone else
        lastError = {
          code: 'LOCK_HELD',
          message: `Lock held by another owner until ${new Date(lockResult.expiresAt).toISOString()}`,
        };

        logger.debug('Lock held, retrying', {
          key: fullKey,
          attempt: attempts + 1,
          expiresAt: new Date(lockResult.expiresAt).toISOString(),
        });
      } catch (error) {
        lastError = {
          code: 'REDIS_ERROR',
          message: 'Redis error during lock acquisition',
          cause: error instanceof Error ? error : new Error(String(error)),
        };
        logger.warn('Redis error during lock acquisition', { error, attempt: attempts + 1 });
      }

      // Wait before retry with exponential backoff
      const backoff = Math.min(
        this.config.retryIntervalMs * Math.pow(1.5, attempts),
        5000 // Cap at 5 seconds
      );
      await this.sleep(backoff);
      attempts++;
    }

    logger.warn('Lock acquisition failed after max retries', {
      key: fullKey,
      attempts,
    });

    incCounter('step_generation_lock_failed_total', { key: fullKey });

    return err(lastError ?? {
      code: 'LOCK_TIMEOUT',
      message: 'Lock acquisition failed after max retries',
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Lock Release
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Release a distributed lock.
   *
   * @param key - Lock key
   * @returns Success if released, error otherwise
   */
  async release(key: string): Promise<Result<void, LockError>> {
    const fullKey = this.buildKey(key);

    logger.info('Releasing lock', { key: fullKey, ownerId: this.ownerId });

    if (!this.scriptsLoaded) {
      return err({
        code: 'SCRIPT_NOT_LOADED',
        message: 'Scripts not loaded',
      });
    }

    const sha = this.scriptShas.get(LOCK_RELEASE_SCRIPT.name);
    if (!sha) {
      return err({
        code: 'SCRIPT_NOT_LOADED',
        message: 'Lock release script not loaded',
      });
    }

    try {
      const result = await this.redis.evalsha(
        sha,
        1,
        fullKey,
        this.ownerId
      ) as number;

      if (result === 1) {
        logger.info('Lock released', { key: fullKey });
        incCounter('step_generation_lock_released_total', { key: fullKey });
        return ok(undefined);
      }

      logger.warn('Lock not held by us', { key: fullKey, ownerId: this.ownerId });
      return err({
        code: 'LOCK_NOT_HELD',
        message: 'Lock is not held by this owner',
      });
    } catch (error) {
      logger.error('Failed to release lock', { key: fullKey, error });
      return err({
        code: 'REDIS_ERROR',
        message: 'Failed to release lock',
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Lock Extension
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Extend a lock's TTL.
   *
   * @param key - Lock key
   * @param additionalMs - Additional time in milliseconds
   * @returns New expiration time if extended, error otherwise
   */
  async extend(key: string, additionalMs?: number): Promise<Result<Date, LockError>> {
    const fullKey = this.buildKey(key);
    const ttl = additionalMs ?? this.config.ttlMs;

    logger.debug('Extending lock', { key: fullKey, additionalMs: ttl });

    if (!this.scriptsLoaded) {
      return err({
        code: 'SCRIPT_NOT_LOADED',
        message: 'Scripts not loaded',
      });
    }

    const sha = this.scriptShas.get(LOCK_EXTEND_SCRIPT.name);
    if (!sha) {
      return err({
        code: 'SCRIPT_NOT_LOADED',
        message: 'Lock extend script not loaded',
      });
    }

    try {
      const now = Date.now();
      const result = await this.redis.evalsha(
        sha,
        1,
        fullKey,
        this.ownerId,
        ttl.toString(),
        now.toString()
      ) as [number, number];

      if (result[0] === 1) {
        const newExpiry = new Date(result[1]);
        logger.debug('Lock extended', { key: fullKey, expiresAt: newExpiry.toISOString() });
        return ok(newExpiry);
      }

      return err({
        code: 'LOCK_NOT_HELD',
        message: 'Cannot extend lock not held by this owner',
      });
    } catch (error) {
      logger.error('Failed to extend lock', { key: fullKey, error });
      return err({
        code: 'REDIS_ERROR',
        message: 'Failed to extend lock',
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // With Lock Helper
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Execute a function while holding a lock.
   * Automatically releases the lock when done.
   *
   * @param key - Lock key
   * @param fn - Function to execute
   * @returns Result of the function
   */
  async withLock<T>(
    key: string,
    fn: (lock: StepGenerationLock) => Promise<T>
  ): Promise<Result<T, LockError>> {
    const acquireResult = await this.acquire(key);
    if (!acquireResult.ok) {
      return err(acquireResult.error);
    }

    const lock = acquireResult.value;

    try {
      const result = await fn(lock);
      return ok(result);
    } finally {
      // Always attempt to release, even if fn throws
      const releaseResult = await this.release(key);
      if (!releaseResult.ok) {
        logger.warn('Failed to release lock in withLock', {
          key,
          error: releaseResult.error,
        });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Build the full lock key.
   */
  private buildKey(key: string): string {
    if (key.startsWith(STEP_GENERATION_LOCK_PREFIX)) {
      return key;
    }
    return `${STEP_GENERATION_LOCK_PREFIX}${key}`;
  }

  /**
   * Sleep for a duration.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get the owner ID for this lock instance.
   */
  getOwnerId(): string {
    return this.ownerId;
  }

  /**
   * Check if a lock is currently held (does not verify ownership).
   */
  async isLocked(key: string): Promise<boolean> {
    const fullKey = this.buildKey(key);
    try {
      const exists = await this.redis.exists(fullKey);
      return exists === 1;
    } catch {
      return false;
    }
  }

  /**
   * Force release a lock (admin operation, ignores ownership).
   * Use with caution!
   */
  async forceRelease(key: string): Promise<Result<void, LockError>> {
    const fullKey = this.buildKey(key);
    logger.warn('Force releasing lock', { key: fullKey });

    try {
      await this.redis.del(fullKey);
      incCounter('step_generation_lock_force_released_total', { key: fullKey });
      return ok(undefined);
    } catch (error) {
      return err({
        code: 'REDIS_ERROR',
        message: 'Failed to force release lock',
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// FACTORY
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create a new distributed lock instance.
 */
export function createDistributedLock(
  redis: Redis,
  config?: Partial<LockConfig>
): DistributedLock {
  return new DistributedLock(redis, config);
}
