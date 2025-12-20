// ═══════════════════════════════════════════════════════════════════════════════
// LEAK PATTERNS — Comprehensive Numeric Detection for Leak Guard
// Phase 5: Leak Guard
// 
// This file defines exhaustive patterns to detect ANY numeric content in model
// output. The Leak Guard uses these to catch unverified numbers before they
// reach the user.
// ═══════════════════════════════════════════════════════════════════════════════

import { freshRegex } from '../../utils/regex.js';

// ─────────────────────────────────────────────────────────────────────────────────
// PATTERN KEY TYPE
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * All pattern keys for type safety.
 */
export type LeakPatternKey =
  // Currency patterns
  | 'currency_usd'
  | 'currency_eur'
  | 'currency_gbp'
  | 'currency_jpy'
  | 'currency_generic'
  | 'currency_crypto'
  // Percentage patterns
  | 'percent_symbol'
  | 'percent_word'
  | 'basis_points'
  // Time patterns
  | 'time_12h'
  | 'time_24h'
  | 'time_with_seconds'
  | 'time_timezone'
  | 'unix_timestamp'
  | 'iso_timestamp'
  // Date patterns
  | 'date_mdy'
  | 'date_dmy'
  | 'date_ymd'
  | 'date_iso'
  | 'date_written'
  // Decimal patterns
  | 'decimal_us'
  | 'decimal_eu'
  | 'scientific_notation'
  // Integer patterns
  | 'integer_plain'
  | 'integer_thousands_comma'
  | 'integer_thousands_space'
  | 'integer_thousands_dot'
  // Spelled numbers
  | 'spelled_cardinal'
  | 'spelled_ordinal'
  | 'spelled_multiplier'
  // Range patterns
  | 'range_dash'
  | 'range_to'
  | 'range_between'
  | 'approximate'
  // Financial patterns
  | 'stock_change'
  | 'market_cap'
  | 'volume'
  | 'ratio'
  | 'multiplier'
  // Measurement patterns
  | 'temperature_c'
  | 'temperature_f'
  | 'speed_mph'
  | 'speed_kph'
  | 'pressure'
  | 'distance'
  | 'weight'
  // Misc patterns
  | 'phone_number'
  | 'ip_address'
  | 'version_number'
  | 'fraction'
  | 'negative_parens'
  | 'ordinal_suffix';

// ─────────────────────────────────────────────────────────────────────────────────
// PATTERN DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Master pattern definitions.
 * 
 * CRITICAL: These patterns must be exhaustive. Any numeric format that escapes
 * detection is a potential data leak.
 * 
 * Each pattern is stored WITHOUT the 'g' flag so we can create fresh instances.
 */
