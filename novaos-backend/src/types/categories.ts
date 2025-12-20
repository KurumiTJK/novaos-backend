// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORIES — Live Data Category Types
// From Phase 1 types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Categories of live data that require real-time verification.
 */
export type LiveCategory = 
  | 'market'   // Stock prices, indices
  | 'crypto'   // Cryptocurrency prices
  | 'fx'       // Foreign exchange rates
  | 'weather'  // Weather conditions
  | 'time';    // Current time/timezone

/**
 * Categories requiring authoritative source verification.
 */
export type AuthoritativeCategory =
  | 'legal'      // Laws, regulations
  | 'medical'    // Medical information
  | 'government' // Government data
  | 'academic';  // Academic/scientific

/**
 * All data categories (union of live and authoritative).
 */
export type DataCategory = LiveCategory | AuthoritativeCategory | 'general';

/**
 * All valid live categories as a Set.
 */
export const VALID_LIVE_CATEGORIES: ReadonlySet<LiveCategory> = new Set([
  'market',
  'crypto',
  'fx',
  'weather',
  'time',
]);

/**
 * All valid authoritative categories as a Set.
 */
export const VALID_AUTHORITATIVE_CATEGORIES: ReadonlySet<AuthoritativeCategory> = new Set([
  'legal',
  'medical',
  'government',
  'academic',
]);

/**
 * Type guard for LiveCategory.
 */
export function isLiveCategory(value: unknown): value is LiveCategory {
  return typeof value === 'string' && VALID_LIVE_CATEGORIES.has(value as LiveCategory);
}

/**
 * Type guard for AuthoritativeCategory.
 */
export function isAuthoritativeCategory(value: unknown): value is AuthoritativeCategory {
  return typeof value === 'string' && VALID_AUTHORITATIVE_CATEGORIES.has(value as AuthoritativeCategory);
}
