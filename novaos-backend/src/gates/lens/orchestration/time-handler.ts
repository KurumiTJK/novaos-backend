// ═══════════════════════════════════════════════════════════════════════════════
// TIME HANDLER — Special Handler for Time Category Queries
// Phase 7: Lens Gate
// 
// Time is unique among live data categories: it has NO qualitative fallback.
// You cannot answer "what time is it in Tokyo?" with a qualitative response.
// If time data is unavailable, the system MUST refuse to answer.
// 
// CRITICAL INVARIANT:
// Time category + provider failure → REFUSE (no degraded response allowed)
// This is enforced through the failure semantics system.
// ═══════════════════════════════════════════════════════════════════════════════

import type { LiveCategory } from '../../../types/categories.js';
import type { TimeData, ProviderResult, ProviderOkResult } from '../../../types/provider-results.js';
import type { NumericToken } from '../../../types/constraints.js';
import type { ResolvedEntity } from '../../../types/entities.js';
import { isProviderOk } from '../../../types/provider-results.js';
import { formatTimeData, type FormattedDataResult } from '../../../services/live-data/numeric-tokens.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Result of time data handling.
 */
export interface TimeHandlerResult {
  /** Whether time data was successfully retrieved */
  readonly success: boolean;
  
  /** The time data if successful */
  readonly data?: TimeData;
  
  /** Formatted evidence text */
  readonly formattedText?: string;
  
  /** Extracted numeric tokens for allowlist */
  readonly tokens?: readonly NumericToken[];
  
  /** Error message if failed */
  readonly error?: string;
  
  /** The timezone that was queried */
  readonly timezone: string;
  
  /** Whether this is a refusal (no fallback available) */
  readonly isRefusal: boolean;
  
  /** Refusal message if applicable */
  readonly refusalMessage?: string;
}

/**
 * Options for time handling.
 */
export interface TimeHandlerOptions {
  /** User's default timezone (fallback if none specified) */
  readonly defaultTimezone?: string;
  
  /** Time format preference */
  readonly timeFormat?: '12h' | '24h';
  
