// ═══════════════════════════════════════════════════════════════════════════════
// RETENTION TESTS — Unit Tests for Retention Policy & Enforcement
// NovaOS Compliance Layer — Phase 16
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RetentionPolicyManager,
  createRetentionPolicyManager,
} from '../retention/policy-manager.js';
import {
  RetentionEnforcer,
  createRetentionEnforcer,
} from '../retention/enforcer.js';
import type { CategoryRegistry, CandidateFinder, CategoryProcessor } from '../retention/enforcer.js';
import type { KeyValueStore } from '../../../storage/index.js';
import type { Timestamp } from '../../types/branded.js';
import { createTimestamp } from '../../types/branded.js';
import type { RetentionPolicy, RetentionCategory } from '../retention/types.js';
import {
  DEFAULT_RETENTION_POLICIES,
  ALL_RETENTION_CATEGORIES,
  isPastRetention,
  daysPastRetention,
} from '../retention/types.js';
import { ok } from '../../types/result.js';

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK STORE
// ═══════════════════════════════════════════════════════════════════════════════

function createMockStore(): KeyValueStore {
  const data = new Map<string, string>();
  const sortedSets = new Map<string, Map<string, number>>();

  return {
    get: vi.fn(async (key: string) => data.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      data.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      return data.delete(key);
    }),
    zadd: vi.fn(async (key: string, score: number, member: string) => {
      if (!sortedSets.has(key)) sortedSets.set(key, new Map());
      sortedSets.get(key)!.set(member, score);
      return 1;
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
    zremrangebyrank: vi.fn(async () => 0),
  } as unknown as KeyValueStore;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RETENTION POLICY MANAGER TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('RetentionPolicyManager', () => {
  let manager: RetentionPolicyManager;

  beforeEach(() => {
    manager = createRetentionPolicyManager();
  });

  describe('default policies', () => {
    it('should load default policies', () => {
      const policies = manager.getAllPolicies();
      
      expect(policies.length).toBe(DEFAULT_RETENTION_POLICIES.length);
    });

    it('should have policy for each category', () => {
      for (const category of ALL_RETENTION_CATEGORIES) {
        const policy = manager.getPolicy(category);
        expect(policy).toBeDefined();
        expect(policy?.category).toBe(category);
      }
    });
  });

  describe('getPolicy', () => {
    it('should return policy for valid category', () => {
      const policy = manager.getPolicy('completedGoals');
      
      expect(policy).toBeDefined();
      expect(policy?.category).toBe('completedGoals');
      expect(policy?.retentionDays).toBe(365);
    });

    it('should return undefined for unknown category', () => {
      const policy = manager.getPolicy('unknownCategory' as RetentionCategory);
      
      expect(policy).toBeUndefined();
    });
  });

  describe('getEnabledPolicies', () => {
    it('should return only enabled policies', () => {
      const enabled = manager.getEnabledPolicies();
      
      enabled.forEach(policy => {
        expect(policy.enabled).toBe(true);
      });
    });
  });

  describe('getPoliciesByAction', () => {
    it('should filter by delete action', () => {
      const deletePolicies = manager.getPoliciesByAction('delete');
      
      deletePolicies.forEach(policy => {
        expect(policy.action).toBe('delete');
      });
    });

    it('should filter by archive action', () => {
      const archivePolicies = manager.getPoliciesByAction('archive');
      
      archivePolicies.forEach(policy => {
        expect(policy.action).toBe('archive');
      });
    });
  });

  describe('setPolicy', () => {
    it('should override existing policy', () => {
      const customPolicy: RetentionPolicy = {
        category: 'completedGoals',
        retentionDays: 180,
        action: 'delete',
        archiveBeforeDelete: false,
        enabled: true,
        description: 'Custom policy',
        legalBasis: 'Custom legal basis',
      };

      manager.setPolicy(customPolicy);
      const policy = manager.getPolicy('completedGoals');

      expect(policy?.retentionDays).toBe(180);
      expect(policy?.action).toBe('delete');
    });
  });

  describe('enablePolicy/disablePolicy', () => {
    it('should enable a policy', () => {
      manager.disablePolicy('completedGoals');
      expect(manager.getPolicy('completedGoals')?.enabled).toBe(false);

      manager.enablePolicy('completedGoals');
      expect(manager.getPolicy('completedGoals')?.enabled).toBe(true);
    });

    it('should disable a policy', () => {
      manager.disablePolicy('abandonedGoals');
      
      expect(manager.getPolicy('abandonedGoals')?.enabled).toBe(false);
    });
  });

  describe('setRetentionDays', () => {
    it('should update retention days', () => {
      manager.setRetentionDays('completedGoals', 730);
      
      expect(manager.getRetentionDays('completedGoals')).toBe(730);
    });

    it('should return false for unknown category', () => {
      const result = manager.setRetentionDays('unknown' as RetentionCategory, 100);
      
      expect(result).toBe(false);
    });
  });

  describe('requiresArchive', () => {
    it('should return true for policies with archiveBeforeDelete', () => {
      expect(manager.requiresArchive('completedGoals')).toBe(true);
      expect(manager.requiresArchive('consentHistory')).toBe(true);
    });

    it('should return false for policies without archiveBeforeDelete', () => {
      expect(manager.requiresArchive('abandonedGoals')).toBe(false);
      expect(manager.requiresArchive('expiredReminders')).toBe(false);
    });
  });

  describe('validateComplete', () => {
    it('should be valid with default policies', () => {
      const result = manager.validateComplete();
      
      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });
  });

  describe('getSummary', () => {
    it('should return summary statistics', () => {
      const summary = manager.getSummary();
      
      expect(summary.totalPolicies).toBe(DEFAULT_RETENTION_POLICIES.length);
      expect(summary.enabledPolicies).toBeGreaterThan(0);
      expect(summary.byAction.delete).toBeGreaterThan(0);
      expect(summary.byAction.archive).toBeGreaterThan(0);
    });
  });

  describe('custom policies', () => {
    it('should accept custom policies in constructor', () => {
      const customPolicies: RetentionPolicy[] = [
        {
          category: 'completedGoals',
          retentionDays: 180,
          action: 'delete',
          archiveBeforeDelete: false,
          enabled: true,
          description: 'Custom',
          legalBasis: 'Custom',
        },
      ];

      const customManager = createRetentionPolicyManager(customPolicies);
      const policy = customManager.getPolicy('completedGoals');

      expect(policy?.retentionDays).toBe(180);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RETENTION HELPER FUNCTION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Retention Helper Functions', () => {
  describe('isPastRetention', () => {
    it('should return false for recent timestamp', () => {
      const now = createTimestamp();
      
      expect(isPastRetention(now, 30)).toBe(false);
    });

    it('should return true for old timestamp', () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100);
      const oldTimestamp = oldDate.toISOString() as Timestamp;
      
      expect(isPastRetention(oldTimestamp, 30)).toBe(true);
    });

    it('should handle edge case at retention boundary', () => {
      const exactlyAtRetention = new Date();
      exactlyAtRetention.setDate(exactlyAtRetention.getDate() - 30);
      const timestamp = exactlyAtRetention.toISOString() as Timestamp;
      
      // At exactly 30 days, should be past retention
      expect(isPastRetention(timestamp, 30)).toBe(true);
    });
  });

  describe('daysPastRetention', () => {
    it('should return 0 for non-expired timestamp', () => {
      const now = createTimestamp();
      
      expect(daysPastRetention(now, 30)).toBe(0);
    });

    it('should return positive number for expired timestamp', () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 50);
      const oldTimestamp = oldDate.toISOString() as Timestamp;
      
      const days = daysPastRetention(oldTimestamp, 30);
      expect(days).toBeGreaterThanOrEqual(19);
      expect(days).toBeLessThanOrEqual(21);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RETENTION ENFORCER TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('RetentionEnforcer', () => {
  let enforcer: RetentionEnforcer;
  let policyManager: RetentionPolicyManager;
  let mockKv: KeyValueStore;
  let mockRegistry: CategoryRegistry;
  let mockDeleteFn: ReturnType<typeof vi.fn>;
  let mockArchiveFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockKv = createMockStore();
    policyManager = createRetentionPolicyManager();
    
    mockDeleteFn = vi.fn().mockResolvedValue(ok(true));
    mockArchiveFn = vi.fn().mockResolvedValue(ok(true));

    // Create mock registry with test data
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 400); // Past 365 day retention

    mockRegistry = {
      finders: {
        completedGoals: {
          findCandidates: vi.fn().mockResolvedValue(ok([
            {
              entityId: 'goal_1',
              userId: 'user_1',
              timestamp: oldDate.toISOString() as Timestamp,
            },
            {
              entityId: 'goal_2',
              userId: 'user_2',
              timestamp: oldDate.toISOString() as Timestamp,
            },
          ])),
        },
        abandonedGoals: {
          findCandidates: vi.fn().mockResolvedValue(ok([])),
        },
      },
      processors: {
        completedGoals: {
          delete: mockDeleteFn,
          archive: mockArchiveFn,
        },
        abandonedGoals: {
          delete: mockDeleteFn,
        },
      },
    };

    enforcer = createRetentionEnforcer(mockKv, policyManager, mockRegistry);
  });

  describe('getPolicies', () => {
    it('should return all policies', () => {
      const policies = enforcer.getPolicies();
      
      expect(policies.length).toBe(DEFAULT_RETENTION_POLICIES.length);
    });
  });

  describe('getPolicy', () => {
    it('should return policy for category', () => {
      const policy = enforcer.getPolicy('completedGoals');
      
      expect(policy).toBeDefined();
      expect(policy?.category).toBe('completedGoals');
    });
  });

  describe('findCandidates', () => {
    it('should find candidates past retention', async () => {
      const result = await enforcer.findCandidates('completedGoals');
      
      expect(result.ok).toBe(true);
      expect(result.value?.length).toBe(2);
    });

    it('should return empty for disabled policy', async () => {
      policyManager.disablePolicy('completedGoals');
      
      const result = await enforcer.findCandidates('completedGoals');
      
      expect(result.ok).toBe(true);
      expect(result.value).toHaveLength(0);
    });

    it('should return empty for category without finder', async () => {
      const result = await enforcer.findCandidates('sessions');
      
      expect(result.ok).toBe(true);
      expect(result.value).toHaveLength(0);
    });

    it('should return error for unknown category', async () => {
      const result = await enforcer.findCandidates('unknown' as RetentionCategory);
      
      expect(result.ok).toBe(false);
    });
  });

  describe('processCandidate', () => {
    it('should process candidate with delete action', async () => {
      const candidate = {
        category: 'abandonedGoals' as RetentionCategory,
        entityId: 'goal_1',
        userId: 'user_1' as any,
        timestamp: createTimestamp(),
        daysPastRetention: 10,
        policy: policyManager.getPolicy('abandonedGoals')!,
      };

      const result = await enforcer.processCandidate(candidate);
      
      expect(result.ok).toBe(true);
      expect(result.value?.action).toBe('delete');
      expect(result.value?.success).toBe(true);
      expect(mockDeleteFn).toHaveBeenCalledWith('goal_1');
    });

    it('should archive before delete if required', async () => {
      const candidate = {
        category: 'completedGoals' as RetentionCategory,
        entityId: 'goal_1',
        userId: 'user_1' as any,
        timestamp: createTimestamp(),
        daysPastRetention: 10,
        policy: policyManager.getPolicy('completedGoals')!, // Has archiveBeforeDelete
      };

      const result = await enforcer.processCandidate(candidate);
      
      expect(result.ok).toBe(true);
      // For 'archive' action, should call archive
      expect(mockArchiveFn).toHaveBeenCalledWith('goal_1');
    });

    it('should not execute in dry run mode', async () => {
      const candidate = {
        category: 'abandonedGoals' as RetentionCategory,
        entityId: 'goal_1',
        userId: 'user_1' as any,
        timestamp: createTimestamp(),
        daysPastRetention: 10,
        policy: policyManager.getPolicy('abandonedGoals')!,
      };

      const result = await enforcer.processCandidate(candidate, true);
      
      expect(result.ok).toBe(true);
      expect(result.value?.success).toBe(true);
      expect(mockDeleteFn).not.toHaveBeenCalled();
    });
  });

  describe('runEnforcement', () => {
    it('should run enforcement across categories', async () => {
      const result = await enforcer.runEnforcement({
        categories: ['completedGoals', 'abandonedGoals'],
        dryRun: true,
      });
      
      expect(result.ok).toBe(true);
      expect(result.value?.totalProcessed).toBeGreaterThanOrEqual(0);
    });

    it('should respect dry run mode', async () => {
      const result = await enforcer.runEnforcement({
        categories: ['completedGoals'],
        dryRun: true,
      });
      
      expect(result.ok).toBe(true);
      // In dry run, no actual deletes should happen
      expect(mockDeleteFn).not.toHaveBeenCalled();
    });
  });

  describe('scheduleJob', () => {
    it('should create a pending job', async () => {
      const result = await enforcer.scheduleJob(['completedGoals', 'abandonedGoals']);
      
      expect(result.ok).toBe(true);
      expect(result.value?.id).toBeDefined();
      expect(result.value?.status).toBe('pending');
      expect(result.value?.categories).toContain('completedGoals');
    });
  });

  describe('getJob', () => {
    it('should return null for non-existent job', async () => {
      const result = await enforcer.getJob('job_nonexistent' as any);
      
      expect(result.ok).toBe(true);
      expect(result.value).toBeNull();
    });

    it('should return scheduled job', async () => {
      const scheduled = await enforcer.scheduleJob(['completedGoals']);
      expect(scheduled.ok).toBe(true);

      const result = await enforcer.getJob(scheduled.value!.id);
      
      expect(result.ok).toBe(true);
      expect(result.value?.id).toBe(scheduled.value?.id);
    });
  });

  describe('isRunning', () => {
    it('should return false when not running', () => {
      expect(enforcer.isRunning()).toBe(false);
    });
  });
});
