// ═══════════════════════════════════════════════════════════════════════════════
// LEAK EXEMPTIONS — Patterns Allowed Without Token Validation
// Phase 5: Leak Guard
// 
// Some numbers are always safe: dates, version numbers, step counts, etc.
// This file defines exemption patterns and logic to identify these.
// ═══════════════════════════════════════════════════════════════════════════════

import type { NumericExemptions } from '../../types/constraints.js';
import { safeMatchAll, escapeRegex } from '../../utils/regex.js';
import { canonicalizeNumeric } from '../../utils/canonicalize.js';

// ─────────────────────────────────────────────────────────────────────────────────
// EXEMPTION TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Reason why a match was exempted.
 */
export type ExemptionReason =
  | 'year'                    // Year (1900-2100)
  | 'date_day'                // Day of month (1-31)
  | 'small_integer'           // Small counting number (0-N)
  | 'ordinal'                 // Ordinal (1st, 2nd, 3rd)
  | 'step_number'             // Step/list number (Step 1, #2)
  | 'version'                 // Software version (v1.2.3)
  | 'code_block'              // Inside code block
  | 'inline_code'             // Inside inline code
  | 'quoted_text'             // Inside quotes
  | 'iso_timestamp'           // ISO 8601 timestamp
  | 'reference_number'        // Reference/ID number context
  | 'page_number'             // Page/section reference
  | 'phone_number'            // Phone number format
  | 'ip_address'              // IP address format
  | 'custom_pattern'          // Custom exemption pattern
  | 'list_marker';            // List bullet/number (1., 2., etc.)

/**
 * Result of exemption check.
 */
export interface ExemptionResult {
  /** Whether the match is exempted */
  readonly exempted: boolean;
  
  /** Reason for exemption (if exempted) */
  readonly reason?: ExemptionReason;
  
