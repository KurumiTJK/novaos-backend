// ═══════════════════════════════════════════════════════════════════════════════
// STORAGE MODULE — Redis + In-Memory Abstractions
// ═══════════════════════════════════════════════════════════════════════════════

import { Redis } from 'ioredis';

// ─────────────────────────────────────────────────────────────────────────────────
// STORE INTERFACE
// ─────────────────────────────────────────────────────────────────────────────────

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  incr(key: string): Promise<number>;
  expire(key: string, ttlSeconds: number): Promise<boolean>;
  keys(pattern: string): Promise<string[]>;
  
  // Hash operations
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, field: string, value: string): Promise<void>;
  hgetall(key: string): Promise<Record<string, string>>;
  hdel(key: string, field: string): Promise<boolean>;
  
  // List operations
  lpush(key: string, value: string): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  ltrim(key: string, start: number, stop: number): Promise<void>;
  
  // Set operations
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  sismember(key: string, member: string): Promise<boolean>;
  scard(key: string): Promise<number>;

  // Sorted set operations
  zadd(key: string, score: number, member: string): Promise<number>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  zrevrange(key: string, start: number, stop: number): Promise<string[]>;
  zremrangebyrank(key: string, start: number, stop: number): Promise<number>;
  
  // Connection
  isConnected(): boolean;
  disconnect(): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────────
// REDIS STORE
// ─────────────────────────────────────────────────────────────────────────────────

export class RedisStore implements KeyValueStore {
  private client: Redis;
  private connected: boolean = false;

  constructor(url?: string) {
    const redisUrl = url ?? process.env.REDIS_URL ?? 'redis://localhost:6379';
    
    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => {
        if (times > 3) {
          console.error('[REDIS] Max retries reached, giving up');
          return null;
        }
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });

    this.client.on('connect', () => {
      console.log('[REDIS] Connected');
      this.connected = true;
    });

    this.client.on('error', (err: Error) => {
      console.error('[REDIS] Error:', err.message);
      this.connected = false;
    });

