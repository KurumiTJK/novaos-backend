// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT STORE — Immutable Audit Log Storage
// NovaOS Compliance Layer — Phase 16
// ═══════════════════════════════════════════════════════════════════════════════
//
// GDPR Article 30 — Records of Processing Activities:
//   - Immutable append-only log
//   - Hash chain for tamper detection
//   - User and category indexing
//   - Query and reporting support
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { KeyValueStore } from '../../storage/index.js';
import { ok, err, type AsyncAppResult } from '../../types/result.js';
import type { UserId, Timestamp, AuditId } from '../../types/branded.js';
import { createTimestamp, createAuditId } from '../../types/branded.js';
import { AuditKeys } from '../keys.js';
import type {
  AuditEntry,
  AuditCategory,
  AuditAction,
  AuditSeverity,
  AuditDetails,
  AuditRequestMetadata,
  AuditQuery,
  AuditQueryResult,
  IAuditStore,
  IntegrityCheckResult,
} from './types.js';
import {
  AuditErrorCode,
  computeAuditEntryHash,
  verifyAuditEntryHash,
  getDefaultSeverity,
  getCategoryFromAction,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR HELPER
// ═══════════════════════════════════════════════════════════════════════════════

function auditError(
  code: string,
  message: string,
  context?: Record<string, unknown>
): { code: string; message: string; context?: Record<string, unknown> } {
  return { code, message, context };
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT STORE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Immutable audit log storage with hash chain integrity.
 *
 * Features:
 * - Append-only (no updates or deletes except retention)
 * - Hash chain for tamper detection
 * - Multiple indexes for efficient queries
 * - Sequence numbering for ordering
 */
export class AuditStore implements IAuditStore {
  private readonly store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // IAuditStore Implementation
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Append an audit entry.
   */
  async append(
    entry: Omit<AuditEntry, 'id' | 'entryHash' | 'previousHash'>
  ): AsyncAppResult<AuditEntry> {
    try {
      // Generate ID
      const id = createAuditId();

      // Get previous entry hash for chain
      const previousHash = await this.getLastEntryHash();

      // Create complete entry
      const completeEntry: Omit<AuditEntry, 'entryHash'> = {
        ...entry,
        id,
        previousHash,
      };

      // Compute hash
      const entryHash = computeAuditEntryHash(completeEntry, previousHash);

      const finalEntry: AuditEntry = {
        ...completeEntry,
        entryHash,
      };

      // Store entry
      const entryKey = AuditKeys.entry(id);
      await this.store.set(entryKey, JSON.stringify(finalEntry));

      // Update last entry reference
      await this.store.set(AuditKeys.lastEntryId(), id);

      // Add to global log (sorted by timestamp)
      const score = new Date(entry.timestamp).getTime();
      await this.store.zadd(AuditKeys.globalLog(), score, id);

      // Add to user log if applicable
      if (entry.userId) {
        await this.store.zadd(AuditKeys.userLog(entry.userId), score, id);
      }

      // Add to category log
      await this.store.zadd(AuditKeys.categoryLog(entry.category), score, id);

      // Increment sequence
      await this.store.incr(AuditKeys.sequenceCounter());

      return ok(finalEntry);
    } catch (error) {
      return err(
        auditError(
          AuditErrorCode.BACKEND_ERROR,
          `Failed to append audit entry: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * Get an entry by ID.
   */
  async get(auditId: AuditId): AsyncAppResult<AuditEntry | null> {
    try {
      const key = AuditKeys.entry(auditId);
      const data = await this.store.get(key);
      
      if (!data) {
        return ok(null);
      }

      return ok(JSON.parse(data) as AuditEntry);
    } catch (error) {
      return err(
        auditError(
          AuditErrorCode.BACKEND_ERROR,
          `Failed to get audit entry: ${error instanceof Error ? error.message : String(error)}`,
          { auditId }
        )
      );
    }
  }

  /**
   * Query audit entries.
   */
  async query(query: AuditQuery): AsyncAppResult<AuditQueryResult> {
    try {
      const {
        userId,
        targetUserId,
        category,
        action,
        severity,
        entityType,
        entityId,
        fromTimestamp,
        toTimestamp,
        successOnly,
        failedOnly,
        searchText,
        limit = 100,
        offset = 0,
        sortOrder = 'desc',
      } = query;

      // Determine which index to use
      let indexKey: string;
      if (userId) {
        indexKey = AuditKeys.userLog(userId);
      } else if (category) {
        indexKey = AuditKeys.categoryLog(category);
      } else {
        indexKey = AuditKeys.globalLog();
      }

      // Get time range scores
      const minScore = fromTimestamp ? new Date(fromTimestamp).getTime() : '-inf';
      const maxScore = toTimestamp ? new Date(toTimestamp).getTime() : '+inf';

      // Get entry IDs from index
      let entryIds: string[];
      if (sortOrder === 'desc') {
        entryIds = await this.store.zrevrangebyscore(
          indexKey,
          maxScore as any,
          minScore as any,
          { limit: { offset, count: limit * 2 } } // Over-fetch for filtering
        );
      } else {
        entryIds = await this.store.zrangebyscore(
          indexKey,
          minScore as any,
          maxScore as any,
          { limit: { offset, count: limit * 2 } }
        );
      }

      // Fetch and filter entries
      const entries: AuditEntry[] = [];
      for (const id of entryIds) {
        if (entries.length >= limit) break;

        const result = await this.get(id as AuditId);
        if (!result.ok || !result.value) continue;

        const entry = result.value;

        // Apply filters
        if (targetUserId && entry.targetUserId !== targetUserId) continue;
        if (category && entry.category !== category) continue;
        if (action && entry.action !== action) continue;
        if (severity && entry.severity !== severity) continue;
        if (entityType && entry.entityType !== entityType) continue;
        if (entityId && entry.entityId !== entityId) continue;
        if (successOnly && !entry.success) continue;
        if (failedOnly && entry.success) continue;
        if (searchText && !this.matchesSearch(entry, searchText)) continue;

        entries.push(entry);
      }

      // Get total count (approximate for large datasets)
      const totalCount = await this.store.zcard(indexKey);

      return ok({
        entries,
        totalCount,
        hasMore: entries.length === limit,
        query,
      });
    } catch (error) {
      return err(
        auditError(
          AuditErrorCode.BACKEND_ERROR,
          `Failed to query audit entries: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * Get entries for a user.
   */
  async getByUser(
    userId: UserId,
    options?: { limit?: number; fromTimestamp?: Timestamp }
  ): AsyncAppResult<readonly AuditEntry[]> {
    const { limit = 100, fromTimestamp } = options ?? {};

    const result = await this.query({
      userId,
      fromTimestamp,
      limit,
      sortOrder: 'desc',
    });

    if (!result.ok) {
      return err(result.error);
    }

    return ok(result.value.entries);
  }

  /**
   * Get recent entries.
   */
  async getRecent(limit: number = 50): AsyncAppResult<readonly AuditEntry[]> {
    try {
      const entryIds = await this.store.zrevrange(AuditKeys.globalLog(), 0, limit - 1);

      const entries: AuditEntry[] = [];
      for (const id of entryIds) {
        const result = await this.get(id as AuditId);
        if (result.ok && result.value) {
          entries.push(result.value);
        }
      }

      return ok(entries);
    } catch (error) {
      return err(
        auditError(
          AuditErrorCode.BACKEND_ERROR,
          `Failed to get recent entries: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * Count entries matching query.
   */
  async count(query: Omit<AuditQuery, 'limit' | 'offset'>): AsyncAppResult<number> {
    // For simple counts, use index cardinality
    if (!query.userId && !query.category && !query.fromTimestamp && !query.toTimestamp) {
      try {
        const count = await this.store.zcard(AuditKeys.globalLog());
        return ok(count);
      } catch (error) {
        return err(
          auditError(
            AuditErrorCode.BACKEND_ERROR,
            `Failed to count entries: ${error instanceof Error ? error.message : String(error)}`
          )
        );
      }
    }

    // For filtered counts, we need to query (expensive for large datasets)
    const result = await this.query({ ...query, limit: 10000 });
    if (!result.ok) {
      return err(result.error);
    }

    return ok(result.value.entries.length);
  }

  /**
   * Verify integrity of audit chain.
   */
  async verifyIntegrity(options?: {
    fromId?: AuditId;
    limit?: number;
  }): AsyncAppResult<IntegrityCheckResult> {
    const { limit = 1000 } = options ?? {};

    try {
      // Get entries in order
      let entryIds: string[];
      if (options?.fromId) {
        // Start from specific ID - get its score first
        const entry = await this.get(options.fromId);
        if (!entry.ok || !entry.value) {
          return ok({
            valid: false,
            entriesChecked: 0,
            brokenAtId: options.fromId,
            error: 'Starting entry not found',
          });
        }
        const score = new Date(entry.value.timestamp).getTime();
        entryIds = await this.store.zrangebyscore(
          AuditKeys.globalLog(),
          score,
          '+inf' as any,
          { limit: { offset: 0, count: limit } }
        );
      } else {
        entryIds = await this.store.zrange(AuditKeys.globalLog(), 0, limit - 1);
      }

      let entriesChecked = 0;
      let previousHash: string | undefined;

      for (const id of entryIds) {
        const result = await this.get(id as AuditId);
        if (!result.ok || !result.value) {
          return ok({
            valid: false,
            entriesChecked,
            brokenAtId: id as AuditId,
            error: 'Entry not found',
          });
        }

        const entry = result.value;

        // Verify hash chain
        if (entriesChecked > 0 && entry.previousHash !== previousHash) {
          return ok({
            valid: false,
            entriesChecked,
            brokenAtId: entry.id,
            error: 'Hash chain broken: previousHash mismatch',
          });
        }

        // Verify entry hash
        if (!verifyAuditEntryHash(entry)) {
          return ok({
            valid: false,
            entriesChecked,
            brokenAtId: entry.id,
            error: 'Entry hash verification failed',
          });
        }

        previousHash = entry.entryHash;
        entriesChecked++;
      }

      return ok({
        valid: true,
        entriesChecked,
      });
    } catch (error) {
      return err(
        auditError(
          AuditErrorCode.BACKEND_ERROR,
          `Failed to verify integrity: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * Delete entries for retention (only method that can delete).
   */
  async deleteForRetention(beforeTimestamp: Timestamp): AsyncAppResult<number> {
    try {
      const maxScore = new Date(beforeTimestamp).getTime();

      // Get entries to delete
      const entryIds = await this.store.zrangebyscore(
        AuditKeys.globalLog(),
        '-inf' as any,
        maxScore,
        { limit: { offset: 0, count: 10000 } }
      );

      let deleted = 0;

      for (const id of entryIds) {
        // Get entry for user/category info
        const entry = await this.get(id as AuditId);
        if (!entry.ok || !entry.value) continue;

        // Remove from indexes
        await this.store.zrem(AuditKeys.globalLog(), id);
        
        if (entry.value.userId) {
          await this.store.zrem(AuditKeys.userLog(entry.value.userId), id);
        }
        
        await this.store.zrem(AuditKeys.categoryLog(entry.value.category), id);

        // Delete entry
        await this.store.delete(AuditKeys.entry(id as AuditId));

        deleted++;
      }

      return ok(deleted);
    } catch (error) {
      return err(
        auditError(
          AuditErrorCode.BACKEND_ERROR,
          `Failed to delete for retention: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ADDITIONAL METHODS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get the current sequence number.
   */
  async getSequence(): AsyncAppResult<number> {
    try {
      const seq = await this.store.get(AuditKeys.sequenceCounter());
      return ok(seq ? parseInt(seq, 10) : 0);
    } catch (error) {
      return err(
        auditError(
          AuditErrorCode.BACKEND_ERROR,
          `Failed to get sequence: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * Get entries by category.
   */
  async getByCategory(
    category: AuditCategory,
    options?: { limit?: number; fromTimestamp?: Timestamp }
  ): AsyncAppResult<readonly AuditEntry[]> {
    const result = await this.query({
      category,
      fromTimestamp: options?.fromTimestamp,
      limit: options?.limit ?? 100,
      sortOrder: 'desc',
    });

    if (!result.ok) {
      return err(result.error);
    }

    return ok(result.value.entries);
  }

  /**
   * Get entries by action.
   */
  async getByAction(
    action: AuditAction,
    options?: { limit?: number }
  ): AsyncAppResult<readonly AuditEntry[]> {
    const category = getCategoryFromAction(action);
    const result = await this.query({
      category,
      action,
      limit: options?.limit ?? 100,
      sortOrder: 'desc',
    });

    if (!result.ok) {
      return err(result.error);
    }

    return ok(result.value.entries);
  }

  /**
   * Delete all audit data for a user.
   */
  async deleteByUser(userId: UserId): AsyncAppResult<number> {
    try {
      const indexKey = AuditKeys.userLog(userId);
      const entryIds = await this.store.zrange(indexKey, 0, -1);

      let deleted = 0;

      for (const id of entryIds) {
        const entry = await this.get(id as AuditId);
        if (!entry.ok || !entry.value) continue;

        // Remove from global and category indexes
        await this.store.zrem(AuditKeys.globalLog(), id);
        await this.store.zrem(AuditKeys.categoryLog(entry.value.category), id);

        // Delete entry
        await this.store.delete(AuditKeys.entry(id as AuditId));

        deleted++;
      }

      // Delete user index
      await this.store.delete(indexKey);

      return ok(deleted);
    } catch (error) {
      return err(
        auditError(
          AuditErrorCode.BACKEND_ERROR,
          `Failed to delete user audit data: ${error instanceof Error ? error.message : String(error)}`,
          { userId }
        )
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get hash of the last entry for chain linking.
   */
  private async getLastEntryHash(): Promise<string | undefined> {
    try {
      const lastId = await this.store.get(AuditKeys.lastEntryId());
      if (!lastId) {
        return undefined;
      }

      const entry = await this.get(lastId as AuditId);
      if (!entry.ok || !entry.value) {
        return undefined;
      }

      return entry.value.entryHash;
    } catch {
      return undefined;
    }
  }

  /**
   * Check if entry matches search text.
   */
  private matchesSearch(entry: AuditEntry, searchText: string): boolean {
    const lower = searchText.toLowerCase();
    
    if (entry.description.toLowerCase().includes(lower)) return true;
    if (entry.action.toLowerCase().includes(lower)) return true;
    if (entry.category.toLowerCase().includes(lower)) return true;
    if (entry.entityType?.toLowerCase().includes(lower)) return true;
    if (entry.entityId?.toLowerCase().includes(lower)) return true;
    if (entry.errorMessage?.toLowerCase().includes(lower)) return true;

    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create an AuditStore instance.
 */
export function createAuditStore(store: KeyValueStore): AuditStore {
  return new AuditStore(store);
}
