// ═══════════════════════════════════════════════════════════════════════════════
// LEAK GUARD — Two-Mode Numeric Validation Engine
// Phase 5: Leak Guard
// 
// The Leak Guard is the LAST line of defense before model output reaches users.
// It operates in two modes:
// 
// 1. FORBID MODE: Block ALL numeric content (used when provider failed)
// 2. ALLOWLIST MODE: Only allow tokenized numbers + exemptions (normal operation)
// 
// CRITICAL: This is a TERMINAL guard. If it catches a violation, the response
// is replaced with a safe fallback. There is no retry.
// ═══════════════════════════════════════════════════════════════════════════════

import type { LiveCategory } from '../../types/categories.js';
import type {
  NumericToken,
  NumericTokenSet,
  NumericExemptions,
  ResponseConstraints,
  NumericContextKey,
} from '../../types/constraints.js';

import { safeMatchAll, getMatchesWithPositions } from '../../utils/regex.js';
import { canonicalizeNumeric, generateCanonicalVariants } from '../../utils/canonicalize.js';

import {
  getPattern,
  findAllMatches,
  hasAnyNumeric,
  PRIORITY_PATTERNS,
  SECONDARY_PATTERNS,
  TERTIARY_PATTERNS,
  ALWAYS_EXEMPT_PATTERNS,
  SPELLED_NUMBER_PATTERN,
  type LeakPatternKey,
  type PatternCategory,
} from './leak-patterns.js';

import {
  isExempted,
  filterNonExempted,
  type ExemptionReason,
} from './leak-exemptions.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Leak guard operation mode.
 */
export type LeakGuardMode = 'forbid' | 'allowlist';

/**
 * A detected leak violation.
 */
export interface LeakViolation {
  /** The matched text that violated */
  readonly match: string;
  
  /** Index in the response */
  readonly index: number;
  
  /** Length of the match */
  readonly length: number;
  
  /** Pattern that detected it (if applicable) */
  readonly pattern?: LeakPatternKey;
  
  /** Pattern category */
  readonly category?: PatternCategory;
  
  /** Why this is a violation */
  readonly reason: string;
  
  /** Canonical form of the number (if extractable) */
  readonly canonical?: string;
  
  /** Surrounding context for debugging */
  readonly context?: string;
}

/**
 * Result of leak guard check.
 */
export interface LeakGuardResult {
  /** Whether the response passed validation */
  readonly passed: boolean;
  
  /** Mode that was used */
  readonly mode: LeakGuardMode;
  
  /** All detected violations */
  readonly violations: readonly LeakViolation[];
  
  /** Violations after exemptions applied */
  readonly unexemptedViolations: readonly LeakViolation[];
  
  /** Whether this is an invalid system state */
  readonly invalidState: boolean;
  
  /** Invalid state reason (if applicable) */
  readonly invalidStateReason?: string;
  
  /** Processing time in milliseconds */
  readonly processingTimeMs: number;
  
  /** Debug trace */
  readonly trace: LeakGuardTrace;
}

/**
 * Trace information for debugging.
 */
export interface LeakGuardTrace {
  /** Total patterns checked */
  readonly patternsChecked: number;
  
  /** Total matches found */
  readonly matchesFound: number;
  
  /** Matches exempted */
  readonly matchesExempted: number;
  
  /** Overlapping matches deduplicated */
  readonly overlapsDeduplicated: number;
  
  /** Exemption reasons used */
  readonly exemptionReasons: readonly ExemptionReason[];
  
  /** Tokens checked against (allowlist mode) */
  readonly tokensChecked: number;
  
