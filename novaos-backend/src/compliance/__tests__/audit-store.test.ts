// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT STORE TESTS — Unit Tests for Audit Logging
// NovaOS Compliance Layer — Phase 16
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuditStore, createAuditStore } from '../audit-log/audit-store.js';
import { AuditLogger, createAuditLogger } from '../audit-log/audit-logger.js';
import type { KeyValueStore } from '../../storage/index.js';
import type { UserId, Timestamp, AuditId } from '../../types/branded.js';
import { createTimestamp } from '../../types/branded.js';
import type { AuditEntry, AuditCategory, AuditAction } from '../audit-log/types.js';
import { verifyAuditEntryHash } from '../audit-log/types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK STORE
// ═══════════════════════════════════════════════════════════════════════════════

function createMockStore(): KeyValueStore {
  const data = new Map<string, string>();
  const sortedSets = new Map<string, Map<string, number>>();
  let counter = 0;

  return {
    get: vi.fn(async (key: string) => data.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      data.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      return data.delete(key);
    }),
    exists: vi.fn(async (key: string) => data.has(key)),
    incr: vi.fn(async (key: string) => {
      counter++;
      data.set(key, String(counter));
      return counter;
    }),

    // Sorted set operations
    zadd: vi.fn(async (key: string, score: number, member: string) => {
      if (!sortedSets.has(key)) sortedSets.set(key, new Map());
      sortedSets.get(key)!.set(member, score);
      return 1;
    }),
    zrem: vi.fn(async (key: string, member: string) => {
      return sortedSets.get(key)?.delete(member) ? 1 : 0;
    }),
    zcard: vi.fn(async (key: string) => {
      return sortedSets.get(key)?.size ?? 0;
    }),
    zrange: vi.fn(async (key: string, start: number, stop: number) => {
      const ss = sortedSets.get(key);
      if (!ss) return [];
      const sorted = Array.from(ss.entries())
        .sort((a, b) => a[1] - b[1])
        .map(([m]) => m);
      const end = stop === -1 ? sorted.length : stop + 1;
      return sorted.slice(start, end);
    }),
    zrevrange: vi.fn(async (key: string, start: number, stop: number) => {
      const ss = sortedSets.get(key);
      if (!ss) return [];
      const sorted = Array.from(ss.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([m]) => m);
      const end = stop === -1 ? sorted.length : stop + 1;
      return sorted.slice(start, end);
    }),
    zrangebyscore: vi.fn(async (key: string, min: any, max: any, opts?: any) => {
      const ss = sortedSets.get(key);
      if (!ss) return [];
      const minScore = min === '-inf' ? -Infinity : Number(min);
      const maxScore = max === '+inf' ? Infinity : Number(max);
      const filtered = Array.from(ss.entries())
        .filter(([, score]) => score >= minScore && score <= maxScore)
        .sort((a, b) => a[1] - b[1])
        .map(([m]) => m);
      if (opts?.limit) {
        return filtered.slice(opts.limit.offset, opts.limit.offset + opts.limit.count);
      }
      return filtered;
    }),
    zrevrangebyscore: vi.fn(async (key: string, max: any, min: any, opts?: any) => {
      const ss = sortedSets.get(key);
      if (!ss) return [];
      const minScore = min === '-inf' ? -Infinity : Number(min);
      const maxScore = max === '+inf' ? Infinity : Number(max);
      const filtered = Array.from(ss.entries())
        .filter(([, score]) => score >= minScore && score <= maxScore)
        .sort((a, b) => b[1] - a[1])
        .map(([m]) => m);
      if (opts?.limit) {
        return filtered.slice(opts.limit.offset, opts.limit.offset + opts.limit.count);
      }
      return filtered;
    }),
    zremrangebyrank: vi.fn(async () => 0),
  } as unknown as KeyValueStore;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const testUserId = 'user_test123' as UserId;

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT STORE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('AuditStore', () => {
  let store: AuditStore;
  let mockKv: KeyValueStore;

  beforeEach(() => {
    mockKv = createMockStore();
    store = createAuditStore(mockKv);
  });

  describe('append', () => {
    it('should append an audit entry', async () => {
      const result = await store.append({
        timestamp: createTimestamp(),
        category: 'consent',
        action: 'consent.granted',
        severity: 'info',
        userId: testUserId,
        description: 'User granted consent for analytics',
        success: true,
      });

      expect(result.ok).toBe(true);
      expect(result.value?.id).toBeDefined();
      expect(result.value?.entryHash).toBeDefined();
      expect(result.value?.category).toBe('consent');
    });

    it('should compute valid hash', async () => {
      const result = await store.append({
        timestamp: createTimestamp(),
        category: 'consent',
        action: 'consent.granted',
        severity: 'info',
        description: 'Test entry',
        success: true,
      });

      expect(result.ok).toBe(true);
      expect(verifyAuditEntryHash(result.value!)).toBe(true);
    });

    it('should link to previous entry hash', async () => {
      // First entry
      const first = await store.append({
        timestamp: createTimestamp(),
        category: 'consent',
        action: 'consent.granted',
        severity: 'info',
        description: 'First entry',
        success: true,
      });

      // Second entry
      const second = await store.append({
        timestamp: createTimestamp(),
        category: 'consent',
        action: 'consent.revoked',
        severity: 'info',
        description: 'Second entry',
        success: true,
      });

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(second.value?.previousHash).toBe(first.value?.entryHash);
    });

    it('should add to indexes', async () => {
      await store.append({
        timestamp: createTimestamp(),
        category: 'consent',
        action: 'consent.granted',
        severity: 'info',
        userId: testUserId,
        description: 'Test entry',
        success: true,
      });

      // Check indexes were populated
      expect(mockKv.zadd).toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('should return null for non-existent entry', async () => {
      const result = await store.get('audit_nonexistent' as AuditId);

      expect(result.ok).toBe(true);
      expect(result.value).toBeNull();
    });

    it('should return entry by ID', async () => {
      const appendResult = await store.append({
        timestamp: createTimestamp(),
        category: 'security',
        action: 'security.blocked',
        severity: 'warning',
        description: 'Request blocked',
        success: false,
      });

      expect(appendResult.ok).toBe(true);
      const id = appendResult.value!.id;

      const result = await store.get(id);

      expect(result.ok).toBe(true);
      expect(result.value?.id).toBe(id);
      expect(result.value?.category).toBe('security');
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      // Add some test entries
      await store.append({
        timestamp: createTimestamp(),
        category: 'consent',
        action: 'consent.granted',
        severity: 'info',
        userId: testUserId,
        description: 'Consent granted',
        success: true,
      });

      await store.append({
        timestamp: createTimestamp(),
        category: 'security',
        action: 'security.blocked',
        severity: 'warning',
        description: 'Blocked request',
        success: false,
      });

      await store.append({
        timestamp: createTimestamp(),
        category: 'consent',
        action: 'consent.revoked',
        severity: 'info',
        userId: testUserId,
        description: 'Consent revoked',
        success: true,
      });
    });

    it('should query all entries', async () => {
      const result = await store.query({ limit: 100 });

      expect(result.ok).toBe(true);
      expect(result.value?.entries.length).toBeGreaterThanOrEqual(3);
    });

    it('should filter by category', async () => {
      const result = await store.query({
        category: 'consent',
        limit: 100,
      });

      expect(result.ok).toBe(true);
      result.value?.entries.forEach(entry => {
        expect(entry.category).toBe('consent');
      });
    });

    it('should filter by userId', async () => {
      const result = await store.query({
        userId: testUserId,
        limit: 100,
      });

      expect(result.ok).toBe(true);
      result.value?.entries.forEach(entry => {
        expect(entry.userId).toBe(testUserId);
      });
    });

    it('should filter by success', async () => {
      const result = await store.query({
        failedOnly: true,
        limit: 100,
      });

      expect(result.ok).toBe(true);
      result.value?.entries.forEach(entry => {
        expect(entry.success).toBe(false);
      });
    });
  });

  describe('getRecent', () => {
    it('should return recent entries', async () => {
      await store.append({
        timestamp: createTimestamp(),
        category: 'system',
        action: 'system.startup',
        severity: 'info',
        description: 'System started',
        success: true,
      });

      const result = await store.getRecent(10);

      expect(result.ok).toBe(true);
      expect(result.value?.length).toBeGreaterThan(0);
    });
  });

  describe('verifyIntegrity', () => {
    it('should verify intact chain', async () => {
      await store.append({
        timestamp: createTimestamp(),
        category: 'consent',
        action: 'consent.granted',
        severity: 'info',
        description: 'Entry 1',
        success: true,
      });

      await store.append({
        timestamp: createTimestamp(),
        category: 'consent',
        action: 'consent.revoked',
        severity: 'info',
        description: 'Entry 2',
        success: true,
      });

      const result = await store.verifyIntegrity();

      expect(result.ok).toBe(true);
      expect(result.value?.valid).toBe(true);
      expect(result.value?.entriesChecked).toBeGreaterThanOrEqual(2);
    });
  });

  describe('count', () => {
    it('should count entries', async () => {
      await store.append({
        timestamp: createTimestamp(),
        category: 'consent',
        action: 'consent.granted',
        severity: 'info',
        description: 'Entry',
        success: true,
      });

      const result = await store.count({});

      expect(result.ok).toBe(true);
      expect(result.value).toBeGreaterThanOrEqual(1);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT LOGGER TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('AuditLogger', () => {
  let store: AuditStore;
  let logger: AuditLogger;
  let mockKv: KeyValueStore;

  beforeEach(() => {
    mockKv = createMockStore();
    store = createAuditStore(mockKv);
    logger = createAuditLogger(store);
  });

  describe('logConsent', () => {
    it('should log consent granted', async () => {
      const result = await logger.logConsent(
        testUserId,
        'consent.granted',
        {
          purpose: 'analytics',
          granted: true,
          method: 'settings_toggle',
          policyVersion: '1.0.0',
        }
      );

      expect(result.ok).toBe(true);
      expect(result.value?.category).toBe('consent');
      expect(result.value?.action).toBe('consent.granted');
      expect(result.value?.details?.consent?.purpose).toBe('analytics');
    });

    it('should log consent revoked', async () => {
      const result = await logger.logConsent(
        testUserId,
        'consent.revoked',
        {
          purpose: 'marketing',
          granted: false,
        }
      );

      expect(result.ok).toBe(true);
      expect(result.value?.action).toBe('consent.revoked');
      expect(result.value?.details?.consent?.granted).toBe(false);
    });
  });

  describe('logDataAccess', () => {
    it('should log data export', async () => {
      const result = await logger.logDataAccess(
        testUserId,
        'data.exported',
        {
          categories: ['goals', 'quests'],
          recordCount: 42,
        }
      );

      expect(result.ok).toBe(true);
      expect(result.value?.action).toBe('data.exported');
      expect(result.value?.details?.data?.recordCount).toBe(42);
    });
  });

  describe('logDataDeletion', () => {
    it('should log deletion request', async () => {
      const result = await logger.logDataDeletion(
        testUserId,
        'data.deletion_requested',
        {}
      );

      expect(result.ok).toBe(true);
      expect(result.value?.action).toBe('data.deletion_requested');
      expect(result.value?.severity).toBe('warning');
    });

    it('should log data deleted', async () => {
      const result = await logger.logDataDeletion(
        testUserId,
        'data.deleted',
        {
          categories: ['goals', 'quests', 'steps'],
          recordCount: 150,
        }
      );

      expect(result.ok).toBe(true);
      expect(result.value?.action).toBe('data.deleted');
    });
  });

  describe('logSecurityEvent', () => {
    it('should log blocked request', async () => {
      const result = await logger.logSecurityEvent(
        'security.blocked',
        {
          userId: testUserId,
          reason: 'Suspicious pattern detected',
          rule: 'rate_limit_exceeded',
        }
      );

      expect(result.ok).toBe(true);
      expect(result.value?.category).toBe('security');
      expect(result.value?.severity).toBe('warning');
      expect(result.value?.success).toBe(false);
    });
  });

  describe('logAuth', () => {
    it('should log successful login', async () => {
      const result = await logger.logAuth(
        testUserId,
        'auth.login',
        { method: 'password' }
      );

      expect(result.ok).toBe(true);
      expect(result.value?.action).toBe('auth.login');
      expect(result.value?.success).toBe(true);
    });

    it('should log failed login', async () => {
      const result = await logger.logAuth(
        undefined,
        'auth.failed_login',
        { reason: 'Invalid credentials' }
      );

      expect(result.ok).toBe(true);
      expect(result.value?.action).toBe('auth.failed_login');
      expect(result.value?.success).toBe(false);
      expect(result.value?.severity).toBe('warning');
    });
  });

  describe('logRetention', () => {
    it('should log retention job completion', async () => {
      const result = await logger.logRetention(
        'retention.job_completed',
        {
          jobId: 'job_123',
          processed: 100,
          deleted: 50,
          archived: 25,
        }
      );

      expect(result.ok).toBe(true);
      expect(result.value?.action).toBe('retention.job_completed');
      expect(result.value?.details?.retention?.deleted).toBe(50);
    });
  });

  describe('logSystem', () => {
    it('should log system startup', async () => {
      const result = await logger.logSystem(
        'system.startup',
        {
          component: 'NovaOS',
          version: '1.0.0',
        }
      );

      expect(result.ok).toBe(true);
      expect(result.value?.action).toBe('system.startup');
      expect(result.value?.severity).toBe('info');
    });

    it('should log system error', async () => {
      const result = await logger.logSystem(
        'system.error',
        {
          component: 'SparkEngine',
          error: 'Connection timeout',
        }
      );

      expect(result.ok).toBe(true);
      expect(result.value?.action).toBe('system.error');
      expect(result.value?.severity).toBe('error');
      expect(result.value?.success).toBe(false);
    });
  });

  describe('logDataCreated/Updated', () => {
    it('should log data creation', async () => {
      const result = await logger.logDataCreated(
        testUserId,
        'goal',
        'goal_abc123'
      );

      expect(result.ok).toBe(true);
      expect(result.value?.entityType).toBe('goal');
      expect(result.value?.entityId).toBe('goal_abc123');
    });

    it('should log data update', async () => {
      const result = await logger.logDataUpdated(
        testUserId,
        'goal',
        'goal_abc123',
        { status: 'completed' }
      );

      expect(result.ok).toBe(true);
      expect(result.value?.action).toBe('data.updated');
    });
  });
});