const LEAK_PATTERN_SOURCES: Readonly<Record<LeakPatternKey, { source: string; flags: string; description: string }>> = {
  // ═══════════════════════════════════════════════════════════════════════════════
  // CURRENCY PATTERNS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  currency_usd: {
    source: '\\$\\s*-?[\\d,]+(?:\\.\\d{1,2})?(?:\\s*(?:USD|dollars?))?',
    flags: 'gi',
    description: 'US Dollar amounts: $100, $1,234.56, $100 USD',
  },
  
  currency_eur: {
    source: '€\\s*-?[\\d,\\.\\s]+(?:\\.\\d{1,2})?|[\\d,\\.\\s]+\\s*(?:EUR|euros?)',
    flags: 'gi',
    description: 'Euro amounts: €100, 100 EUR, 1.234,56 euros',
  },
  
  currency_gbp: {
    source: '£\\s*-?[\\d,]+(?:\\.\\d{1,2})?|[\\d,]+\\s*(?:GBP|pounds?\\s*sterling)',
    flags: 'gi',
    description: 'British Pound amounts: £100, 100 GBP',
  },
  
  currency_jpy: {
    source: '¥\\s*-?[\\d,]+|[\\d,]+\\s*(?:JPY|yen)',
    flags: 'gi',
    description: 'Japanese Yen amounts: ¥10000, 10000 JPY',
  },
  
  currency_generic: {
    source: '(?:₹|₽|₩|฿|₫|₴|₱|₦|₺|₵|CHF|CAD|AUD|NZD|SGD|HKD|CNY|INR|RUB|KRW|BRL|MXN|ZAR)\\s*-?[\\d,]+(?:\\.\\d{1,2})?',
    flags: 'gi',
    description: 'Other currency symbols and codes',
  },
  
  currency_crypto: {
    source: '(?:BTC|ETH|SOL|ADA|DOT|XRP|DOGE|LTC|AVAX|MATIC|₿|Ξ)\\s*-?[\\d,]+(?:\\.\\d{1,8})?|[\\d,]+(?:\\.\\d{1,8})?\\s*(?:BTC|ETH|SOL|satoshis?|gwei|wei)',
    flags: 'gi',
    description: 'Cryptocurrency amounts with up to 8 decimal places',
  },
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // PERCENTAGE PATTERNS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  percent_symbol: {
    source: '-?[\\d,]+(?:\\.\\d+)?\\s*%',
    flags: 'g',
    description: 'Percentage with symbol: 50%, -3.5%',
  },
  
  percent_word: {
    source: '-?[\\d,]+(?:\\.\\d+)?\\s*(?:percent|percentage|pct)',
    flags: 'gi',
    description: 'Percentage with word: 50 percent',
  },
  
  basis_points: {
    source: '-?\\d+\\s*(?:bps|basis\\s*points?)',
    flags: 'gi',
    description: 'Basis points: 25 bps, 50 basis points',
  },
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // TIME PATTERNS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  time_12h: {
    source: '\\b(?:1[0-2]|0?[1-9]):[0-5]\\d(?::[0-5]\\d)?\\s*(?:AM|PM|am|pm|a\\.m\\.|p\\.m\\.)\\b',
    flags: 'gi',
    description: '12-hour time: 3:45 PM, 11:30:00 am',
  },
  
  time_24h: {
    source: '\\b(?:[01]?\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?\\b',
    flags: 'g',
    description: '24-hour time: 15:45, 23:59:59',
  },
  
  time_with_seconds: {
    source: '\\b(?:[01]?\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?\\b',
    flags: 'g',
    description: 'Time with seconds/milliseconds: 15:45:30.123',
  },
  
  time_timezone: {
    source: '\\b(?:[01]?\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?\\s*(?:UTC|GMT|EST|PST|CST|MST|EDT|PDT|CDT|MDT|[A-Z]{2,4})?(?:[+-]\\d{1,2}(?::\\d{2})?)?\\b',
    flags: 'g',
    description: 'Time with timezone: 15:45 UTC, 3:45 PM EST',
  },
  
  unix_timestamp: {
    source: '\\b1[0-9]{9,12}\\b',
    flags: 'g',
    description: 'Unix timestamps (seconds or milliseconds since epoch)',
  },
  
  iso_timestamp: {
    source: '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?(?:Z|[+-]\\d{2}:?\\d{2})?',
    flags: 'g',
    description: 'ISO 8601 timestamps: 2024-01-15T10:30:00Z',
  },
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // DATE PATTERNS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  date_mdy: {
    source: '\\b(?:0?[1-9]|1[0-2])[/\\-.](?:0?[1-9]|[12]\\d|3[01])[/\\-.](?:19|20)?\\d{2}\\b',
    flags: 'g',
    description: 'MM/DD/YYYY or MM-DD-YY: 01/15/2024',
  },
  
  date_dmy: {
    source: '\\b(?:0?[1-9]|[12]\\d|3[01])[/\\-.](?:0?[1-9]|1[0-2])[/\\-.](?:19|20)?\\d{2}\\b',
    flags: 'g',
    description: 'DD/MM/YYYY: 15/01/2024 (European)',
  },
  
  date_ymd: {
    source: '\\b(?:19|20)\\d{2}[/\\-.](?:0?[1-9]|1[0-2])[/\\-.](?:0?[1-9]|[12]\\d|3[01])\\b',
    flags: 'g',
    description: 'YYYY-MM-DD: 2024-01-15 (ISO)',
  },
  
  date_iso: {
    source: '\\b\\d{4}-\\d{2}-\\d{2}\\b',
    flags: 'g',
    description: 'ISO date only: 2024-01-15',
  },
  
  date_written: {
    source: '\\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s*(?:19|20)?\\d{2}\\b',
    flags: 'gi',
    description: 'Written dates: January 15, 2024',
  },
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // DECIMAL PATTERNS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  decimal_us: {
    source: '-?\\d{1,3}(?:,\\d{3})*\\.\\d+|-?\\d+\\.\\d+',
    flags: 'g',
    description: 'US decimals: 1,234.56 or 123.456',
  },
  
  decimal_eu: {
    source: '-?\\d{1,3}(?:\\.\\d{3})*,\\d+',
    flags: 'g',
    description: 'European decimals: 1.234,56',
  },
  
  scientific_notation: {
    source: '-?\\d+(?:\\.\\d+)?[eE][+-]?\\d+',
    flags: 'g',
    description: 'Scientific notation: 1.23e10, 5E-3',
  },
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // INTEGER PATTERNS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  integer_plain: {
    source: '\\b-?\\d+\\b',
    flags: 'g',
    description: 'Plain integers: 123, -456',
  },
  
  integer_thousands_comma: {
    source: '-?\\d{1,3}(?:,\\d{3})+',
    flags: 'g',
    description: 'Integers with comma separators: 1,234,567',
  },
  
  integer_thousands_space: {
    source: '-?\\d{1,3}(?:\\s\\d{3})+',
    flags: 'g',
    description: 'Integers with space separators: 1 234 567',
  },
  
  integer_thousands_dot: {
    source: '-?\\d{1,3}(?:\\.\\d{3})+(?!,)',
    flags: 'g',
    description: 'Integers with dot separators (European): 1.234.567',
  },
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // SPELLED NUMBERS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  spelled_cardinal: {
    source: '\\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion)\\b',
    flags: 'gi',
    description: 'Spelled cardinal numbers: one, twenty, million',
  },
  
  spelled_ordinal: {
    source: '\\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth|fortieth|fiftieth|sixtieth|seventieth|eightieth|ninetieth|hundredth|thousandth|millionth)\\b',
    flags: 'gi',
    description: 'Spelled ordinal numbers: first, second, hundredth',
  },
  
  spelled_multiplier: {
    source: '\\b(?:once|twice|thrice|double|triple|quadruple|half|quarter)\\b',
    flags: 'gi',
    description: 'Spelled multipliers: twice, double, half',
  },
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // RANGE PATTERNS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  range_dash: {
    source: '-?[\\d,]+(?:\\.\\d+)?\\s*[-–—]\\s*-?[\\d,]+(?:\\.\\d+)?',
    flags: 'g',
    description: 'Dash ranges: 10-20, 1.5–2.5',
  },
  
  range_to: {
    source: '-?[\\d,]+(?:\\.\\d+)?\\s+to\\s+-?[\\d,]+(?:\\.\\d+)?',
    flags: 'gi',
    description: 'Word ranges: 10 to 20',
  },
  
  range_between: {
    source: 'between\\s+-?[\\d,]+(?:\\.\\d+)?\\s+and\\s+-?[\\d,]+(?:\\.\\d+)?',
    flags: 'gi',
    description: 'Between ranges: between 10 and 20',
  },
  
  approximate: {
    source: '(?:about|around|approximately|approx\\.?|roughly|nearly|almost|~)\\s*-?[\\d,]+(?:\\.\\d+)?',
    flags: 'gi',
    description: 'Approximate values: about 100, ~50',
  },
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // FINANCIAL PATTERNS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  stock_change: {
    source: '[+-]\\s*[\\d,]+(?:\\.\\d+)?(?:\\s*(?:\\(|%)|(?:points?))?',
    flags: 'g',
    description: 'Stock changes: +2.5%, -10 points',
  },
  
  market_cap: {
    source: '\\$?[\\d,]+(?:\\.\\d+)?\\s*(?:B|billion|M|million|K|thousand|T|trillion)\\b',
    flags: 'gi',
    description: 'Market cap: $2.5B, 500 million',
  },
  
  volume: {
    source: '[\\d,]+(?:\\.\\d+)?\\s*(?:shares?|units?|contracts?|lots?)',
    flags: 'gi',
    description: 'Trading volume: 1,000,000 shares',
  },
  
  ratio: {
    source: '\\d+(?:\\.\\d+)?\\s*[:/]\\s*\\d+(?:\\.\\d+)?',
    flags: 'g',
    description: 'Ratios: 2:1, 1.5/1',
  },
  
  multiplier: {
    source: '\\d+(?:\\.\\d+)?[xX]\\b|\\b[xX]\\d+(?:\\.\\d+)?',
    flags: 'g',
    description: 'Multipliers: 2x, 10X, x5',
  },
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // MEASUREMENT PATTERNS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  temperature_c: {
    source: '-?\\d+(?:\\.\\d+)?\\s*°?\\s*[Cc](?:elsius)?\\b',
    flags: 'g',
    description: 'Celsius: 25°C, 25 celsius',
  },
  
  temperature_f: {
    source: '-?\\d+(?:\\.\\d+)?\\s*°?\\s*[Ff](?:ahrenheit)?\\b',
    flags: 'g',
    description: 'Fahrenheit: 77°F, 77 fahrenheit',
  },
  
  speed_mph: {
    source: '\\d+(?:\\.\\d+)?\\s*(?:mph|miles?\\s*(?:per|/)\\s*h(?:our)?)',
    flags: 'gi',
    description: 'Speed in mph: 60 mph',
  },
  
  speed_kph: {
    source: '\\d+(?:\\.\\d+)?\\s*(?:kph|km/?h|kilometers?\\s*(?:per|/)\\s*h(?:our)?)',
    flags: 'gi',
    description: 'Speed in kph: 100 km/h',
  },
  
  pressure: {
    source: '\\d+(?:\\.\\d+)?\\s*(?:mb|mbar|hPa|psi|atm|bar|mmHg|inHg)',
    flags: 'gi',
    description: 'Pressure: 1013 mb, 29.92 inHg',
  },
  
  distance: {
    source: '\\d+(?:\\.\\d+)?\\s*(?:km|mi|m|ft|yd|cm|mm|in|miles?|meters?|feet|yards?|inches?|kilometers?)',
    flags: 'gi',
    description: 'Distance: 5 km, 10 miles',
  },
  
  weight: {
    source: '\\d+(?:\\.\\d+)?\\s*(?:kg|lb|lbs?|g|oz|mg|pounds?|kilograms?|grams?|ounces?)',
    flags: 'gi',
    description: 'Weight: 70 kg, 150 lbs',
  },
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // MISCELLANEOUS PATTERNS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  phone_number: {
    source: '(?:\\+?1[-.]?)?\\(?\\d{3}\\)?[-.]?\\d{3}[-.]?\\d{4}',
    flags: 'g',
    description: 'Phone numbers: (555) 123-4567',
  },
  
  ip_address: {
    source: '\\b(?:25[0-5]|2[0-4]\\d|1?\\d{1,2})(?:\\.(?:25[0-5]|2[0-4]\\d|1?\\d{1,2})){3}\\b',
    flags: 'g',
    description: 'IPv4 addresses: 192.168.1.1',
  },
  
  version_number: {
    source: '\\bv?\\d+(?:\\.\\d+){1,3}(?:-[a-zA-Z0-9.]+)?(?:\\+[a-zA-Z0-9.]+)?\\b',
    flags: 'gi',
    description: 'Version numbers: v1.2.3, 2.0.0-beta',
  },
  
  fraction: {
    source: '\\b\\d+\\s*/\\s*\\d+\\b',
    flags: 'g',
    description: 'Fractions: 1/2, 3/4',
  },
  
  negative_parens: {
    source: '\\([\\d,]+(?:\\.\\d+)?\\)',
    flags: 'g',
    description: 'Negative in parentheses: (100.50)',
  },
  
  ordinal_suffix: {
    source: '\\b\\d+(?:st|nd|rd|th)\\b',
    flags: 'gi',
    description: 'Ordinal suffixes: 1st, 2nd, 3rd, 4th',
  },
};

