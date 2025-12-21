// ═══════════════════════════════════════════════════════════════════════════════
// REDIS CLIENT — Secure Redis Client with TLS, Auth, Metrics
// NovaOS Infrastructure — Phase 4
// ═══════════════════════════════════════════════════════════════════════════════
//
// Production-ready Redis client featuring:
// - TLS encryption support
// - Password authentication
// - Automatic reconnection with backoff
// - Connection health monitoring
// - Metrics integration (Prometheus)
// - Lua script loading and caching
// - Graceful shutdown support
//
// ═══════════════════════════════════════════════════════════════════════════════

import { createHash } from 'crypto';
import type { RedisConfig } from '../../config/schema.js';
import type { KeyValueStore } from '../../storage/index.js';
import { getLogger } from '../../observability/logging/index.js';
import {
  updateRedisStatus,
  recordRedisOperation,
  incCounter,
} from '../../observability/metrics/index.js';
import {
  ALL_SCRIPTS,
  type LuaScript,
  type RateLimitResult,
  type LockResult,
  type ConditionalResult,
  parseRateLimitResult,
  parseLockResult,
  parseConditionalResult,
} from './scripts.js';
import { setKeyPrefix, getKeyPrefix } from './keys.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Redis client configuration.
 */
export interface RedisClientConfig {
  /** Redis host */
  host: string;
  
  /** Redis port */
  port: number;
  
  /** Redis password */
  password?: string;
  
  /** Enable TLS */
  tls: boolean;
  
  /** Redis URL (overrides host/port) */
  url?: string;
  
  /** Key prefix */
  keyPrefix: string;
  
  /** Connection timeout in ms */
  connectTimeoutMs: number;
  
  /** Command timeout in ms */
  commandTimeoutMs: number;
  
  /** Max retries per request */
  maxRetriesPerRequest: number;
  
  /** Enable offline queue */
  enableOfflineQueue?: boolean;
  
  /** Lazy connect (don't connect until first command) */
  lazyConnect?: boolean;
}

/**
 * Redis connection state.
 */
export type ConnectionState = 
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'closing'
  | 'closed';

/**
 * Redis client events.
 */
export interface RedisClientEvents {
  connect: () => void;
  ready: () => void;
  error: (error: Error) => void;
  close: () => void;
  reconnecting: (attempt: number) => void;
}

/**
 * Extended KeyValueStore interface with Redis-specific operations.
 */
export interface RedisStore extends KeyValueStore {
  // ─────────────────────────────────────────────────────────────────────────────
  // Connection
  // ─────────────────────────────────────────────────────────────────────────────
  
  /** Connect to Redis */
  connect(): Promise<void>;
  
  /** Disconnect from Redis */
  disconnect(): Promise<void>;
  
  /** Get connection state */
  getState(): ConnectionState;
  
  /** Ping Redis */
  ping(): Promise<boolean>;
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Hash operations
  // ─────────────────────────────────────────────────────────────────────────────
  
  /** Set hash field */
  hset(key: string, field: string, value: string): Promise<void>;
  
  /** Get hash field */
  hget(key: string, field: string): Promise<string | null>;
  
  /** Get all hash fields */
  hgetall(key: string): Promise<Record<string, string> | null>;
  
  /** Set multiple hash fields */
  hmset(key: string, fields: Record<string, string>): Promise<void>;
  
  /** Delete hash field */
  hdel(key: string, field: string): Promise<boolean>;
  
  // ─────────────────────────────────────────────────────────────────────────────
  // List operations
  // ─────────────────────────────────────────────────────────────────────────────
  
  /** Push to list (right) */
  rpush(key: string, ...values: string[]): Promise<number>;
  
  /** Push to list (left) */
  lpush(key: string, ...values: string[]): Promise<number>;
  
  /** Pop from list (left) */
  lpop(key: string): Promise<string | null>;
  
  /** Get list range */
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  
  /** Get list length */
  llen(key: string): Promise<number>;
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Set operations
  // ─────────────────────────────────────────────────────────────────────────────
  
