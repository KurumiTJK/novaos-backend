// ═══════════════════════════════════════════════════════════════════════════════
// GOAL RATE LIMITER — Goal Creation Rate Limiting
// NovaOS Gates — Phase 13: SwordGate Integration
// ═══════════════════════════════════════════════════════════════════════════════
//
// Enforces goal creation limits:
//   - Maximum total goals per user
//   - Maximum active goals per user
//   - Cooldown between goal creations
//
// Uses Redis for distributed counting and TTL-based cooldowns.
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { Redis } from 'ioredis';

import type { UserId } from '../../types/branded.js';
import { createTimestamp } from '../../types/branded.js';
import type { AsyncAppResult } from '../../types/result.js';
import { ok, err, appError } from '../../types/result.js';

import { buildKey, KeyNamespace, RateLimitKeys } from '../../infrastructure/redis/keys.js';
import type { GoalRateLimitInfo, SwordGateConfig } from './types.js';
import type { IGoalRateLimiter } from './sword-gate.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Rate limiter configuration.
 */
export interface GoalRateLimiterConfig {
  /** Maximum total goals a user can have */
  readonly maxGoalsPerUser: number;

  /** Maximum active (non-completed) goals a user can have */
  readonly maxActiveGoals: number;

  /** Minimum seconds between goal creations */
  readonly cooldownSeconds: number;

  /** TTL for cooldown keys in seconds */
  readonly cooldownTtlSeconds: number;
}

/**
 * Default rate limiter configuration.
 */
export const DEFAULT_RATE_LIMITER_CONFIG: GoalRateLimiterConfig = {
  maxGoalsPerUser: 10,
  maxActiveGoals: 3,
  cooldownSeconds: 60, // 1 minute between creations
  cooldownTtlSeconds: 300, // 5 minute TTL for cooldown tracking
};

// ═══════════════════════════════════════════════════════════════════════════════
// REDIS KEYS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build Redis key for user's total goal count.
 */
function userGoalCountKey(userId: UserId): string {
  return buildKey(KeyNamespace.SWORD, 'goal_count', userId);
}

/**
 * Build Redis key for user's active goal count.
 */
function userActiveGoalCountKey(userId: UserId): string {
  return buildKey(KeyNamespace.SWORD, 'active_goal_count', userId);
}

/**
 * Build Redis key for creation cooldown.
 */
function creationCooldownKey(userId: UserId): string {
  return buildKey(KeyNamespace.RATE, 'goal_creation', userId);
}

// ═══════════════════════════════════════════════════════════════════════════════
// GOAL RATE LIMITER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Redis-backed goal creation rate limiter.
 */
export class GoalRateLimiter implements IGoalRateLimiter {
  private readonly redis: Redis;
  private readonly config: GoalRateLimiterConfig;

  constructor(redis: Redis, config: Partial<GoalRateLimiterConfig> = {}) {
    this.redis = redis;
    this.config = { ...DEFAULT_RATE_LIMITER_CONFIG, ...config };
  }

  /**
   * Check if a user can create a new goal.
   */
  async canCreateGoal(userId: UserId): AsyncAppResult<GoalRateLimitInfo> {
    try {
      // Check cooldown first (fastest check)
      const cooldownResult = await this.checkCooldown(userId);
      if (cooldownResult.exceeded) {
        return ok(cooldownResult);
      }

      // Check active goal limit
      const activeResult = await this.checkActiveGoalLimit(userId);
      if (activeResult.exceeded) {
        return ok(activeResult);
      }

      // Check total goal limit
      const totalResult = await this.checkTotalGoalLimit(userId);
      if (totalResult.exceeded) {
        return ok(totalResult);
      }

      // All checks passed
      return ok({
        exceeded: false,
        currentCount: totalResult.currentCount,
        maxAllowed: this.config.maxGoalsPerUser,
        message: 'Goal creation allowed',
      });
    } catch (error) {
      console.error('[RATE_LIMITER] Error checking rate limit:', error);
      // Fail open - allow creation on error
      return ok({
        exceeded: false,
        currentCount: 0,
        maxAllowed: this.config.maxGoalsPerUser,
        message: 'Rate limit check failed - allowing creation',
      });
    }
  }

  /**
   * Record a goal creation.
   */
  async recordGoalCreation(userId: UserId): AsyncAppResult<void> {
    try {
      const pipeline = this.redis.multi();

      // Increment total goal count
      pipeline.incr(userGoalCountKey(userId));

      // Increment active goal count
      pipeline.incr(userActiveGoalCountKey(userId));

      // Set cooldown
      pipeline.set(creationCooldownKey(userId), Date.now().toString(), {
        EX: this.config.cooldownTtlSeconds,
      });

      await pipeline.exec();

      return ok(undefined);
    } catch (error) {
      console.error('[RATE_LIMITER] Error recording goal creation:', error);
      return err(appError('INTERNAL_ERROR', 'Failed to record goal creation'));
    }
  }

