// ═══════════════════════════════════════════════════════════════════════════════
// FEATURE FLAGS — Static, Dynamic, and User-Specific Flag System
// Sword System v3.0 — Phase 1: Configuration & Core Types
// ═══════════════════════════════════════════════════════════════════════════════

import type { AppConfig } from './schema.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Static feature flags derived from configuration.
 * These are set at startup and don't change during runtime.
 */
export interface StaticFeatureFlags {
  // Core capabilities
  readonly enableReminders: boolean;
  readonly enableWebSearch: boolean;
  readonly enableVerification: boolean;
  readonly enableEncryption: boolean;
  
  // Security
  readonly enableCertPinning: boolean;
  readonly enableRateLimiting: boolean;
  readonly enableSSRFProtection: boolean;
  
  // Providers
  readonly enableMockProvider: boolean;
  readonly enableOpenAI: boolean;
  readonly enableGemini: boolean;
  
  // Observability
  readonly enableDebugMode: boolean;
  readonly enableMetrics: boolean;
  readonly enableTracing: boolean;
  
  // Auth
  readonly requireAuth: boolean;
}

/**
 * Dynamic feature flags that can be changed at runtime via Redis.
 * These allow adjusting behavior without redeploying.
 */
export interface DynamicFeatureFlags {
  // Model selection
  llmModel: string;
  llmTemperature: number;
  
  // Limits (adjustable)
  maxGoalsPerUser: number;
  maxActiveGoals: number;
  maxConversationHistory: number;
  
  // Rate limits
  rateLimitMultiplier: number;
  
  // Feature toggles
  enableSparkGeneration: boolean;
  enableGoalDecomposition: boolean;
  enableAdvancedReminders: boolean;
}

/**
 * User-specific feature flags for A/B testing and gradual rollout.
 * These are evaluated per-user based on user ID or attributes.
 */
export interface UserFeatureFlags {
  readonly enableNewSparkUI: boolean;
  readonly enableAdvancedReminders: boolean;
  readonly enableExperimentalFeatures: boolean;
  readonly sparkReminderVariant: 'control' | 'variant_a' | 'variant_b';
}

/**
 * Combined feature flags (all types merged).
 */
export interface FeatureFlags extends StaticFeatureFlags {
  readonly dynamic: DynamicFeatureFlags;
}

/**
 * Flag evaluation context for user-specific flags.
 */
export interface FlagContext {
  readonly userId?: string;
  readonly userTier?: 'free' | 'pro' | 'enterprise';
  readonly userCreatedAt?: Date;
  readonly percentile?: number; // 0-100, for percentage rollouts
}

// ─────────────────────────────────────────────────────────────────────────────────
// STATIC FLAGS — Derived from AppConfig
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Extract static feature flags from application configuration.
 */
export function getStaticFlags(config: AppConfig): StaticFeatureFlags {
  return Object.freeze({
    // Core capabilities
    enableReminders: true, // Always enabled, controlled by Sword limits
    enableWebSearch: config.webFetch.enabled,
    enableVerification: config.verification.enabled,
    enableEncryption: config.encryption.enabled,
    
    // Security
    enableCertPinning: config.ssrf.validateCerts,
    enableRateLimiting: config.rateLimits.multiplier > 0,
    enableSSRFProtection: config.ssrf.preventDnsRebinding,
    
    // Providers
    enableMockProvider: config.llm.useMock,
    enableOpenAI: config.llm.openaiApiKey !== undefined,
    enableGemini: config.llm.geminiApiKey !== undefined,
    
    // Observability
    enableDebugMode: config.observability.debugMode,
    enableMetrics: config.observability.enableMetrics,
    enableTracing: config.observability.enableTracing,
    
    // Auth
    requireAuth: config.auth.required,
  });
}

// ─────────────────────────────────────────────────────────────────────────────────
// DYNAMIC FLAGS — Redis-backed runtime configuration
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Default values for dynamic flags.
 */
const DEFAULT_DYNAMIC_FLAGS: DynamicFeatureFlags = {
  llmModel: 'gpt-4o',
  llmTemperature: 0.7,
  maxGoalsPerUser: 10,
  maxActiveGoals: 3,
  maxConversationHistory: 50,
  rateLimitMultiplier: 1.0,
  enableSparkGeneration: true,
  enableGoalDecomposition: true,
  enableAdvancedReminders: false,
};

/**
 * Redis key prefix for dynamic flags.
 */
const DYNAMIC_FLAG_PREFIX = 'flags:dynamic:';

/**
 * Interface for Redis client (minimal subset needed).
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

/**
 * Dynamic flag manager for runtime configuration.
 */
export class DynamicFlagManager {
  private readonly redis: RedisClient | null;
  private readonly cache: Map<string, { value: unknown; expiresAt: number }>;
  private readonly cacheTTLMs: number;
  private readonly keyPrefix: string;
  
