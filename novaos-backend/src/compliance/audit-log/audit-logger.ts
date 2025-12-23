// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT LOGGER — High-Level Audit Logging API
// NovaOS Compliance Layer — Phase 16
// ═══════════════════════════════════════════════════════════════════════════════
//
// Convenient API for logging audit events:
//   - Type-safe logging methods for each category
//   - Automatic timestamp and severity
//   - Request metadata extraction
//
// ═══════════════════════════════════════════════════════════════════════════════

import { ok, err, type AsyncAppResult } from '../../types/result.js';
import type { UserId, Timestamp } from '../../types/branded.js';
import { createTimestamp } from '../../types/branded.js';
import type {
  AuditEntry,
  AuditCategory,
  AuditAction,
  AuditSeverity,
  AuditDetails,
  AuditRequestMetadata,
  IAuditLogger,
  IAuditStore,
} from './types.js';
import { getDefaultSeverity, getCategoryFromAction } from './types.js';
import type { ConsentPurpose } from '../consent/types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT LOGGER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * High-level audit logger for application use.
 */
export class AuditLogger implements IAuditLogger {
  private readonly store: IAuditStore;

  constructor(store: IAuditStore) {
    this.store = store;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CONSENT LOGGING
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Log a consent action.
   */
  async logConsent(
    userId: UserId,
    action: 'consent.granted' | 'consent.revoked' | 'consent.updated',
    details: {
      purpose: ConsentPurpose;
      granted: boolean;
      method?: string;
      policyVersion?: string;
    },
    request?: AuditRequestMetadata
  ): AsyncAppResult<AuditEntry> {
    const description = details.granted
      ? `User granted consent for ${details.purpose}`
      : `User revoked consent for ${details.purpose}`;

    return this.log('consent', action, {
      userId,
      description,
      details: {
        consent: {
          purpose: details.purpose,
          granted: details.granted,
          method: details.method,
          policyVersion: details.policyVersion,
        },
      },
      request,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DATA ACCESS LOGGING
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Log a data access action.
   */
  async logDataAccess(
    userId: UserId,
    action: 'data.exported' | 'data.viewed' | 'data.downloaded',
    details: {
      categories?: readonly string[];
      recordCount?: number;
    },
    request?: AuditRequestMetadata
  ): AsyncAppResult<AuditEntry> {
    const actionDescriptions: Record<string, string> = {
      'data.exported': 'User exported personal data',
      'data.viewed': 'User viewed personal data',
      'data.downloaded': 'User downloaded personal data',
    };

    return this.log('dataAccess', action, {
      userId,
      description: actionDescriptions[action] ?? 'Data access',
      details: {
        data: {
          categories: details.categories as string[] | undefined,
          recordCount: details.recordCount,
        },
      },
      request,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DATA DELETION LOGGING
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Log a data deletion action.
   */
  async logDataDeletion(
    userId: UserId,
    action: 'data.deletion_requested' | 'data.deletion_verified' | 'data.deleted' | 'data.archived',
    details: {
      categories?: readonly string[];
      recordCount?: number;
    },
    request?: AuditRequestMetadata
  ): AsyncAppResult<AuditEntry> {
    const actionDescriptions: Record<string, string> = {
      'data.deletion_requested': 'User requested data deletion',
      'data.deletion_verified': 'User verified deletion request',
      'data.deleted': 'User data deleted',
      'data.archived': 'User data archived before deletion',
    };

    return this.log('dataDeletion', action, {
      userId,
      description: actionDescriptions[action] ?? 'Data deletion',
      details: {
        data: {
          categories: details.categories as string[] | undefined,
          recordCount: details.recordCount,
        },
      },
      severity: 'warning', // Deletions are significant
      request,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SECURITY LOGGING
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Log a security event.
   */
  async logSecurityEvent(
    action: 'security.blocked' | 'security.rate_limited' | 'security.suspicious_activity',
    details: {
      userId?: UserId;
      reason: string;
      rule?: string;
    },
    request?: AuditRequestMetadata
  ): AsyncAppResult<AuditEntry> {
    const actionDescriptions: Record<string, string> = {
      'security.blocked': 'Request blocked by security',
      'security.rate_limited': 'Request rate limited',
      'security.suspicious_activity': 'Suspicious activity detected',
    };

    return this.log('security', action, {
      userId: details.userId,
      description: `${actionDescriptions[action]}: ${details.reason}`,
      details: {
        security: {
          reason: details.reason,
          rule: details.rule,
          blocked: action === 'security.blocked',
        },
      },
      severity: 'warning',
      success: false,
      request,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // AUTHENTICATION LOGGING
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Log an authentication event.
   */
  async logAuth(
    userId: UserId | undefined,
    action: 'auth.login' | 'auth.logout' | 'auth.failed_login' | 'auth.token_refreshed' | 'auth.password_changed',
    details?: {
      reason?: string;
      method?: string;
    },
    request?: AuditRequestMetadata
  ): AsyncAppResult<AuditEntry> {
    const actionDescriptions: Record<string, string> = {
      'auth.login': 'User logged in',
      'auth.logout': 'User logged out',
      'auth.failed_login': 'Failed login attempt',
      'auth.token_refreshed': 'Authentication token refreshed',
      'auth.password_changed': 'User changed password',
    };

    const success = action !== 'auth.failed_login';
    const severity = action === 'auth.failed_login' ? 'warning' : 'info';

    return this.log('authentication', action, {
      userId,
      description: details?.reason
        ? `${actionDescriptions[action]}: ${details.reason}`
        : actionDescriptions[action],
      severity,
      success,
      request,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RETENTION LOGGING
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Log a retention event.
   */
  async logRetention(
    action: 'retention.job_started' | 'retention.job_completed' | 'retention.data_expired' | 'retention.data_archived',
    details: {
      category?: string;
      processed?: number;
      deleted?: number;
      archived?: number;
      jobId?: string;
    },
    request?: AuditRequestMetadata
  ): AsyncAppResult<AuditEntry> {
    const actionDescriptions: Record<string, string> = {
      'retention.job_started': 'Retention enforcement job started',
      'retention.job_completed': 'Retention enforcement job completed',
      'retention.data_expired': 'Data expired per retention policy',
      'retention.data_archived': 'Data archived per retention policy',
    };

    return this.log('retention', action, {
      description: actionDescriptions[action],
      entityType: 'retention_job',
      entityId: details.jobId,
      details: {
        retention: {
          category: details.category,
          processed: details.processed,
          deleted: details.deleted,
          archived: details.archived,
        },
      },
      request,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SYSTEM LOGGING
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Log a system event.
   */
  async logSystem(
    action: 'system.startup' | 'system.shutdown' | 'system.config_changed' | 'system.error',
    details: {
      component?: string;
      version?: string;
      config?: Record<string, unknown>;
      error?: string;
    },
    request?: AuditRequestMetadata
  ): AsyncAppResult<AuditEntry> {
    const actionDescriptions: Record<string, string> = {
      'system.startup': 'System started',
      'system.shutdown': 'System shutdown',
      'system.config_changed': 'System configuration changed',
      'system.error': 'System error occurred',
    };

    const severity = action === 'system.error' ? 'error' : 'info';
    const success = action !== 'system.error';

    let description = actionDescriptions[action];
    if (details.component) {
      description = `${description} (${details.component})`;
    }
    if (details.error) {
      description = `${description}: ${details.error}`;
    }

    return this.log('system', action, {
      description,
      details: {
        system: {
          component: details.component,
          version: details.version,
          config: details.config,
        },
      },
      severity,
      success,
      errorMessage: details.error,
      request,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GENERIC LOGGING
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Log a generic audit entry.
   */
  async log(
    category: AuditCategory,
    action: AuditAction,
    options: {
      userId?: UserId;
      targetUserId?: UserId;
      entityType?: string;
      entityId?: string;
      description: string;
      details?: AuditDetails;
      severity?: AuditSeverity;
      success?: boolean;
      errorMessage?: string;
      request?: AuditRequestMetadata;
    }
  ): AsyncAppResult<AuditEntry> {
    const now = createTimestamp();

    return this.store.append({
      timestamp: now,
      category,
      action,
      severity: options.severity ?? getDefaultSeverity(action),
      userId: options.userId,
      targetUserId: options.targetUserId,
      entityType: options.entityType,
      entityId: options.entityId,
      description: options.description,
      details: options.details,
      request: options.request,
      success: options.success ?? true,
      errorMessage: options.errorMessage,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DATA MODIFICATION LOGGING
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Log a data creation event.
   */
  async logDataCreated(
    userId: UserId,
    entityType: string,
    entityId: string,
    request?: AuditRequestMetadata
  ): AsyncAppResult<AuditEntry> {
    return this.log('dataModification', 'data.created', {
      userId,
      entityType,
      entityId,
      description: `Created ${entityType}: ${entityId}`,
      request,
    });
  }

  /**
   * Log a data update event.
   */
  async logDataUpdated(
    userId: UserId,
    entityType: string,
    entityId: string,
    changes?: Record<string, unknown>,
    request?: AuditRequestMetadata
  ): AsyncAppResult<AuditEntry> {
    return this.log('dataModification', 'data.updated', {
      userId,
      entityType,
      entityId,
      description: `Updated ${entityType}: ${entityId}`,
      details: {
        extra: changes,
      },
      request,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REQUEST METADATA EXTRACTOR
// ═══════════════════════════════════════════════════════════════════════════════

import type { Request } from 'express';

/**
 * Extract audit metadata from Express request.
 */
export function extractRequestMetadata(req: Request): AuditRequestMetadata {
  return {
    requestId: (req as any).id ?? req.headers['x-request-id'] as string,
    ipAddress: req.ip ?? req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    sessionId: (req as any).sessionId,
    endpoint: req.originalUrl ?? req.url,
    method: req.method,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create an AuditLogger instance.
 */
export function createAuditLogger(store: IAuditStore): AuditLogger {
  return new AuditLogger(store);
}
