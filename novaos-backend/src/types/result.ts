// ═══════════════════════════════════════════════════════════════════════════════
// RESULT PATTERN — Type-Safe Error Handling
// Sword System v3.0 — Phase 1: Configuration & Core Types
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// CORE RESULT TYPE
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Success variant of Result.
 */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
  readonly error?: never;
}

/**
 * Failure variant of Result.
 */
export interface Err<E> {
  readonly ok: false;
  readonly error: E;
  readonly value?: never;
}

/**
 * Result type representing either success (Ok) or failure (Err).
 * 
 * Use this instead of throwing exceptions for expected failure cases.
 * 
 * @example
 * ```typescript
 * function divide(a: number, b: number): Result<number, string> {
 *   if (b === 0) {
 *     return err('Division by zero');
 *   }
 *   return ok(a / b);
 * }
 * 
 * const result = divide(10, 2);
 * if (result.ok) {
 *   console.log(result.value); // 5
 * } else {
 *   console.error(result.error);
 * }
 * ```
 */
export type Result<T, E = Error> = Ok<T> | Err<E>;

/**
 * Async Result type — Promise that resolves to a Result.
 */
export type AsyncResult<T, E = Error> = Promise<Result<T, E>>;

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTRUCTORS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create a success Result.
 */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/**
 * Create a failure Result.
 */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/**
 * Create a success Result with no value (void).
 */
export function okVoid(): Ok<void> {
  return { ok: true, value: undefined };
}

// ─────────────────────────────────────────────────────────────────────────────────
// TYPE GUARDS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Check if a Result is Ok.
 */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok === true;
}

/**
 * Check if a Result is Err.
 */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return result.ok === false;
}

// ─────────────────────────────────────────────────────────────────────────────────
// UNWRAP OPERATIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Unwrap the value from an Ok Result.
 * Throws if the Result is Err.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.value;
  }
  throw new Error(`Unwrap called on Err: ${String(result.error)}`);
}

/**
 * Unwrap the value from an Ok Result, or return a default.
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (result.ok) {
    return result.value;
  }
  return defaultValue;
}

/**
 * Unwrap the value from an Ok Result, or compute a default.
 */
export function unwrapOrElse<T, E>(result: Result<T, E>, fn: (error: E) => T): T {
  if (result.ok) {
    return result.value;
  }
  return fn(result.error);
}

/**
 * Unwrap the error from an Err Result.
 * Throws if the Result is Ok.
 */
export function unwrapErr<T, E>(result: Result<T, E>): E {
  if (!result.ok) {
    return result.error;
  }
  throw new Error('unwrapErr called on Ok');
}

// ─────────────────────────────────────────────────────────────────────────────────
// TRANSFORMATION OPERATIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Map the value of an Ok Result.
 */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  if (result.ok) {
    return ok(fn(result.value));
  }
  return result;
}

/**
 * Map the error of an Err Result.
 */
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  if (!result.ok) {
    return err(fn(result.error));
  }
  return result;
}

/**
 * Chain Result-returning operations (flatMap).
 */
export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> {
  if (result.ok) {
    return fn(result.value);
  }
  return result;
}

/**
 * Recover from an error with a Result-returning function.
 */