  /** Whether to include UTC conversion */
  readonly includeUtc?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Default timezone when none is specified and no user default.
 */
const FALLBACK_TIMEZONE = 'UTC';

/**
 * Standard refusal message for time queries.
 */
const TIME_REFUSAL_MESSAGE = 
  'I cannot provide the current time because the time service is unavailable. ' +
  'Unlike other data, time has no qualitative fallback - I need accurate data to answer this question. ' +
  'Please try again in a moment.';

/**
 * Refusal message for invalid timezone.
 */
const INVALID_TIMEZONE_MESSAGE = 
  'I cannot determine the timezone for your query. ' +
  'Please specify a valid timezone (e.g., "America/New_York", "EST", "Tokyo").';

// ─────────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER FUNCTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Handle time data retrieval and formatting.
 * 
 * CRITICAL: If time data cannot be retrieved, this returns a refusal.
 * There is NO qualitative fallback for time queries.
 * 
 * @param providerResult - Result from time provider
 * @param entity - The resolved entity (timezone)
 * @param options - Handler options
 * @returns Time handler result
 * 
 * @example
 * const result = handleTimeData(providerResult, entity);
 * if (result.isRefusal) {
 *   // Must refuse to answer - no fallback available
 *   return createRefusalResponse(result.refusalMessage);
 * }
 */
export function handleTimeData(
  providerResult: ProviderResult | null,
  entity: ResolvedEntity | null,
  options: TimeHandlerOptions = {}
): TimeHandlerResult {
  const timezone = resolveTimezone(entity, options.defaultTimezone);
  
  // ─── CASE 1: No provider result at all ───
  if (!providerResult) {
    console.warn('[TIME-HANDLER] No provider result - refusing');
    return createRefusal(timezone, TIME_REFUSAL_MESSAGE);
  }
  
  // ─── CASE 2: Provider returned error ───
  if (!isProviderOk(providerResult)) {
    console.warn(`[TIME-HANDLER] Provider error: ${providerResult.error.code} - refusing`);
    return createRefusal(
      timezone,
      `${TIME_REFUSAL_MESSAGE} (Error: ${providerResult.error.code})`
    );
  }
  
  // ─── CASE 3: Provider returned success but wrong data type ───
  const okResult = providerResult as ProviderOkResult;
  if (okResult.data.type !== 'time') {
    console.error('[TIME-HANDLER] Provider returned non-time data - refusing');
    return createRefusal(timezone, TIME_REFUSAL_MESSAGE);
  }
  
  // ─── CASE 4: Success - format the time data ───
  const timeData = okResult.data as TimeData;
  
  try {
    const formatted = formatTimeData(timeData, {
      fetchedAt: okResult.fetchedAt,
      timeFormat: options.timeFormat ?? '12h',
    });
    
    console.log(`[TIME-HANDLER] Successfully formatted time for ${timezone}`);
    
    return {
      success: true,
      data: timeData,
      formattedText: formatted.text,
      tokens: formatted.tokens,
      timezone: timeData.timezone,
      isRefusal: false,
    };
  } catch (error) {
    console.error('[TIME-HANDLER] Formatting error:', error);
    return createRefusal(timezone, TIME_REFUSAL_MESSAGE);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// TIMEZONE RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Resolve timezone from entity or defaults.
 */
function resolveTimezone(
  entity: ResolvedEntity | null,
  defaultTimezone?: string
): string {
  // Use entity canonical form if available
  if (entity?.canonicalForm && entity.canonicalForm !== 'local') {
    return entity.canonicalForm;
  }
  
  // Use default timezone if provided
  if (defaultTimezone) {
    return defaultTimezone;
  }
  
  // Fall back to UTC
  return FALLBACK_TIMEZONE;
}

/**
 * Validate a timezone string.
 * This is a basic validation - full validation happens at the provider level.
 */
export function isValidTimezone(timezone: string): boolean {
  if (!timezone || timezone.length === 0) {
    return false;
  }
  
  // Check for IANA format (e.g., "America/New_York")
  if (timezone.includes('/')) {
    const parts = timezone.split('/');
    return parts.length >= 2 && parts.every(p => p.length > 0);
  }
  
  // Check for abbreviation format (e.g., "EST", "UTC")
  if (/^[A-Z]{2,5}$/.test(timezone)) {
    return true;
  }
  
  // Check for offset format (e.g., "+05:30", "-08:00")
  if (/^[+-]\d{2}:\d{2}$/.test(timezone)) {
    return true;
  }
  
  // Check for "local" keyword
  if (timezone === 'local') {
    return true;
  }
  
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────────
// REFUSAL CREATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create a refusal result.
 */
function createRefusal(timezone: string, message: string): TimeHandlerResult {
  return {
    success: false,
    timezone,
    isRefusal: true,
    refusalMessage: message,
    error: message,
  };
}

/**
 * Create an invalid timezone refusal.
 */
export function createInvalidTimezoneRefusal(rawTimezone: string): TimeHandlerResult {
  return {
    success: false,
    timezone: rawTimezone,
    isRefusal: true,
    refusalMessage: INVALID_TIMEZONE_MESSAGE,
    error: `Invalid timezone: ${rawTimezone}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// BATCH TIME HANDLING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Handle multiple time queries (e.g., "what time is it in Tokyo and New York?").
 * 
 * If ANY time query fails, the entire batch is considered a failure.
 * This maintains the no-fallback invariant.
 * 
 * @param results - Map of timezone to provider result
 * @param entities - Resolved entities for each timezone
 * @param options - Handler options
 * @returns Map of timezone to handler result
 */
export function handleMultipleTimeQueries(
  results: ReadonlyMap<string, ProviderResult | null>,
  entities: readonly ResolvedEntity[],
  options: TimeHandlerOptions = {}
): {
  success: boolean;
  results: ReadonlyMap<string, TimeHandlerResult>;
  failedTimezones: readonly string[];
} {
  const handlerResults = new Map<string, TimeHandlerResult>();
  const failedTimezones: string[] = [];
  
  // Create entity lookup
  const entityByTimezone = new Map<string, ResolvedEntity>();
  for (const entity of entities) {
    if (entity.category === 'time' && entity.canonicalForm) {
      entityByTimezone.set(entity.canonicalForm, entity);
    }
  }
  
  // Process each result
  for (const [timezone, providerResult] of results) {
    const entity = entityByTimezone.get(timezone) ?? null;
    const result = handleTimeData(providerResult, entity, options);
    
    handlerResults.set(timezone, result);
    
    if (!result.success) {
      failedTimezones.push(timezone);
    }
  }
  
  // Batch success only if ALL queries succeeded
  const success = failedTimezones.length === 0;
  
  if (!success) {
    console.warn(`[TIME-HANDLER] Batch failed for timezones: ${failedTimezones.join(', ')}`);
  }
  
  return {
    success,
    results: handlerResults,
    failedTimezones,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// TIME-SPECIFIC EVIDENCE BUILDING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Build evidence text for time data.
 * This is a convenience wrapper around formatTimeData.
 */
export function buildTimeEvidence(
  timeData: TimeData,
  options: TimeHandlerOptions = {}
): FormattedDataResult {
  return formatTimeData(timeData, {
    fetchedAt: Date.now(),
    timeFormat: options.timeFormat ?? '12h',
  });
}

/**
 * Build a human-readable time response.
 */
export function buildTimeResponse(
  timeData: TimeData,
  options: TimeHandlerOptions = {}
): string {
  const { timeFormat = '12h' } = options;
  
  // Parse local time
  const localTime = timeData.localTime;
  const formattedTime = timeFormat === '12h'
    ? formatTo12Hour(localTime)
    : localTime;
  
  // Build response
  const abbr = timeData.abbreviation ?? timeData.timezone;
  let response = `The current time in ${timeData.timezone} is ${formattedTime} ${abbr}`;
  
  // Add DST info if relevant
  if (timeData.isDst !== undefined) {
    response += timeData.isDst ? ' (Daylight Saving Time)' : '';
  }
  
  return response;
}

/**
 * Format 24-hour time to 12-hour format.
 */
function formatTo12Hour(time24: string): string {
  const match = time24.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return time24;
  
  let hours = parseInt(match[1]!, 10);
  const minutes = match[2];
  const period = hours >= 12 ? 'PM' : 'AM';
  
  hours = hours % 12;
  if (hours === 0) hours = 12;
  
  return `${hours}:${minutes} ${period}`;
}

// ─────────────────────────────────────────────────────────────────────────────────
// VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Check if a category is time.
 */
export function isTimeCategory(category: LiveCategory): boolean {
  return category === 'time';
}

/**
 * Check if entities include time category.
 */
export function hasTimeEntity(entities: readonly ResolvedEntity[]): boolean {
  return entities.some(e => e.category === 'time');
}

/**
 * Extract time entities from a list of entities.
 */
export function extractTimeEntities(
  entities: readonly ResolvedEntity[]
): readonly ResolvedEntity[] {
  return entities.filter(e => e.category === 'time');
}

/**
 * Get the timezone from a time entity.
 */
export function getTimezoneFromEntity(entity: ResolvedEntity): string | null {
  if (entity.category !== 'time') {
    return null;
  }
  return entity.canonicalForm ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export {
  TIME_REFUSAL_MESSAGE,
  INVALID_TIMEZONE_MESSAGE,
  FALLBACK_TIMEZONE,
};
