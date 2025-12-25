// ═══════════════════════════════════════════════════════════════════════════════
// RATE LIMITING MODULE INDEX — Rate Limiting Exports
// NovaOS Security Module — Phase 2
// ═══════════════════════════════════════════════════════════════════════════════

// Types
export {
  type RateLimitConfig,
  type TierRateLimits,
  type RateLimitContext,
  type RateLimitResult,
  type RateLimiter,
  type RateLimitEvent,
  createAllowedResult,
  createDeniedResult,
  keyByUser,
  keyByIp,
  keyByUserAndPath,
  keyByIpAndPath,
  keyByUserOrIp,
} from './types.js';

// Token Bucket
export {
  TokenBucketLimiter,
  SlidingWindowLimiter,
  getTokenBucketLimiter,
  getSlidingWindowLimiter,
  getRateLimiter,
  initRateLimiter,
  resetRateLimiter,
} from './token-bucket.js';

// Config
export {
  DEFAULT_TIER_LIMITS,
  ANONYMOUS_LIMIT,
  EndpointLimits,
  PATH_PATTERNS,
  SKIP_PATHS,
  type EndpointCategory,
  getCategoryForPath,
  getLimitForPath,
  getAnonymousLimit,
  getRateLimitMultiplier,
  applyMultiplier,
  isRateLimitingEnabled,
  shouldSkipRateLimit,
} from './config.js';

// Middleware
export {
  rateLimit,
  chatRateLimit,
  goalCreationRateLimit,
  sparkGenerationRateLimit,
  webFetchRateLimit,
  authRateLimit,
  adminRateLimit,
  strictRateLimit,
  ipRateLimit,
  getRateLimitStatus,
  resetUserRateLimit,
  resetIpRateLimit,
  onRateLimitEvent,
  clearRateLimitEventHandlers,
  type RateLimitOptions,
} from './middleware.js';

// ─────────────────────────────────────────────────────────────────────────────────
// RATE LIMIT CATEGORY CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Rate limit category constants for use with createRateLimiter.
 * Maps to EndpointCategory values from config.
 */
export const RateLimitCategory = {
  DEFAULT: 'DEFAULT',
  CHAT: 'CHAT',
  GOAL_CREATION: 'GOAL_CREATION',
  SPARK_GENERATION: 'SPARK_GENERATION',
  MEMORY_EXTRACTION: 'MEMORY_EXTRACTION',
  WEB_FETCH: 'WEB_FETCH',
  AUTH: 'AUTH',
  EXPORT: 'EXPORT',
  ADMIN: 'ADMIN',
  BULK: 'BULK',
} as const;

export type RateLimitCategoryType = typeof RateLimitCategory[keyof typeof RateLimitCategory];

// ─────────────────────────────────────────────────────────────────────────────────
// RATE LIMITER FACTORY
// ─────────────────────────────────────────────────────────────────────────────────

import { rateLimit as createRateLimitMiddleware, type RateLimitOptions } from './middleware.js';
import type { EndpointCategory } from './config.js';

/**
 * Create a rate limiter middleware for a specific category.
 * 
 * @example
 * const goalLimiter = createRateLimiter(RateLimitCategory.GOAL_CREATION);
 * router.post('/goals', goalLimiter, createGoalHandler);
 * 
 * @example
 * // With custom options
 * const chatLimiter = createRateLimiter(RateLimitCategory.CHAT, {
 *   keyGenerator: (ctx) => `chat:${ctx.userId}`,
 * });
 */
export function createRateLimiter(
  category: RateLimitCategoryType | EndpointCategory,
  options?: Omit<RateLimitOptions, 'category'>
) {
  return createRateLimitMiddleware({
    ...options,
    category: category as EndpointCategory,
  });
}