  /**
   * Record a goal completion (decrements active count).
   */
  async recordGoalCompletion(userId: UserId): AsyncAppResult<void> {
    try {
      const key = userActiveGoalCountKey(userId);
      const current = await this.redis.get(key);

      if (current && parseInt(current, 10) > 0) {
        await this.redis.decr(key);
      }

      return ok(undefined);
    } catch (error) {
      console.error('[RATE_LIMITER] Error recording goal completion:', error);
      return err(appError('INTERNAL_ERROR', 'Failed to record goal completion'));
    }
  }

  /**
   * Record a goal deletion (decrements both counts).
   */
  async recordGoalDeletion(userId: UserId, wasActive: boolean): AsyncAppResult<void> {
    try {
      const pipeline = this.redis.multi();

      // Decrement total count
      const totalKey = userGoalCountKey(userId);
      pipeline.decr(totalKey);

      // Decrement active count if goal was active
      if (wasActive) {
        pipeline.decr(userActiveGoalCountKey(userId));
      }

      await pipeline.exec();

      // Ensure counts don't go negative
      await this.ensureNonNegative(userId);

      return ok(undefined);
    } catch (error) {
      console.error('[RATE_LIMITER] Error recording goal deletion:', error);
      return err(appError('INTERNAL_ERROR', 'Failed to record goal deletion'));
    }
  }

  /**
   * Get current counts for a user.
   */
  async getCounts(userId: UserId): AsyncAppResult<{ total: number; active: number }> {
    try {
      const [total, active] = await Promise.all([
        this.redis.get(userGoalCountKey(userId)),
        this.redis.get(userActiveGoalCountKey(userId)),
      ]);

      return ok({
        total: parseInt(total ?? '0', 10),
        active: parseInt(active ?? '0', 10),
      });
    } catch (error) {
      console.error('[RATE_LIMITER] Error getting counts:', error);
      return err(appError('INTERNAL_ERROR', 'Failed to get counts'));
    }
  }

