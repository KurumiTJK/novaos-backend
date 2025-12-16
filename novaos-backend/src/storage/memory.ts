// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY STORE — In-Memory KeyValueStore Implementation for Testing
// ═══════════════════════════════════════════════════════════════════════════════

import type { KeyValueStore } from './types.js';

export class MemoryStore implements KeyValueStore {
  private data: Map<string, { value: string; expiresAt?: number }> = new Map();
  private lists: Map<string, string[]> = new Map();
  private sets: Map<string, Set<string>> = new Map();
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // STRING OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  async get(key: string): Promise<string | null> {
    const entry = this.data.get(key);
    if (!entry) return null;
    
    // Check expiration
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.data.delete(key);
      return null;
    }
    
    return entry.value;
  }
  
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
    this.data.set(key, { value, expiresAt });
  }
  
  async delete(key: string): Promise<boolean> {
    const existed = this.data.has(key) || this.lists.has(key) || this.sets.has(key);
    this.data.delete(key);
    this.lists.delete(key);
    this.sets.delete(key);
    return existed;
  }
  
  async exists(key: string): Promise<boolean> {
    const entry = this.data.get(key);
    if (!entry) return this.lists.has(key) || this.sets.has(key);
    
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.data.delete(key);
      return false;
    }
    
    return true;
  }
  
  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    const entry = this.data.get(key);
    if (entry) {
      entry.expiresAt = Date.now() + ttlSeconds * 1000;
      return true;
    }
    return false;
  }
  
  async ttl(key: string): Promise<number> {
    const entry = this.data.get(key);
    if (!entry || !entry.expiresAt) return -1;
    
    const remaining = Math.ceil((entry.expiresAt - Date.now()) / 1000);
    return remaining > 0 ? remaining : -2;
  }
  
  async incr(key: string): Promise<number> {
    const current = await this.get(key);
    const newValue = (parseInt(current ?? '0', 10) || 0) + 1;
    await this.set(key, newValue.toString());
    return newValue;
  }
  
  async incrBy(key: string, increment: number): Promise<number> {
    const current = await this.get(key);
    const newValue = (parseInt(current ?? '0', 10) || 0) + increment;
    await this.set(key, newValue.toString());
    return newValue;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // LIST OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  async lpush(key: string, ...values: string[]): Promise<number> {
    let list = this.lists.get(key);
    if (!list) {
      list = [];
      this.lists.set(key, list);
    }
    list.unshift(...values);
    return list.length;
  }
  
  async rpush(key: string, ...values: string[]): Promise<number> {
    let list = this.lists.get(key);
    if (!list) {
      list = [];
      this.lists.set(key, list);
    }
    list.push(...values);
    return list.length;
  }
  
  async lpop(key: string): Promise<string | null> {
    const list = this.lists.get(key);
    if (!list || list.length === 0) return null;
    return list.shift() ?? null;
  }
  
  async rpop(key: string): Promise<string | null> {
    const list = this.lists.get(key);
    if (!list || list.length === 0) return null;
    return list.pop() ?? null;
  }
  
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key);
    if (!list) return [];
    
    // Handle negative indices like Redis
    const len = list.length;
    let startIdx = start < 0 ? Math.max(0, len + start) : start;
    let stopIdx = stop < 0 ? len + stop : stop;
    
    if (startIdx > stopIdx || startIdx >= len) return [];
    
    return list.slice(startIdx, stopIdx + 1);
  }
  
  async llen(key: string): Promise<number> {
    const list = this.lists.get(key);
    return list?.length ?? 0;
  }
  
  async ltrim(key: string, start: number, stop: number): Promise<void> {
    const list = this.lists.get(key);
    if (!list) return;
    
    const len = list.length;
    let startIdx = start < 0 ? Math.max(0, len + start) : start;
    let stopIdx = stop < 0 ? len + stop : stop;
    
    this.lists.set(key, list.slice(startIdx, stopIdx + 1));
  }
  
  async lrem(key: string, count: number, value: string): Promise<number> {
    const list = this.lists.get(key);
    if (!list) return 0;
    
    let removed = 0;
    const newList: string[] = [];
    
    for (const item of list) {
      if (item === value && (count === 0 || removed < Math.abs(count))) {
        removed++;
      } else {
        newList.push(item);
      }
    }
    
    this.lists.set(key, newList);
    return removed;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // SET OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════════
  
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
      if (set.delete(member)) {
        removed++;
      }
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
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // HASH OPERATIONS (simplified)
  // ═══════════════════════════════════════════════════════════════════════════════
  
  async hget(key: string, field: string): Promise<string | null> {
    const data = await this.get(`${key}:${field}`);
    return data;
  }
  
  async hset(key: string, field: string, value: string): Promise<number> {
    const existed = await this.exists(`${key}:${field}`);
    await this.set(`${key}:${field}`, value);
    return existed ? 0 : 1;
  }
  
  async hdel(key: string, ...fields: string[]): Promise<number> {
    let deleted = 0;
    for (const field of fields) {
      if (await this.delete(`${key}:${field}`)) {
        deleted++;
      }
    }
    return deleted;
  }
  
  async hgetall(key: string): Promise<Record<string, string>> {
    // Simplified - would need to track hash fields separately for full implementation
    return {};
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // UTILITY
  // ═══════════════════════════════════════════════════════════════════════════════
  
  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    const allKeys = [
      ...this.data.keys(),
      ...this.lists.keys(),
      ...this.sets.keys(),
    ];
    return allKeys.filter(k => regex.test(k));
  }
  
  async ping(): Promise<string> {
    return 'PONG';
  }
  
  async flushall(): Promise<void> {
    this.data.clear();
    this.lists.clear();
    this.sets.clear();
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST HELPERS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  clear(): void {
    this.data.clear();
    this.lists.clear();
    this.sets.clear();
  }
  
  size(): number {
    return this.data.size + this.lists.size + this.sets.size;
  }
}
