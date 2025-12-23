// ═══════════════════════════════════════════════════════════════════════════════
// CONSENT STORE — Encrypted Consent Storage
// NovaOS Compliance Layer — Phase 16
// ═══════════════════════════════════════════════════════════════════════════════
//
// Persistent storage for GDPR consent tracking with:
//   - Encryption at rest
//   - Immutable consent history (audit trail)
//   - Purpose-based indexing
//   - Full consent lifecycle support
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { KeyValueStore } from '../../storage/index.js';
import type { EncryptionService } from '../../security/encryption/service.js';
import { ok, err, type AsyncAppResult } from '../../types/result.js';
import type { UserId, Timestamp } from '../../types/branded.js';
import { createTimestamp } from '../../types/branded.js';
import { ConsentKeys } from '../keys.js';
import { SecureStore, storeError } from '../../services/spark-engine/store/secure-store.js';
import type { SecureStoreConfig } from '../../services/spark-engine/store/types.js';
import { StoreErrorCode as ErrorCodes } from '../../services/spark-engine/store/types.js';
import type {
  UserConsent,
  ConsentRecord,
  ConsentPurpose,
  PurposeConsent,
  UpdateConsentRequest,
  BatchConsentRequest,
  ConsentUpdateResult,
  RevocationReason,
  IConsentStore,
  ConsentHistoryId,
} from './types.js';
import {
  ConsentErrorCode,
  ALL_CONSENT_PURPOSES,
  REQUIRED_PURPOSES,
  CURRENT_POLICY_VERSION,
  isRequiredPurpose,
  createConsentHistoryId,
  createDefaultConsent,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSENT STORE ERROR HELPER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a consent-specific error.
 */
function consentError(
  code: string,
  message: string,
  context?: Record<string, unknown>
): { code: string; message: string; context?: Record<string, unknown> } {
  return { code, message, context };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSENT STORE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Encrypted storage for GDPR consent tracking.
 *
 * Features:
 * - User consent state (current grants per purpose)
 * - Immutable consent history for audit
 * - Purpose-based indexing for bulk queries
 * - Encrypted at rest
 */
export class ConsentStore extends SecureStore<UserConsent, UserId> implements IConsentStore {
  constructor(
    store: KeyValueStore,
    config: Partial<SecureStoreConfig> = {},
    encryption?: EncryptionService
  ) {
    super(store, config, encryption);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ABSTRACT METHOD IMPLEMENTATIONS
  // ─────────────────────────────────────────────────────────────────────────────

  protected getKey(userId: UserId): string {
    return ConsentKeys.consent(userId);
  }

  protected validate(consent: UserConsent): string | undefined {
    if (!consent.userId) {
      return 'User ID is required';
    }
    if (!consent.purposes || typeof consent.purposes !== 'object') {
      return 'Consent purposes are required';
    }
    if (!consent.policyVersion) {
      return 'Policy version is required';
    }
    if (typeof consent.changeCount !== 'number' || consent.changeCount < 0) {
      return 'Change count must be a non-negative number';
    }
    return undefined;
  }

  protected getId(consent: UserConsent): UserId {
    return consent.userId;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLIC API — IConsentStore Implementation
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get current consent state for a user.
   */
  async getConsent(userId: UserId): AsyncAppResult<UserConsent | null> {
    return this.getEntity(userId);
  }

  /**
   * Record a consent change.
   */
  async recordConsent(
    userId: UserId,
    request: UpdateConsentRequest,
    metadata?: { ipAddress?: string; userAgent?: string }
  ): AsyncAppResult<ConsentUpdateResult> {
    const now = createTimestamp();

    // Check if revoking a required consent
    if (!request.granted && isRequiredPurpose(request.purpose)) {
      return ok({
        success: false,
        consent: await this.getOrCreateConsent(userId, now),
        record: this.createConsentRecord(userId, request, now, metadata),
        warning: `Cannot revoke required consent: ${request.purpose}`,
      });
    }

    // Get or create current consent state
    const currentResult = await this.getEntity(userId);
    if (!currentResult.ok) {
      return err(currentResult.error);
    }

    const current = currentResult.value ?? createDefaultConsent(
      userId,
      now,
      request.policyVersion ?? CURRENT_POLICY_VERSION
    );

    // Check if already in requested state
    const currentPurpose = current.purposes[request.purpose];
    if (currentPurpose && currentPurpose.granted === request.granted) {
      return ok({
        success: true,
        consent: current,
        record: this.createConsentRecord(userId, request, now, metadata),
        warning: 'Consent already in requested state',
      });
    }

    // Create consent history record
    const record = this.createConsentRecord(userId, request, now, metadata);

    // Save history record
    const historyResult = await this.saveConsentRecord(record);
    if (!historyResult.ok) {
      return err(historyResult.error);
    }

    // Update consent state
    const updatedPurpose: PurposeConsent = {
      granted: request.granted,
      updatedAt: now,
      method: request.granted ? request.method : undefined,
      recordId: record.id,
    };

    const updatedPurposes = {
      ...current.purposes,
      [request.purpose]: updatedPurpose,
    };

    const updatedConsent: UserConsent = {
      ...current,
      purposes: updatedPurposes,
      lastModifiedAt: now,
      policyVersion: request.policyVersion ?? current.policyVersion,
      hasRequiredConsents: this.checkRequiredConsents(updatedPurposes),
      changeCount: current.changeCount + 1,
    };

    // Save updated consent state
    const saveResult = await this.saveEntity(updatedConsent);
    if (!saveResult.ok) {
      return err(saveResult.error);
    }

    // Update purpose index
    await this.updatePurposeIndex(userId, request.purpose, request.granted);

    return ok({
      success: true,
      consent: updatedConsent,
      record,
    });
  }

  /**
   * Batch update consents.
   */
  async batchUpdateConsent(
    userId: UserId,
    request: BatchConsentRequest,
    metadata?: { ipAddress?: string; userAgent?: string }
  ): AsyncAppResult<UserConsent> {
    const now = createTimestamp();

    // Get or create current consent state
    const currentResult = await this.getEntity(userId);
    if (!currentResult.ok) {
      return err(currentResult.error);
    }

    let current = currentResult.value ?? createDefaultConsent(
      userId,
      now,
      request.policyVersion
    );

    // Process each consent update
    for (const update of request.consents) {
      // Skip required consents if trying to revoke
      if (!update.granted && isRequiredPurpose(update.purpose)) {
        continue;
      }

      // Create and save history record
      const record = this.createConsentRecord(
        userId,
        { ...update, method: request.method, policyVersion: request.policyVersion },
        now,
        metadata
      );
      await this.saveConsentRecord(record);

      // Update purpose state
      const updatedPurpose: PurposeConsent = {
        granted: update.granted,
        updatedAt: now,
        method: update.granted ? request.method : undefined,
        recordId: record.id,
      };

      current = {
        ...current,
        purposes: {
          ...current.purposes,
          [update.purpose]: updatedPurpose,
        },
        lastModifiedAt: now,
        changeCount: current.changeCount + 1,
      };

      // Update purpose index
      await this.updatePurposeIndex(userId, update.purpose, update.granted);
    }

    // Update final state
    const finalConsent: UserConsent = {
      ...current,
      policyVersion: request.policyVersion,
      hasRequiredConsents: this.checkRequiredConsents(current.purposes),
    };

    // Save final state
    const saveResult = await this.saveEntity(finalConsent);
    if (!saveResult.ok) {
      return err(saveResult.error);
    }

    return ok(finalConsent);
  }

  /**
   * Revoke all consents for a user (account deletion).
   */
  async revokeAllConsents(
    userId: UserId,
    reason: RevocationReason
  ): AsyncAppResult<void> {
    const now = createTimestamp();

    // Get current consent state
    const currentResult = await this.getEntity(userId);
    if (!currentResult.ok) {
      return err(currentResult.error);
    }

    if (!currentResult.value) {
      // No consent to revoke
      return ok(undefined);
    }

    const current = currentResult.value;

    // Create revocation records for all purposes
    for (const purpose of ALL_CONSENT_PURPOSES) {
      const purposeConsent = current.purposes[purpose];
      if (purposeConsent?.granted) {
        const record = this.createConsentRecord(
          userId,
          {
            purpose,
            granted: false,
            method: 'api_request',
            revocationReason: reason,
          },
          now
        );
        await this.saveConsentRecord(record);
        await this.updatePurposeIndex(userId, purpose, false);
      }
    }

    // Update consent state to all revoked
    const revokedPurposes: Record<ConsentPurpose, PurposeConsent> = {} as Record<ConsentPurpose, PurposeConsent>;
    for (const purpose of ALL_CONSENT_PURPOSES) {
      revokedPurposes[purpose] = {
        granted: false,
        updatedAt: now,
        recordId: createConsentHistoryId(),
      };
    }

    const revokedConsent: UserConsent = {
      ...current,
      purposes: revokedPurposes,
      lastModifiedAt: now,
      hasRequiredConsents: false,
      changeCount: current.changeCount + ALL_CONSENT_PURPOSES.length,
    };

    const saveResult = await this.saveEntity(revokedConsent);
    if (!saveResult.ok) {
      return err(saveResult.error);
    }

    return ok(undefined);
  }

  /**
   * Get consent history for a user.
   */
  async getConsentHistory(
    userId: UserId,
    options?: { limit?: number; purpose?: ConsentPurpose }
  ): AsyncAppResult<readonly ConsentRecord[]> {
    const { limit = 100, purpose } = options ?? {};

    try {
      const historyKey = ConsentKeys.consentHistory(userId);
      
      // Get record IDs from sorted set (newest first)
      const recordIds = await this.store.zrevrange(historyKey, 0, limit - 1);

      if (recordIds.length === 0) {
        return ok([]);
      }

      // Fetch records
      const records: ConsentRecord[] = [];
      for (const recordId of recordIds) {
        const recordKey = ConsentKeys.consentRecord(recordId as ConsentHistoryId);
        const data = await this.store.get(recordKey);
        if (data) {
          try {
            const record = JSON.parse(data) as ConsentRecord;
            // Filter by purpose if specified
            if (!purpose || record.purpose === purpose) {
              records.push(record);
            }
          } catch {
            // Skip invalid records
          }
        }
      }

      return ok(records);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to get consent history: ${error instanceof Error ? error.message : String(error)}`,
          { userId }
        )
      );
    }
  }

  /**
   * Check if user has consented to a specific purpose.
   */
  async hasConsent(userId: UserId, purpose: ConsentPurpose): AsyncAppResult<boolean> {
    const result = await this.getEntity(userId);
    if (!result.ok) {
      return err(result.error);
    }

    if (!result.value) {
      return ok(false);
    }

    const purposeConsent = result.value.purposes[purpose];
    return ok(purposeConsent?.granted ?? false);
  }

  /**
   * Check if user has all required consents.
   */
  async hasRequiredConsents(userId: UserId): AsyncAppResult<boolean> {
    const result = await this.getEntity(userId);
    if (!result.ok) {
      return err(result.error);
    }

    if (!result.value) {
      return ok(false);
    }

    return ok(result.value.hasRequiredConsents);
  }

  /**
   * Delete all consent data for a user (GDPR deletion).
   */
  async deleteConsentData(userId: UserId): AsyncAppResult<number> {
    let deleted = 0;

    try {
      // Delete consent state
      const deleteResult = await this.deleteEntity(userId);
      if (deleteResult.ok && deleteResult.value) {
        deleted++;
      }

      // Delete consent history
      const historyKey = ConsentKeys.consentHistory(userId);
      const recordIds = await this.store.zrange(historyKey, 0, -1);

      for (const recordId of recordIds) {
        const recordKey = ConsentKeys.consentRecord(recordId as ConsentHistoryId);
        await this.store.delete(recordKey);
        deleted++;
      }

      // Delete history index
      await this.store.delete(historyKey);

      // Remove from purpose indexes
      for (const purpose of ALL_CONSENT_PURPOSES) {
        const purposeKey = ConsentKeys.purposeIndex(purpose);
        await this.store.srem(purposeKey, userId);
      }

      return ok(deleted);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to delete consent data: ${error instanceof Error ? error.message : String(error)}`,
          { userId }
        )
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ADDITIONAL METHODS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get users who have consented to a specific purpose.
   */
  async getUsersByPurpose(
    purpose: ConsentPurpose,
    options?: { limit?: number }
  ): AsyncAppResult<readonly UserId[]> {
    const { limit = 1000 } = options ?? {};

    try {
      const purposeKey = ConsentKeys.purposeIndex(purpose);
      const userIds = await this.store.smembers(purposeKey);
      
      // Apply limit
      const limited = userIds.slice(0, limit) as UserId[];
      return ok(limited);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to get users by purpose: ${error instanceof Error ? error.message : String(error)}`,
          { purpose }
        )
      );
    }
  }

  /**
   * Count users with a specific consent.
   */
  async countByPurpose(purpose: ConsentPurpose): AsyncAppResult<number> {
    try {
      const purposeKey = ConsentKeys.purposeIndex(purpose);
      const count = await this.store.scard(purposeKey);
      return ok(count);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to count by purpose: ${error instanceof Error ? error.message : String(error)}`,
          { purpose }
        )
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get or create consent for a user.
   */
  private async getOrCreateConsent(userId: UserId, now: Timestamp): Promise<UserConsent> {
    const result = await this.getEntity(userId);
    if (result.ok && result.value) {
      return result.value;
    }
    return createDefaultConsent(userId, now, CURRENT_POLICY_VERSION);
  }

  /**
   * Create a consent history record.
   */
  private createConsentRecord(
    userId: UserId,
    request: UpdateConsentRequest,
    timestamp: Timestamp,
    metadata?: { ipAddress?: string; userAgent?: string }
  ): ConsentRecord {
    return {
      id: createConsentHistoryId(),
      userId,
      purpose: request.purpose,
      granted: request.granted,
      timestamp,
      method: request.method,
      revocationReason: request.revocationReason,
      ipAddress: metadata?.ipAddress,
      userAgent: metadata?.userAgent,
      policyVersion: request.policyVersion,
      context: request.context,
    };
  }

  /**
   * Save a consent history record.
   */
  private async saveConsentRecord(record: ConsentRecord): AsyncAppResult<void> {
    try {
      // Save record entity
      const recordKey = ConsentKeys.consentRecord(record.id);
      await this.store.set(recordKey, JSON.stringify(record));

      // Add to user's history sorted set (score = timestamp)
      const historyKey = ConsentKeys.consentHistory(record.userId);
      const score = new Date(record.timestamp).getTime();
      await this.store.zadd(historyKey, score, record.id);

      return ok(undefined);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to save consent record: ${error instanceof Error ? error.message : String(error)}`,
          { recordId: record.id }
        )
      );
    }
  }

  /**
   * Update purpose index when consent changes.
   */
  private async updatePurposeIndex(
    userId: UserId,
    purpose: ConsentPurpose,
    granted: boolean
  ): AsyncAppResult<void> {
    try {
      const purposeKey = ConsentKeys.purposeIndex(purpose);

      if (granted) {
        await this.store.sadd(purposeKey, userId);
      } else {
        await this.store.srem(purposeKey, userId);
      }

      return ok(undefined);
    } catch (error) {
      return err(
        storeError(
          ErrorCodes.BACKEND_ERROR,
          `Failed to update purpose index: ${error instanceof Error ? error.message : String(error)}`,
          { userId, purpose, granted }
        )
      );
    }
  }

  /**
   * Check if all required consents are granted.
   */
  private checkRequiredConsents(
    purposes: Readonly<Record<ConsentPurpose, PurposeConsent>>
  ): boolean {
    for (const purpose of REQUIRED_PURPOSES) {
      const consent = purposes[purpose];
      if (!consent?.granted) {
        return false;
      }
    }
    return true;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a ConsentStore instance.
 */
export function createConsentStore(
  store: KeyValueStore,
  config?: Partial<SecureStoreConfig>,
  encryption?: EncryptionService
): ConsentStore {
  return new ConsentStore(store, config, encryption);
}