  /** Tokens that matched */
  readonly tokensMatched: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONTEXT KEYWORDS — For token validation in ALLOWLIST mode
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Context keywords for each NumericContextKey.
 * A token is only valid if the surrounding text contains relevant keywords.
 */
const CONTEXT_KEYWORDS: Readonly<Record<NumericContextKey, readonly string[]>> = {
  // Price contexts
  price: ['price', 'priced', 'pricing', 'cost', 'costs', 'trading', 'trades', 'worth', 'valued', 'quoted'],
  price_usd: ['price', 'usd', 'dollar', 'dollars', '$', 'cost', 'trading'],
  price_btc: ['price', 'btc', 'bitcoin', 'satoshi', 'sats'],
  market_cap: ['market cap', 'capitalization', 'mcap', 'valuation', 'valued'],
  volume: ['volume', 'traded', 'trading volume', 'shares', 'turnover'],
  open: ['open', 'opened', 'opening', 'market open'],
  close: ['close', 'closed', 'closing', 'market close', 'last'],
  high: ['high', 'highest', 'peak', 'maximum', 'max'],
  low: ['low', 'lowest', 'bottom', 'minimum', 'min'],
  previous_close: ['previous', 'yesterday', 'prior', 'last close'],
  
  // Change contexts
  change: ['change', 'changed', 'movement', 'move', 'moved', 'gain', 'loss'],
  change_absolute: ['change', 'up', 'down', 'gained', 'lost', 'rose', 'fell', 'points'],
  change_percent: ['change', 'percent', '%', 'up', 'down', 'gained', 'lost', 'rose', 'fell'],
  change_1h: ['hour', '1h', 'hourly', 'last hour'],
  change_24h: ['24h', '24 hour', 'day', 'daily', 'today'],
  change_7d: ['7d', '7 day', 'week', 'weekly'],
  
  // Rate contexts
  rate: ['rate', 'rates', 'exchange', 'conversion', 'convert'],
  exchange_rate: ['exchange', 'rate', 'fx', 'forex', 'conversion', 'convert', 'equals'],
  bid: ['bid', 'buy', 'buying'],
  ask: ['ask', 'sell', 'selling', 'offer'],
  spread: ['spread', 'difference', 'gap'],
  
  // Weather contexts
  temperature: ['temperature', 'temp', 'degrees', '°', 'warm', 'cold', 'hot'],
  temperature_c: ['celsius', '°c', 'c', 'degrees'],
  temperature_f: ['fahrenheit', '°f', 'f', 'degrees'],
  feels_like: ['feels like', 'feels', 'apparent', 'real feel'],
  humidity: ['humidity', 'humid', 'moisture', '%'],
  wind_speed: ['wind', 'winds', 'speed', 'gust', 'gusting'],
  wind_speed_kph: ['wind', 'km/h', 'kph', 'kilometers'],
  wind_speed_mph: ['wind', 'mph', 'miles'],
  pressure: ['pressure', 'barometric', 'mb', 'hpa', 'mbar'],
  uv_index: ['uv', 'ultraviolet', 'index', 'sun'],
  visibility: ['visibility', 'visible', 'visibility'],
  
  // Time contexts
  timestamp: ['time', 'timestamp', 'at', 'as of'],
  unix_timestamp: ['unix', 'epoch', 'timestamp'],
  utc_offset: ['utc', 'offset', 'timezone', 'gmt'],
  dst_offset: ['dst', 'daylight', 'saving'],
  
  // Supply contexts
  circulating_supply: ['circulating', 'supply', 'circulation'],
  max_supply: ['max', 'maximum', 'supply', 'cap', 'limit'],
  total_supply: ['total', 'supply', 'all'],
  
  // Generic contexts
  count: ['count', 'number', 'total', 'amount'],
  quantity: ['quantity', 'qty', 'amount', 'number'],
  index: ['index', 'position', 'rank'],
  rank: ['rank', 'ranking', 'position', '#'],
};

/**
 * Get context keywords for a token's context key.
 */
function getContextKeywords(contextKey: NumericContextKey): readonly string[] {
  return CONTEXT_KEYWORDS[contextKey] ?? [];
}

/**
 * Check if surrounding text contains valid context for a token.
 */
function hasValidContext(
  surroundingText: string,
  contextKey: NumericContextKey
): boolean {
  const keywords = getContextKeywords(contextKey);
  const lowerText = surroundingText.toLowerCase();
  
  return keywords.some(keyword => lowerText.includes(keyword.toLowerCase()));
}

// ─────────────────────────────────────────────────────────────────────────────────
// DEDUPLICATION — Handle overlapping matches
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Deduplicate overlapping violations.
 * Keeps the longest match when violations overlap.
 */
function deduplicateViolations(violations: LeakViolation[]): LeakViolation[] {
  if (violations.length <= 1) {
    return violations;
  }
  
  // Sort by start index, then by length (descending)
  const sorted = [...violations].sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index;
    return b.length - a.length;  // Longer matches first
  });
  
  const result: LeakViolation[] = [];
  let lastEnd = -1;
  
  for (const violation of sorted) {
    const start = violation.index;
    const end = start + violation.length;
    
    // Skip if this violation is contained within a previous one
    if (start < lastEnd) {
      continue;
    }
    
    result.push(violation);
    lastEnd = end;
  }
  
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────────
// FORBID MODE — Block ALL numeric content
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Check for numeric leaks in FORBID mode.
 * 
 * FORBID mode is used when the provider failed and we have no verified data.
 * ANY numeric content (except always-exempt patterns) is a violation.
 * 
 * @param response - The model response to check
 * @param category - The data category (for INVALID STATE detection)
 * @param exemptions - Exemption configuration
 * @returns Leak guard result
 */
