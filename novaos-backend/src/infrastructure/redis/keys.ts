// ═══════════════════════════════════════════════════════════════════════════════
// REDIS KEYS — Collision-Safe Key Generation
// NovaOS Infrastructure — Phase 4
// ═══════════════════════════════════════════════════════════════════════════════
//
// Provides type-safe, collision-resistant Redis key generation:
// - Escapes special characters to prevent injection
// - Consistent prefix from configuration
// - Type-safe builders for each entity type
// - Compound key support for relationships
//
// Key Format: {prefix}{namespace}:{entity}:{id}[:{subkey}]
// Example:    nova:sword:goal:goal_abc123
//             nova:sword:user:user_xyz:goals
//             nova:rate:api:192.168.1.1:minute
//
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  UserId,
  GoalId,
  QuestId,
  StepId,
  SparkId,
  ReminderId,
  ConversationId,
  MessageId,
  MemoryId,
  SessionId,
} from '../../types/branded.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Default key prefix (overridable via configuration).
 */
let keyPrefix = 'nova:';

/**
 * Configure the global key prefix.
 */
export function setKeyPrefix(prefix: string): void {
  // Ensure prefix ends with colon
  keyPrefix = prefix.endsWith(':') ? prefix : `${prefix}:`;
}

/**
 * Get the current key prefix.
 */
export function getKeyPrefix(): string {
  return keyPrefix;
}

// ─────────────────────────────────────────────────────────────────────────────────
// KEY ESCAPING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Characters that must be escaped in Redis keys.
 * These could be used for injection attacks or cause parsing issues.
 */
const UNSAFE_CHARS = /[:\\/\s\0\n\r\t*?[\]{}]/g;

/**
 * Escape a key segment to prevent injection attacks.
 * Replaces unsafe characters with URL-encoded equivalents.
 */
export function escapeKeySegment(segment: string): string {
  if (!segment || typeof segment !== 'string') {
    throw new KeyError('Key segment must be a non-empty string');
  }
  
  // Limit segment length to prevent memory issues
  if (segment.length > 256) {
    throw new KeyError(`Key segment too long: ${segment.length} chars (max 256)`);
  }
  
  return segment.replace(UNSAFE_CHARS, (char) => {
    return `%${char.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()}`;
  });
}

/**
 * Unescape a key segment.
 */
export function unescapeKeySegment(segment: string): string {
  return segment.replace(/%([0-9A-Fa-f]{2})/g, (_, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });
}

/**
 * Validate that a string is safe for use as a key segment.
 * Returns true if no escaping needed.
 */
export function isValidKeySegment(segment: string): boolean {
  if (!segment || typeof segment !== 'string') return false;
  if (segment.length > 256) return false;
  return !UNSAFE_CHARS.test(segment);
}

// ─────────────────────────────────────────────────────────────────────────────────
// KEY ERROR
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Error thrown for invalid key operations.
 */
export class KeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// KEY NAMESPACES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Key namespaces for different subsystems.
 */
export const KeyNamespace = {
  /** Sword system entities (goals, quests, steps, sparks) */
  SWORD: 'sword',
  
  /** User data */
  USER: 'user',
  
  /** Conversations and messages */
  CONV: 'conv',
  
  /** Memory system */
  MEMORY: 'mem',
  
  /** Rate limiting */
  RATE: 'rate',
  
  /** Session management */
  SESSION: 'sess',
  
  /** Distributed locks */
  LOCK: 'lock',
  
  /** Cache */
  CACHE: 'cache',
  
  /** Health checks */
  HEALTH: 'health',
  
  /** Temporary/ephemeral data */
  TEMP: 'temp',
} as const;

export type KeyNamespace = typeof KeyNamespace[keyof typeof KeyNamespace];

// ─────────────────────────────────────────────────────────────────────────────────
// CORE KEY BUILDER
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Build a Redis key from segments.
 * Automatically escapes each segment and applies prefix.
 */
export function buildKey(...segments: string[]): string {
  if (segments.length === 0) {
    throw new KeyError('At least one key segment required');
  }
  
  const escaped = segments.map(escapeKeySegment);
  return `${keyPrefix}${escaped.join(':')}`;
}