    this.client.on('close', () => {
      console.log('[REDIS] Connection closed');
      this.connected = false;
    });
  }

  async connect(): Promise<void> {
    try {
      await this.client.connect();
    } catch (error) {
      console.error('[REDIS] Failed to connect:', error);
      throw error;
    }
  }

  isConnected(): boolean {
    return this.connected && this.client.status === 'ready';
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async delete(key: string): Promise<boolean> {
    const result = await this.client.del(key);
    return result > 0;
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result > 0;
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.expire(key, ttlSeconds);
    return result === 1;
  }

  async keys(pattern: string): Promise<string[]> {
    return this.client.keys(pattern);
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field);
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    await this.client.hset(key, field, value);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(key);
  }

  async hdel(key: string, field: string): Promise<boolean> {
    const result = await this.client.hdel(key, field);
    return result > 0;
  }

  async lpush(key: string, value: string): Promise<number> {
    return this.client.lpush(key, value);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.lrange(key, start, stop);
  }

  async ltrim(key: string, start: number, stop: number): Promise<void> {
    await this.client.ltrim(key, start, stop);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    return this.client.sadd(key, ...members);
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    return this.client.srem(key, ...members);
  }

  async smembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  async sismember(key: string, member: string): Promise<boolean> {
    const result = await this.client.sismember(key, member);
    return result === 1;
  }

  async scard(key: string): Promise<number> {
    return this.client.scard(key);
  }

  // Sorted set operations
  async zadd(key: string, score: number, member: string): Promise<number> {
    return this.client.zadd(key, score, member);
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.zrange(key, start, stop);
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.zrevrange(key, start, stop);
  }

  async zremrangebyrank(key: string, start: number, stop: number): Promise<number> {
    return this.client.zremrangebyrank(key, start, stop);
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// IN-MEMORY STORE (Fallback when Redis unavailable)
// ─────────────────────────────────────────────────────────────────────────────────

interface MemoryEntry {
  value: string;
  expiresAt?: number;
}

interface SortedSetEntry {
  member: string;
  score: number;
}

export class MemoryStore implements KeyValueStore {
  private store = new Map<string, MemoryEntry>();
  private hashes = new Map<string, Map<string, string>>();
  private lists = new Map<string, string[]>();
  private sets = new Map<string, Set<string>>();
  private sortedSets = new Map<string, SortedSetEntry[]>();

  isConnected(): boolean {
    return true;
  }

  private isExpired(entry: MemoryEntry): boolean {
    return entry.expiresAt !== undefined && Date.now() > entry.expiresAt;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry || this.isExpired(entry)) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const entry: MemoryEntry = { value };
    if (ttlSeconds) {
      entry.expiresAt = Date.now() + ttlSeconds * 1000;
    }
    this.store.set(key, entry);
  }

  async delete(key: string): Promise<boolean> {
    const existed = this.store.has(key) || this.lists.has(key) || this.sets.has(key) || this.hashes.has(key) || this.sortedSets.has(key);
    this.store.delete(key);
    this.lists.delete(key);
    this.sets.delete(key);
    this.hashes.delete(key);
    this.sortedSets.delete(key);
    return existed;
  }

  async exists(key: string): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry || this.isExpired(entry)) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  async incr(key: string): Promise<number> {
    const current = await this.get(key);
    const newValue = (parseInt(current ?? '0', 10) || 0) + 1;
    await this.set(key, String(newValue));
    return newValue;
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry) return false;
    entry.expiresAt = Date.now() + ttlSeconds * 1000;
    return true;
  }

  async keys(pattern: string): Promise<string[]> {
    this.cleanup();
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return Array.from(this.store.keys()).filter(key => regex.test(key));
  }

  async hget(key: string, field: string): Promise<string | null> {
    const hash = this.hashes.get(key);
    return hash?.get(field) ?? null;
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    let hash = this.hashes.get(key);
    if (!hash) {
      hash = new Map();
      this.hashes.set(key, hash);
    }
    hash.set(field, value);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const hash = this.hashes.get(key);
    if (!hash) return {};
    return Object.fromEntries(hash.entries());
  }

  async hdel(key: string, field: string): Promise<boolean> {
    const hash = this.hashes.get(key);
    return hash?.delete(field) ?? false;
  }

  async lpush(key: string, value: string): Promise<number> {
    let list = this.lists.get(key);
    if (!list) {
      list = [];
      this.lists.set(key, list);
    }
    list.unshift(value);
    return list.length;
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key) ?? [];
    const end = stop < 0 ? list.length + stop + 1 : stop + 1;
    return list.slice(start, end);
  }

  async ltrim(key: string, start: number, stop: number): Promise<void> {
    const list = this.lists.get(key);
    if (!list) return;
    const end = stop < 0 ? list.length + stop + 1 : stop + 1;
    const trimmed = list.slice(start, end);
    this.lists.set(key, trimmed);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    let set = this.sets.get(key);
    if (!set) {
      set = new Set();
      this.sets.set(key, set);
    }
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
    const set = this.sets.get(key);
    return set ? Array.from(set) : [];
  }

  async sismember(key: string, member: string): Promise<boolean> {
    const set = this.sets.get(key);
    return set?.has(member) ?? false;
  }

  async scard(key: string): Promise<number> {
    const set = this.sets.get(key);
    return set?.size ?? 0;
  }

  // Sorted set operations
  async zadd(key: string, score: number, member: string): Promise<number> {
    let zset = this.sortedSets.get(key);
    if (!zset) {
      zset = [];
      this.sortedSets.set(key, zset);
    }
    
    // Check if member exists
    const existingIndex = zset.findIndex(e => e.member === member);
    if (existingIndex >= 0) {
      // Update score
      zset[existingIndex]!.score = score;
      // Re-sort
      zset.sort((a, b) => a.score - b.score);
      return 0; // No new elements added
    }
    
    // Add new entry and sort
    zset.push({ member, score });
    zset.sort((a, b) => a.score - b.score);
    return 1;
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    const zset = this.sortedSets.get(key) ?? [];
    const end = stop < 0 ? zset.length + stop + 1 : stop + 1;
    return zset.slice(start, end).map(e => e.member);
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    const zset = this.sortedSets.get(key) ?? [];
    // Reverse the sorted set (highest scores first)
    const reversed = [...zset].reverse();
    const end = stop < 0 ? reversed.length + stop + 1 : stop + 1;
    return reversed.slice(start, end).map(e => e.member);
  }

  async zremrangebyrank(key: string, start: number, stop: number): Promise<number> {
    const zset = this.sortedSets.get(key);
    if (!zset) return 0;
    
    const len = zset.length;
    const normalizedStart = start < 0 ? Math.max(0, len + start) : start;
    const normalizedStop = stop < 0 ? len + stop : stop;
    
    if (normalizedStart > normalizedStop || normalizedStart >= len) return 0;
    
    const deleteCount = Math.min(normalizedStop, len - 1) - normalizedStart + 1;
    zset.splice(normalizedStart, deleteCount);
    return deleteCount;
  }

  async disconnect(): Promise<void> {
    this.store.clear();
    this.hashes.clear();
    this.lists.clear();
    this.sets.clear();
    this.sortedSets.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// STORE MANAGER
// ─────────────────────────────────────────────────────────────────────────────────

export class StoreManager {
  private redis: RedisStore | null = null;
  private memory: MemoryStore;
  private useRedis: boolean = false;

  constructor() {
    this.memory = new MemoryStore();
    
    // Try to initialize Redis if REDIS_URL is set
    if (process.env.REDIS_URL) {
      try {
        this.redis = new RedisStore(process.env.REDIS_URL);
        this.useRedis = true;
      } catch (error) {
        console.warn('[STORAGE] Redis initialization failed, using memory store');
        this.useRedis = false;
      }
    }
  }

  async initialize(): Promise<void> {
    if (this.redis && this.useRedis) {
      try {
        await this.redis.connect();
      } catch (error) {
        console.warn('[STORAGE] Redis connection failed, falling back to memory store');
        this.useRedis = false;
      }
    }
  }

  getStore(): KeyValueStore {
    if (this.useRedis && this.redis?.isConnected()) {
      return this.redis!;
    }
    return this.memory;
  }

  isUsingRedis(): boolean {
    return this.useRedis && (this.redis?.isConnected() ?? false);
  }

  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.disconnect();
    }
    await this.memory.disconnect();
  }

  async disconnect(): Promise<void> {
    return this.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SPECIALIZED STORES
// ─────────────────────────────────────────────────────────────────────────────────

// Rate Limit Store
export class RateLimitStore {
  constructor(private store: KeyValueStore) {}

  private getKey(userId: string): string {
    return `ratelimit:${userId}`;
  }

  async increment(userId: string, windowSeconds: number): Promise<{ count: number; ttl: number }> {
    const key = this.getKey(userId);
    const count = await this.store.incr(key);
    
    if (count === 1) {
      await this.store.expire(key, windowSeconds);
    }

    return { count, ttl: windowSeconds };
  }

  async getCount(userId: string): Promise<number> {
    const value = await this.store.get(this.getKey(userId));
    return parseInt(value ?? '0', 10);
  }

  async reset(userId: string): Promise<void> {
    await this.store.delete(this.getKey(userId));
  }
}

// Session Store
export class SessionStore {
  constructor(private store: KeyValueStore) {}

  private getKey(conversationId: string): string {
    return `session:${conversationId}`;
  }

  async create(userId: string, conversationId: string): Promise<void> {
    const session = {
      userId,
      conversationId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      messageCount: 0,
      tokenCount: 0,
    };
    await this.store.set(
      this.getKey(conversationId),
      JSON.stringify(session),
      24 * 60 * 60 // 24 hour TTL
    );
  }

  async get(conversationId: string): Promise<any | null> {
    const data = await this.store.get(this.getKey(conversationId));
    return data ? JSON.parse(data) : null;
  }

  async update(conversationId: string, updates: { messageCount?: number; tokenCount?: number }): Promise<void> {
    const session = await this.get(conversationId);
    if (!session) return;

    session.lastActivity = Date.now();
    if (updates.messageCount) session.messageCount += updates.messageCount;
    if (updates.tokenCount) session.tokenCount += updates.tokenCount;

    await this.store.set(
      this.getKey(conversationId),
      JSON.stringify(session),
      24 * 60 * 60
    );
  }

  async delete(conversationId: string): Promise<void> {
    await this.store.delete(this.getKey(conversationId));
  }
}

// Ack Token Store
export class AckTokenStore {
  constructor(private kvStore: KeyValueStore) {}

  private getKey(token: string): string {
    return `ack:${token}`;
  }

  async save(token: string, userId: string, ttlSeconds: number = 300): Promise<void> {
    await this.kvStore.set(
      this.getKey(token),
      JSON.stringify({ userId, createdAt: Date.now() }),
      ttlSeconds
    );
  }

  async validate(token: string, userId: string): Promise<boolean> {
    const data = await this.kvStore.get(this.getKey(token));
    if (!data) return false;

    const parsed = JSON.parse(data);
    if (parsed.userId !== userId) return false;

    // Delete after validation (single use)
    await this.kvStore.delete(this.getKey(token));
    return true;
  }
}

// Block Store
export class BlockStore {
  constructor(private store: KeyValueStore) {}

  private getKey(userId: string): string {
    return `block:${userId}`;
  }

  async block(userId: string, reason: string, durationSeconds: number): Promise<void> {
    await this.store.set(
      this.getKey(userId),
      JSON.stringify({ reason, until: Date.now() + durationSeconds * 1000 }),
      durationSeconds
    );
  }

  async isBlocked(userId: string): Promise<{ blocked: boolean; reason?: string; until?: number }> {
    const data = await this.store.get(this.getKey(userId));
    if (!data) return { blocked: false };

    const parsed = JSON.parse(data);
    return {
      blocked: true,
      reason: parsed.reason,
      until: parsed.until,
    };
  }

  async unblock(userId: string): Promise<boolean> {
    return this.store.delete(this.getKey(userId));
  }
}

// Veto History Store
export class VetoHistoryStore {
  constructor(private store: KeyValueStore) {}

  private getKey(userId: string): string {
    return `veto:${userId}`;
  }

  async track(userId: string, windowSeconds: number = 300): Promise<number> {
    const key = this.getKey(userId);
    const now = Date.now();

    // Add new timestamp
    await this.store.lpush(key, String(now));
    await this.store.expire(key, windowSeconds);

    // Get all timestamps
    const timestamps = await this.store.lrange(key, 0, -1);
    const cutoff = now - windowSeconds * 1000;

    // Count recent ones
    const recentCount = timestamps.filter(t => parseInt(t, 10) > cutoff).length;

    // Trim old entries (keep last 20)
    await this.store.ltrim(key, 0, 19);

    return recentCount;
  }

  async getCount(userId: string, windowSeconds: number = 300): Promise<number> {
    const key = this.getKey(userId);
    const now = Date.now();
    const cutoff = now - windowSeconds * 1000;

    const timestamps = await this.store.lrange(key, 0, -1);
    return timestamps.filter(t => parseInt(t, 10) > cutoff).length;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// AUDIT LOG STORE
// ─────────────────────────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  userId: string;
  action: string;
  details: Record<string, any>;
  requestId?: string;
  stance?: string;
  status?: string;
}

export class AuditLogStore {
  constructor(private store: KeyValueStore) {}

  private getUserKey(userId: string): string {
    return `audit:user:${userId}`;
  }

  private getGlobalKey(): string {
    return 'audit:global';
  }

  async log(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): Promise<string> {
    const id = crypto.randomUUID();
    const fullEntry: AuditLogEntry = {
      ...entry,
      id,
      timestamp: Date.now(),
    };

    const json = JSON.stringify(fullEntry);

    // Store in user-specific list
    await this.store.lpush(this.getUserKey(entry.userId), json);
    await this.store.ltrim(this.getUserKey(entry.userId), 0, 999); // Keep last 1000

    // Store in global list
    await this.store.lpush(this.getGlobalKey(), json);
    await this.store.ltrim(this.getGlobalKey(), 0, 9999); // Keep last 10000

    return id;
  }

  async getUserLogs(userId: string, limit: number = 100): Promise<AuditLogEntry[]> {
    const logs = await this.store.lrange(this.getUserKey(userId), 0, limit - 1);
    return logs.map(log => JSON.parse(log));
  }

  async getGlobalLogs(limit: number = 100): Promise<AuditLogEntry[]> {
    const logs = await this.store.lrange(this.getGlobalKey(), 0, limit - 1);
    return logs.map(log => JSON.parse(log));
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON INSTANCE
// ─────────────────────────────────────────────────────────────────────────────────

export const storeManager = new StoreManager();

export function getStore(): KeyValueStore {
  return storeManager.getStore();
}
