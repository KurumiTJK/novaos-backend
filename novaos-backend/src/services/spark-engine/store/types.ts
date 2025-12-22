// ═══════════════════════════════════════════════════════════════════════════════
// SECURE STORE TYPES — Encrypted Storage Layer Types
// NovaOS Spark Engine — Phase 12: Secure Store Layer
// ═══════════════════════════════════════════════════════════════════════════════
//
// This module defines types for the encrypted storage layer:
//   - StoredEntity<T>: Wrapper for entity data with metadata
//   - EntityMetadata: Version, timestamps, encryption state, integrity hash
//   - Store configuration and options
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { Timestamp } from '../../../types/branded.js';
import type { AsyncAppResult } from '../../../types/result.js';
import type {
  Goal,
  Quest,
  Step,
  Spark,
  ReminderSchedule,
  GoalStatus,
  ReminderStatus,
} from '../types.js';
import type {
  GoalId,
  QuestId,
  StepId,
  SparkId,
  ReminderId,
  UserId,
} from '../../../types/branded.js';

// ═══════════════════════════════════════════════════════════════════════════════
// ENTITY METADATA
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Metadata attached to every stored entity.
 * Used for versioning, integrity, and audit.
 */
export interface EntityMetadata {
  /** When the entity was first created */
  readonly createdAt: Timestamp;

  /** When the entity was last updated */
  readonly updatedAt: Timestamp;

  /**
   * Version number for optimistic locking.
   * Incremented on each update.
   */
  readonly version: number;

  /**
   * Whether the entity data is encrypted at rest.
   * When true, data field contains encrypted envelope.
   */
  readonly encrypted: boolean;

  /**
   * HMAC-SHA256 integrity hash of the serialized data.
   * Used to detect tampering or corruption.
   */
  readonly integrityHash: string;

  /**
   * Encryption key ID used (if encrypted).
   * Enables key rotation tracking.
   */
  readonly keyId?: string;

  /**
   * TTL expiration timestamp (if set).
   * Entity should be cleaned up after this time.
   */
  readonly expiresAt?: Timestamp;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STORED ENTITY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Wrapper for entity data with metadata.
 * This is the format stored in Redis.
 *
 * @template T - The entity type (Goal, Quest, Step, Spark, etc.)
 */
export interface StoredEntity<T> {
  /**
   * The entity data.
   * May be encrypted (check metadata.encrypted).
   */
  readonly data: T;

  /**
   * Entity metadata for versioning, integrity, etc.
   */
  readonly metadata: EntityMetadata;
}

/**
 * Raw stored format before decryption/parsing.
 * This is what we read directly from Redis.
 */
export interface RawStoredEntity {
  /** Serialized data (may be encrypted envelope) */
  readonly data: string;

  /** Metadata (always unencrypted) */
  readonly metadata: EntityMetadata;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STORE CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Configuration for secure store behavior.
 */
export interface SecureStoreConfig {
  /**
   * Enable encryption at rest.
   * When false, data is stored in plaintext.
   * @default true
   */
  readonly encryptionEnabled: boolean;

  /**
   * Enable integrity verification on read.
   * When true, HMAC is verified before returning data.
   * @default true
   */
  readonly integrityCheckEnabled: boolean;

  /**
   * Fields to encrypt (for selective encryption).
   * If empty/undefined, entire entity is encrypted.
   */
  readonly sensitiveFields?: readonly string[];

  /**
   * Default TTL in seconds for entities (0 = no expiry).
   * @default 0
   */
  readonly defaultTtlSeconds: number;

  /**
   * TTL in seconds for completed/abandoned goals.
   * @default 2592000 (30 days)
   */
  readonly completedGoalTtlSeconds: number;

  /**
   * TTL in seconds for expired reminders.
   * @default 86400 (24 hours)
   */
  readonly expiredReminderTtlSeconds: number;

  /**
   * TTL in seconds for refinement state (SwordGate).
   * @default 3600 (1 hour)
   */
  readonly refinementStateTtlSeconds: number;
}

/**
 * Default secure store configuration.
 */
export const DEFAULT_SECURE_STORE_CONFIG: SecureStoreConfig = {
  encryptionEnabled: true,
  integrityCheckEnabled: true,
  sensitiveFields: undefined,
  defaultTtlSeconds: 0,
  completedGoalTtlSeconds: 30 * 24 * 60 * 60, // 30 days
  expiredReminderTtlSeconds: 24 * 60 * 60, // 24 hours
  refinementStateTtlSeconds: 60 * 60, // 1 hour
};

// ═══════════════════════════════════════════════════════════════════════════════
// STORE OPTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Options for save operations.
 */
export interface SaveOptions {
  /**
   * Expected version for optimistic locking.
   * If provided, save fails if current version doesn't match.
   */
  readonly expectedVersion?: number;

