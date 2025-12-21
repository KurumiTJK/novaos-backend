// ═══════════════════════════════════════════════════════════════════════════════
// REDIS LUA SCRIPTS — Atomic Operations
// NovaOS Infrastructure — Phase 4
// ═══════════════════════════════════════════════════════════════════════════════
//
// Lua scripts for atomic Redis operations:
// - Token bucket rate limiting
// - Distributed locking with fencing tokens
// - Atomic create-if-not-exists
// - Conditional update with version check
//
// Scripts are designed to be loaded once and executed via EVALSHA.
//
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// SCRIPT TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Lua script definition.
 */
export interface LuaScript {
  /** Script name for identification */
  readonly name: string;
  
  /** Lua source code */
  readonly source: string;
  
  /** Number of KEYS arguments */
  readonly numKeys: number;
  
  /** Description of what the script does */
  readonly description: string;
  
  /** SHA1 hash (populated after loading) */
  sha?: string;
}

/**
 * Result from rate limit check.
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  
  /** Current token count */
  tokens: number;
  
  /** Maximum tokens (bucket capacity) */
  maxTokens: number;
  
  /** Milliseconds until bucket refills */
  retryAfterMs: number;
}

/**
 * Result from lock acquisition.
 */
export interface LockResult {
  /** Whether lock was acquired */
  acquired: boolean;
  
  /** Fencing token (monotonically increasing) */
  fencingToken: number;
  
  /** Lock expiry timestamp */
  expiresAt: number;
}

/**
 * Result from conditional operations.
 */
export interface ConditionalResult {
  /** Whether operation succeeded */
  success: boolean;
  
  /** New version number (if success) */
  version?: number;
  
  /** Reason for failure (if failed) */
  reason?: 'not_found' | 'version_mismatch' | 'already_exists';
}

// ─────────────────────────────────────────────────────────────────────────────────
// TOKEN BUCKET RATE LIMITING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Token bucket rate limiter script.
 * 
 * Implements a token bucket algorithm where:
 * - Bucket fills at a constant rate
 * - Each request consumes one token
 * - Request is rejected if no tokens available
 * 
 * KEYS[1] = bucket key
 * ARGV[1] = bucket capacity (max tokens)
 * ARGV[2] = refill rate (tokens per second)
 * ARGV[3] = current timestamp (milliseconds)
 * ARGV[4] = tokens to consume (usually 1)
 * 
 * Returns: [allowed (0/1), current_tokens, retry_after_ms]
 */
export const TOKEN_BUCKET_SCRIPT: LuaScript = {
  name: 'token_bucket',
  numKeys: 1,
  description: 'Token bucket rate limiting with smooth refill',
  source: `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requested = tonumber(ARGV[4]) or 1

-- Get current bucket state
local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(bucket[1])
local last_refill = tonumber(bucket[2])

-- Initialize if bucket doesn't exist
if tokens == nil then
  tokens = capacity
  last_refill = now
end

-- Calculate tokens to add based on time elapsed
local elapsed_ms = now - last_refill
local tokens_to_add = (elapsed_ms / 1000) * refill_rate

-- Refill bucket (capped at capacity)
tokens = math.min(capacity, tokens + tokens_to_add)

-- Check if request can be served
local allowed = 0
local retry_after_ms = 0

if tokens >= requested then
  -- Consume tokens
  tokens = tokens - requested
  allowed = 1
else
  -- Calculate time until enough tokens available
  local tokens_needed = requested - tokens
  retry_after_ms = math.ceil((tokens_needed / refill_rate) * 1000)
end

-- Update bucket state
redis.call('HSET', key, 'tokens', tokens, 'last_refill', now)

-- Set expiry (2x the time to fill from empty, minimum 60s)
local ttl = math.max(60, math.ceil((capacity / refill_rate) * 2))
redis.call('EXPIRE', key, ttl)

return {allowed, math.floor(tokens), retry_after_ms}
`.trim(),
};

/**
 * Sliding window rate limiter script.
 * 
 * Counts requests in a sliding time window.
 * More accurate than fixed windows but uses more memory.
 * 
 * KEYS[1] = counter key
 * ARGV[1] = window size (milliseconds)
 * ARGV[2] = max requests in window
 * ARGV[3] = current timestamp (milliseconds)
 * 
 * Returns: [allowed (0/1), current_count, retry_after_ms]
 */
export const SLIDING_WINDOW_SCRIPT: LuaScript = {
  name: 'sliding_window',
  numKeys: 1,
  description: 'Sliding window rate limiting',
  source: `
local key = KEYS[1]
local window_ms = tonumber(ARGV[1])
local max_requests = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

-- Remove expired entries
local window_start = now - window_ms
redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

-- Count current requests in window
local current_count = redis.call('ZCARD', key)

-- Check if allowed
local allowed = 0
local retry_after_ms = 0

if current_count < max_requests then
  -- Add this request
  redis.call('ZADD', key, now, now .. '-' .. math.random(1000000))
  allowed = 1
  current_count = current_count + 1
else
  -- Find oldest entry to calculate retry time
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  if oldest[2] then
    retry_after_ms = math.max(0, tonumber(oldest[2]) + window_ms - now)
  else
    retry_after_ms = window_ms
  end
end

-- Set expiry slightly longer than window
redis.call('EXPIRE', key, math.ceil(window_ms / 1000) + 1)

return {allowed, current_count, retry_after_ms}
`.trim(),
};

