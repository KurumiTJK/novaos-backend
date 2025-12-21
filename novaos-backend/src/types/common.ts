// ═══════════════════════════════════════════════════════════════════════════════
// COMMON UTILITY TYPES — Shared Type Utilities
// Sword System v3.0 — Phase 1: Configuration & Core Types
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// NULLABILITY TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Make a type nullable (T | null).
 */
export type Nullable<T> = T | null;

/**
 * Make a type optional (T | undefined).
 */
export type Optional<T> = T | undefined;

/**
 * Make a type possibly absent (T | null | undefined).
 */
export type Maybe<T> = T | null | undefined;

/**
 * Remove null and undefined from a type.
 */
export type NonNullish<T> = T extends null | undefined ? never : T;

// ─────────────────────────────────────────────────────────────────────────────────
// ARRAY TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Array with at least one element.
 */
export type NonEmptyArray<T> = readonly [T, ...T[]];

/**
 * Mutable version of NonEmptyArray.
 */
export type MutableNonEmptyArray<T> = [T, ...T[]];

/**
 * Array with exactly N elements.
 */
export type FixedArray<T, N extends number> = N extends N
  ? number extends N
    ? T[]
    : _FixedArrayBuilder<T, N, []>
  : never;

type _FixedArrayBuilder<
  T,
  N extends number,
  R extends unknown[]
> = R['length'] extends N ? R : _FixedArrayBuilder<T, N, [T, ...R]>;

/**
 * Get the element type of an array.
 */
export type ArrayElement<T> = T extends readonly (infer E)[] ? E : never;

/**
 * Check if value is a non-empty array.
 */
export function isNonEmptyArray<T>(arr: readonly T[]): arr is NonEmptyArray<T> {
  return arr.length > 0;
}

/**
 * Assert array is non-empty, throwing if empty.
 */
export function assertNonEmpty<T>(arr: readonly T[], message?: string): NonEmptyArray<T> {
  if (arr.length === 0) {
    throw new Error(message ?? 'Expected non-empty array');
  }
  return arr as NonEmptyArray<T>;
}

/**
 * Get the first element of a non-empty array (guaranteed to exist).
 */
export function first<T>(arr: NonEmptyArray<T>): T {
  return arr[0];
}

/**
 * Get the last element of a non-empty array (guaranteed to exist).
 */
export function last<T>(arr: NonEmptyArray<T>): T {
  return arr[arr.length - 1] as T;
}

// ─────────────────────────────────────────────────────────────────────────────────
// OBJECT TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Deep readonly — makes all nested properties readonly.
 */
export type DeepReadonly<T> = T extends (infer R)[]
  ? DeepReadonlyArray<R>
  : T extends Function
  ? T
  : T extends object
  ? DeepReadonlyObject<T>
  : T;

type DeepReadonlyArray<T> = readonly DeepReadonly<T>[];
type DeepReadonlyObject<T> = {
  readonly [P in keyof T]: DeepReadonly<T[P]>;
};

/**
 * Deep partial — makes all nested properties optional.
 */
export type DeepPartial<T> = T extends (infer R)[]
  ? DeepPartialArray<R>
  : T extends Function
  ? T
  : T extends object
  ? DeepPartialObject<T>
  : T | undefined;

type DeepPartialArray<T> = Array<DeepPartial<T>>;
type DeepPartialObject<T> = {
  [P in keyof T]?: DeepPartial<T[P]>;
};

/**
 * Deep required — makes all nested properties required.
 */
export type DeepRequired<T> = T extends (infer R)[]
  ? DeepRequiredArray<R>
  : T extends Function
  ? T
  : T extends object
  ? DeepRequiredObject<T>
  : T;

type DeepRequiredArray<T> = Array<DeepRequired<T>>;
type DeepRequiredObject<T> = {
  [P in keyof T]-?: DeepRequired<T[P]>;
};

/**
 * Make specific keys required.
 */
export type RequiredKeys<T, K extends keyof T> = T & { [P in K]-?: T[P] };

/**
 * Make specific keys optional.
 */
export type OptionalKeys<T, K extends keyof T> = Omit<T, K> & { [P in K]?: T[P] };

/**
 * Pick only the keys with values of a specific type.
 */
export type PickByType<T, U> = {
  [P in keyof T as T[P] extends U ? P : never]: T[P];
};

/**
 * Omit keys with values of a specific type.
 */
export type OmitByType<T, U> = {
  [P in keyof T as T[P] extends U ? never : P]: T[P];
};

/**
 * Get keys of T that are assignable to U.
 */
export type KeysOfType<T, U> = {
  [K in keyof T]: T[K] extends U ? K : never;
}[keyof T];

/**
 * Make all properties mutable (remove readonly).
 */
export type Mutable<T> = {
  -readonly [P in keyof T]: T[P];
};

/**
 * Deep mutable — removes readonly from all nested properties.
 */
export type DeepMutable<T> = T extends (infer R)[]
  ? DeepMutableArray<R>
  : T extends Function
  ? T
  : T extends object
  ? DeepMutableObject<T>
  : T;

type DeepMutableArray<T> = Array<DeepMutable<T>>;
type DeepMutableObject<T> = {
  -readonly [P in keyof T]: DeepMutable<T[P]>;
};

// ─────────────────────────────────────────────────────────────────────────────────
// RECORD TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Dictionary with string keys.
 */
