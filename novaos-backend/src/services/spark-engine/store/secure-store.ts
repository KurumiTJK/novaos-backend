// ═══════════════════════════════════════════════════════════════════════════════
// SECURE STORE — Base Encrypted Storage Layer
// NovaOS Spark Engine — Phase 12: Secure Store Layer
// ═══════════════════════════════════════════════════════════════════════════════
//
// Base class for encrypted entity storage providing:
//   - AES-256-GCM encryption at rest
//   - HMAC-SHA256 integrity verification
//   - Optimistic locking via version numbers
//   - TTL enforcement
//   - Serialization/deserialization
//
// ═══════════════════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';
import type { KeyValueStore } from '../../../storage/index.js';
import {
  EncryptionService,
  getEncryptionService,
  type EncryptedEnvelope,
} from '../../../security/encryption/service.js';
import { ok, err, type AsyncAppResult, type AppError } from '../../../types/result.js';
import { createTimestamp, type Timestamp } from '../../../types/branded.js';
import {
  type StoredEntity,
  type EntityMetadata,
  type RawStoredEntity,
  type SecureStoreConfig,
  type SaveOptions,
  type GetOptions,
  DEFAULT_SECURE_STORE_CONFIG,
  StoreErrorCode,
  isEntityMetadata,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * HMAC algorithm for integrity verification.
 */
const HMAC_ALGORITHM = 'sha256';

/**
 * Secret for HMAC integrity verification.
 * MUST be set in production via STORE_HMAC_SECRET environment variable.
 */
const HMAC_SECRET = (() => {
  const secret = process.env.STORE_HMAC_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('STORE_HMAC_SECRET must be set in production');
  }
  if (!secret) {
    console.warn('[SecureStore] Using development fallback HMAC secret - NOT FOR PRODUCTION');
  }
  return secret || 'nova-store-dev-hmac-secret-not-for-production';
})();

/**
 * Initial version for new entities.
 */
const INITIAL_VERSION = 1;

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute HMAC-SHA256 hash for integrity verification.
 */
function computeIntegrityHash(data: string): string {
  return crypto
    .createHmac(HMAC_ALGORITHM, HMAC_SECRET)
    .update(data)
    .digest('hex');
}

/**
 * Verify integrity hash matches data.
 */