/**
 * Build a key without prefix (for internal use).
 */
export function buildKeyWithoutPrefix(...segments: string[]): string {
  if (segments.length === 0) {
    throw new KeyError('At least one key segment required');
  }
  
  return segments.map(escapeKeySegment).join(':');
}

/**
 * Parse a key back into segments.
 */
export function parseKey(key: string): { prefix: string; segments: string[] } {
  if (!key.startsWith(keyPrefix)) {
    throw new KeyError(`Key does not start with expected prefix: ${keyPrefix}`);
  }
  
  const withoutPrefix = key.slice(keyPrefix.length);
  const segments = withoutPrefix.split(':').map(unescapeKeySegment);
  
  return { prefix: keyPrefix, segments };
}

// ─────────────────────────────────────────────────────────────────────────────────
// SWORD ENTITY KEYS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Key builders for Sword system entities.
 */
export const SwordKeys = {
  // ─────────────────────────────────────────────────────────────────────────────
  // Goals
  // ─────────────────────────────────────────────────────────────────────────────
  
  /** Get key for a goal entity */
  goal(goalId: GoalId): string {
    return buildKey(KeyNamespace.SWORD, 'goal', goalId);
  },
  
  /** Get key for user's goal list */
  userGoals(userId: UserId): string {
    return buildKey(KeyNamespace.SWORD, 'user', userId, 'goals');
  },
  
  /** Get key for user's active goals */
  userActiveGoals(userId: UserId): string {
    return buildKey(KeyNamespace.SWORD, 'user', userId, 'active');
  },
  
  /** Pattern to match all goals for a user */
  userGoalsPattern(userId: UserId): string {
    return buildKey(KeyNamespace.SWORD, 'user', userId, 'goal') + ':*';
  },
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Quests
  // ─────────────────────────────────────────────────────────────────────────────
  
  /** Get key for a quest entity */
  quest(questId: QuestId): string {
    return buildKey(KeyNamespace.SWORD, 'quest', questId);
  },
  
  /** Get key for goal's quest list */
  goalQuests(goalId: GoalId): string {
    return buildKey(KeyNamespace.SWORD, 'goal', goalId, 'quests');
  },
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Steps
  // ─────────────────────────────────────────────────────────────────────────────
  
  /** Get key for a step entity */
  step(stepId: StepId): string {
    return buildKey(KeyNamespace.SWORD, 'step', stepId);
  },
  
  /** Get key for quest's step list */
  questSteps(questId: QuestId): string {
    return buildKey(KeyNamespace.SWORD, 'quest', questId, 'steps');
  },
  
  /** Get key for user's pending steps queue */
  userPendingSteps(userId: UserId): string {
    return buildKey(KeyNamespace.SWORD, 'user', userId, 'pending');
  },
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Sparks
  // ─────────────────────────────────────────────────────────────────────────────
  
  /** Get key for a spark entity */
  spark(sparkId: SparkId): string {
    return buildKey(KeyNamespace.SWORD, 'spark', sparkId);
  },
  
  /** Get key for step's current spark */
  stepSpark(stepId: StepId): string {
    return buildKey(KeyNamespace.SWORD, 'step', stepId, 'spark');
  },
  
  /** Get key for user's active spark */
  userActiveSpark(userId: UserId): string {
    return buildKey(KeyNamespace.SWORD, 'user', userId, 'spark');
  },
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Reminders
  // ─────────────────────────────────────────────────────────────────────────────
  
  /** Get key for a reminder entity */
  reminder(reminderId: ReminderId): string {
    return buildKey(KeyNamespace.SWORD, 'reminder', reminderId);
  },
  
  /** Get key for scheduled reminders sorted set */
  scheduledReminders(): string {
    return buildKey(KeyNamespace.SWORD, 'reminders', 'scheduled');
  },
  
  /** Get key for user's reminder queue */
  userReminders(userId: UserId): string {
    return buildKey(KeyNamespace.SWORD, 'user', userId, 'reminders');
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────────
// USER KEYS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Key builders for user data.
 */
export const UserKeys = {
  /** Get key for user profile */
  profile(userId: UserId): string {
    return buildKey(KeyNamespace.USER, 'profile', userId);
  },
  
  /** Get key for user preferences */
  preferences(userId: UserId): string {
    return buildKey(KeyNamespace.USER, 'prefs', userId);
  },
  
  /** Get key for user timezone */
  timezone(userId: UserId): string {
    return buildKey(KeyNamespace.USER, 'tz', userId);
  },
  
  /** Get key for user's notification settings */
  notifications(userId: UserId): string {
    return buildKey(KeyNamespace.USER, 'notif', userId);
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────────
// CONVERSATION KEYS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Key builders for conversations and messages.
 */
export const ConversationKeys = {
  /** Get key for a conversation entity */
  conversation(conversationId: ConversationId): string {
    return buildKey(KeyNamespace.CONV, 'conv', conversationId);
  },
  
  /** Get key for conversation messages list */
  messages(conversationId: ConversationId): string {
    return buildKey(KeyNamespace.CONV, 'conv', conversationId, 'msgs');
  },
  
  /** Get key for a single message */
  message(messageId: MessageId): string {
    return buildKey(KeyNamespace.CONV, 'msg', messageId);
  },
  
  /** Get key for user's conversation list */
  userConversations(userId: UserId): string {
    return buildKey(KeyNamespace.CONV, 'user', userId, 'convs');
  },
  
  /** Get key for user's active conversation */
  userActiveConversation(userId: UserId): string {
    return buildKey(KeyNamespace.CONV, 'user', userId, 'active');
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────────
// MEMORY KEYS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Key builders for memory system.
 */
export const MemoryKeys = {
  /** Get key for a memory entity */
  memory(memoryId: MemoryId): string {
    return buildKey(KeyNamespace.MEMORY, 'mem', memoryId);
  },
  
  /** Get key for user's memory index */
  userMemories(userId: UserId): string {
    return buildKey(KeyNamespace.MEMORY, 'user', userId, 'index');
  },
  
  /** Get key for user's memory embeddings */
  userEmbeddings(userId: UserId): string {
    return buildKey(KeyNamespace.MEMORY, 'user', userId, 'embed');
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────────
// RATE LIMIT KEYS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Key builders for rate limiting.
 */
export const RateLimitKeys = {
  /** Get key for API rate limit bucket */
  api(identifier: string, window: 'second' | 'minute' | 'hour'): string {
    return buildKey(KeyNamespace.RATE, 'api', identifier, window);
  },
  
  /** Get key for goal creation rate limit */
  goalCreation(userId: UserId): string {
    return buildKey(KeyNamespace.RATE, 'goal', userId);
  },
  
  /** Get key for spark generation rate limit */
  sparkGeneration(userId: UserId): string {
    return buildKey(KeyNamespace.RATE, 'spark', userId);
  },
  
  /** Get key for authentication rate limit */
  auth(identifier: string): string {
    return buildKey(KeyNamespace.RATE, 'auth', identifier);
  },
  
  /** Get key for SSRF rate limit */
  ssrf(identifier: string): string {
    return buildKey(KeyNamespace.RATE, 'ssrf', identifier);
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────────
// SESSION KEYS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Key builders for session management.
 */
export const SessionKeys = {
  /** Get key for a session */
  session(sessionId: SessionId): string {
    return buildKey(KeyNamespace.SESSION, 'sess', sessionId);
  },
  
  /** Get key for user's sessions list */
  userSessions(userId: UserId): string {
    return buildKey(KeyNamespace.SESSION, 'user', userId, 'sessions');
  },
  
  /** Get key for refresh token */
  refreshToken(tokenId: string): string {
    return buildKey(KeyNamespace.SESSION, 'refresh', tokenId);
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────────
// LOCK KEYS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Key builders for distributed locks.
 */
export const LockKeys = {
  /** Get key for a generic lock */
  lock(resource: string): string {
    return buildKey(KeyNamespace.LOCK, resource);
  },
  
  /** Get key for goal lock (during updates) */
  goal(goalId: GoalId): string {
    return buildKey(KeyNamespace.LOCK, 'goal', goalId);
  },
  
  /** Get key for user operation lock */
  userOperation(userId: UserId, operation: string): string {
    return buildKey(KeyNamespace.LOCK, 'user', userId, operation);
  },
  
  /** Get key for spark generation lock */
  sparkGeneration(stepId: StepId): string {
    return buildKey(KeyNamespace.LOCK, 'spark', stepId);
  },
  
  /** Get key for reminder processing lock */
  reminderProcessing(): string {
    return buildKey(KeyNamespace.LOCK, 'reminders', 'process');
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────────
// CACHE KEYS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Key builders for caching.
 */
export const CacheKeys = {
  /** Get key for LLM response cache */
  llmResponse(hash: string): string {
    return buildKey(KeyNamespace.CACHE, 'llm', hash);
  },
  
  /** Get key for verification cache */
  verification(hash: string): string {
    return buildKey(KeyNamespace.CACHE, 'verify', hash);
  },
  
  /** Get key for web fetch cache */
  webFetch(urlHash: string): string {
    return buildKey(KeyNamespace.CACHE, 'web', urlHash);
  },
  
  /** Get key for external API cache */
  externalApi(api: string, hash: string): string {
    return buildKey(KeyNamespace.CACHE, 'api', api, hash);
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────────
// HEALTH KEYS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Key builders for health checks.
 */
export const HealthKeys = {
  /** Get key for health ping test */
  ping(): string {
    return buildKey(KeyNamespace.HEALTH, 'ping');
  },
  
  /** Get key for last health check timestamp */
  lastCheck(component: string): string {
    return buildKey(KeyNamespace.HEALTH, 'check', component);
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────────
// TEMP KEYS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Key builders for temporary/ephemeral data.
 */
export const TempKeys = {
  /** Get key for temporary data with auto-generated suffix */
  temp(category: string, id: string): string {
    return buildKey(KeyNamespace.TEMP, category, id);
  },
  
  /** Get key for pending operation */
  pendingOperation(operationId: string): string {
    return buildKey(KeyNamespace.TEMP, 'op', operationId);
  },
  
  /** Get key for upload in progress */
  upload(uploadId: string): string {
    return buildKey(KeyNamespace.TEMP, 'upload', uploadId);
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────────
// ALL KEY BUILDERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * All key builders in one object.
 */
export const Keys = {
  Sword: SwordKeys,
  User: UserKeys,
  Conversation: ConversationKeys,
  Memory: MemoryKeys,
  RateLimit: RateLimitKeys,
  Session: SessionKeys,
  Lock: LockKeys,
  Cache: CacheKeys,
  Health: HealthKeys,
  Temp: TempKeys,
} as const;

// ─────────────────────────────────────────────────────────────────────────────────
// PATTERN BUILDERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Build a pattern for key matching (KEYS or SCAN commands).
 * Note: Use SCAN in production, KEYS blocks the server.
 */
export function buildPattern(...segments: string[]): string {
  if (segments.length === 0) {
    return `${keyPrefix}*`;
  }
  
  const escaped = segments.map((seg) => {
    if (seg === '*') return '*';
    return escapeKeySegment(seg);
  });
  
  return `${keyPrefix}${escaped.join(':')}`;
}

/**
 * Common patterns.
 */
export const Patterns = {
  /** All keys in a namespace */
  namespace(ns: KeyNamespace): string {
    return buildPattern(ns, '*');
  },
  
  /** All keys for a user in a namespace */
  userInNamespace(ns: KeyNamespace, userId: UserId): string {
    return buildPattern(ns, 'user', userId, '*');
  },
  
  /** All Sword data for a user */
  userSwordData(userId: UserId): string {
    return buildPattern(KeyNamespace.SWORD, 'user', userId, '*');
  },
  
  /** All rate limit keys */
  allRateLimits(): string {
    return buildPattern(KeyNamespace.RATE, '*');
  },
  
  /** All lock keys */
  allLocks(): string {
    return buildPattern(KeyNamespace.LOCK, '*');
  },
  
  /** All temp keys */
  allTemp(): string {
    return buildPattern(KeyNamespace.TEMP, '*');
  },
} as const;