  /**
   * TTL in seconds (overrides default).
   */
  readonly ttlSeconds?: number;

  /**
   * Skip encryption for this save.
   */
  readonly skipEncryption?: boolean;
}

/**
 * Options for get operations.
 */
export interface GetOptions {
  /**
   * Skip integrity check for this read.
   */
  readonly skipIntegrityCheck?: boolean;

  /**
   * Include metadata in result.
   * @default false
   */
  readonly includeMetadata?: boolean;
}

/**
 * Options for list/query operations.
 */
export interface ListOptions {
  /**
   * Maximum number of results.
   * @default 100
   */
  readonly limit?: number;

  /**
   * Offset for pagination.
   * @default 0
   */
  readonly offset?: number;

  /**
   * Filter by status (for entities with status field).
   */
  readonly status?: string;

  /**
   * Sort order.
   * @default 'asc'
   */
  readonly sortOrder?: 'asc' | 'desc';
}

// ═══════════════════════════════════════════════════════════════════════════════
// STORE RESULT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Result of a save operation.
 */
export interface SaveResult<T> {
  /** The saved entity */
  readonly entity: T;

  /** New version number */
  readonly version: number;

  /** Whether this was a create (vs update) */
  readonly created: boolean;
}

/**
 * Result of a delete operation.
 */
export interface DeleteResult {
  /** Whether the entity existed and was deleted */
  readonly deleted: boolean;

  /** Number of related entities also deleted (cascade) */
  readonly cascadeCount?: number;
}

/**
 * Result of a list operation.
 */
export interface ListResult<T> {
  /** The entities */
  readonly items: readonly T[];

  /** Total count (may be more than returned) */
  readonly total: number;

  /** Whether there are more results */
  readonly hasMore: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STORE ERROR CODES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Store-specific error codes.
 */
export const StoreErrorCode = {
  /** Entity not found */
  NOT_FOUND: 'STORE_NOT_FOUND',

  /** Version mismatch (optimistic locking failure) */
  VERSION_CONFLICT: 'STORE_VERSION_CONFLICT',

  /** Integrity check failed (tampering or corruption) */
  INTEGRITY_FAILURE: 'STORE_INTEGRITY_FAILURE',

  /** Encryption/decryption failed */
  ENCRYPTION_FAILURE: 'STORE_ENCRYPTION_FAILURE',

  /** Serialization/deserialization failed */
  SERIALIZATION_FAILURE: 'STORE_SERIALIZATION_FAILURE',

  /** Storage backend error */
  BACKEND_ERROR: 'STORE_BACKEND_ERROR',

  /** Entity already exists (create conflict) */
  ALREADY_EXISTS: 'STORE_ALREADY_EXISTS',

  /** Invalid entity data */
  INVALID_DATA: 'STORE_INVALID_DATA',

  /** TTL expired */
  EXPIRED: 'STORE_EXPIRED',
} as const;

export type StoreErrorCode = (typeof StoreErrorCode)[keyof typeof StoreErrorCode];

// ═══════════════════════════════════════════════════════════════════════════════
// ENTITY-SPECIFIC STORE INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Goal store interface.
 */
export interface IGoalStore {
  save(goal: Goal, options?: SaveOptions): AsyncAppResult<SaveResult<Goal>>;
  get(goalId: GoalId, options?: GetOptions): AsyncAppResult<Goal | null>;
  delete(goalId: GoalId): AsyncAppResult<DeleteResult>;
  getByUser(userId: UserId, options?: ListOptions): AsyncAppResult<ListResult<Goal>>;
  getByStatus(userId: UserId, status: GoalStatus): AsyncAppResult<readonly Goal[]>;
  updateStatus(goalId: GoalId, status: GoalStatus): AsyncAppResult<Goal>;
}

/**
 * Quest store interface.
 */
export interface IQuestStore {
  save(quest: Quest, options?: SaveOptions): AsyncAppResult<SaveResult<Quest>>;
  get(questId: QuestId, options?: GetOptions): AsyncAppResult<Quest | null>;
  delete(questId: QuestId): AsyncAppResult<DeleteResult>;
  getByGoal(goalId: GoalId, options?: ListOptions): AsyncAppResult<ListResult<Quest>>;
}

/**
 * Step store interface.
 */
export interface IStepStore {
  save(step: Step, options?: SaveOptions): AsyncAppResult<SaveResult<Step>>;
  get(stepId: StepId, options?: GetOptions): AsyncAppResult<Step | null>;
  delete(stepId: StepId): AsyncAppResult<DeleteResult>;
  getByQuest(questId: QuestId, options?: ListOptions): AsyncAppResult<ListResult<Step>>;
  getByDate(userId: UserId, date: string): AsyncAppResult<Step | null>;
}

/**
 * Spark store interface.
 */
export interface ISparkStore {
  save(spark: Spark, options?: SaveOptions): AsyncAppResult<SaveResult<Spark>>;
  get(sparkId: SparkId, options?: GetOptions): AsyncAppResult<Spark | null>;
  delete(sparkId: SparkId): AsyncAppResult<DeleteResult>;
  getByStep(stepId: StepId, options?: ListOptions): AsyncAppResult<ListResult<Spark>>;
  getActiveForStep(stepId: StepId): AsyncAppResult<Spark | null>;
}

/**
 * Reminder store interface.
 * Implements IReminderStore from Phase 11.
 */
export interface IReminderStore {
  save(reminder: ReminderSchedule): AsyncAppResult<ReminderSchedule>;
  get(reminderId: ReminderId): AsyncAppResult<ReminderSchedule | null>;
  delete(reminderId: ReminderId): AsyncAppResult<boolean>;
  getPendingByUser(userId: UserId): AsyncAppResult<readonly ReminderSchedule[]>;
  getPendingBySpark(sparkId: SparkId): AsyncAppResult<readonly ReminderSchedule[]>;
  getDueReminders(beforeTime?: Date): AsyncAppResult<readonly ReminderSchedule[]>;
  updateStatus(reminderId: ReminderId, status: ReminderStatus, timestamp?: Timestamp): AsyncAppResult<void>;
  deleteBySpark(sparkId: SparkId): AsyncAppResult<number>;
}

/**
 * Refinement state for SwordGate.
 */
export interface RefinementState {
  /** User ID */
  readonly userId: UserId;

