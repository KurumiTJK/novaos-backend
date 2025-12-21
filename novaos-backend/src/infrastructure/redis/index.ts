// ═══════════════════════════════════════════════════════════════════════════════
// REDIS MODULE INDEX — Secure Redis Client Exports
// NovaOS Infrastructure — Phase 4
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// KEYS
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Configuration
  setKeyPrefix,
  getKeyPrefix,
  
  // Escaping
  escapeKeySegment,
  unescapeKeySegment,
  isValidKeySegment,
  KeyError,
  
  // Core builders
  buildKey,
  buildKeyWithoutPrefix,
  parseKey,
  
  // Namespaces
  KeyNamespace,
  
  // Entity key builders
  SwordKeys,
  UserKeys,
  ConversationKeys,
  MemoryKeys,
  RateLimitKeys,
  SessionKeys,
  LockKeys,
  CacheKeys,
  HealthKeys,
  TempKeys,
  Keys,
  
  // Pattern builders
  buildPattern,
  Patterns,
} from './keys.js';

// ─────────────────────────────────────────────────────────────────────────────────
// SCRIPTS
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Types
  type LuaScript,
  type RateLimitResult,
  type LockResult,
  type ConditionalResult,
  
  // Scripts
  TOKEN_BUCKET_SCRIPT,
  SLIDING_WINDOW_SCRIPT,
  LOCK_ACQUIRE_SCRIPT,
  LOCK_RELEASE_SCRIPT,
  LOCK_EXTEND_SCRIPT,
  CREATE_IF_NOT_EXISTS_SCRIPT,
  CONDITIONAL_UPDATE_SCRIPT,
  GET_WITH_VERSION_SCRIPT,
  CONDITIONAL_DELETE_SCRIPT,
  BATCH_GET_SCRIPT,
  ALL_SCRIPTS,
  getScript,
  
  // Parsers
  parseRateLimitResult,
  parseLockResult,
  parseConditionalResult,
} from './scripts.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CLIENT
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Types
  type RedisClientConfig,
  type ConnectionState,
  type RedisClientEvents,
  type RedisStore,
  
  // Client
  MemoryRedisClient,
  createRedisClient,
  getRedisClient,
  resetRedisClient,
} from './client.js';