// ─────────────────────────────────────────────────────────────────────────────────
// PATTERN ACCESS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Get a fresh RegExp instance for a pattern key.
 * 
 * Always returns a new instance to avoid lastIndex state issues.
 * 
 * @param key - The pattern key
 * @returns Fresh RegExp instance
 */
export function getPattern(key: LeakPatternKey): RegExp {
  const def = LEAK_PATTERN_SOURCES[key];
  return new RegExp(def.source, def.flags);
}

/**
 * Get all patterns as fresh RegExp instances.
 * 
 * @returns Map of all patterns
 */
export function getAllPatterns(): Map<LeakPatternKey, RegExp> {
  const patterns = new Map<LeakPatternKey, RegExp>();
  for (const key of Object.keys(LEAK_PATTERN_SOURCES) as LeakPatternKey[]) {
    patterns.set(key, getPattern(key));
  }
  return patterns;
}

/**
 * Get pattern description.
 * 
 * @param key - The pattern key
 * @returns Description of what the pattern matches
 */
export function getPatternDescription(key: LeakPatternKey): string {
  return LEAK_PATTERN_SOURCES[key].description;
}

/**
 * Get all pattern keys.
 */
export function getAllPatternKeys(): LeakPatternKey[] {
  return Object.keys(LEAK_PATTERN_SOURCES) as LeakPatternKey[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// PATTERN CATEGORIES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Pattern categories for grouped processing.
 */
export type PatternCategory =
  | 'currency'
  | 'percentage'
  | 'time'
  | 'date'
  | 'decimal'
  | 'integer'
  | 'spelled'
  | 'range'
  | 'financial'
  | 'measurement'
  | 'misc';

/**
 * Mapping of pattern keys to categories.
 */
export const PATTERN_CATEGORIES: Readonly<Record<LeakPatternKey, PatternCategory>> = {
  currency_usd: 'currency',
  currency_eur: 'currency',
  currency_gbp: 'currency',
  currency_jpy: 'currency',
  currency_generic: 'currency',
  currency_crypto: 'currency',
  percent_symbol: 'percentage',
  percent_word: 'percentage',
  basis_points: 'percentage',
  time_12h: 'time',
  time_24h: 'time',
  time_with_seconds: 'time',
  time_timezone: 'time',
  unix_timestamp: 'time',
  iso_timestamp: 'time',
  date_mdy: 'date',
  date_dmy: 'date',
  date_ymd: 'date',
  date_iso: 'date',
  date_written: 'date',
  decimal_us: 'decimal',
  decimal_eu: 'decimal',
  scientific_notation: 'decimal',
  integer_plain: 'integer',
  integer_thousands_comma: 'integer',
  integer_thousands_space: 'integer',
  integer_thousands_dot: 'integer',
  spelled_cardinal: 'spelled',
  spelled_ordinal: 'spelled',
  spelled_multiplier: 'spelled',
  range_dash: 'range',
  range_to: 'range',
  range_between: 'range',
  approximate: 'range',
  stock_change: 'financial',
  market_cap: 'financial',
  volume: 'financial',
  ratio: 'financial',
  multiplier: 'financial',
  temperature_c: 'measurement',
  temperature_f: 'measurement',
  speed_mph: 'measurement',
  speed_kph: 'measurement',
  pressure: 'measurement',
  distance: 'measurement',
  weight: 'measurement',
  phone_number: 'misc',
  ip_address: 'misc',
  version_number: 'misc',
  fraction: 'misc',
  negative_parens: 'misc',
  ordinal_suffix: 'misc',
};

/**
 * Get all patterns in a category.
 * 
 * @param category - The category to get patterns for
 * @returns Array of pattern keys in that category
 */
export function getPatternsByCategory(category: PatternCategory): LeakPatternKey[] {
  return (Object.entries(PATTERN_CATEGORIES) as [LeakPatternKey, PatternCategory][])
    .filter(([, cat]) => cat === category)
    .map(([key]) => key);
}

// ─────────────────────────────────────────────────────────────────────────────────
// PRIORITY PATTERNS — For FORBID mode (catch-all)
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * High-priority patterns for FORBID mode.
 * These catch the most common numeric formats and should be checked first.
 */
export const PRIORITY_PATTERNS: readonly LeakPatternKey[] = [
  // Currency is highest priority - most dangerous leaks
  'currency_usd',
  'currency_eur',
  'currency_gbp',
  'currency_crypto',
  // Percentages are common in financial data
  'percent_symbol',
  'percent_word',
  // Decimals catch most numeric values
  'decimal_us',
  'decimal_eu',
  // Plain integers as fallback
  'integer_plain',
  'integer_thousands_comma',
  // Time patterns
  'time_12h',
  'time_24h',
  // Temperature (weather data)
  'temperature_c',
  'temperature_f',
];

/**
 * Secondary patterns for FORBID mode.
 * Checked after priority patterns.
 */
export const SECONDARY_PATTERNS: readonly LeakPatternKey[] = [
  'currency_jpy',
  'currency_generic',
  'basis_points',
  'time_with_seconds',
  'time_timezone',
  'unix_timestamp',
  'iso_timestamp',
  'scientific_notation',
  'integer_thousands_space',
  'integer_thousands_dot',
  'stock_change',
  'market_cap',
  'volume',
  'ratio',
  'multiplier',
  'speed_mph',
  'speed_kph',
  'pressure',
  'distance',
  'weight',
];

/**
 * Tertiary patterns for FORBID mode.
 * These are less common but still need to be caught.
 */
export const TERTIARY_PATTERNS: readonly LeakPatternKey[] = [
  'spelled_cardinal',
  'spelled_ordinal',
  'spelled_multiplier',
  'range_dash',
  'range_to',
  'range_between',
  'approximate',
  'date_mdy',
  'date_dmy',
  'date_ymd',
  'date_iso',
  'date_written',
  'fraction',
  'negative_parens',
  'ordinal_suffix',
];

/**
 * Exempt patterns that should NOT trigger FORBID mode.
 * These are allowed even in strict mode (version numbers, IPs).
 */
export const ALWAYS_EXEMPT_PATTERNS: readonly LeakPatternKey[] = [
  'version_number',  // Software versions are safe
  'ip_address',      // IPs are not financial data
  'phone_number',    // Phone numbers are not financial data
];

// ─────────────────────────────────────────────────────────────────────────────────
// COMBINED PATTERNS — Single regex for fast detection
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Combined pattern that matches ANY numeric content.
 * 
 * Use this for quick first-pass detection in FORBID mode.
 * If this doesn't match, there are no numbers.
 */
export const ANY_NUMERIC_PATTERN = new RegExp(
  // Currency symbols followed by numbers
  '[$€£¥₹₽₩฿₫₴₱₦₺₵]\\s*[\\d,]+(?:\\.\\d+)?' +
  // Numbers followed by currency codes
  '|[\\d,]+(?:\\.\\d+)?\\s*(?:USD|EUR|GBP|JPY|BTC|ETH)' +
  // Percentages
  '|[\\d,]+(?:\\.\\d+)?\\s*%' +
  // Plain numbers (decimal or integer)
  '|\\b\\d+(?:[,.]\\d+)*\\b' +
  // Numbers with units
  '|\\d+(?:\\.\\d+)?\\s*(?:°[CF]|mph|kph|km|mi|kg|lb)',
  'gi'
);

/**
 * Pattern for spelled numbers (requires word boundaries).
 */
export const SPELLED_NUMBER_PATTERN = new RegExp(
  '\\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|' +
  'eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|' +
  'twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|' +
  'hundred|thousand|million|billion|trillion|' +
  'first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|' +
  'once|twice|thrice|double|triple|half|quarter)\\b',
  'gi'
);

// ─────────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Quick check if text contains any numeric content.
 * 
 * @param text - Text to check
 * @returns True if any numeric content detected
 */
export function hasAnyNumeric(text: string): boolean {
  // Reset lastIndex and test
  ANY_NUMERIC_PATTERN.lastIndex = 0;
  if (ANY_NUMERIC_PATTERN.test(text)) {
    return true;
  }
  
  // Also check spelled numbers
  SPELLED_NUMBER_PATTERN.lastIndex = 0;
  return SPELLED_NUMBER_PATTERN.test(text);
}

/**
 * Get all pattern matches in text.
 * 
 * @param text - Text to search
 * @param patterns - Pattern keys to use (default: all priority patterns)
 * @returns Array of matches with pattern info
 */
export function findAllMatches(
  text: string,
  patterns: readonly LeakPatternKey[] = PRIORITY_PATTERNS
): Array<{
  pattern: LeakPatternKey;
  match: string;
  index: number;
  category: PatternCategory;
}> {
  const results: Array<{
    pattern: LeakPatternKey;
    match: string;
    index: number;
    category: PatternCategory;
  }> = [];
  
  for (const key of patterns) {
    const regex = getPattern(key);
    let match: RegExpExecArray | null;
    
    while ((match = regex.exec(text)) !== null) {
      results.push({
        pattern: key,
        match: match[0],
        index: match.index,
        category: PATTERN_CATEGORIES[key],
      });
    }
  }
  
  // Sort by index
  results.sort((a, b) => a.index - b.index);
  
  return results;
}

/**
 * Check if a specific pattern key should be exempt from FORBID mode.
 */
export function isAlwaysExemptPattern(key: LeakPatternKey): boolean {
  return ALWAYS_EXEMPT_PATTERNS.includes(key);
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export {
  LEAK_PATTERN_SOURCES,
};