  /** Goal being refined (if any) */
  readonly goalId?: GoalId;

  /** Current refinement stage */
  readonly stage: 'initial' | 'clarifying' | 'confirming' | 'complete';

  /** Collected user inputs */
  readonly inputs: Record<string, unknown>;

  /** Created at */
  readonly createdAt: Timestamp;

  /** Updated at */
  readonly updatedAt: Timestamp;

  /** Expires at (TTL) */
  readonly expiresAt: Timestamp;
}

/**
 * Refinement state store interface.
 */
export interface IRefinementStore {
  save(state: RefinementState): AsyncAppResult<RefinementState>;
  get(userId: UserId): AsyncAppResult<RefinementState | null>;
  delete(userId: UserId): AsyncAppResult<boolean>;
  update(userId: UserId, updates: Partial<RefinementState>): AsyncAppResult<RefinementState>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMBINED STORE INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Combined interface for all Spark Engine stores.
 * Provides a unified access point.
 */
export interface ISparkEngineStores {
  readonly goals: IGoalStore;
  readonly quests: IQuestStore;
  readonly steps: IStepStore;
  readonly sparks: ISparkStore;
  readonly reminders: IReminderStore;
  readonly refinement: IRefinementStore;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE GUARDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check if a value is a valid StoredEntity.
 */
export function isStoredEntity<T>(value: unknown): value is StoredEntity<T> {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    'data' in obj &&
    'metadata' in obj &&
    typeof obj.metadata === 'object' &&
    obj.metadata !== null
  );
}

/**
 * Check if a value is valid EntityMetadata.
 */
export function isEntityMetadata(value: unknown): value is EntityMetadata {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.createdAt === 'string' &&
    typeof obj.updatedAt === 'string' &&
    typeof obj.version === 'number' &&
    typeof obj.encrypted === 'boolean' &&
    typeof obj.integrityHash === 'string'
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extract the entity type from a StoredEntity.
 */
export type ExtractEntity<S> = S extends StoredEntity<infer T> ? T : never;

/**
 * Make all properties of T mutable (for internal use).
 */
export type Mutable<T> = {
  -readonly [P in keyof T]: T[P];
};

/**
 * Entity with version (for optimistic locking).
 */
export type WithVersion<T> = T & { readonly _version: number };