  /** Add to set */
  sadd(key: string, ...members: string[]): Promise<number>;
  
  /** Remove from set */
  srem(key: string, ...members: string[]): Promise<number>;
  
  /** Get all set members */
  smembers(key: string): Promise<string[]>;
  
  /** Check set membership */
  sismember(key: string, member: string): Promise<boolean>;
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Sorted set operations
  // ─────────────────────────────────────────────────────────────────────────────
  
  /** Add to sorted set */
  zadd(key: string, score: number, member: string): Promise<number>;
  
  /** Get sorted set range by score */
  zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]>;
  
  /** Remove from sorted set by score range */
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number>;
  
  /** Get sorted set cardinality */
  zcard(key: string): Promise<number>;
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Lua scripts
  // ─────────────────────────────────────────────────────────────────────────────
  
  /** Execute rate limit check */
  rateLimit(key: string, capacity: number, refillRate: number, tokens?: number): Promise<RateLimitResult>;
  
  /** Acquire distributed lock */
  acquireLock(lockKey: string, ownerId: string, ttlMs: number): Promise<LockResult>;
  
  /** Release distributed lock */
  releaseLock(lockKey: string, ownerId: string): Promise<boolean>;
  
  /** Create if not exists */
  createIfNotExists(key: string, data: string, ttlSeconds?: number): Promise<ConditionalResult>;
  
  /** Conditional update with version check */
  conditionalUpdate(key: string, expectedVersion: number, data: string): Promise<ConditionalResult>;
}

// ─────────────────────────────────────────────────────────────────────────────────
// MOCK REDIS CLIENT (for when Redis is disabled)
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * In-memory implementation when Redis is disabled.
 */
class MemoryRedisClient implements RedisStore {
  private readonly data = new Map<string, { value: string; expiresAt?: number }>();
  private readonly hashes = new Map<string, Map<string, string>>();
  private readonly lists = new Map<string, string[]>();
  private readonly sets = new Map<string, Set<string>>();
  private readonly zsets = new Map<string, Map<string, number>>();
  private state: ConnectionState = 'disconnected';
  private fencingToken = 0;
  
  async connect(): Promise<void> {
    this.state = 'connected';
  }
  
  async disconnect(): Promise<void> {
    this.state = 'disconnected';
  }
  
  getState(): ConnectionState {
    return this.state;
  }
  
  isConnected(): boolean {
    return this.state === 'connected';
  }
  
  async ping(): Promise<boolean> {
    return this.state === 'connected';
  }
  
  private isExpired(key: string): boolean {
    const entry = this.data.get(key);
    if (entry?.expiresAt && Date.now() > entry.expiresAt) {
      this.data.delete(key);
      return true;
    }
    return false;
  }
  