  /**
   * Sync counts with actual data (for consistency recovery).
   */
  async syncCounts(userId: UserId, totalGoals: number, activeGoals: number): AsyncAppResult<void> {
    try {
      const pipeline = this.redis.multi();

      pipeline.set(userGoalCountKey(userId), totalGoals.toString());
      pipeline.set(userActiveGoalCountKey(userId), activeGoals.toString());

      await pipeline.exec();

      return ok(undefined);
    } catch (error) {
      console.error('[RATE_LIMITER] Error syncing counts:', error);
      return err(appError('INTERNAL_ERROR', 'Failed to sync counts'));
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Check creation cooldown.
   */
  private async checkCooldown(userId: UserId): Promise<GoalRateLimitInfo> {
    const key = creationCooldownKey(userId);
    const lastCreation = await this.redis.get(key);

    if (lastCreation) {
      const lastTime = parseInt(lastCreation, 10);
      const elapsed = (Date.now() - lastTime) / 1000;

      if (elapsed < this.config.cooldownSeconds) {
        const remaining = Math.ceil(this.config.cooldownSeconds - elapsed);
        return {
          exceeded: true,
          currentCount: 0,
          maxAllowed: 0,
          resetsAt: createTimestamp(new Date(Date.now() + remaining * 1000)),
          message: `Please wait ${remaining} seconds before creating another goal.`,
        };
      }
    }

    return {
      exceeded: false,
      currentCount: 0,
      maxAllowed: 0,
      message: 'Cooldown passed',
    };
  }

  /**
   * Check active goal limit.
   */
  private async checkActiveGoalLimit(userId: UserId): Promise<GoalRateLimitInfo> {
    const key = userActiveGoalCountKey(userId);
    const count = await this.redis.get(key);
    const activeCount = parseInt(count ?? '0', 10);

    if (activeCount >= this.config.maxActiveGoals) {
      return {
        exceeded: true,
        currentCount: activeCount,
        maxAllowed: this.config.maxActiveGoals,
        message: `You have ${activeCount} active goals. Complete or pause some goals before creating new ones (max ${this.config.maxActiveGoals} active).`,
      };
    }

    return {
      exceeded: false,
      currentCount: activeCount,
      maxAllowed: this.config.maxActiveGoals,
      message: 'Active goal limit OK',
    };
  }

  /**
   * Check total goal limit.
   */
  private async checkTotalGoalLimit(userId: UserId): Promise<GoalRateLimitInfo> {
    const key = userGoalCountKey(userId);
    const count = await this.redis.get(key);
    const totalCount = parseInt(count ?? '0', 10);

    if (totalCount >= this.config.maxGoalsPerUser) {
      return {
        exceeded: true,
        currentCount: totalCount,
        maxAllowed: this.config.maxGoalsPerUser,
        message: `You have ${totalCount} goals. Delete some goals before creating new ones (max ${this.config.maxGoalsPerUser} total).`,
      };
    }

    return {
      exceeded: false,
      currentCount: totalCount,
      maxAllowed: this.config.maxGoalsPerUser,
      message: 'Total goal limit OK',
    };
  }

  /**
   * Ensure counts don't go negative after decrements.
   */
  private async ensureNonNegative(userId: UserId): Promise<void> {
    const [total, active] = await Promise.all([
      this.redis.get(userGoalCountKey(userId)),
      this.redis.get(userActiveGoalCountKey(userId)),
    ]);

    const pipeline = this.redis.multi();

    if (total && parseInt(total, 10) < 0) {
      pipeline.set(userGoalCountKey(userId), '0');
    }

    if (active && parseInt(active, 10) < 0) {
      pipeline.set(userActiveGoalCountKey(userId), '0');
    }

    await pipeline.exec();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a GoalRateLimiter instance.
 */
export function createGoalRateLimiter(
  redis: Redis,
  config?: Partial<GoalRateLimiterConfig>
): GoalRateLimiter {
  return new GoalRateLimiter(redis, config);
}

// ═══════════════════════════════════════════════════════════════════════════════
// IN-MEMORY IMPLEMENTATION (for testing)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * In-memory rate limiter for testing.
 */
export class InMemoryGoalRateLimiter implements IGoalRateLimiter {
  private readonly config: GoalRateLimiterConfig;
  private readonly counts = new Map<string, { total: number; active: number }>();
  private readonly cooldowns = new Map<string, number>();

  constructor(config: Partial<GoalRateLimiterConfig> = {}) {
    this.config = { ...DEFAULT_RATE_LIMITER_CONFIG, ...config };
  }

  async canCreateGoal(userId: UserId): AsyncAppResult<GoalRateLimitInfo> {
    const userIdStr = String(userId);

    // Check cooldown
    const lastCreation = this.cooldowns.get(userIdStr);
    if (lastCreation) {
      const elapsed = (Date.now() - lastCreation) / 1000;
      if (elapsed < this.config.cooldownSeconds) {
        const remaining = Math.ceil(this.config.cooldownSeconds - elapsed);
        return ok({
          exceeded: true,
          currentCount: 0,
          maxAllowed: 0,
          resetsAt: createTimestamp(new Date(Date.now() + remaining * 1000)),
          message: `Please wait ${remaining} seconds before creating another goal.`,
        });
      }
    }

    const counts = this.counts.get(userIdStr) ?? { total: 0, active: 0 };

    // Check active limit
    if (counts.active >= this.config.maxActiveGoals) {
      return ok({
        exceeded: true,
        currentCount: counts.active,
        maxAllowed: this.config.maxActiveGoals,
        message: `You have ${counts.active} active goals (max ${this.config.maxActiveGoals}).`,
      });
    }

    // Check total limit
    if (counts.total >= this.config.maxGoalsPerUser) {
      return ok({
        exceeded: true,
        currentCount: counts.total,
        maxAllowed: this.config.maxGoalsPerUser,
        message: `You have ${counts.total} goals (max ${this.config.maxGoalsPerUser}).`,
      });
    }

    return ok({
      exceeded: false,
      currentCount: counts.total,
      maxAllowed: this.config.maxGoalsPerUser,
      message: 'Goal creation allowed',
    });
  }

  async recordGoalCreation(userId: UserId): AsyncAppResult<void> {
    const userIdStr = String(userId);
    const counts = this.counts.get(userIdStr) ?? { total: 0, active: 0 };

    this.counts.set(userIdStr, {
      total: counts.total + 1,
      active: counts.active + 1,
    });

    this.cooldowns.set(userIdStr, Date.now());

    return ok(undefined);
  }

  /**
   * Reset state (for testing).
   */
  reset(): void {
    this.counts.clear();
    this.cooldowns.clear();
  }

  /**
   * Set counts directly (for testing).
   */
  setCounts(userId: UserId, total: number, active: number): void {
    this.counts.set(String(userId), { total, active });
  }
}

/**
 * Create an in-memory rate limiter for testing.
 */
export function createInMemoryGoalRateLimiter(
  config?: Partial<GoalRateLimiterConfig>
): InMemoryGoalRateLimiter {
  return new InMemoryGoalRateLimiter(config);
}
