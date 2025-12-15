// ═══════════════════════════════════════════════════════════════════════════════
// STORAGE TESTS — Redis + Memory Store Validation
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MemoryStore,
  RateLimitStore,
  SessionStore,
  AckTokenStore,
  BlockStore,
  VetoHistoryStore,
  AuditLogStore,
} from '../storage/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// MEMORY STORE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it('should always be connected', () => {
    expect(store.isConnected()).toBe(true);
  });

  describe('Basic Operations', () => {
    it('should set and get values', async () => {
      await store.set('key1', 'value1');
      const result = await store.get('key1');
      expect(result).toBe('value1');
    });

    it('should return null for missing keys', async () => {
      const result = await store.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should delete values', async () => {
      await store.set('key1', 'value1');
      const deleted = await store.delete('key1');
      expect(deleted).toBe(true);
      expect(await store.get('key1')).toBeNull();
    });

    it('should check existence', async () => {
      await store.set('key1', 'value1');
      expect(await store.exists('key1')).toBe(true);
      expect(await store.exists('nonexistent')).toBe(false);
    });

    it('should increment values', async () => {
      const v1 = await store.incr('counter');
      const v2 = await store.incr('counter');
      const v3 = await store.incr('counter');
      expect(v1).toBe(1);
      expect(v2).toBe(2);
      expect(v3).toBe(3);
    });
  });

  describe('TTL Operations', () => {
    it('should set expiry time on values', async () => {
      await store.set('expiring', 'value', 60);
      // Value should exist
      const result = await store.get('expiring');
      expect(result).toBe('value');
    });

    it('should not expire values before TTL', async () => {
      await store.set('persistent', 'value', 60);
      const result = await store.get('persistent');
      expect(result).toBe('value');
    });
  });

  describe('Hash Operations', () => {
    it('should set and get hash fields', async () => {
      await store.hset('hash1', 'field1', 'value1');
      await store.hset('hash1', 'field2', 'value2');
      
      expect(await store.hget('hash1', 'field1')).toBe('value1');
      expect(await store.hget('hash1', 'field2')).toBe('value2');
    });

    it('should get all hash fields', async () => {
      await store.hset('hash2', 'a', '1');
      await store.hset('hash2', 'b', '2');
      
      const all = await store.hgetall('hash2');
      expect(all).toEqual({ a: '1', b: '2' });
    });

    it('should delete hash fields', async () => {
      await store.hset('hash3', 'field', 'value');
      const deleted = await store.hdel('hash3', 'field');
      expect(deleted).toBe(true);
      expect(await store.hget('hash3', 'field')).toBeNull();
    });
  });

  describe('List Operations', () => {
    it('should push and range list values', async () => {
      await store.lpush('list1', 'c');
      await store.lpush('list1', 'b');
      await store.lpush('list1', 'a');
      
      const all = await store.lrange('list1', 0, -1);
      expect(all).toEqual(['a', 'b', 'c']);
    });

    it('should trim list', async () => {
      await store.lpush('list2', '3');
      await store.lpush('list2', '2');
      await store.lpush('list2', '1');
      
      await store.ltrim('list2', 0, 1);
      const result = await store.lrange('list2', 0, -1);
      expect(result).toEqual(['1', '2']);
    });
  });

  describe('Keys Pattern', () => {
    it('should find keys by pattern', async () => {
      await store.set('user:1', 'a');
      await store.set('user:2', 'b');
      await store.set('other:1', 'c');
      
      const userKeys = await store.keys('user:*');
      expect(userKeys).toContain('user:1');
      expect(userKeys).toContain('user:2');
      expect(userKeys).not.toContain('other:1');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// RATE LIMIT STORE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('RateLimitStore', () => {
  let memStore: MemoryStore;
  let rateLimitStore: RateLimitStore;

  beforeEach(() => {
    memStore = new MemoryStore();
    rateLimitStore = new RateLimitStore(memStore);
  });

  it('should increment request count', async () => {
    const result1 = await rateLimitStore.increment('user1', 60);
    const result2 = await rateLimitStore.increment('user1', 60);
    
    expect(result1.count).toBe(1);
    expect(result2.count).toBe(2);
  });

  it('should get current count', async () => {
    await rateLimitStore.increment('user2', 60);
    await rateLimitStore.increment('user2', 60);
    
    const count = await rateLimitStore.getCount('user2');
    expect(count).toBe(2);
  });

  it('should reset count', async () => {
    await rateLimitStore.increment('user3', 60);
    await rateLimitStore.reset('user3');
    
    const count = await rateLimitStore.getCount('user3');
    expect(count).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// SESSION STORE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('SessionStore', () => {
  let memStore: MemoryStore;
  let sessionStore: SessionStore;

  beforeEach(() => {
    memStore = new MemoryStore();
    sessionStore = new SessionStore(memStore);
  });

  it('should create session', async () => {
    await sessionStore.create('user1', 'conv1');
    const session = await sessionStore.get('conv1');
    
    expect(session).toBeDefined();
    expect(session.userId).toBe('user1');
    expect(session.conversationId).toBe('conv1');
    expect(session.messageCount).toBe(0);
  });

  it('should update session', async () => {
    await sessionStore.create('user1', 'conv2');
    await sessionStore.update('conv2', { messageCount: 5, tokenCount: 100 });
    
    const session = await sessionStore.get('conv2');
    expect(session.messageCount).toBe(5);
    expect(session.tokenCount).toBe(100);
  });

  it('should delete session', async () => {
    await sessionStore.create('user1', 'conv3');
    await sessionStore.delete('conv3');
    
    const session = await sessionStore.get('conv3');
    expect(session).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// ACK TOKEN STORE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('AckTokenStore', () => {
  let memStore: MemoryStore;
  let ackStore: AckTokenStore;

  beforeEach(() => {
    memStore = new MemoryStore();
    ackStore = new AckTokenStore(memStore);
  });

  it('should store and validate token', async () => {
    await ackStore.save('token123', 'user1', 60);
    const valid = await ackStore.validate('token123', 'user1');
    expect(valid).toBe(true);
  });

  it('should reject invalid user', async () => {
    await ackStore.save('token456', 'user1', 60);
    const valid = await ackStore.validate('token456', 'user2');
    expect(valid).toBe(false);
  });

  it('should reject nonexistent token', async () => {
    const valid = await ackStore.validate('nonexistent', 'user1');
    expect(valid).toBe(false);
  });

  it('should be single-use', async () => {
    await ackStore.save('token789', 'user1', 60);
    
    const first = await ackStore.validate('token789', 'user1');
    const second = await ackStore.validate('token789', 'user1');
    
    expect(first).toBe(true);
    expect(second).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// BLOCK STORE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('BlockStore', () => {
  let memStore: MemoryStore;
  let blockStore: BlockStore;

  beforeEach(() => {
    memStore = new MemoryStore();
    blockStore = new BlockStore(memStore);
  });

  it('should block user', async () => {
    await blockStore.block('user1', 'Test reason', 60);
    const status = await blockStore.isBlocked('user1');
    
    expect(status.blocked).toBe(true);
    expect(status.reason).toBe('Test reason');
  });

  it('should unblock user', async () => {
    await blockStore.block('user2', 'Test', 60);
    await blockStore.unblock('user2');
    
    const status = await blockStore.isBlocked('user2');
    expect(status.blocked).toBe(false);
  });

  it('should report unblocked for unknown users', async () => {
    const status = await blockStore.isBlocked('unknown');
    expect(status.blocked).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// VETO HISTORY STORE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('VetoHistoryStore', () => {
  let memStore: MemoryStore;
  let vetoStore: VetoHistoryStore;

  beforeEach(() => {
    memStore = new MemoryStore();
    vetoStore = new VetoHistoryStore(memStore);
  });

  it('should track vetos', async () => {
    const count1 = await vetoStore.track('user1', 60);
    const count2 = await vetoStore.track('user1', 60);
    const count3 = await vetoStore.track('user1', 60);
    
    expect(count1).toBe(1);
    expect(count2).toBe(2);
    expect(count3).toBe(3);
  });

  it('should get veto count', async () => {
    await vetoStore.track('user2', 60);
    await vetoStore.track('user2', 60);
    
    const count = await vetoStore.getCount('user2', 60);
    expect(count).toBe(2);
  });

  it('should return 0 for unknown users', async () => {
    const count = await vetoStore.getCount('unknown', 60);
    expect(count).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// AUDIT LOG STORE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('AuditLogStore', () => {
  let memStore: MemoryStore;
  let auditStore: AuditLogStore;

  beforeEach(() => {
    memStore = new MemoryStore();
    auditStore = new AuditLogStore(memStore);
  });

  it('should log entries', async () => {
    const id = await auditStore.log({
      userId: 'user1',
      action: 'test_action',
      details: { key: 'value' },
    });
    
    expect(id).toBeDefined();
    expect(typeof id).toBe('string');
  });

  it('should get user logs', async () => {
    await auditStore.log({ userId: 'user1', action: 'action1', details: {} });
    await auditStore.log({ userId: 'user1', action: 'action2', details: {} });
    await auditStore.log({ userId: 'user2', action: 'action3', details: {} });
    
    const userLogs = await auditStore.getUserLogs('user1');
    expect(userLogs.length).toBe(2);
  });

  it('should get global logs', async () => {
    await auditStore.log({ userId: 'user1', action: 'action1', details: {} });
    await auditStore.log({ userId: 'user2', action: 'action2', details: {} });
    
    const globalLogs = await auditStore.getGlobalLogs();
    expect(globalLogs.length).toBe(2);
  });

  it('should limit returned logs', async () => {
    for (let i = 0; i < 10; i++) {
      await auditStore.log({ userId: 'user1', action: `action${i}`, details: {} });
    }
    
    const limitedLogs = await auditStore.getUserLogs('user1', 3);
    expect(limitedLogs.length).toBe(3);
  });
});