  /** Description of why it was exempted */
  readonly description?: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXEMPTION PATTERNS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Pattern for years (1900-2100).
 * Must be standalone or in date context.
 */
const YEAR_PATTERN = /\b(19\d{2}|20\d{2}|21\d{2})\b/g;

/**
 * Pattern for years in date context.
 */
const YEAR_IN_DATE_PATTERN = /(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?,?\s*(19\d{2}|20\d{2})|(?:19\d{2}|20\d{2})[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/](19\d{2}|20\d{2})/gi;

/**
 * Pattern for ordinals (1st, 2nd, 3rd, 4th, etc.).
 */
const ORDINAL_PATTERN = /\b(\d+)(?:st|nd|rd|th)\b/gi;

/**
 * Pattern for step numbers.
 */
const STEP_NUMBER_PATTERN = /(?:step|phase|stage|part|chapter|section|item|number|no\.?|#)\s*(\d+)/gi;

/**
 * Pattern for list markers.
 */
const LIST_MARKER_PATTERN = /^(\d+)[.)]\s|^\s*[-*•]\s/gm;

/**
 * Pattern for version numbers.
 */
const VERSION_PATTERN = /\bv?(\d+(?:\.\d+){1,3})(?:-[a-zA-Z0-9.]+)?(?:\+[a-zA-Z0-9.]+)?\b/gi;

/**
 * Pattern for code blocks.
 */
const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;

/**
 * Pattern for inline code.
 */
const INLINE_CODE_PATTERN = /`[^`]+`/g;

/**
 * Pattern for quoted text (double or single quotes).
 */
const QUOTED_TEXT_PATTERN = /"[^"]*"|'[^']*'/g;

/**
 * Pattern for ISO timestamps.
 */
const ISO_TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})?/g;

/**
 * Pattern for phone numbers.
 */
const PHONE_NUMBER_PATTERN = /(?:\+?1[-.]?)?\(?[2-9]\d{2}\)?[-.]?\d{3}[-.]?\d{4}/g;

/**
 * Pattern for IP addresses.
 */
const IP_ADDRESS_PATTERN = /\b(?:25[0-5]|2[0-4]\d|1?\d{1,2})(?:\.(?:25[0-5]|2[0-4]\d|1?\d{1,2})){3}\b/g;

/**
 * Pattern for page/section references.
 */
const PAGE_REFERENCE_PATTERN = /(?:page|p\.|pg\.?|section|sec\.|§)\s*(\d+)/gi;

/**
 * Pattern for reference/ID numbers.
 */
const REFERENCE_NUMBER_PATTERN = /(?:ref(?:erence)?|id|#|no\.?|number)\s*:?\s*(\d+)/gi;

// ─────────────────────────────────────────────────────────────────────────────────
// CONTEXT EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Get surrounding context for a match.
 * 
 * @param text - Full text
 * @param matchIndex - Index of the match
 * @param matchLength - Length of the match
 * @param contextSize - Characters of context on each side
 * @returns Surrounding context string
 */
export function getSurroundingContext(
  text: string,
  matchIndex: number,
  matchLength: number,
  contextSize: number = 50
): string {
  const start = Math.max(0, matchIndex - contextSize);
  const end = Math.min(text.length, matchIndex + matchLength + contextSize);
  return text.slice(start, end);
}

/**
 * Check if index is inside any of the given ranges.
 */
function isInsideRange(
  index: number,
  length: number,
  ranges: Array<{ start: number; end: number }>
): boolean {
  const matchEnd = index + length;
  return ranges.some(range => 
    index >= range.start && matchEnd <= range.end
  );
}

/**
 * Get all code block and inline code ranges.
 */
function getCodeRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  
  // Code blocks first (they're longer)
  const codeBlocks = safeMatchAll(CODE_BLOCK_PATTERN, text);
  for (const match of codeBlocks) {
    ranges.push({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    });
  }
  
  // Inline code
  const inlineCode = safeMatchAll(INLINE_CODE_PATTERN, text);
  for (const match of inlineCode) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    // Only add if not already inside a code block
    if (!isInsideRange(start, match[0].length, ranges)) {
      ranges.push({ start, end });
    }
  }
  
  return ranges;
}

/**
 * Get all quoted text ranges.
 */
function getQuotedRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  
  const quotes = safeMatchAll(QUOTED_TEXT_PATTERN, text);
  for (const match of quotes) {
    ranges.push({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    });
  }
  
  return ranges;
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXEMPTION CHECKING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Check if a numeric match is exempted.
 * 
 * @param match - The matched numeric string
 * @param matchIndex - Index of match in full text
 * @param fullText - The complete text being checked
 * @param exemptions - Exemption configuration
 * @returns Exemption result
 */
export function isExempted(
  match: string,
  matchIndex: number,
  fullText: string,
  exemptions: NumericExemptions
): ExemptionResult {
  const matchLength = match.length;
  const context = getSurroundingContext(fullText, matchIndex, matchLength);
  
  // Extract canonical numeric value
  const canonical = canonicalizeNumeric(match);
  const numericValue = parseFloat(canonical);
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // STRUCTURAL EXEMPTIONS (code blocks, quotes)
  // ═══════════════════════════════════════════════════════════════════════════════
  
  // Check if inside code block
  if (exemptions.allowInCodeBlocks) {
    const codeRanges = getCodeRanges(fullText);
    if (isInsideRange(matchIndex, matchLength, codeRanges)) {
      return {
        exempted: true,
        reason: 'code_block',
        description: 'Number is inside a code block',
      };
    }
  }
  
  // Check if inside quoted text
  if (exemptions.allowInQuotes) {
    const quoteRanges = getQuotedRanges(fullText);
    if (isInsideRange(matchIndex, matchLength, quoteRanges)) {
      return {
        exempted: true,
        reason: 'quoted_text',
        description: 'Number is inside quoted text',
      };
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // FORMAT-BASED EXEMPTIONS (always check)
  // ═══════════════════════════════════════════════════════════════════════════════
  
  // ISO timestamps are always safe
  ISO_TIMESTAMP_PATTERN.lastIndex = 0;
  if (ISO_TIMESTAMP_PATTERN.test(match)) {
    return {
      exempted: true,
      reason: 'iso_timestamp',
      description: 'ISO 8601 timestamp format',
    };
  }
  
  // Version numbers are always safe
  VERSION_PATTERN.lastIndex = 0;
  if (VERSION_PATTERN.test(match) && match.includes('.')) {
    return {
      exempted: true,
      reason: 'version',
      description: 'Software version number',
    };
  }
  
  // Phone numbers are always safe
  PHONE_NUMBER_PATTERN.lastIndex = 0;
  if (PHONE_NUMBER_PATTERN.test(match)) {
    return {
      exempted: true,
      reason: 'phone_number',
      description: 'Phone number format',
    };
  }
  
  // IP addresses are always safe
  IP_ADDRESS_PATTERN.lastIndex = 0;
  if (IP_ADDRESS_PATTERN.test(match)) {
    return {
      exempted: true,
      reason: 'ip_address',
      description: 'IP address format',
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // CONFIGURABLE EXEMPTIONS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  // Year check (1900-2100)
  if (exemptions.allowYears) {
    if (Number.isInteger(numericValue) && numericValue >= 1900 && numericValue <= 2100) {
      // Make sure it's in a date-like context or standalone year reference
      const yearContext = /\b(?:in|since|from|until|by|year|dated?|circa|c\.|©)\s*$/i.test(
        fullText.slice(Math.max(0, matchIndex - 20), matchIndex)
      );
      const inDateFormat = YEAR_IN_DATE_PATTERN.test(context);
      
      if (yearContext || inDateFormat || /^(19|20)\d{2}$/.test(match)) {
        return {
          exempted: true,
          reason: 'year',
          description: `Year value: ${match}`,
        };
      }
    }
  }
  
  // Date day check (1-31)
  if (exemptions.allowDates) {
    if (Number.isInteger(numericValue) && numericValue >= 1 && numericValue <= 31) {
      // Check if in date context
      const dateContext = /(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s*$/i.test(
        fullText.slice(Math.max(0, matchIndex - 15), matchIndex)
      );
      
      if (dateContext) {
        return {
          exempted: true,
          reason: 'date_day',
          description: `Day of month: ${match}`,
        };
      }
    }
  }
  
  // Small integer check
  if (exemptions.allowSmallIntegers) {
    if (Number.isInteger(numericValue) && 
        numericValue >= 0 && 
        numericValue <= exemptions.smallIntegerMax) {
      // Exclude if it looks like a price or percentage
      const looksLikePrice = /[$€£¥]/.test(context) || 
                            /\.\d{2}\b/.test(match) ||
                            /\bprice\b/i.test(context);
      const looksLikePercent = /%/.test(match) || /percent/i.test(context);
      
      if (!looksLikePrice && !looksLikePercent) {
        return {
          exempted: true,
          reason: 'small_integer',
          description: `Small integer (≤${exemptions.smallIntegerMax}): ${match}`,
        };
      }
    }
  }
  
  // Ordinal check
  if (exemptions.allowOrdinals) {
    ORDINAL_PATTERN.lastIndex = 0;
    if (ORDINAL_PATTERN.test(match)) {
      return {
        exempted: true,
        reason: 'ordinal',
        description: `Ordinal number: ${match}`,
      };
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // CONTEXT-BASED EXEMPTIONS (always check)
  // ═══════════════════════════════════════════════════════════════════════════════
  
  // Step/phase numbers
  const beforeMatch = fullText.slice(Math.max(0, matchIndex - 30), matchIndex);
  STEP_NUMBER_PATTERN.lastIndex = 0;
  if (STEP_NUMBER_PATTERN.test(beforeMatch + match)) {
    return {
      exempted: true,
      reason: 'step_number',
      description: `Step/phase number: ${match}`,
    };
  }
  
  // List markers at start of line
  const lineStart = fullText.lastIndexOf('\n', matchIndex) + 1;
  const linePrefix = fullText.slice(lineStart, matchIndex + matchLength);
  LIST_MARKER_PATTERN.lastIndex = 0;
  if (LIST_MARKER_PATTERN.test(linePrefix)) {
    return {
      exempted: true,
      reason: 'list_marker',
      description: `List marker: ${match}`,
    };
  }
  
  // Page/section references
  PAGE_REFERENCE_PATTERN.lastIndex = 0;
  if (PAGE_REFERENCE_PATTERN.test(beforeMatch + match)) {
    return {
      exempted: true,
      reason: 'page_number',
      description: `Page/section reference: ${match}`,
    };
  }
  
  // Reference/ID numbers
  REFERENCE_NUMBER_PATTERN.lastIndex = 0;
  if (REFERENCE_NUMBER_PATTERN.test(beforeMatch + match)) {
    return {
      exempted: true,
      reason: 'reference_number',
      description: `Reference/ID number: ${match}`,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // CUSTOM PATTERN EXEMPTIONS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  for (const pattern of exemptions.customPatterns) {
    try {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(context)) {
        return {
          exempted: true,
          reason: 'custom_pattern',
          description: `Matches custom pattern: ${pattern}`,
        };
      }
    } catch {
      // Invalid regex pattern, skip
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // NOT EXEMPTED
  // ═══════════════════════════════════════════════════════════════════════════════
  
  return { exempted: false };
}

// ─────────────────────────────────────────────────────────────────────────────────
// BATCH EXEMPTION CHECKING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Match with exemption status.
 */
export interface MatchWithExemption {
  /** The matched string */
  readonly match: string;
  
  /** Index in the text */
  readonly index: number;
  
  /** Whether it's exempted */
  readonly exempted: boolean;
  
  /** Exemption reason (if exempted) */
  readonly reason?: ExemptionReason;
  
  /** Description */
  readonly description?: string;
}

/**
 * Check exemptions for multiple matches.
 * 
 * @param matches - Array of matches with their indices
 * @param fullText - The complete text
 * @param exemptions - Exemption configuration
 * @returns Matches with exemption status
 */
export function checkExemptions(
  matches: ReadonlyArray<{ match: string; index: number }>,
  fullText: string,
  exemptions: NumericExemptions
): MatchWithExemption[] {
  return matches.map(({ match, index }) => {
    const result = isExempted(match, index, fullText, exemptions);
    return {
      match,
      index,
      exempted: result.exempted,
      reason: result.reason,
      description: result.description,
    };
  });
}

/**
 * Filter matches to only non-exempted ones.
 * 
 * @param matches - Array of matches with their indices
 * @param fullText - The complete text
 * @param exemptions - Exemption configuration
 * @returns Only non-exempted matches
 */
export function filterNonExempted(
  matches: ReadonlyArray<{ match: string; index: number }>,
  fullText: string,
  exemptions: NumericExemptions
): Array<{ match: string; index: number }> {
  return matches.filter(({ match, index }) => {
    const result = isExempted(match, index, fullText, exemptions);
    return !result.exempted;
  });
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXEMPTION PRESETS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Exemption preset for general responses.
 * Allows most common safe numbers.
 */
export const GENERAL_EXEMPTIONS: NumericExemptions = {
  allowYears: true,
  allowDates: true,
  allowSmallIntegers: true,
  smallIntegerMax: 10,
  allowExplanatoryPercentages: false,
  allowOrdinals: true,
  allowInCodeBlocks: true,
  allowInQuotes: true,
  customPatterns: [],
};

/**
 * Exemption preset for financial responses.
 * More restrictive - only allows structural exemptions.
 */
export const FINANCIAL_EXEMPTIONS: NumericExemptions = {
  allowYears: true,
  allowDates: true,
  allowSmallIntegers: true,
  smallIntegerMax: 5,
  allowExplanatoryPercentages: false,
  allowOrdinals: true,
  allowInCodeBlocks: true,
  allowInQuotes: true,
  customPatterns: [],
};

/**
 * Exemption preset for maximum strictness.
 * Only allows version numbers, IPs, and timestamps.
 */
export const MINIMAL_EXEMPTIONS: NumericExemptions = {
  allowYears: false,
  allowDates: false,
  allowSmallIntegers: false,
  smallIntegerMax: 0,
  allowExplanatoryPercentages: false,
  allowOrdinals: false,
  allowInCodeBlocks: true,  // Code is always safe
  allowInQuotes: false,
  customPatterns: [],
};

// ─────────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create custom exemptions with additional patterns.
 * 
 * @param base - Base exemption config
 * @param additionalPatterns - Additional regex patterns to exempt
 * @returns New exemption config
 */
export function withCustomPatterns(
  base: NumericExemptions,
  additionalPatterns: readonly string[]
): NumericExemptions {
  return {
    ...base,
    customPatterns: [...base.customPatterns, ...additionalPatterns],
  };
}

/**
 * Create exemptions that allow a specific number.
 * 
 * Useful for allowing a known-safe number that doesn't fit other categories.
 * 
 * @param base - Base exemption config
 * @param number - The specific number to allow
 * @returns New exemption config
 */
export function allowSpecificNumber(
  base: NumericExemptions,
  number: number | string
): NumericExemptions {
  const escaped = escapeRegex(String(number));
  return withCustomPatterns(base, [`\\b${escaped}\\b`]);
}

/**
 * Check if a string looks like it's in a financial context.
 * 
 * Used to determine if stricter exemptions should apply.
 */
export function isFinancialContext(text: string): boolean {
  const financialTerms = /\b(?:price|stock|share|market|trade|invest|portfolio|dividend|earnings|revenue|profit|loss|P\/E|ratio|yield|bond|equity|fund|ETF|crypto|bitcoin|USD|EUR|GBP)\b/i;
  return financialTerms.test(text);
}

/**
 * Get appropriate exemptions based on context.
 * 
 * @param text - The text to analyze
 * @returns Appropriate exemption preset
 */
export function getExemptionsForContext(text: string): NumericExemptions {
  if (isFinancialContext(text)) {
    return FINANCIAL_EXEMPTIONS;
  }
  return GENERAL_EXEMPTIONS;
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export {
  YEAR_PATTERN,
  ORDINAL_PATTERN,
  STEP_NUMBER_PATTERN,
  VERSION_PATTERN,
  CODE_BLOCK_PATTERN,
  INLINE_CODE_PATTERN,
  QUOTED_TEXT_PATTERN,
  ISO_TIMESTAMP_PATTERN,
  PHONE_NUMBER_PATTERN,
  IP_ADDRESS_PATTERN,
};
