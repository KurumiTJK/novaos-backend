// ═══════════════════════════════════════════════════════════════════════════════
// BRANDED TYPES — Compile-Time Type Safety for IDs and Special Values
// Sword System v3.0 — Phase 1: Configuration & Core Types
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// BRAND SYMBOL
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Unique symbol for branding types.
 * This ensures brands are truly unique and can't be accidentally matched.
 */
declare const brand: unique symbol;

/**
 * Brand type that adds a phantom type to a base type.
 * The brand only exists at compile time — no runtime overhead.
 * 
 * @example
 * ```typescript
 * type UserId = Brand<string, 'UserId'>;
 * type GoalId = Brand<string, 'GoalId'>;
 * 
 * function getUser(id: UserId): User { ... }
 * 
 * const userId = 'user-123' as UserId;
 * const goalId = 'goal-456' as GoalId;
 * 
 * getUser(userId); // ✓ OK
 * getUser(goalId); // ✗ Compile error: GoalId not assignable to UserId
 * ```
 */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

// ─────────────────────────────────────────────────────────────────────────────────
// ID TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * User identifier.
 */
export type UserId = Brand<string, 'UserId'>;

/**
 * Goal identifier.
 */
export type GoalId = Brand<string, 'GoalId'>;

/**
 * Quest identifier.
 */
export type QuestId = Brand<string, 'QuestId'>;

/**
 * Step identifier.
 */
export type StepId = Brand<string, 'StepId'>;

/**
 * Spark identifier.
 */
export type SparkId = Brand<string, 'SparkId'>;

/**
 * Reminder identifier.
 */
export type ReminderId = Brand<string, 'ReminderId'>;

/**
 * Resource identifier.
 */
export type ResourceId = Brand<string, 'ResourceId'>;

/**
 * Conversation identifier.
 */
export type ConversationId = Brand<string, 'ConversationId'>;

/**
 * Message identifier.
 */
export type MessageId = Brand<string, 'MessageId'>;

/**
 * Memory identifier.
 */
export type MemoryId = Brand<string, 'MemoryId'>;

/**
 * Request identifier (for tracing/correlation).
 */
export type RequestId = Brand<string, 'RequestId'>;

/**
 * Session identifier.
 */
export type SessionId = Brand<string, 'SessionId'>;

/**
 * Audit log identifier.
 */
export type AuditId = Brand<string, 'AuditId'>;

// ─────────────────────────────────────────────────────────────────────────────────
// SPECIAL VALUE TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * ISO 8601 timestamp string.
 */
export type Timestamp = Brand<string, 'Timestamp'>;

/**
 * Unix timestamp in milliseconds.
 */
export type UnixTimestampMs = Brand<number, 'UnixTimestampMs'>;

/**
 * JWT token string.
 */
export type JWTToken = Brand<string, 'JWTToken'>;

/**
 * API key string.
 */
export type ApiKey = Brand<string, 'ApiKey'>;

/**
 * Email address string.
 */
export type Email = Brand<string, 'Email'>;

/**
 * URL string.
 */
export type UrlString = Brand<string, 'UrlString'>;

/**
 * JSON string.
 */
export type JsonString = Brand<string, 'JsonString'>;

/**
 * Base64-encoded string.
 */
export type Base64String = Brand<string, 'Base64String'>;

/**
 * Hash (SHA-256, etc.) string.
 */
export type HashString = Brand<string, 'HashString'>;

/**
 * Correlation ID for distributed tracing.
 */
export type CorrelationId = Brand<string, 'CorrelationId'>;

// ─────────────────────────────────────────────────────────────────────────────────
// NUMERIC TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Positive integer (> 0).
 */
export type PositiveInt = Brand<number, 'PositiveInt'>;

/**
 * Non-negative integer (>= 0).
 */
export type NonNegativeInt = Brand<number, 'NonNegativeInt'>;

/**
 * Percentage value (0-100).
 */
export type Percentage = Brand<number, 'Percentage'>;