// ─────────────────────────────────────────────────────────────────────────────────
// DISTRIBUTED LOCKING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Acquire distributed lock with fencing token.
 * 
 * KEYS[1] = lock key
 * KEYS[2] = fencing token counter key
 * ARGV[1] = lock owner ID (unique per client)
 * ARGV[2] = TTL in milliseconds
 * ARGV[3] = current timestamp (milliseconds)
 * 
 * Returns: [acquired (0/1), fencing_token, expires_at]
 */
export const LOCK_ACQUIRE_SCRIPT: LuaScript = {
  name: 'lock_acquire',
  numKeys: 2,
  description: 'Acquire distributed lock with fencing token',
  source: `
local lock_key = KEYS[1]
local token_key = KEYS[2]
local owner = ARGV[1]
local ttl_ms = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

-- Check if lock exists and is still valid
local current = redis.call('HMGET', lock_key, 'owner', 'expires_at')
local current_owner = current[1]
local expires_at = tonumber(current[2])

-- If lock exists and hasn't expired, check if we own it
if current_owner and expires_at and expires_at > now then
  if current_owner == owner then
    -- We already own the lock, extend it
    local new_expires = now + ttl_ms
    redis.call('HSET', lock_key, 'expires_at', new_expires)
    redis.call('PEXPIRE', lock_key, ttl_ms)
    local fencing_token = redis.call('GET', token_key)
    return {1, tonumber(fencing_token), new_expires}
  else
    -- Someone else owns the lock
    return {0, 0, expires_at}
  end
end

-- Lock is available, acquire it
-- Increment fencing token (atomic monotonic counter)
local fencing_token = redis.call('INCR', token_key)
local new_expires = now + ttl_ms

redis.call('HSET', lock_key, 'owner', owner, 'fencing_token', fencing_token, 'expires_at', new_expires)
redis.call('PEXPIRE', lock_key, ttl_ms)

-- Fencing token key should never expire
redis.call('PERSIST', token_key)

return {1, fencing_token, new_expires}
`.trim(),
};

/**
 * Release distributed lock.
 * 
 * KEYS[1] = lock key
 * ARGV[1] = lock owner ID
 * 
 * Returns: 1 if released, 0 if not owned
 */
export const LOCK_RELEASE_SCRIPT: LuaScript = {
  name: 'lock_release',
  numKeys: 1,
  description: 'Release distributed lock (only if owner matches)',
  source: `
local lock_key = KEYS[1]
local owner = ARGV[1]

-- Check if we own the lock
local current_owner = redis.call('HGET', lock_key, 'owner')

if current_owner == owner then
  redis.call('DEL', lock_key)
  return 1
end

return 0
`.trim(),
};

/**
 * Extend lock TTL.
 * 
 * KEYS[1] = lock key
 * ARGV[1] = lock owner ID
 * ARGV[2] = new TTL in milliseconds
 * ARGV[3] = current timestamp (milliseconds)
 * 
 * Returns: [success (0/1), new_expires_at]
 */
export const LOCK_EXTEND_SCRIPT: LuaScript = {
  name: 'lock_extend',
  numKeys: 1,
  description: 'Extend lock TTL (only if owner matches)',
  source: `
local lock_key = KEYS[1]
local owner = ARGV[1]
local ttl_ms = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

-- Check if we own the lock
local current_owner = redis.call('HGET', lock_key, 'owner')

if current_owner == owner then
  local new_expires = now + ttl_ms
  redis.call('HSET', lock_key, 'expires_at', new_expires)
  redis.call('PEXPIRE', lock_key, ttl_ms)
  return {1, new_expires}
end

return {0, 0}
`.trim(),
};

// ─────────────────────────────────────────────────────────────────────────────────
// ATOMIC CREATE-IF-NOT-EXISTS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create entity only if it doesn't exist.
 * Initializes version to 1.
 * 
 * KEYS[1] = entity key
 * ARGV[1] = JSON data
 * ARGV[2] = TTL in seconds (0 for no expiry)
 * ARGV[3] = current timestamp (milliseconds)
 * 
 * Returns: [success (0/1), version, reason]
 * reason: 0 = success, 1 = already_exists
 */
export const CREATE_IF_NOT_EXISTS_SCRIPT: LuaScript = {
  name: 'create_if_not_exists',
  numKeys: 1,
  description: 'Atomic create-if-not-exists with version initialization',
  source: `
local key = KEYS[1]
local data = ARGV[1]
local ttl = tonumber(ARGV[2])
local now = ARGV[3]

-- Check if key exists
if redis.call('EXISTS', key) == 1 then
  return {0, 0, 1}  -- already_exists
end

-- Create with version 1
redis.call('HSET', key, 
  'data', data, 
  'version', 1, 
  'created_at', now, 
  'updated_at', now
)

if ttl > 0 then
  redis.call('EXPIRE', key, ttl)
end

return {1, 1, 0}  -- success, version 1
`.trim(),
};

