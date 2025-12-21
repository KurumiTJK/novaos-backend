// ═══════════════════════════════════════════════════════════════════════════════
// INFRASTRUCTURE MODULE — Core Infrastructure Services
// NovaOS Infrastructure — Phase 4
// ═══════════════════════════════════════════════════════════════════════════════
//
// This module provides core infrastructure services:
// - Secure Redis client with TLS, auth, Lua scripts
// - Circuit breaker pattern for fault tolerance
// - Retry policies with exponential backoff
// - Graceful shutdown handling
//
// Quick Start:
//   import { 
//     getRedisClient,
//     getCircuitBreaker,
//     retry,
//     installSignalHandlers,
//     registerShutdownHook,
//   } from './infrastructure/index.js';
//
//   // Initialize Redis
//   const redis = getRedisClient(config.redis);
//   await redis.connect();
//
//   // Wrap external calls with circuit breaker
//   const breaker = getCircuitBreaker('openai');
//   const result = await breaker.execute(() => callOpenAI(prompt));
//
//   // Retry failed operations
//   const data = await retry(() => fetchData(url), { maxAttempts: 3 });
//
//   // Register shutdown hooks
//   registerShutdownHook('redis', () => redis.disconnect(), { priority: 'high' });
//   installSignalHandlers();
//
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// REDIS
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Keys
  setKeyPrefix,
  getKeyPrefix,
  escapeKeySegment,
  buildKey,
  parseKey,
  KeyNamespace,
  Keys,
  SwordKeys,
  UserKeys,
  ConversationKeys,
  MemoryKeys,
  RateLimitKeys,
  SessionKeys,
  LockKeys,
  CacheKeys,
  HealthKeys,
  Patterns,
  KeyError,
  
  // Scripts
  type LuaScript,
  type RateLimitResult,
  type LockResult,
  type ConditionalResult,
  ALL_SCRIPTS,
  TOKEN_BUCKET_SCRIPT,
  LOCK_ACQUIRE_SCRIPT,
  
  // Client
  type RedisClientConfig,
  type ConnectionState,
  type RedisStore,
  MemoryRedisClient,
  createRedisClient,
  getRedisClient,
  resetRedisClient,
} from './redis/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CIRCUIT BREAKER
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Types
  type CircuitState,
  type CircuitBreakerConfig,
  type CircuitMetrics,
  type CircuitBreaker,
  type StateChangeEvent,
  CircuitOpenError,
  CircuitTimeoutError,
  DEFAULT_CIRCUIT_CONFIG,
  
  // Config
  type ConfigPreset,
  PRESETS,
  SERVICE_CONFIGS,
  getServiceConfig,
  createServiceConfig,
  isRetryableError as isCircuitRetryableError,
  
  // Implementation
  CircuitBreakerImpl,
  getCircuitBreakerRegistry,
  getCircuitBreaker,
  configureCircuitBreaker,
  withCircuitBreaker,
  createProtectedClient,
} from './circuit-breaker/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// RETRY
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Types
  type BackoffStrategy,
  type JitterType,
  type RetryConfig,
  type RetryPolicy,
  type RetryResult,
  type RetryEvent,
  DEFAULT_RETRY_CONFIG,
  RetryExhaustedError,
  AttemptTimeoutError,
  
  // Backoff
  type BackoffCalculator,
  BackoffCalculatorImpl,
  createBackoffCalculator,
  exponentialBackoff,
  fixedBackoff,
  linearBackoff,
  sleep,
  formatDelay,
  
  // Policy
  isRetryableError,
  RetryPolicyImpl,
  createRetryPolicy,
  retryWithBackoff,
  retryWithFixedDelay,
  retry,
  tryRetry,
  withRetry,
  RetryPresets,
} from './retry/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// SHUTDOWN
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Types
  type ShutdownPriority,
  type ShutdownHookFn,
  type ShutdownHook,
  type HookResult,
  type ShutdownResult,
  type ShutdownConfig,
  type ShutdownState,
  PRIORITY_VALUES,
  DEFAULT_SHUTDOWN_CONFIG,
  
  // Hooks
  setDefaultHookTimeout,
  isShutdownInProgress,
  registerShutdownHook,
  unregisterShutdownHook,
  setHookEnabled,
  getRegisteredHooks,
  clearShutdownHooks,
  executeShutdownHooks,
  createServerCloseHook,
  createDisconnectHook,
  
  // Handler
  configureShutdown,
  getShutdownState,
  installSignalHandlers,
  removeSignalHandlers,
  initiateShutdown,
  shouldAcceptRequests,
  getShutdownTimeRemaining,
  simulateShutdown,
} from './shutdown/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// INITIALIZATION HELPER
// ─────────────────────────────────────────────────────────────────────────────────

import type { RedisConfig } from '../config/schema.js';
import { createRedisClient, type RedisStore } from './redis/index.js';
import { 
  registerShutdownHook, 
  installSignalHandlers,
  configureShutdown,
  type ShutdownConfig,
} from './shutdown/index.js';
import { configureCircuitBreaker, type CircuitBreakerConfig } from './circuit-breaker/index.js';

/**
 * Infrastructure initialization options.
 */
export interface InfrastructureConfig {
  /** Redis configuration */
  redis?: RedisConfig;
  
  /** Shutdown configuration */
  shutdown?: Partial<ShutdownConfig>;
  
  /** Circuit breaker configurations by name */
  circuitBreakers?: Record<string, Partial<CircuitBreakerConfig>>;
  
  /** Install signal handlers */
  installSignalHandlers?: boolean;
}

/**
 * Infrastructure initialization result.
 */
export interface InfrastructureServices {
  redis: RedisStore;
}

/**
 * Initialize all infrastructure services.
 */
export async function initializeInfrastructure(
  config: InfrastructureConfig
): Promise<InfrastructureServices> {
  // Configure shutdown
  if (config.shutdown) {
    configureShutdown(config.shutdown);
  }
  
  // Configure circuit breakers
  if (config.circuitBreakers) {
    for (const [name, cbConfig] of Object.entries(config.circuitBreakers)) {
      configureCircuitBreaker(name, cbConfig);
    }
  }
  
  // Initialize Redis
  const redis = createRedisClient(config.redis ?? {
    host: 'localhost',
    port: 6379,
    keyPrefix: 'nova:',
    tls: false,
    disabled: true,
    connectTimeoutMs: 5000,
    commandTimeoutMs: 5000,
    maxRetriesPerRequest: 3,
  });
  
  if (config.redis && !config.redis.disabled) {
    await redis.connect();
    
    // Register shutdown hook
    registerShutdownHook('redis', () => redis.disconnect(), {
      priority: 'high',
      timeoutMs: 5000,
    });
  }
  
  // Install signal handlers
  if (config.installSignalHandlers ?? true) {
    installSignalHandlers();
  }
  
  return { redis };
}