function verifyIntegrity(data: string, expectedHash: string): boolean {
  const actualHash = computeIntegrityHash(data);
  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(actualHash, 'hex'),
      Buffer.from(expectedHash, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Create a store error.
 */
function storeError(
  code: string,
  message: string,
  context?: Record<string, unknown>
): AppError {
  return { code, message, context };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECURE STORE BASE CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Base class for encrypted entity storage.
 *
 * Provides:
 * - Encryption at rest (AES-256-GCM)
 * - Integrity verification (HMAC-SHA256)
 * - Optimistic locking (version numbers)
 * - TTL enforcement
 *
 * @template T - Entity type
 * @template ID - Entity ID type (branded string)
 */
export abstract class SecureStore<T, ID extends string> {
  protected readonly store: KeyValueStore;
  protected readonly encryption: EncryptionService;
  protected readonly config: SecureStoreConfig;

  constructor(
    store: KeyValueStore,
    config: Partial<SecureStoreConfig> = {},
    encryption?: EncryptionService
  ) {
    this.store = store;
    this.encryption = encryption ?? getEncryptionService();
    this.config = { ...DEFAULT_SECURE_STORE_CONFIG, ...config };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ABSTRACT METHODS (to be implemented by subclasses)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get the Redis key for an entity ID.
   */
  protected abstract getKey(id: ID): string;

  /**
   * Validate entity data before save.
   * Returns error message if invalid, undefined if valid.
   */
  protected abstract validate(entity: T): string | undefined;

  /**
   * Extract the ID from an entity.
   */
  protected abstract getId(entity: T): ID;

  // ─────────────────────────────────────────────────────────────────────────────
  // CORE OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Save an entity to storage.
   */
  protected async saveEntity(
    entity: T,
    options: SaveOptions = {}
  ): AsyncAppResult<{ entity: T; version: number; created: boolean }> {
    // Validate entity
    const validationError = this.validate(entity);
    if (validationError) {
      return err(storeError(StoreErrorCode.INVALID_DATA, validationError));
    }

    const id = this.getId(entity);
    const key = this.getKey(id);
    const now = createTimestamp();

    try {
      // Check for existing entity (for version tracking)
      const existing = await this.getRawEntity(key);
      const isCreate = existing === null;

      // Version check for optimistic locking
      if (options.expectedVersion !== undefined && existing) {
        if (existing.metadata.version !== options.expectedVersion) {
          return err(
            storeError(
              StoreErrorCode.VERSION_CONFLICT,
              `Version mismatch: expected ${options.expectedVersion}, got ${existing.metadata.version}`,
              { expected: options.expectedVersion, actual: existing.metadata.version }
            )
          );
        }
      }

      // Serialize entity data
      const serializedData = JSON.stringify(entity);

      // Encrypt if enabled
      let storedData: string;
      let keyId: string | undefined;

      if (this.config.encryptionEnabled && !options.skipEncryption) {
        const envelope = this.encryption.encrypt(serializedData);
        storedData = this.encryption.serialize(envelope);
        keyId = envelope.kid;
      } else {
        storedData = serializedData;
      }

      // Compute integrity hash
      const integrityHash = computeIntegrityHash(storedData);

      // Build metadata
      const newVersion = isCreate ? INITIAL_VERSION : existing.metadata.version + 1;
      const metadata: EntityMetadata = {
        createdAt: isCreate ? now : existing.metadata.createdAt,
        updatedAt: now,
        version: newVersion,
        encrypted: this.config.encryptionEnabled && !options.skipEncryption,
        integrityHash,
        keyId,
        expiresAt: this.computeExpiresAt(options.ttlSeconds),
      };

      // Build stored entity
      const storedEntity: RawStoredEntity = {
        data: storedData,
        metadata,
      };

      // Determine TTL
      const ttl = options.ttlSeconds ?? this.config.defaultTtlSeconds;

      // Save to Redis
      await this.store.set(key, JSON.stringify(storedEntity), ttl > 0 ? ttl : undefined);

      return ok({
        entity,
        version: newVersion,
        created: isCreate,
      });
    } catch (error) {
      return err(
        storeError(
          StoreErrorCode.BACKEND_ERROR,
          `Failed to save entity: ${error instanceof Error ? error.message : String(error)}`,
          { id, error: String(error) }
        )
      );
    }
  }

  /**
   * Get an entity by ID.
   */
  protected async getEntity(
    id: ID,
    options: GetOptions = {}
  ): AsyncAppResult<T | null> {
    const key = this.getKey(id);

    try {
      const raw = await this.getRawEntity(key);
      if (!raw) {
        return ok(null);
      }

      // Check TTL expiration
      if (raw.metadata.expiresAt) {
        const expiresAt = new Date(raw.metadata.expiresAt).getTime();
        if (Date.now() > expiresAt) {
          // Entity has expired, delete it
          await this.store.delete(key);
          return ok(null);
        }
      }

      // Verify integrity
      if (this.config.integrityCheckEnabled && !options.skipIntegrityCheck) {
        if (!verifyIntegrity(raw.data, raw.metadata.integrityHash)) {
          return err(
            storeError(
              StoreErrorCode.INTEGRITY_FAILURE,
              'Entity integrity check failed',
              { id }
            )
          );
        }
      }

      // Decrypt if needed
      let entityData: string;
      if (raw.metadata.encrypted) {
        try {
          const envelope = this.encryption.deserialize(raw.data);
          entityData = this.encryption.decryptToString(envelope);
        } catch (decryptError) {
          return err(
            storeError(
              StoreErrorCode.ENCRYPTION_FAILURE,
              `Failed to decrypt entity: ${decryptError instanceof Error ? decryptError.message : String(decryptError)}`,
              { id }
            )
          );
        }
      } else {
        entityData = raw.data;
      }

      // Parse entity
      try {
        const entity = JSON.parse(entityData) as T;
        return ok(entity);
      } catch (parseError) {
        return err(
          storeError(
            StoreErrorCode.SERIALIZATION_FAILURE,
            `Failed to parse entity: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
            { id }
          )
        );
      }
    } catch (error) {
      return err(
        storeError(
          StoreErrorCode.BACKEND_ERROR,
          `Failed to get entity: ${error instanceof Error ? error.message : String(error)}`,
          { id, error: String(error) }
        )
      );
    }
  }

  /**
   * Get an entity with its metadata.
   */
  protected async getEntityWithMetadata(
    id: ID
  ): AsyncAppResult<StoredEntity<T> | null> {
    const key = this.getKey(id);

    try {
      const raw = await this.getRawEntity(key);
      if (!raw) {
        return ok(null);
      }

      // Get decrypted entity
      const entityResult = await this.getEntity(id);
      if (!entityResult.ok) {
        return entityResult;
      }
      if (entityResult.value === null) {
        return ok(null);
      }

      return ok({
        data: entityResult.value,
        metadata: raw.metadata,
      });
    } catch (error) {
      return err(
        storeError(
          StoreErrorCode.BACKEND_ERROR,
          `Failed to get entity with metadata: ${error instanceof Error ? error.message : String(error)}`,
          { id, error: String(error) }
        )
      );
    }
  }

  /**
   * Delete an entity by ID.
   */
  protected async deleteEntity(id: ID): AsyncAppResult<boolean> {
    const key = this.getKey(id);

    try {
      const deleted = await this.store.delete(key);
      return ok(deleted);
    } catch (error) {
      return err(
        storeError(
          StoreErrorCode.BACKEND_ERROR,
          `Failed to delete entity: ${error instanceof Error ? error.message : String(error)}`,
          { id, error: String(error) }
        )
      );
    }
  }

  /**
   * Check if an entity exists.
   */
  protected async exists(id: ID): AsyncAppResult<boolean> {
    const key = this.getKey(id);

    try {
      const exists = await this.store.exists(key);
      return ok(exists);
    } catch (error) {
      return err(
        storeError(
          StoreErrorCode.BACKEND_ERROR,
          `Failed to check entity existence: ${error instanceof Error ? error.message : String(error)}`,
          { id, error: String(error) }
        )
      );
    }
  }

  /**
   * Get the current version of an entity.
   */
  protected async getVersion(id: ID): AsyncAppResult<number | null> {
    const key = this.getKey(id);

    try {
      const raw = await this.getRawEntity(key);
      if (!raw) {
        return ok(null);
      }
      return ok(raw.metadata.version);
    } catch (error) {
      return err(
        storeError(
          StoreErrorCode.BACKEND_ERROR,
          `Failed to get entity version: ${error instanceof Error ? error.message : String(error)}`,
          { id, error: String(error) }
        )
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // BATCH OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get multiple entities by IDs.
   */
  protected async getMany(ids: readonly ID[]): AsyncAppResult<Map<ID, T>> {
    const results = new Map<ID, T>();

    // Process in parallel (could be optimized with Redis MGET)
    const promises = ids.map(async (id) => {
      const result = await this.getEntity(id);
      if (result.ok && result.value !== null) {
        results.set(id, result.value);
      }
    });

    try {
      await Promise.all(promises);
      return ok(results);
    } catch (error) {
      return err(
        storeError(
          StoreErrorCode.BACKEND_ERROR,
          `Failed to get multiple entities: ${error instanceof Error ? error.message : String(error)}`,
          { count: ids.length, error: String(error) }
        )
      );
    }
  }

  /**
   * Delete multiple entities by IDs.
   */
  protected async deleteMany(ids: readonly ID[]): AsyncAppResult<number> {
    let deleted = 0;

    for (const id of ids) {
      const result = await this.deleteEntity(id);
      if (result.ok && result.value) {
        deleted++;
      }
    }

    return ok(deleted);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HELPER METHODS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get raw stored entity from Redis.
   */
  private async getRawEntity(key: string): Promise<RawStoredEntity | null> {
    const data = await this.store.get(key);
    if (!data) {
      return null;
    }

    try {
      const parsed = JSON.parse(data);

      // Validate structure
      if (!parsed.data || !parsed.metadata) {
        return null;
      }

      if (!isEntityMetadata(parsed.metadata)) {
        return null;
      }

      return parsed as RawStoredEntity;
    } catch {
      return null;
    }
  }

  /**
   * Compute expiration timestamp from TTL.
   */
  private computeExpiresAt(ttlSeconds?: number): Timestamp | undefined {
    const ttl = ttlSeconds ?? this.config.defaultTtlSeconds;
    if (ttl <= 0) {
      return undefined;
    }
    return createTimestamp(new Date(Date.now() + ttl * 1000));
  }

  /**
   * Parse entities from a list of keys.
   */
  protected async parseEntitiesFromKeys(keys: string[]): AsyncAppResult<T[]> {
    const entities: T[] = [];

    for (const key of keys) {
      const data = await this.store.get(key);
      if (!data) continue;

      try {
        const raw = JSON.parse(data) as RawStoredEntity;

        // Verify integrity if enabled
        if (this.config.integrityCheckEnabled) {
          if (!verifyIntegrity(raw.data, raw.metadata.integrityHash)) {
            continue; // Skip corrupted entities
          }
        }

        // Check expiration
        if (raw.metadata.expiresAt) {
          const expiresAt = new Date(raw.metadata.expiresAt).getTime();
          if (Date.now() > expiresAt) {
            await this.store.delete(key);
            continue;
          }
        }

        // Decrypt if needed
        let entityData: string;
        if (raw.metadata.encrypted) {
          const envelope = this.encryption.deserialize(raw.data);
          entityData = this.encryption.decryptToString(envelope);
        } else {
          entityData = raw.data;
        }

        entities.push(JSON.parse(entityData) as T);
      } catch {
        // Skip entities that fail to parse
        continue;
      }
    }

    return ok(entities);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RE-ENCRYPTION (for key rotation)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Re-encrypt an entity with the current primary key.
   * Used for key rotation.
   */
  protected async reencryptEntity(id: ID): AsyncAppResult<boolean> {
    const result = await this.getEntity(id);
    if (!result.ok) {
      return err(result.error);
    }
    if (result.value === null) {
      return ok(false);
    }

    // Re-save with current key
    const saveResult = await this.saveEntity(result.value);
    return ok(saveResult.ok);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

export {
  computeIntegrityHash,
  verifyIntegrity,
  storeError,
  INITIAL_VERSION,
};