  constructor(options: {
    redis?: RedisClient | null;
    cacheTTLMs?: number;
    keyPrefix?: string;
  } = {}) {
    this.redis = options.redis ?? null;
    this.cache = new Map();
    this.cacheTTLMs = options.cacheTTLMs ?? 30000; // 30 seconds
    this.keyPrefix = options.keyPrefix ?? DYNAMIC_FLAG_PREFIX;
  }
  
  /**
   * Get a dynamic flag value.
   */
  async get<K extends keyof DynamicFeatureFlags>(
    key: K
  ): Promise<DynamicFeatureFlags[K]> {
    // Check cache first
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as DynamicFeatureFlags[K];
    }
    
    // Try Redis
    if (this.redis) {
      try {
        const redisValue = await this.redis.get(this.keyPrefix + key);
        if (redisValue !== null) {
          const parsed = JSON.parse(redisValue) as DynamicFeatureFlags[K];
          this.cache.set(key, {
            value: parsed,
            expiresAt: Date.now() + this.cacheTTLMs,
          });
          return parsed;
        }
      } catch (error) {
        // Redis error, fall through to default
        console.warn(`[FeatureFlags] Redis error for ${key}:`, error);
      }
    }
    
    // Return default
    return DEFAULT_DYNAMIC_FLAGS[key];
  }
  
  /**
   * Set a dynamic flag value.
   */
  async set<K extends keyof DynamicFeatureFlags>(
    key: K,
    value: DynamicFeatureFlags[K]
  ): Promise<void> {
    // Update cache
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.cacheTTLMs,
    });
    
    // Update Redis
    if (this.redis) {
      try {
        await this.redis.set(this.keyPrefix + key, JSON.stringify(value));
      } catch (error) {
        console.error(`[FeatureFlags] Failed to set ${key} in Redis:`, error);
        throw error;
      }
    }
  }
  
  /**
   * Reset a dynamic flag to its default value.
   */
  async reset<K extends keyof DynamicFeatureFlags>(key: K): Promise<void> {
    this.cache.delete(key);
    
    if (this.redis) {
      try {
        await this.redis.del(this.keyPrefix + key);
      } catch (error) {
        console.error(`[FeatureFlags] Failed to delete ${key} from Redis:`, error);
      }
    }
  }
  
  /**
   * Get all dynamic flags.
   */
  async getAll(): Promise<DynamicFeatureFlags> {
    const flags: Partial<DynamicFeatureFlags> = {};
    
    for (const key of Object.keys(DEFAULT_DYNAMIC_FLAGS) as Array<keyof DynamicFeatureFlags>) {
      flags[key] = await this.get(key) as never;
    }
    
    return flags as DynamicFeatureFlags;
  }
  
  /**
   * Clear the local cache.
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// USER FLAGS — Per-user A/B testing and gradual rollout
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * User flag definitions with rollout configuration.
 */
interface UserFlagDefinition<T> {
  readonly key: string;
  readonly defaultValue: T;
  readonly rolloutPercentage?: number; // 0-100
  readonly enabledTiers?: Array<'free' | 'pro' | 'enterprise'>;
  readonly enabledAfter?: Date; // Only for users created after this date
}

const USER_FLAG_DEFINITIONS: Record<keyof UserFeatureFlags, UserFlagDefinition<unknown>> = {
  enableNewSparkUI: {
    key: 'new_spark_ui',
    defaultValue: false,
    rolloutPercentage: 0, // Disabled by default
  },
  enableAdvancedReminders: {
    key: 'advanced_reminders',
    defaultValue: false,
    enabledTiers: ['pro', 'enterprise'],
  },
  enableExperimentalFeatures: {
    key: 'experimental',
    defaultValue: false,
    enabledTiers: ['enterprise'],
  },
  sparkReminderVariant: {
    key: 'spark_reminder_variant',
    defaultValue: 'control' as const,
    rolloutPercentage: 100, // All users get assigned a variant
  },
};

/**
 * Compute a stable hash for a user ID (for consistent bucketing).
 */