/**
 * Progress value (0-1).
 */
export type Progress = Brand<number, 'Progress'>;

/**
 * Duration in milliseconds.
 */
export type DurationMs = Brand<number, 'DurationMs'>;

// ─────────────────────────────────────────────────────────────────────────────────
// ID CONSTRUCTORS — With validation
// ─────────────────────────────────────────────────────────────────────────────────

import { v4 as uuidv4 } from 'uuid';

/**
 * Create a new UserId.
 */
export function createUserId(value?: string): UserId {
  return (value ?? `user-${uuidv4()}`) as UserId;
}

/**
 * Create a new GoalId.
 */
export function createGoalId(value?: string): GoalId {
  return (value ?? `goal-${uuidv4()}`) as GoalId;
}

/**
 * Create a new QuestId.
 */
export function createQuestId(value?: string): QuestId {
  return (value ?? `quest-${uuidv4()}`) as QuestId;
}

/**
 * Create a new StepId.
 */
export function createStepId(value?: string): StepId {
  return (value ?? `step-${uuidv4()}`) as StepId;
}

/**
 * Create a new SparkId.
 */
export function createSparkId(value?: string): SparkId {
  return (value ?? `spark-${uuidv4()}`) as SparkId;
}

/**
 * Create a new ReminderId.
 */
export function createReminderId(value?: string): ReminderId {
  return (value ?? `reminder-${uuidv4()}`) as ReminderId;
}

/**
 * Create a new ResourceId.
 */
export function createResourceId(value?: string): ResourceId {
  return (value ?? `resource-${uuidv4()}`) as ResourceId;
}

/**
 * Create a new ConversationId.
 */
export function createConversationId(value?: string): ConversationId {
  return (value ?? `conv-${uuidv4()}`) as ConversationId;
}

/**
 * Create a new MessageId.
 */
export function createMessageId(value?: string): MessageId {
  return (value ?? `msg-${uuidv4()}`) as MessageId;
}

/**
 * Create a new MemoryId.
 */
export function createMemoryId(value?: string): MemoryId {
  return (value ?? `mem-${uuidv4()}`) as MemoryId;
}

/**
 * Create a new RequestId.
 */
export function createRequestId(value?: string): RequestId {
  return (value ?? `req-${uuidv4()}`) as RequestId;
}

/**
 * Create a new SessionId.
 */
export function createSessionId(value?: string): SessionId {
  return (value ?? `sess-${uuidv4()}`) as SessionId;
}

/**
 * Create a new AuditId.
 */
export function createAuditId(value?: string): AuditId {
  return (value ?? `audit-${uuidv4()}`) as AuditId;
}

/**
 * Create a new CorrelationId.
 */
export function createCorrelationId(value?: string): CorrelationId {
  return (value ?? `corr-${uuidv4()}`) as CorrelationId;
}

// ─────────────────────────────────────────────────────────────────────────────────
// SPECIAL VALUE CONSTRUCTORS — With validation
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create a Timestamp from a Date or now.
 */
export function createTimestamp(date?: Date): Timestamp {
  return (date ?? new Date()).toISOString() as Timestamp;
}

/**
 * Parse a Timestamp to Date.
 */
export function parseTimestamp(timestamp: Timestamp): Date {
  return new Date(timestamp);
}

/**
 * Create a UnixTimestampMs from a Date or now.
 */
export function createUnixTimestampMs(date?: Date): UnixTimestampMs {
  return (date ?? new Date()).getTime() as UnixTimestampMs;
}

/**
 * Parse a UnixTimestampMs to Date.
 */
export function parseUnixTimestampMs(timestamp: UnixTimestampMs): Date {
  return new Date(timestamp);
}

/**
 * Email validation regex.
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Create an Email with validation.
 * Throws if invalid.
 */
export function createEmail(value: string): Email {
  if (!EMAIL_REGEX.test(value)) {
    throw new Error(`Invalid email: ${value}`);
  }
  return value as Email;
}

/**
 * Try to create an Email, returning null if invalid.
 */
