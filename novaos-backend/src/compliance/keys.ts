// ═══════════════════════════════════════════════════════════════════════════════
// COMPLIANCE KEYS — Redis Keys for GDPR Compliance
// NovaOS Compliance Layer — Phase 16
// ═══════════════════════════════════════════════════════════════════════════════
//
// Key builders for compliance-related entities:
//   - Consent tracking
//   - Audit logs
//   - Data subject requests
//   - Retention tracking
//
// ═══════════════════════════════════════════════════════════════════════════════

import { buildKey, buildPattern } from '../infrastructure/redis/keys.js';
import type { UserId, AuditId } from '../../../types/branded.js';
import type { ExportRequestId, DeletionRequestId, ArchiveId } from '../data-subject/types.js';
import type { RetentionJobId } from '../retention/types.js';
import type { ConsentHistoryId } from '../consent/types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// NAMESPACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compliance namespace for Redis keys.
 */
export const ComplianceNamespace = 'gdpr' as const;

// ═══════════════════════════════════════════════════════════════════════════════
// CONSENT KEYS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Key builders for consent tracking.
 */
export const ConsentKeys = {
  /**
   * Current consent state for a user.
   * Key: gdpr:consent:{userId}
   */
  consent(userId: UserId): string {
    return buildKey(ComplianceNamespace, 'consent', userId);
  },

  /**
   * Consent history list for a user (sorted set by timestamp).
   * Key: gdpr:consent:{userId}:history
   */
  consentHistory(userId: UserId): string {
    return buildKey(ComplianceNamespace, 'consent', userId, 'history');
  },

  /**
   * Individual consent record.
   * Key: gdpr:consent:record:{recordId}
   */
  consentRecord(recordId: ConsentHistoryId): string {
    return buildKey(ComplianceNamespace, 'consent', 'record', recordId);
  },

  /**
   * Index of users by consent purpose (for bulk queries).
   * Key: gdpr:consent:purpose:{purpose}
   */
  purposeIndex(purpose: string): string {
    return buildKey(ComplianceNamespace, 'consent', 'purpose', purpose);
  },

  /**
   * Pattern to match all consent data for a user.
   */
  userConsentPattern(userId: UserId): string {
    return buildPattern(ComplianceNamespace, 'consent', userId, '*');
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT LOG KEYS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Key builders for audit logging.
 */
export const AuditKeys = {
  /**
   * Individual audit entry.
   * Key: gdpr:audit:{auditId}
   */
  entry(auditId: AuditId): string {
    return buildKey(ComplianceNamespace, 'audit', auditId);
  },

  /**
   * Global audit log (sorted set by timestamp).
   * Key: gdpr:audit:log
   */
  globalLog(): string {
    return buildKey(ComplianceNamespace, 'audit', 'log');
  },

  /**
   * User's audit log index (sorted set by timestamp).
   * Key: gdpr:audit:user:{userId}
   */
  userLog(userId: UserId): string {
    return buildKey(ComplianceNamespace, 'audit', 'user', userId);
  },

  /**
   * Audit entries by category (sorted set).
   * Key: gdpr:audit:category:{category}
   */
  categoryLog(category: string): string {
    return buildKey(ComplianceNamespace, 'audit', 'category', category);
  },

  /**
   * Last entry ID (for hash chain).
   * Key: gdpr:audit:last
   */
  lastEntryId(): string {
    return buildKey(ComplianceNamespace, 'audit', 'last');
  },

  /**
   * Audit sequence counter.
   * Key: gdpr:audit:seq
   */
  sequenceCounter(): string {
    return buildKey(ComplianceNamespace, 'audit', 'seq');
  },

  /**
   * Pattern to match all audit entries.
   */
  allEntriesPattern(): string {
    return buildPattern(ComplianceNamespace, 'audit', '*');
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// DATA SUBJECT REQUEST KEYS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Key builders for data subject requests (export/deletion).
 */
export const DataSubjectKeys = {
  // ─────────────────────────────────────────────────────────────────────────────
  // Export Requests
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Export request entity.
   * Key: gdpr:export:{requestId}
   */
  exportRequest(requestId: ExportRequestId): string {
    return buildKey(ComplianceNamespace, 'export', requestId);
  },

  /**
   * User's export requests (sorted set by timestamp).
   * Key: gdpr:export:user:{userId}
   */
  userExportRequests(userId: UserId): string {
    return buildKey(ComplianceNamespace, 'export', 'user', userId);
  },

  /**
   * Pending export requests queue.
   * Key: gdpr:export:pending
   */
  pendingExports(): string {
    return buildKey(ComplianceNamespace, 'export', 'pending');
  },

  /**
   * Export download token (temporary).
   * Key: gdpr:export:token:{token}
   */
  exportToken(token: string): string {
    return buildKey(ComplianceNamespace, 'export', 'token', token);
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Deletion Requests
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Deletion request entity.
   * Key: gdpr:delete:{requestId}
   */
  deletionRequest(requestId: DeletionRequestId): string {
    return buildKey(ComplianceNamespace, 'delete', requestId);
  },

  /**
   * User's deletion requests (sorted set by timestamp).
   * Key: gdpr:delete:user:{userId}
   */
  userDeletionRequests(userId: UserId): string {
    return buildKey(ComplianceNamespace, 'delete', 'user', userId);
  },

  /**
   * Pending deletion requests queue.
   * Key: gdpr:delete:pending
   */
  pendingDeletions(): string {
    return buildKey(ComplianceNamespace, 'delete', 'pending');
  },

  /**
   * Deletion verification token.
   * Key: gdpr:delete:verify:{token}
   */
  verificationToken(token: string): string {
    return buildKey(ComplianceNamespace, 'delete', 'verify', token);
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Archives
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Archive entity.
   * Key: gdpr:archive:{archiveId}
   */
  archive(archiveId: ArchiveId): string {
    return buildKey(ComplianceNamespace, 'archive', archiveId);
  },

  /**
   * User's archives (sorted set by timestamp).
   * Key: gdpr:archive:user:{userId}
   */
  userArchives(userId: UserId): string {
    return buildKey(ComplianceNamespace, 'archive', 'user', userId);
  },

  /**
   * Archive expiration index (sorted set by expiry time).
   * Key: gdpr:archive:expiry
   */
  archiveExpiry(): string {
    return buildKey(ComplianceNamespace, 'archive', 'expiry');
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// RETENTION KEYS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Key builders for retention enforcement.
 */
export const RetentionKeys = {
  /**
   * Retention job entity.
   * Key: gdpr:retention:{jobId}
   */
  job(jobId: RetentionJobId): string {
    return buildKey(ComplianceNamespace, 'retention', jobId);
  },

  /**
   * Recent retention jobs (sorted set by timestamp).
   * Key: gdpr:retention:jobs
   */
  recentJobs(): string {
    return buildKey(ComplianceNamespace, 'retention', 'jobs');
  },

  /**
   * Active retention job lock.
   * Key: gdpr:retention:lock
   */
  jobLock(): string {
    return buildKey(ComplianceNamespace, 'retention', 'lock');
  },

  /**
   * Last run timestamp per category.
   * Key: gdpr:retention:lastrun:{category}
   */
  lastRun(category: string): string {
    return buildKey(ComplianceNamespace, 'retention', 'lastrun', category);
  },

  /**
   * Retention candidates queue for a category.
   * Key: gdpr:retention:queue:{category}
   */
  candidateQueue(category: string): string {
    return buildKey(ComplianceNamespace, 'retention', 'queue', category);
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// ALL COMPLIANCE KEYS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * All compliance key builders.
 */
export const ComplianceKeys = {
  Consent: ConsentKeys,
  Audit: AuditKeys,
  DataSubject: DataSubjectKeys,
  Retention: RetentionKeys,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// PATTERNS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Common patterns for compliance data.
 */
export const CompliancePatterns = {
  /**
   * All compliance data.
   */
  all(): string {
    return buildPattern(ComplianceNamespace, '*');
  },

  /**
   * All consent data.
   */
  allConsent(): string {
    return buildPattern(ComplianceNamespace, 'consent', '*');
  },

  /**
   * All audit data.
   */
  allAudit(): string {
    return buildPattern(ComplianceNamespace, 'audit', '*');
  },

  /**
   * All export data.
   */
  allExports(): string {
    return buildPattern(ComplianceNamespace, 'export', '*');
  },

  /**
   * All deletion data.
   */
  allDeletions(): string {
    return buildPattern(ComplianceNamespace, 'delete', '*');
  },

  /**
   * All archive data.
   */
  allArchives(): string {
    return buildPattern(ComplianceNamespace, 'archive', '*');
  },

  /**
   * All retention data.
   */
  allRetention(): string {
    return buildPattern(ComplianceNamespace, 'retention', '*');
  },

  /**
   * All compliance data for a user.
   */
  userComplianceData(userId: UserId): string[] {
    return [
      ConsentKeys.userConsentPattern(userId),
      buildPattern(ComplianceNamespace, 'audit', 'user', userId, '*'),
      buildPattern(ComplianceNamespace, 'export', 'user', userId, '*'),
      buildPattern(ComplianceNamespace, 'delete', 'user', userId, '*'),
      buildPattern(ComplianceNamespace, 'archive', 'user', userId, '*'),
    ];
  },
} as const;