function hashUserId(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    const char = userId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Get percentile bucket for a user (0-99).
 */
function getUserPercentile(userId: string): number {
  return hashUserId(userId) % 100;
}

/**
 * Determine A/B test variant for a user.
 */
function getVariant(userId: string, variants: string[]): string {
  const index = hashUserId(userId) % variants.length;
  return variants[index] ?? variants[0] ?? 'control';
}

/**
 * Evaluate user-specific feature flags.
 */
export function evaluateUserFlags(context: FlagContext): UserFeatureFlags {
  const percentile = context.percentile ?? (context.userId ? getUserPercentile(context.userId) : 50);
  
  return {
    enableNewSparkUI: evaluateFlag('enableNewSparkUI', context, percentile),
    enableAdvancedReminders: evaluateFlag('enableAdvancedReminders', context, percentile),
    enableExperimentalFeatures: evaluateFlag('enableExperimentalFeatures', context, percentile),
    sparkReminderVariant: context.userId
      ? getVariant(context.userId, ['control', 'variant_a', 'variant_b']) as 'control' | 'variant_a' | 'variant_b'
      : 'control',
  };
}

/**
 * Evaluate a single user flag.
 */
function evaluateFlag(
  flagName: keyof UserFeatureFlags,
  context: FlagContext,
  percentile: number
): boolean {
  const definition = USER_FLAG_DEFINITIONS[flagName];
  
  // Check tier restriction
  if (definition.enabledTiers && context.userTier) {
    if (!definition.enabledTiers.includes(context.userTier)) {
      return false;
    }
  }
  
  // Check date restriction
  if (definition.enabledAfter && context.userCreatedAt) {
    if (context.userCreatedAt < definition.enabledAfter) {
      return false;
    }
  }
  
  // Check rollout percentage
  if (definition.rolloutPercentage !== undefined) {
    if (percentile >= definition.rolloutPercentage) {
      return false;
    }
  }
  
  return definition.defaultValue as boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────
// COMBINED FLAG MANAGER
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Combined feature flag manager for all flag types.
 */
export class FeatureFlagManager {
  private readonly staticFlags: StaticFeatureFlags;
  private readonly dynamicManager: DynamicFlagManager;
  
  constructor(config: AppConfig, redis?: RedisClient | null) {
    this.staticFlags = getStaticFlags(config);
    this.dynamicManager = new DynamicFlagManager({
      redis,
      keyPrefix: config.redis.keyPrefix + 'flags:',
    });
  }
  
  /**
   * Get all static flags.
   */
  getStatic(): StaticFeatureFlags {
    return this.staticFlags;
  }
  
  /**
   * Get a specific static flag.
   */
  getStaticFlag<K extends keyof StaticFeatureFlags>(key: K): StaticFeatureFlags[K] {
    return this.staticFlags[key];
  }
  
  /**
   * Get the dynamic flag manager.
   */
  getDynamicManager(): DynamicFlagManager {
    return this.dynamicManager;
  }
  
  /**
   * Get a dynamic flag.
   */
  async getDynamic<K extends keyof DynamicFeatureFlags>(
    key: K
  ): Promise<DynamicFeatureFlags[K]> {
    return this.dynamicManager.get(key);
  }
  
  /**
   * Set a dynamic flag.
   */
  async setDynamic<K extends keyof DynamicFeatureFlags>(
    key: K,
    value: DynamicFeatureFlags[K]
  ): Promise<void> {
    return this.dynamicManager.set(key, value);
  }
  
  /**
   * Evaluate user-specific flags.
   */
  evaluateUserFlags(context: FlagContext): UserFeatureFlags {
    return evaluateUserFlags(context);
  }
  
  /**
   * Get all flags for a user (combined static + dynamic + user).
   */
  async getAllFlags(context?: FlagContext): Promise<{
    static: StaticFeatureFlags;
    dynamic: DynamicFeatureFlags;
    user: UserFeatureFlags | null;
  }> {
    const dynamic = await this.dynamicManager.getAll();
    const user = context ? this.evaluateUserFlags(context) : null;
    
    return {
      static: this.staticFlags,
      dynamic,
      user,
    };
  }
  
  /**
   * Check if a feature is enabled (convenience method).
   */
  isEnabled(feature: keyof StaticFeatureFlags): boolean {
    return this.staticFlags[feature];
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON & FACTORY
// ─────────────────────────────────────────────────────────────────────────────────

let flagManagerInstance: FeatureFlagManager | null = null;

/**
 * Initialize the feature flag manager singleton.
 */
export function initFeatureFlags(
  config: AppConfig,
  redis?: RedisClient | null
): FeatureFlagManager {
  flagManagerInstance = new FeatureFlagManager(config, redis);
  return flagManagerInstance;
}

/**
 * Get the feature flag manager singleton.
 * Throws if not initialized.
 */
export function getFeatureFlags(): FeatureFlagManager {
  if (!flagManagerInstance) {
    throw new Error('Feature flags not initialized. Call initFeatureFlags() first.');
  }
  return flagManagerInstance;
}

/**
 * Check if feature flags have been initialized.
 */
export function isFeatureFlagsInitialized(): boolean {
  return flagManagerInstance !== null;
}

/**
 * Reset feature flags (for testing).
 * @internal
 */
export function resetFeatureFlags(): void {
  flagManagerInstance = null;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONVENIENCE EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export { DEFAULT_DYNAMIC_FLAGS };