export type Dictionary<T> = Record<string, T>;

/**
 * Dictionary with string keys, values may be undefined.
 */
export type PartialDictionary<T> = Record<string, T | undefined>;

/**
 * Read-only dictionary.
 */
export type ReadonlyDictionary<T> = Readonly<Record<string, T>>;

/**
 * Ensure an object has at least one key.
 */
export type NonEmptyObject<T> = T & { [K in keyof T]: T[K] };

// ─────────────────────────────────────────────────────────────────────────────────
// FUNCTION TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Any function type.
 */
export type AnyFunction = (...args: unknown[]) => unknown;

/**
 * Async function type.
 */
export type AsyncFunction<T = unknown> = (...args: unknown[]) => Promise<T>;

/**
 * Function that takes no arguments.
 */
export type Thunk<T> = () => T;

/**
 * Async thunk.
 */
export type AsyncThunk<T> = () => Promise<T>;

/**
 * Predicate function.
 */
export type Predicate<T> = (value: T) => boolean;

/**
 * Async predicate function.
 */
export type AsyncPredicate<T> = (value: T) => Promise<boolean>;

/**
 * Transformer function.
 */
export type Transformer<T, U> = (value: T) => U;

/**
 * Async transformer function.
 */
export type AsyncTransformer<T, U> = (value: T) => Promise<U>;

/**
 * Consumer function (side effect).
 */
export type Consumer<T> = (value: T) => void;

/**
 * Async consumer function.
 */
export type AsyncConsumer<T> = (value: T) => Promise<void>;

/**
 * Comparator function for sorting.
 */
export type Comparator<T> = (a: T, b: T) => number;

// ─────────────────────────────────────────────────────────────────────────────────
// STRING LITERAL TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Non-empty string type (compile-time only, use with caution).
 */
export type NonEmptyString = string & { readonly __nonEmpty: unique symbol };

/**
 * Create a union of string literal types.
 */
export type StringUnion<T extends string> = T;

/**
 * Get literal type from const array.
 */
export type Literal<T extends readonly unknown[]> = T[number];

// ─────────────────────────────────────────────────────────────────────────────────
// PROMISE TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Unwrap the type inside a Promise.
 */
export type Awaited<T> = T extends Promise<infer U> ? U : T;

/**
 * Make a type or Promise of that type.
 */
export type MaybePromise<T> = T | Promise<T>;

// ─────────────────────────────────────────────────────────────────────────────────
// DISCRIMINATED UNION HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Extract a specific variant from a discriminated union.
 */
export type ExtractVariant<T, K extends string, V> = T extends { [P in K]: V }
  ? T
  : never;

/**
 * Get the discriminator values from a union.
 */
export type DiscriminatorValues<T, K extends keyof T> = T[K];

// ─────────────────────────────────────────────────────────────────────────────────
// ASSERTION HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Assert that a value is defined (not null or undefined).
 */
export function assertDefined<T>(
  value: T | null | undefined,
  message?: string
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message ?? 'Expected value to be defined');
  }
}

/**
 * Assert that a value is not null.
 */
export function assertNotNull<T>(
  value: T | null,
  message?: string
): asserts value is T {
  if (value === null) {
    throw new Error(message ?? 'Expected value to not be null');
  }
}

/**
 * Assert that a condition is true.
 */
export function assert(
  condition: boolean,
  message?: string
): asserts condition is true {
  if (!condition) {
    throw new Error(message ?? 'Assertion failed');
  }
}

/**
 * Exhaustive check for switch statements.
 * Use in default case to ensure all variants are handled.
 */
export function exhaustive(value: never, message?: string): never {
  throw new Error(message ?? `Unhandled case: ${JSON.stringify(value)}`);
}

// ─────────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Identity function.
 */
export function identity<T>(value: T): T {
  return value;
}

/**
 * No-op function.
 */
export function noop(): void {
  // Do nothing
}

/**
 * Constant function — always returns the same value.
 */
export function constant<T>(value: T): () => T {
  return () => value;
}

/**
 * Check if a value is defined (not null or undefined).
 */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Check if a value is null or undefined.
 */
export function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/**
 * Check if a value is an object (not null, not array).
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Check if a value is a non-empty string.
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Pick defined properties from an object.
 */
export function pickDefined<T extends Record<string, unknown>>(
  obj: T
): Partial<T> {
  const result: Partial<T> = {};
  for (const key in obj) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Omit undefined properties from an object.
 */
export function omitUndefined<T extends Record<string, unknown>>(
  obj: T
): { [K in keyof T]: Exclude<T[K], undefined> } {
  return pickDefined(obj) as { [K in keyof T]: Exclude<T[K], undefined> };
}

// ─────────────────────────────────────────────────────────────────────────────────
// TYPE NARROWING HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create a type guard for a specific property value.
 */
export function hasProperty<K extends string, V>(
  key: K,
  value: V
): <T extends Record<K, unknown>>(obj: T) => obj is T & Record<K, V> {
  return (obj): obj is typeof obj & Record<K, V> => obj[key] === value;
}

/**
 * Create a type guard that checks for a specific type discriminator.
 */
export function isType<T extends { type: string }, K extends T['type']>(
  type: K
): (value: T) => value is Extract<T, { type: K }> {
  return (value): value is Extract<T, { type: K }> => value.type === type;
}