  async get(key: string): Promise<string | null> {
    if (this.isExpired(key)) return null;
    return this.data.get(key)?.value ?? null;
  }
  
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.data.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
    });
  }
  
  async delete(key: string): Promise<boolean> {
    return this.data.delete(key) || this.hashes.delete(key) || 
           this.lists.delete(key) || this.sets.delete(key) || this.zsets.delete(key);
  }
  
  async incr(key: string): Promise<number> {
    const current = await this.get(key);
    const newValue = current ? parseInt(current, 10) + 1 : 1;
    await this.set(key, String(newValue));
    return newValue;
  }
  
  async expire(key: string, ttlSeconds: number): Promise<void> {
    const entry = this.data.get(key);
    if (entry) {
      entry.expiresAt = Date.now() + ttlSeconds * 1000;
    }
  }
  
  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    const allKeys = [
      ...this.data.keys(),
      ...this.hashes.keys(),
      ...this.lists.keys(),
      ...this.sets.keys(),
      ...this.zsets.keys(),
    ];
    return allKeys.filter(k => regex.test(k) && !this.isExpired(k));
  }
  
  // Hash operations
  async hset(key: string, field: string, value: string): Promise<void> {
    if (!this.hashes.has(key)) this.hashes.set(key, new Map());
    this.hashes.get(key)!.set(field, value);
  }
  
  async hget(key: string, field: string): Promise<string | null> {
    return this.hashes.get(key)?.get(field) ?? null;
  }
  
  async hgetall(key: string): Promise<Record<string, string> | null> {
    const hash = this.hashes.get(key);
    if (!hash) return null;
    return Object.fromEntries(hash);
  }
  
  async hmset(key: string, fields: Record<string, string>): Promise<void> {
    if (!this.hashes.has(key)) this.hashes.set(key, new Map());
    const hash = this.hashes.get(key)!;
    for (const [field, value] of Object.entries(fields)) {
      hash.set(field, value);
    }
  }
  
  async hdel(key: string, field: string): Promise<boolean> {
    return this.hashes.get(key)?.delete(field) ?? false;
  }
  
  // List operations
  async rpush(key: string, ...values: string[]): Promise<number> {
    if (!this.lists.has(key)) this.lists.set(key, []);
    this.lists.get(key)!.push(...values);
    return this.lists.get(key)!.length;
  }
  
  async lpush(key: string, ...values: string[]): Promise<number> {
    if (!this.lists.has(key)) this.lists.set(key, []);
    this.lists.get(key)!.unshift(...values);
    return this.lists.get(key)!.length;
  }
  
  async lpop(key: string): Promise<string | null> {
    return this.lists.get(key)?.shift() ?? null;
  }
  
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key) ?? [];
    const end = stop === -1 ? undefined : stop + 1;
    return list.slice(start, end);
  }
  
  async llen(key: string): Promise<number> {
    return this.lists.get(key)?.length ?? 0;
  }
  
  // Set operations
  async sadd(key: string, ...members: string[]): Promise<number> {
    if (!this.sets.has(key)) this.sets.set(key, new Set());
    const set = this.sets.get(key)!;
    let added = 0;
    for (const member of members) {
      if (!set.has(member)) {
        set.add(member);
        added++;
      }
    }
    return added;
  }
  
  async srem(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const member of members) {
      if (set.delete(member)) removed++;
    }
    return removed;
  }
  
  async smembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? [])];
  }
  
  async sismember(key: string, member: string): Promise<boolean> {
    return this.sets.get(key)?.has(member) ?? false;
  }
  
  // Sorted set operations
  async zadd(key: string, score: number, member: string): Promise<number> {
    if (!this.zsets.has(key)) this.zsets.set(key, new Map());
    const existed = this.zsets.get(key)!.has(member);
    this.zsets.get(key)!.set(member, score);
    return existed ? 0 : 1;
  }
  
  async zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]> {
    const zset = this.zsets.get(key);
    if (!zset) return [];
    const minVal = min === '-inf' ? -Infinity : Number(min);
    const maxVal = max === '+inf' ? Infinity : Number(max);
    return [...zset.entries()]
      .filter(([_, score]) => score >= minVal && score <= maxVal)
      .sort((a, b) => a[1] - b[1])
      .map(([member]) => member);
  }
  
  async zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number> {
    const zset = this.zsets.get(key);
    if (!zset) return 0;
    const minVal = min === '-inf' ? -Infinity : Number(min);
    const maxVal = max === '+inf' ? Infinity : Number(max);
    let removed = 0;
    for (const [member, score] of zset) {
      if (score >= minVal && score <= maxVal) {
        zset.delete(member);
        removed++;
      }
    }
    return removed;
  }
  
  async zcard(key: string): Promise<number> {
    return this.zsets.get(key)?.size ?? 0;
  }
  
  // Lua script simulations
  async rateLimit(key: string, capacity: number, refillRate: number, tokens = 1): Promise<RateLimitResult> {
    const now = Date.now();
    const data = await this.hgetall(key);
    
    let currentTokens = data ? parseFloat(data.tokens ?? String(capacity)) : capacity;
    const lastRefill = data ? parseInt(data.last_refill ?? String(now), 10) : now;
    
    // Refill
    const elapsed = now - lastRefill;
    const tokensToAdd = (elapsed / 1000) * refillRate;
    currentTokens = Math.min(capacity, currentTokens + tokensToAdd);
    
    let allowed = false;
    let retryAfterMs = 0;
    
    if (currentTokens >= tokens) {
      currentTokens -= tokens;
      allowed = true;
    } else {
      const tokensNeeded = tokens - currentTokens;
      retryAfterMs = Math.ceil((tokensNeeded / refillRate) * 1000);
    }
    
    await this.hmset(key, { tokens: String(currentTokens), last_refill: String(now) });
    
    return { allowed, tokens: Math.floor(currentTokens), maxTokens: capacity, retryAfterMs };
  }
  
  async acquireLock(lockKey: string, ownerId: string, ttlMs: number): Promise<LockResult> {
    const now = Date.now();
    const data = await this.hgetall(lockKey);
    
    if (data?.owner && data.expires_at) {
      const expiresAt = parseInt(data.expires_at, 10);
      if (expiresAt > now && data.owner !== ownerId) {
        return { acquired: false, fencingToken: 0, expiresAt };
      }
    }
    
    this.fencingToken++;
    const expiresAt = now + ttlMs;
    await this.hmset(lockKey, {
      owner: ownerId,
      fencing_token: String(this.fencingToken),
      expires_at: String(expiresAt),
    });
    
    return { acquired: true, fencingToken: this.fencingToken, expiresAt };
  }
  
  async releaseLock(lockKey: string, ownerId: string): Promise<boolean> {
    const currentOwner = await this.hget(lockKey, 'owner');
    if (currentOwner === ownerId) {
      await this.delete(lockKey);
      return true;
    }
    return false;
  }
  
  async createIfNotExists(key: string, data: string, ttlSeconds?: number): Promise<ConditionalResult> {
    const exists = await this.hget(key, 'data');
    if (exists !== null) {
      return { success: false, reason: 'already_exists' };
    }
    
    const now = String(Date.now());
    await this.hmset(key, { data, version: '1', created_at: now, updated_at: now });
    if (ttlSeconds) await this.expire(key, ttlSeconds);
    
    return { success: true, version: 1 };
  }
  
  async conditionalUpdate(key: string, expectedVersion: number, data: string): Promise<ConditionalResult> {
    const currentVersion = await this.hget(key, 'version');
    if (currentVersion === null) {
      return { success: false, reason: 'not_found' };
    }
    
    if (parseInt(currentVersion, 10) !== expectedVersion) {
      return { success: false, reason: 'version_mismatch' };
    }
    
    const newVersion = expectedVersion + 1;
    await this.hmset(key, { data, version: String(newVersion), updated_at: String(Date.now()) });
    
    return { success: true, version: newVersion };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// REDIS CLIENT IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * IORedis client type (dynamically imported).
 */
type IORedisClient = {
  status: string;
  on(event: string, callback: (...args: unknown[]) => void): void;
  connect(): Promise<void>;
  quit(): Promise<string>;
  disconnect(): void;
  ping(): Promise<string>;
  script(command: string, script: string): Promise<string>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<string>;
  setex(key: string, seconds: number, value: string): Promise<string>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  hset(key: string, field: string, value: string): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string>>;
  hmset(key: string, data: Record<string, string>): Promise<string>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  rpush(key: string, ...values: string[]): Promise<number>;
  lpush(key: string, ...values: string[]): Promise<number>;
  lpop(key: string): Promise<string | null>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  llen(key: string): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  sismember(key: string, member: string): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<number>;
  zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]>;
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number>;
  zcard(key: string): Promise<number>;
  evalsha(sha: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
};

/**
 * Production Redis client using ioredis.
 */
class RedisClient implements RedisStore {
  private client: IORedisClient | null = null;
  private readonly config: RedisClientConfig;
  private readonly logger = getLogger({ component: 'redis' });
  private state: ConnectionState = 'disconnected';
  private scriptShas = new Map<string, string>();
  private readonly tokenCounterKey: string;
  
  constructor(config: RedisClientConfig) {
    this.config = config;
    setKeyPrefix(config.keyPrefix);
    this.tokenCounterKey = `${config.keyPrefix}lock:fencing:counter`;
  }
  
  async connect(): Promise<void> {
    if (this.client) return;
    
    this.state = 'connecting';
    
    try {
      // Dynamic import to avoid bundling issues
      const ioredis = await import('ioredis');
      const Redis = ioredis.default ?? ioredis;
      
      const options: Record<string, unknown> = {
        host: this.config.host,
        port: this.config.port,
        password: this.config.password,
        connectTimeout: this.config.connectTimeoutMs,
        commandTimeout: this.config.commandTimeoutMs,
        maxRetriesPerRequest: this.config.maxRetriesPerRequest,
        enableOfflineQueue: this.config.enableOfflineQueue ?? true,
        lazyConnect: true,
        retryStrategy: (times: number) => {
          if (times > 10) {
            this.logger.error('Redis max retries reached', undefined, { attempts: times });
            return null; // Stop retrying
          }
          const delay = Math.min(times * 100, 3000);
          this.logger.warn('Redis reconnecting', { attempt: times, delayMs: delay });
          return delay;
        },
      };
      
      // TLS configuration
      if (this.config.tls) {
        options.tls = {
          rejectUnauthorized: true,
        };
      }
      
      // URL takes precedence
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const RedisConstructor = Redis as any;
      if (this.config.url) {
        this.client = new RedisConstructor(this.config.url, options) as IORedisClient;
      } else {
        this.client = new RedisConstructor(options) as IORedisClient;
      }
      
      // Event handlers
      this.client!.on('connect', () => {
        this.state = 'connecting';
        this.logger.info('Redis connecting');
      });
      
      this.client!.on('ready', () => {
        this.state = 'connected';
        updateRedisStatus(true);
        this.logger.info('Redis connected');
        this.loadScripts().catch(err => {
          this.logger.error('Failed to load Redis scripts', err);
        });
      });
      
      this.client!.on('error', (err) => {
        this.logger.error('Redis error', err as Error);
        incCounter('redis_errors_total', { type: 'connection' });
      });
      
      this.client!.on('close', () => {
        this.state = 'closed';
        updateRedisStatus(false);
        this.logger.warn('Redis connection closed');
      });
      
      this.client!.on('reconnecting', () => {
        this.state = 'reconnecting';
        updateRedisStatus(false);
      });
      
      // Actually connect
      await this.client!.connect();
      
    } catch (error) {
      this.state = 'disconnected';
      updateRedisStatus(false);
      this.logger.error('Redis connection failed', error);
      throw error;
    }
  }
  
  async disconnect(): Promise<void> {
    if (!this.client) return;
    
    this.state = 'closing';
    try {
      await this.client.quit();
    } catch (error) {
      this.logger.warn('Redis disconnect error', { error });
      this.client.disconnect();
    }
    this.client = null;
    this.state = 'disconnected';
    updateRedisStatus(false);
  }
  
  getState(): ConnectionState {
    return this.state;
  }
  
  isConnected(): boolean {
    return this.state === 'connected' && this.client?.status === 'ready';
  }
  
  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const start = Date.now();
      const result = await this.client.ping();
      recordRedisOperation('ping', (Date.now() - start) / 1000);
      return result === 'PONG';
    } catch {
      return false;
    }
  }
  
  private async loadScripts(): Promise<void> {
    if (!this.client) return;
    
    for (const script of ALL_SCRIPTS) {
      try {
        const sha = await this.client.script('LOAD', script.source) as string;
        this.scriptShas.set(script.name, sha);
        script.sha = sha;
        this.logger.debug('Loaded Redis script', { name: script.name, sha });
      } catch (error) {
        this.logger.error('Failed to load script', error, { name: script.name });
      }
    }
  }
  
  private requireClient(): IORedisClient {
    if (!this.client || !this.isConnected()) {
      throw new Error('Redis not connected');
    }
    return this.client;
  }
  
  private async timed<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      recordRedisOperation(operation, (Date.now() - start) / 1000);
      return result;
    } catch (error) {
      incCounter('redis_errors_total', { type: 'command', operation });
      throw error;
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Basic operations
  // ─────────────────────────────────────────────────────────────────────────────
  
  async get(key: string): Promise<string | null> {
    return this.timed('get', () => this.requireClient().get(key));
  }
  
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    await this.timed('set', async () => {
      if (ttlSeconds) {
        await this.requireClient().setex(key, ttlSeconds, value);
      } else {
        await this.requireClient().set(key, value);
      }
    });
  }
  
  async delete(key: string): Promise<boolean> {
    const result = await this.timed('del', () => this.requireClient().del(key));
    return result > 0;
  }
  
  async incr(key: string): Promise<number> {
    return this.timed('incr', () => this.requireClient().incr(key));
  }
  
  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.timed('expire', () => this.requireClient().expire(key, ttlSeconds));
  }
  
  async keys(pattern: string): Promise<string[]> {
    return this.timed('keys', () => this.requireClient().keys(pattern));
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Hash operations
  // ─────────────────────────────────────────────────────────────────────────────
  
  async hset(key: string, field: string, value: string): Promise<void> {
    await this.timed('hset', () => this.requireClient().hset(key, field, value));
  }
  
  async hget(key: string, field: string): Promise<string | null> {
    return this.timed('hget', () => this.requireClient().hget(key, field));
  }
  
  async hgetall(key: string): Promise<Record<string, string> | null> {
    const result = await this.timed('hgetall', () => this.requireClient().hgetall(key));
    return Object.keys(result).length > 0 ? result : null;
  }
  
  async hmset(key: string, fields: Record<string, string>): Promise<void> {
    await this.timed('hmset', () => this.requireClient().hmset(key, fields));
  }
  
  async hdel(key: string, field: string): Promise<boolean> {
    const result = await this.timed('hdel', () => this.requireClient().hdel(key, field));
    return result > 0;
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // List operations
  // ─────────────────────────────────────────────────────────────────────────────
  
  async rpush(key: string, ...values: string[]): Promise<number> {
    return this.timed('rpush', () => this.requireClient().rpush(key, ...values));
  }
  
  async lpush(key: string, ...values: string[]): Promise<number> {
    return this.timed('lpush', () => this.requireClient().lpush(key, ...values));
  }
  
  async lpop(key: string): Promise<string | null> {
    return this.timed('lpop', () => this.requireClient().lpop(key));
  }
  
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.timed('lrange', () => this.requireClient().lrange(key, start, stop));
  }
  
  async llen(key: string): Promise<number> {
    return this.timed('llen', () => this.requireClient().llen(key));
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Set operations
  // ─────────────────────────────────────────────────────────────────────────────
  
  async sadd(key: string, ...members: string[]): Promise<number> {
    return this.timed('sadd', () => this.requireClient().sadd(key, ...members));
  }
  
  async srem(key: string, ...members: string[]): Promise<number> {
    return this.timed('srem', () => this.requireClient().srem(key, ...members));
  }
  
  async smembers(key: string): Promise<string[]> {
    return this.timed('smembers', () => this.requireClient().smembers(key));
  }
  
  async sismember(key: string, member: string): Promise<boolean> {
    const result = await this.timed('sismember', () => this.requireClient().sismember(key, member));
    return result === 1;
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Sorted set operations
  // ─────────────────────────────────────────────────────────────────────────────
  
  async zadd(key: string, score: number, member: string): Promise<number> {
    return this.timed('zadd', () => this.requireClient().zadd(key, score, member));
  }
  
  async zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]> {
    return this.timed('zrangebyscore', () => 
      this.requireClient().zrangebyscore(key, min, max)
    );
  }
  
  async zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number> {
    return this.timed('zremrangebyscore', () =>
      this.requireClient().zremrangebyscore(key, min, max)
    );
  }
  
  async zcard(key: string): Promise<number> {
    return this.timed('zcard', () => this.requireClient().zcard(key));
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Lua scripts
  // ─────────────────────────────────────────────────────────────────────────────
  
  async rateLimit(key: string, capacity: number, refillRate: number, tokens = 1): Promise<RateLimitResult> {
    const sha = this.scriptShas.get('token_bucket');
    if (!sha) throw new Error('Rate limit script not loaded');
    
    const result = await this.timed('rate_limit', () =>
      this.requireClient().evalsha(sha, 1, key, capacity, refillRate, Date.now(), tokens)
    ) as [number, number, number];
    
    return { ...parseRateLimitResult(result), maxTokens: capacity };
  }
  
  async acquireLock(lockKey: string, ownerId: string, ttlMs: number): Promise<LockResult> {
    const sha = this.scriptShas.get('lock_acquire');
    if (!sha) throw new Error('Lock acquire script not loaded');
    
    const result = await this.timed('lock_acquire', () =>
      this.requireClient().evalsha(sha, 2, lockKey, this.tokenCounterKey, ownerId, ttlMs, Date.now())
    ) as [number, number, number];
    
    return parseLockResult(result);
  }
  
  async releaseLock(lockKey: string, ownerId: string): Promise<boolean> {
    const sha = this.scriptShas.get('lock_release');
    if (!sha) throw new Error('Lock release script not loaded');
    
    const result = await this.timed('lock_release', () =>
      this.requireClient().evalsha(sha, 1, lockKey, ownerId)
    ) as number;
    
    return result === 1;
  }
  
  async createIfNotExists(key: string, data: string, ttlSeconds = 0): Promise<ConditionalResult> {
    const sha = this.scriptShas.get('create_if_not_exists');
    if (!sha) throw new Error('Create script not loaded');
    
    const result = await this.timed('create_if_not_exists', () =>
      this.requireClient().evalsha(sha, 1, key, data, ttlSeconds, Date.now())
    ) as [number, number, number];
    
    return parseConditionalResult(result);
  }
  
  async conditionalUpdate(key: string, expectedVersion: number, data: string): Promise<ConditionalResult> {
    const sha = this.scriptShas.get('conditional_update');
    if (!sha) throw new Error('Update script not loaded');
    
    const result = await this.timed('conditional_update', () =>
      this.requireClient().evalsha(sha, 1, key, expectedVersion, data, Date.now())
    ) as [number, number, number];
    
    return parseConditionalResult(result);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// FACTORY
// ─────────────────────────────────────────────────────────────────────────────────

let clientInstance: RedisStore | null = null;

/**
 * Create Redis client from configuration.
 */
export function createRedisClient(config: RedisConfig): RedisStore {
  setKeyPrefix(config.keyPrefix);
  
  if (config.disabled) {
    return new MemoryRedisClient();
  }
  
  return new RedisClient({
    host: config.host,
    port: config.port,
    password: config.password,
    tls: config.tls,
    url: config.url,
    keyPrefix: config.keyPrefix,
    connectTimeoutMs: config.connectTimeoutMs,
    commandTimeoutMs: config.commandTimeoutMs,
    maxRetriesPerRequest: config.maxRetriesPerRequest,
  });
}

/**
 * Get or create the global Redis client.
 */
export function getRedisClient(config?: RedisConfig): RedisStore {
  if (!clientInstance && config) {
    clientInstance = createRedisClient(config);
  }
  if (!clientInstance) {
    // Return memory client if no config provided
    clientInstance = new MemoryRedisClient();
  }
  return clientInstance;
}

/**
 * Reset the global Redis client (for testing).
 */
export async function resetRedisClient(): Promise<void> {
  if (clientInstance) {
    await clientInstance.disconnect();
    clientInstance = null;
  }
}

export { MemoryRedisClient };