export function checkLeakForbidMode(
  response: string,
  category: LiveCategory,
  exemptions: NumericExemptions
): LeakGuardResult {
  const startTime = Date.now();
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // INVALID STATE CHECK
  // ═══════════════════════════════════════════════════════════════════════════════
  
  // time category should NEVER reach FORBID mode
  // Time providers should always succeed (use system time as fallback)
  if (category === 'time') {
    return {
      passed: false,
      mode: 'forbid',
      violations: [],
      unexemptedViolations: [],
      invalidState: true,
      invalidStateReason: 'INVALID STATE: time category reached FORBID mode. Time should always have a fallback.',
      processingTimeMs: Date.now() - startTime,
      trace: {
        patternsChecked: 0,
        matchesFound: 0,
        matchesExempted: 0,
        overlapsDeduplicated: 0,
        exemptionReasons: [],
        tokensChecked: 0,
        tokensMatched: 0,
      },
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // QUICK CHECK — Fast path if no numerics
  // ═══════════════════════════════════════════════════════════════════════════════
  
  if (!hasAnyNumeric(response)) {
    return {
      passed: true,
      mode: 'forbid',
      violations: [],
      unexemptedViolations: [],
      invalidState: false,
      processingTimeMs: Date.now() - startTime,
      trace: {
        patternsChecked: 1,
        matchesFound: 0,
        matchesExempted: 0,
        overlapsDeduplicated: 0,
        exemptionReasons: [],
        tokensChecked: 0,
        tokensMatched: 0,
      },
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // FULL PATTERN SCAN
  // ═══════════════════════════════════════════════════════════════════════════════
  
  const allViolations: LeakViolation[] = [];
  const exemptionReasonsSet = new Set<ExemptionReason>();
  let matchesExempted = 0;
  
  // Combine all patterns except always-exempt ones
  const patternsToCheck = [
    ...PRIORITY_PATTERNS,
    ...SECONDARY_PATTERNS,
    ...TERTIARY_PATTERNS,
  ].filter(p => !ALWAYS_EXEMPT_PATTERNS.includes(p));
  
  // Check each pattern
  for (const patternKey of patternsToCheck) {
    const matches = findAllMatches(response, [patternKey]);
    
    for (const match of matches) {
      // Check exemption
      const exemption = isExempted(match.match, match.index, response, exemptions);
      
      if (exemption.exempted) {
        matchesExempted++;
        if (exemption.reason) {
          exemptionReasonsSet.add(exemption.reason);
        }
        continue;
      }
      
      // This is a violation
      const context = response.slice(
        Math.max(0, match.index - 30),
        Math.min(response.length, match.index + match.match.length + 30)
      );
      
      allViolations.push({
        match: match.match,
        index: match.index,
        length: match.match.length,
        pattern: match.pattern,
        category: match.category,
        reason: 'FORBID mode: No numeric content allowed',
        canonical: canonicalizeNumeric(match.match),
        context,
      });
    }
  }
  
  // Also check spelled numbers
  SPELLED_NUMBER_PATTERN.lastIndex = 0;
  const spelledMatches = safeMatchAll(SPELLED_NUMBER_PATTERN, response);
  
  for (const match of spelledMatches) {
    const index = match.index ?? 0;
    const matchText = match[0];
    
    // Check exemption
    const exemption = isExempted(matchText, index, response, exemptions);
    
    if (exemption.exempted) {
      matchesExempted++;
      if (exemption.reason) {
        exemptionReasonsSet.add(exemption.reason);
      }
      continue;
    }
    
    const context = response.slice(
      Math.max(0, index - 30),
      Math.min(response.length, index + matchText.length + 30)
    );
    
    allViolations.push({
      match: matchText,
      index,
      length: matchText.length,
      pattern: 'spelled_cardinal',
      category: 'spelled',
      reason: 'FORBID mode: Spelled numbers not allowed',
      context,
    });
  }
  
  // Deduplicate overlapping violations
  const deduplicated = deduplicateViolations(allViolations);
  const overlapsDeduplicated = allViolations.length - deduplicated.length;
  
  return {
    passed: deduplicated.length === 0,
    mode: 'forbid',
    violations: allViolations,
    unexemptedViolations: deduplicated,
    invalidState: false,
    processingTimeMs: Date.now() - startTime,
    trace: {
      patternsChecked: patternsToCheck.length + 1,  // +1 for spelled numbers
      matchesFound: allViolations.length + matchesExempted,
      matchesExempted,
      overlapsDeduplicated,
      exemptionReasons: [...exemptionReasonsSet],
      tokensChecked: 0,
      tokensMatched: 0,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// ALLOWLIST MODE — Only allow tokenized numbers
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Generate all string variants for a token value.
 */
function generateTokenVariants(token: NumericToken): Set<string> {
  const variants = new Set<string>();
  
  // Add formatted version if available
  if (token.formatted) {
    variants.add(token.formatted);
    variants.add(canonicalizeNumeric(token.formatted));
  }
  
  // Generate canonical variants
  const generated = generateCanonicalVariants(token.value, {
    includeCurrency: true,
    currencySymbols: ['$', '€', '£'],
    includePercentage: token.contextKey.includes('percent') || token.contextKey.includes('change'),
    includeNegative: token.value < 0,
    includeThousandsSeparators: true,
    maxDecimalPlaces: token.precision ?? 2,
    includePositiveSign: token.contextKey.includes('change'),
  });
  
  for (const variant of generated) {
    variants.add(variant);
    variants.add(canonicalizeNumeric(variant));
  }
  
  // Add the raw value in various formats
  variants.add(String(token.value));
  variants.add(token.value.toFixed(2));
  if (Number.isInteger(token.value)) {
    variants.add(token.value.toFixed(0));
  }
  
  return variants;
}

/**
 * Check if a match corresponds to an allowed token.
 */
function matchesToken(
  match: string,
  matchIndex: number,
  response: string,
  tokens: NumericTokenSet
): { matched: boolean; token?: NumericToken } {
  const canonical = canonicalizeNumeric(match);
  const numericValue = parseFloat(canonical);
  
  if (isNaN(numericValue)) {
    return { matched: false };
  }
  
  // Look up by value
  const possibleTokens = tokens.byValue.get(numericValue);
  if (!possibleTokens || possibleTokens.length === 0) {
    return { matched: false };
  }
  
  // Get surrounding context
  const contextStart = Math.max(0, matchIndex - 50);
  const contextEnd = Math.min(response.length, matchIndex + match.length + 50);
  const surroundingText = response.slice(contextStart, contextEnd);
  
  // Check each possible token for context match
  for (const token of possibleTokens) {
    // Verify context keywords
    if (hasValidContext(surroundingText, token.contextKey)) {
      return { matched: true, token };
    }
  }
  
  // Value matches but context doesn't
  return { matched: false };
}

/**
 * Check for numeric leaks in ALLOWLIST mode.
 * 
 * ALLOWLIST mode is used when we have verified data from providers.
 * Only numbers that match allowed tokens (with context validation) or
 * exemptions are permitted.
 * 
 * @param response - The model response to check
 * @param tokens - Allowed numeric tokens from providers
 * @param exemptions - Exemption configuration
 * @returns Leak guard result
 */
export function checkLeakAllowlistMode(
  response: string,
  tokens: NumericTokenSet,
  exemptions: NumericExemptions
): LeakGuardResult {
  const startTime = Date.now();
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // QUICK CHECK — Fast path if no numerics
  // ═══════════════════════════════════════════════════════════════════════════════
  
  if (!hasAnyNumeric(response)) {
    return {
      passed: true,
      mode: 'allowlist',
      violations: [],
      unexemptedViolations: [],
      invalidState: false,
      processingTimeMs: Date.now() - startTime,
      trace: {
        patternsChecked: 1,
        matchesFound: 0,
        matchesExempted: 0,
        overlapsDeduplicated: 0,
        exemptionReasons: [],
        tokensChecked: tokens.tokens.size,
        tokensMatched: 0,
      },
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // BUILD TOKEN VARIANT LOOKUP
  // ═══════════════════════════════════════════════════════════════════════════════
  
  const tokenVariantMap = new Map<string, NumericToken>();
  
  for (const [, token] of tokens.tokens) {
    const variants = generateTokenVariants(token);
    for (const variant of variants) {
      tokenVariantMap.set(variant, token);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // FULL PATTERN SCAN
  // ═══════════════════════════════════════════════════════════════════════════════
  
  const allViolations: LeakViolation[] = [];
  const exemptionReasonsSet = new Set<ExemptionReason>();
  let matchesExempted = 0;
  let tokensMatched = 0;
  
  // Check priority patterns first (most likely to contain live data)
  const patternsToCheck = [
    ...PRIORITY_PATTERNS,
    ...SECONDARY_PATTERNS,
  ].filter(p => !ALWAYS_EXEMPT_PATTERNS.includes(p));
  
  for (const patternKey of patternsToCheck) {
    const matches = findAllMatches(response, [patternKey]);
    
    for (const match of matches) {
      // First check exemption
      const exemption = isExempted(match.match, match.index, response, exemptions);
      
      if (exemption.exempted) {
        matchesExempted++;
        if (exemption.reason) {
          exemptionReasonsSet.add(exemption.reason);
        }
        continue;
      }
      
      // Check against token allowlist
      const canonical = canonicalizeNumeric(match.match);
      
      // Quick lookup by canonical form
      const directMatch = tokenVariantMap.get(canonical) || tokenVariantMap.get(match.match);
      
      if (directMatch) {
        // Verify context
        const contextStart = Math.max(0, match.index - 50);
        const contextEnd = Math.min(response.length, match.index + match.match.length + 50);
        const surroundingText = response.slice(contextStart, contextEnd);
        
        if (hasValidContext(surroundingText, directMatch.contextKey)) {
          tokensMatched++;
          continue;  // Allowed by token
        }
      }
      
      // Try matching by numeric value with context
      const tokenMatch = matchesToken(match.match, match.index, response, tokens);
      
      if (tokenMatch.matched) {
        tokensMatched++;
        continue;  // Allowed by token with context
      }
      
      // This is a violation
      const context = response.slice(
        Math.max(0, match.index - 30),
        Math.min(response.length, match.index + match.match.length + 30)
      );
      
      allViolations.push({
        match: match.match,
        index: match.index,
        length: match.match.length,
        pattern: match.pattern,
        category: match.category,
        reason: 'ALLOWLIST mode: Number not in allowed tokens or missing context',
        canonical,
        context,
      });
    }
  }
  
  // Deduplicate overlapping violations
  const deduplicated = deduplicateViolations(allViolations);
  const overlapsDeduplicated = allViolations.length - deduplicated.length;
  
  return {
    passed: deduplicated.length === 0,
    mode: 'allowlist',
    violations: allViolations,
    unexemptedViolations: deduplicated,
    invalidState: false,
    processingTimeMs: Date.now() - startTime,
    trace: {
      patternsChecked: patternsToCheck.length,
      matchesFound: allViolations.length + matchesExempted + tokensMatched,
      matchesExempted,
      overlapsDeduplicated,
      exemptionReasons: [...exemptionReasonsSet],
      tokensChecked: tokens.tokens.size,
      tokensMatched,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Check for numeric leaks in model output.
 * 
 * This is the main entry point for the leak guard. It automatically selects
 * the appropriate mode based on the response constraints.
 * 
 * @param response - The model response to check
 * @param constraints - Response constraints (determines mode)
 * @param category - The primary data category
 * @returns Leak guard result
 */
export function checkNumericLeak(
  response: string,
  constraints: ResponseConstraints,
  category: LiveCategory
): LeakGuardResult {
  // Determine mode based on constraints
  if (!constraints.numericPrecisionAllowed) {
    // FORBID MODE: Provider failed, no numeric data allowed
    return checkLeakForbidMode(response, category, constraints.numericExemptions);
  }
  
  if (constraints.allowedTokens) {
    // ALLOWLIST MODE: Only tokenized numbers allowed
    return checkLeakAllowlistMode(
      response,
      constraints.allowedTokens,
      constraints.numericExemptions
    );
  }
  
  // No token validation required (permissive mode)
  // This should be rare - most live data queries should have tokens
  return {
    passed: true,
    mode: 'allowlist',
    violations: [],
    unexemptedViolations: [],
    invalidState: false,
    processingTimeMs: 0,
    trace: {
      patternsChecked: 0,
      matchesFound: 0,
      matchesExempted: 0,
      overlapsDeduplicated: 0,
      exemptionReasons: [],
      tokensChecked: 0,
      tokensMatched: 0,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Get a human-readable summary of the leak guard result.
 */
export function getResultSummary(result: LeakGuardResult): string {
  if (result.invalidState) {
    return `INVALID STATE: ${result.invalidStateReason}`;
  }
  
  if (result.passed) {
    return `PASSED (${result.mode} mode): No violations detected`;
  }
  
  const violations = result.unexemptedViolations;
  const examples = violations.slice(0, 3).map(v => `"${v.match}"`).join(', ');
  const more = violations.length > 3 ? ` and ${violations.length - 3} more` : '';
  
  return `FAILED (${result.mode} mode): ${violations.length} violation(s) - ${examples}${more}`;
}

/**
 * Check if a result indicates a critical failure.
 */
export function isCriticalFailure(result: LeakGuardResult): boolean {
  return result.invalidState || !result.passed;
}

/**
 * Get violation matches for redaction.
 */
export function getViolationMatches(result: LeakGuardResult): string[] {
  return result.unexemptedViolations.map(v => v.match);
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export {
  CONTEXT_KEYWORDS,
};