export function tryCreateEmail(value: string): Email | null {
  if (!EMAIL_REGEX.test(value)) {
    return null;
  }
  return value as Email;
}

/**
 * URL validation using URL constructor.
 */
export function createUrlString(value: string): UrlString {
  try {
    new URL(value);
    return value as UrlString;
  } catch {
    throw new Error(`Invalid URL: ${value}`);
  }
}

/**
 * Try to create a UrlString, returning null if invalid.
 */
export function tryCreateUrlString(value: string): UrlString | null {
  try {
    new URL(value);
    return value as UrlString;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// NUMERIC CONSTRUCTORS — With validation
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create a PositiveInt with validation.
 */
export function createPositiveInt(value: number): PositiveInt {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Value must be a positive integer: ${value}`);
  }
  return value as PositiveInt;
}

/**
 * Create a NonNegativeInt with validation.
 */
export function createNonNegativeInt(value: number): NonNegativeInt {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Value must be a non-negative integer: ${value}`);
  }
  return value as NonNegativeInt;
}

/**
 * Create a Percentage with validation (0-100).
 */
export function createPercentage(value: number): Percentage {
  if (value < 0 || value > 100) {
    throw new Error(`Percentage must be between 0 and 100: ${value}`);
  }
  return value as Percentage;
}

/**
 * Create a Progress with validation (0-1).
 */
export function createProgress(value: number): Progress {
  if (value < 0 || value > 1) {
    throw new Error(`Progress must be between 0 and 1: ${value}`);
  }
  return value as Progress;
}

/**
 * Create a DurationMs with validation.
 */
export function createDurationMs(value: number): DurationMs {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Duration must be a non-negative integer: ${value}`);
  }
  return value as DurationMs;
}

// ─────────────────────────────────────────────────────────────────────────────────
// TYPE GUARDS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Check if a string looks like a valid UUID.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}

/**
 * Check if a string is a valid ID with prefix.
 */
export function isValidPrefixedId(value: string, prefix: string): boolean {
  if (!value.startsWith(`${prefix}-`)) {
    return false;
  }
  const uuidPart = value.slice(prefix.length + 1);
  return isValidUUID(uuidPart);
}

/**
 * Check if a value is a valid UserId.
 */
export function isUserId(value: string): value is UserId {
  return isValidPrefixedId(value, 'user');
}

/**
 * Check if a value is a valid GoalId.
 */
export function isGoalId(value: string): value is GoalId {
  return isValidPrefixedId(value, 'goal');
}

/**
 * Check if a value is a valid QuestId.
 */
export function isQuestId(value: string): value is QuestId {
  return isValidPrefixedId(value, 'quest');
}

/**
 * Check if a value is a valid StepId.
 */
export function isStepId(value: string): value is StepId {
  return isValidPrefixedId(value, 'step');
}

/**
 * Check if a value is a valid SparkId.
 */
export function isSparkId(value: string): value is SparkId {
  return isValidPrefixedId(value, 'spark');
}

/**
 * Check if a value is a valid Timestamp (ISO 8601).
 */
export function isTimestamp(value: string): value is Timestamp {
  const date = new Date(value);
  return !isNaN(date.getTime()) && value === date.toISOString();
}

/**
 * Check if a value is a valid Email.
 */
export function isEmail(value: string): value is Email {
  return EMAIL_REGEX.test(value);
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXTRACTION UTILITIES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Extract the raw string value from any branded ID type.
 * Use when you need to pass the ID to external systems.
 */
export function extractId<T extends Brand<string, string>>(id: T): string {
  return id as unknown as string;
}

/**
 * Extract the raw number value from any branded number type.
 */
export function extractNumber<T extends Brand<number, string>>(value: T): number {
  return value as unknown as number;
}

/**
 * Unsafe cast — use only when you're certain the value is valid.
 * Prefer the create* functions when possible.
 */
export function unsafeCast<T>(value: string | number): T {
  return value as unknown as T;
}