// ─────────────────────────────────────────────────────────────────────────────────
// CONDITIONAL UPDATE WITH VERSION CHECK
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Update entity only if version matches (optimistic locking).
 * 
 * KEYS[1] = entity key
 * ARGV[1] = expected version
 * ARGV[2] = new JSON data
 * ARGV[3] = current timestamp (milliseconds)
 * 
 * Returns: [success (0/1), new_version, reason]
 * reason: 0 = success, 1 = not_found, 2 = version_mismatch
 */
export const CONDITIONAL_UPDATE_SCRIPT: LuaScript = {
  name: 'conditional_update',
  numKeys: 1,
  description: 'Conditional update with optimistic locking',
  source: `
local key = KEYS[1]
local expected_version = tonumber(ARGV[1])
local new_data = ARGV[2]
local now = ARGV[3]

-- Check if key exists
local current = redis.call('HMGET', key, 'version', 'data')
local current_version = tonumber(current[1])

if current_version == nil then
  return {0, 0, 1}  -- not_found
end

if current_version ~= expected_version then
  return {0, current_version, 2}  -- version_mismatch
end

-- Update with incremented version
local new_version = current_version + 1
redis.call('HSET', key, 
  'data', new_data, 
  'version', new_version, 
  'updated_at', now
)

return {1, new_version, 0}  -- success
`.trim(),
};

/**
 * Get entity with version info.
 * 
 * KEYS[1] = entity key
 * 
 * Returns: [exists (0/1), data, version, created_at, updated_at]
 */
export const GET_WITH_VERSION_SCRIPT: LuaScript = {
  name: 'get_with_version',
  numKeys: 1,
  description: 'Get entity with version metadata',
  source: `
local key = KEYS[1]

local result = redis.call('HMGET', key, 'data', 'version', 'created_at', 'updated_at')

if result[1] == false then
  return {0, '', 0, '', ''}
end

return {1, result[1] or '', tonumber(result[2]) or 0, result[3] or '', result[4] or ''}
`.trim(),
};

/**
 * Delete entity only if version matches.
 * 
 * KEYS[1] = entity key
 * ARGV[1] = expected version
 * 
 * Returns: [success (0/1), reason]
 * reason: 0 = success, 1 = not_found, 2 = version_mismatch
 */
export const CONDITIONAL_DELETE_SCRIPT: LuaScript = {
  name: 'conditional_delete',
  numKeys: 1,
  description: 'Delete entity only if version matches',
  source: `
local key = KEYS[1]
local expected_version = tonumber(ARGV[1])

local current_version = tonumber(redis.call('HGET', key, 'version'))

if current_version == nil then
  return {0, 1}  -- not_found
end

if current_version ~= expected_version then
  return {0, 2}  -- version_mismatch
end

redis.call('DEL', key)
return {1, 0}  -- success
`.trim(),
};

// ─────────────────────────────────────────────────────────────────────────────────
// BATCH OPERATIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Batch get multiple entities.
 * 
 * KEYS = entity keys
 * 
 * Returns array of [exists, data, version] for each key
 */
export const BATCH_GET_SCRIPT: LuaScript = {
  name: 'batch_get',
  numKeys: -1, // Variable number of keys
  description: 'Batch get multiple entities with version info',
  source: `
local results = {}

for i, key in ipairs(KEYS) do
  local data = redis.call('HMGET', key, 'data', 'version')
  if data[1] then
    results[i] = {1, data[1], tonumber(data[2]) or 0}
  else
    results[i] = {0, '', 0}
  end
end

return results
`.trim(),
};

// ─────────────────────────────────────────────────────────────────────────────────
// ALL SCRIPTS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * All Lua scripts for easy loading.
 */
export const ALL_SCRIPTS: LuaScript[] = [
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
];

/**
 * Get script by name.
 */
export function getScript(name: string): LuaScript | undefined {
  return ALL_SCRIPTS.find(s => s.name === name);
}

// ─────────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Parse rate limit result from script return.
 */
export function parseRateLimitResult(result: [number, number, number]): RateLimitResult {
  return {
    allowed: result[0] === 1,
    tokens: result[1],
    maxTokens: 0, // Not returned by script, caller should know
    retryAfterMs: result[2],
  };
}

/**
 * Parse lock result from script return.
 */
export function parseLockResult(result: [number, number, number]): LockResult {
  return {
    acquired: result[0] === 1,
    fencingToken: result[1],
    expiresAt: result[2],
  };
}

/**
 * Parse conditional result from script return.
 */
export function parseConditionalResult(result: [number, number, number]): ConditionalResult {
  const reasonMap: Record<number, ConditionalResult['reason']> = {
    0: undefined,
    1: 'not_found',
    2: 'version_mismatch',
  };
  
  // Handle already_exists case from create script
  const reason = result[2] === 1 && result[0] === 0 ? 'already_exists' : reasonMap[result[2]];
  
  return {
    success: result[0] === 1,
    version: result[0] === 1 ? result[1] : undefined,
    reason,
  };
}