export function orElse<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => Result<T, F>
): Result<T, F> {
  if (!result.ok) {
    return fn(result.error);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────────
// ASYNC OPERATIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Map the value of an async Ok Result.
 */
export async function mapAsync<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Promise<U>
): AsyncResult<U, E> {
  if (result.ok) {
    return ok(await fn(result.value));
  }
  return result;
}

/**
 * Chain async Result-returning operations.
 */
export async function andThenAsync<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => AsyncResult<U, E>
): AsyncResult<U, E> {
  if (result.ok) {
    return fn(result.value);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────────
// COLLECTION OPERATIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Collect an array of Results into a Result of array.
 * Returns Err with the first error encountered.
 */
export function collect<T, E>(results: ReadonlyArray<Result<T, E>>): Result<T[], E> {
  const values: T[] = [];
  
  for (const result of results) {
    if (!result.ok) {
      return result;
    }
    values.push(result.value);
  }
  
  return ok(values);
}

/**
 * Collect an array of Results, accumulating all errors.
 */
export function collectAll<T, E>(
  results: ReadonlyArray<Result<T, E>>
): Result<T[], E[]> {
  const values: T[] = [];
  const errors: E[] = [];
  
  for (const result of results) {
    if (result.ok) {
      values.push(result.value);
    } else {
      errors.push(result.error);
    }
  }
  
  if (errors.length > 0) {
    return err(errors);
  }
  
  return ok(values);
}

/**
 * Partition an array of Results into successes and failures.
 */
export function partition<T, E>(
  results: ReadonlyArray<Result<T, E>>
): { ok: T[]; err: E[] } {
  const okValues: T[] = [];
  const errValues: E[] = [];
  
  for (const result of results) {
    if (result.ok) {
      okValues.push(result.value);
    } else {
      errValues.push(result.error);
    }
  }
  
  return { ok: okValues, err: errValues };
}

// ─────────────────────────────────────────────────────────────────────────────────
// TRY/CATCH UTILITIES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Wrap a function that might throw into a Result-returning function.
 */
export function tryCatch<T>(fn: () => T): Result<T, Error> {
  try {
    return ok(fn());
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Wrap an async function that might throw into an AsyncResult-returning function.
 */
export async function tryCatchAsync<T>(fn: () => Promise<T>): AsyncResult<T, Error> {
  try {
    return ok(await fn());
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Convert a Promise to an AsyncResult.
 */
export async function fromPromise<T>(promise: Promise<T>): AsyncResult<T, Error> {
  return tryCatchAsync(() => promise);
}

/**
 * Convert a Result to a Promise that rejects on Err.
 */
export function toPromise<T, E>(result: Result<T, E>): Promise<T> {
  if (result.ok) {
    return Promise.resolve(result.value);
  }
  return Promise.reject(result.error);
}

// ─────────────────────────────────────────────────────────────────────────────────
// PATTERN MATCHING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Pattern match on a Result.
 */
export function match<T, E, U>(
  result: Result<T, E>,
  handlers: {
    ok: (value: T) => U;
    err: (error: E) => U;
  }
): U {
  if (result.ok) {
    return handlers.ok(result.value);
  }
  return handlers.err(result.error);
}

/**
 * Pattern match on a Result (async handlers).
 */
export async function matchAsync<T, E, U>(
  result: Result<T, E>,
  handlers: {
    ok: (value: T) => Promise<U>;
    err: (error: E) => Promise<U>;
  }
): Promise<U> {
  if (result.ok) {
    return handlers.ok(result.value);
  }
  return handlers.err(result.error);
}

// ─────────────────────────────────────────────────────────────────────────────────
// COMMON ERROR TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Standard application error with code and context.
 */
export interface AppError {
  readonly code: string;
  readonly message: string;
  readonly cause?: Error;
  readonly context?: Record<string, unknown>;
}

/**
 * Create an AppError.
 */
export function appError(
  code: string,
  message: string,
  options?: { cause?: Error; context?: Record<string, unknown> }
): AppError {
  return {
    code,
    message,
    cause: options?.cause,
    context: options?.context,
  };
}

/**
 * Common error codes.
 */
export const ErrorCode = {
  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  
  // Not found
  NOT_FOUND: 'NOT_FOUND',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  GOAL_NOT_FOUND: 'GOAL_NOT_FOUND',
  
  // Authorization
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  
  // Rate limiting
  RATE_LIMITED: 'RATE_LIMITED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  
  // External services
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  TIMEOUT: 'TIMEOUT',
  NETWORK_ERROR: 'NETWORK_ERROR',
  
  // Internal
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
} as const;

export type ErrorCode = typeof ErrorCode[keyof typeof ErrorCode];

/**
 * Type alias for Result with AppError.
 */
export type AppResult<T> = Result<T, AppError>;

/**
 * Type alias for AsyncResult with AppError.
 */
export type AsyncAppResult<T> = AsyncResult<T, AppError>;
