// ═══════════════════════════════════════════════════════════════════════════════
// CLASSIFICATION PATTERNS — Pattern-Based Data Need Detection
// Phase 7: Lens Gate
// 
// This module provides regex patterns for detecting data categories and extracting
// entities from user queries. Used as the first pass before LLM classification.
// 
// PATTERN DESIGN PRINCIPLES:
// 1. High precision over high recall (avoid false positives)
// 2. Entity extraction captures canonical forms where possible
// 3. Confidence scoring based on pattern specificity
// 4. Patterns are ordered from most specific to least specific
// ═══════════════════════════════════════════════════════════════════════════════

import type { LiveCategory, AuthoritativeCategory, DataCategory } from '../../../types/categories.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Result of pattern matching for a single category.
 */
export interface PatternMatch {
  readonly category: DataCategory;
  readonly confidence: number;
  readonly matchedPattern: string;
  readonly extractedEntities: readonly string[];
}

/**
 * Complete result of pattern-based classification.
 */
export interface PatternClassificationResult {
  readonly matches: readonly PatternMatch[];
  readonly primaryCategory: DataCategory | null;
  readonly liveCategories: readonly LiveCategory[];
  readonly authoritativeCategories: readonly AuthoritativeCategory[];
  readonly allEntities: readonly string[];
  readonly highestConfidence: number;
  readonly reasoning: string;
}

/**
 * Pattern definition with metadata.
 */
interface CategoryPattern {
  readonly pattern: RegExp;
  readonly confidence: number;
  readonly entityExtractor?: (match: RegExpMatchArray, message: string) => string[];
  readonly description: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// LIVE CATEGORY PATTERNS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Patterns for detecting market/stock queries.
 * Highest confidence for explicit ticker symbols.
 */
const MARKET_PATTERNS: readonly CategoryPattern[] = [
  // Explicit ticker symbols (highest confidence)
  {
    pattern: /\b([A-Z]{1,5})\s+(?:stock|share|price|quote|trading)/i,
    confidence: 0.95,
    entityExtractor: (match) => [match[1]?.toUpperCase() ?? ''],
    description: 'Ticker with stock/share/price keyword',
  },
  {
    pattern: /\b(?:stock|share|price|quote)\s+(?:of|for)\s+([A-Z]{1,5})\b/i,
    confidence: 0.95,
    entityExtractor: (match) => [match[1]?.toUpperCase() ?? ''],
    description: 'Stock/share/price of ticker',
  },
  // Well-known tickers (high confidence)
  {
    pattern: /\b(AAPL|MSFT|GOOGL|GOOG|AMZN|META|TSLA|NVDA|JPM|V|JNJ|WMT|PG|MA|UNH|HD|DIS|BAC|XOM|PFE)\b/,
    confidence: 0.92,
    entityExtractor: (match) => [match[1] ?? ''],
    description: 'Well-known ticker symbol',
  },
  // Stock price questions
  {
    pattern: /(?:what(?:'s| is)|how much is)\s+(?:the\s+)?(?:current\s+)?(?:stock\s+)?price\s+(?:of|for)\s+([A-Za-z][A-Za-z\s]+?)(?:\s+stock)?(?:\?|$)/i,
    confidence: 0.88,
    entityExtractor: (match, message) => extractCompanyOrTicker(match[1] ?? '', message),
    description: 'Stock price question',
  },
  // Trading at questions
  {
    pattern: /(?:what(?:'s| is)|where is)\s+([A-Za-z][A-Za-z\s]+?)\s+trading\s+(?:at|now)/i,
    confidence: 0.85,
    entityExtractor: (match, message) => extractCompanyOrTicker(match[1] ?? '', message),
    description: 'Trading at question',
  },
  // Market cap questions
  {
    pattern: /(?:market\s+cap(?:italization)?|valuation)\s+(?:of|for)\s+([A-Za-z][A-Za-z\s]+)/i,
    confidence: 0.82,
    entityExtractor: (match, message) => extractCompanyOrTicker(match[1] ?? '', message),
    description: 'Market cap question',
  },
  // Generic stock queries (lower confidence)
  {
    pattern: /\b(?:stock|share|equity)\s+(?:price|quote|value|worth)\b/i,
    confidence: 0.70,
    entityExtractor: () => [],
    description: 'Generic stock query',
  },
  // S&P 500 and indices
  {
    pattern: /\b(S&P\s*500|Dow\s*Jones|NASDAQ|NYSE|DJIA|SPX|SPY|QQQ|IWM)\b/i,
    confidence: 0.90,
    entityExtractor: (match) => [normalizeIndex(match[1] ?? '')],
    description: 'Market index',
  },
];

/**
 * Patterns for detecting cryptocurrency queries.
 */
const CRYPTO_PATTERNS: readonly CategoryPattern[] = [
  // Explicit crypto symbols (highest confidence)
  {
    pattern: /\b(BTC|ETH|XRP|SOL|ADA|DOGE|DOT|AVAX|MATIC|LINK|UNI|ATOM|LTC)\b(?:\s+(?:price|value|worth|trading))?/i,
    confidence: 0.95,
    entityExtractor: (match) => [match[1]?.toUpperCase() ?? ''],
    description: 'Crypto ticker symbol',
  },
  // Full crypto names
  {
    pattern: /\b(bitcoin|ethereum|ripple|solana|cardano|dogecoin|polkadot|avalanche|polygon|chainlink|uniswap|cosmos|litecoin)\b/i,
    confidence: 0.92,
    entityExtractor: (match) => [cryptoNameToSymbol(match[1] ?? '')],
    description: 'Crypto full name',
  },
  // Crypto price questions
  {
    pattern: /(?:what(?:'s| is)|how much is)\s+(?:the\s+)?(?:current\s+)?(?:price\s+(?:of|for)\s+)?(?:a\s+)?(bitcoin|ethereum|btc|eth|crypto(?:currency)?)/i,
    confidence: 0.90,
    entityExtractor: (match) => [cryptoNameToSymbol(match[1] ?? '')],
    description: 'Crypto price question',
  },
  // Generic crypto queries
  {
    pattern: /\bcrypto(?:currency)?\s+(?:price|value|market|trading)\b/i,
    confidence: 0.75,
    entityExtractor: () => [],
    description: 'Generic crypto query',
  },
  // Coin/token patterns
  {
    pattern: /\b([A-Za-z]+)\s+(?:coin|token)\s+(?:price|value|worth)/i,
    confidence: 0.80,
    entityExtractor: (match) => [match[1]?.toUpperCase() ?? ''],
    description: 'Coin/token price query',
  },
];

/**
 * Patterns for detecting foreign exchange queries.
 */
const FX_PATTERNS: readonly CategoryPattern[] = [
  // Currency pair format (highest confidence)
  {
    pattern: /\b([A-Z]{3})\/([A-Z]{3})\s*(?:rate|exchange|price)?/i,
    confidence: 0.95,
    entityExtractor: (match) => [`${match[1]?.toUpperCase()}/${match[2]?.toUpperCase()}`],
    description: 'Currency pair format',
  },
  // Exchange rate questions
  {
    pattern: /(?:exchange\s+rate|conversion(?:\s+rate)?)\s+(?:for|of|from)?\s*([A-Z]{3})\s+(?:to|into|for)\s+([A-Z]{3})/i,
    confidence: 0.92,
    entityExtractor: (match) => [`${match[1]?.toUpperCase()}/${match[2]?.toUpperCase()}`],
    description: 'Exchange rate question',
  },
  // Currency conversion questions
  {
    pattern: /(?:how\s+(?:much|many)|what(?:'s| is))\s+\d+(?:\.\d+)?\s*([A-Z]{3}|dollars?|euros?|pounds?|yen)\s+(?:in|to|worth\s+in)\s+([A-Z]{3}|dollars?|euros?|pounds?|yen)/i,
    confidence: 0.90,
    entityExtractor: (match) => [`${normalizeCurrency(match[1] ?? '')}/${normalizeCurrency(match[2] ?? '')}`],
    description: 'Currency conversion question',
  },
  // Common currency names
  {
    pattern: /\b(dollar|euro|pound|yen|yuan|rupee|franc)\s+(?:to|vs\.?|versus|against)\s+(dollar|euro|pound|yen|yuan|rupee|franc)/i,
    confidence: 0.88,
    entityExtractor: (match) => [`${normalizeCurrency(match[1] ?? '')}/${normalizeCurrency(match[2] ?? '')}`],
    description: 'Currency name conversion',
  },
  // Generic forex queries
  {
    pattern: /\b(?:forex|fx|foreign\s+exchange|currency)\s+(?:rate|price|market)\b/i,
    confidence: 0.70,
    entityExtractor: () => [],
    description: 'Generic forex query',
  },
  // USD to X pattern
  {
    pattern: /\b(USD|EUR|GBP|JPY|CNY|INR|CHF|CAD|AUD|NZD)\s+(?:to|vs\.?|versus)\s+([A-Z]{3})/i,
    confidence: 0.90,
    entityExtractor: (match) => [`${match[1]?.toUpperCase()}/${match[2]?.toUpperCase()}`],
    description: 'Currency code conversion',
  },
];

/**
 * Patterns for detecting weather queries.
 */
const WEATHER_PATTERNS: readonly CategoryPattern[] = [
  // Explicit weather questions (highest confidence)
  {
    pattern: /(?:what(?:'s| is)|how(?:'s| is))\s+(?:the\s+)?weather\s+(?:in|at|for|like\s+in)\s+([A-Za-z][A-Za-z\s,]+)/i,
    confidence: 0.95,
    entityExtractor: (match) => [normalizeLocation(match[1] ?? '')],
    description: 'Weather in location question',
  },
  // Temperature questions
  {
    pattern: /(?:what(?:'s| is)|how)\s+(?:the\s+)?(?:current\s+)?(?:temperature|temp)\s+(?:in|at|for)\s+([A-Za-z][A-Za-z\s,]+)/i,
    confidence: 0.92,
    entityExtractor: (match) => [normalizeLocation(match[1] ?? '')],
    description: 'Temperature question',
  },
  // Forecast questions
  {
    pattern: /(?:weather\s+)?forecast\s+(?:for|in)\s+([A-Za-z][A-Za-z\s,]+)/i,
    confidence: 0.90,
    entityExtractor: (match) => [normalizeLocation(match[1] ?? '')],
    description: 'Forecast question',
  },
  // "Is it raining/snowing" patterns
  {
    pattern: /is\s+it\s+(?:raining|snowing|sunny|cloudy|cold|hot|warm)\s+(?:in|at)\s+([A-Za-z][A-Za-z\s,]+)/i,
    confidence: 0.88,
    entityExtractor: (match) => [normalizeLocation(match[1] ?? '')],
    description: 'Weather condition question',
  },
  // Generic weather query
  {
    pattern: /\bweather\s+(?:today|now|current|forecast)\b/i,
    confidence: 0.75,
    entityExtractor: () => [],
    description: 'Generic weather query',
  },
  // Humidity/wind questions
  {
    pattern: /(?:humidity|wind\s*speed|precipitation|uv\s*index)\s+(?:in|at|for)\s+([A-Za-z][A-Za-z\s,]+)/i,
    confidence: 0.85,
    entityExtractor: (match) => [normalizeLocation(match[1] ?? '')],
    description: 'Specific weather metric question',
  },
];

/**
 * Patterns for detecting time queries.
 * Note: Time queries MUST be satisfied - no qualitative fallback.
 */
const TIME_PATTERNS: readonly CategoryPattern[] = [
  // Explicit time questions (highest confidence)
  {
    pattern: /(?:what(?:'s| is)|tell\s+me)\s+(?:the\s+)?(?:current\s+)?time\s+(?:in|at)\s+([A-Za-z][A-Za-z\s,\/]+)/i,
    confidence: 0.98,
    entityExtractor: (match) => [normalizeTimezone(match[1] ?? '')],
    description: 'Time in location/timezone question',
  },
  // Time zone conversion
  {
    pattern: /(?:what\s+time\s+is\s+it|current\s+time)\s+(?:in|for)\s+([A-Za-z][A-Za-z\s,\/]+)/i,
    confidence: 0.95,
    entityExtractor: (match) => [normalizeTimezone(match[1] ?? '')],
    description: 'What time is it question',
  },
  // Timezone names
  {
    pattern: /\b(EST|EDT|PST|PDT|CST|CDT|MST|MDT|UTC|GMT|BST|CET|CEST|JST|IST|AEST|AEDT)\b\s+(?:time|now)/i,
    confidence: 0.95,
    entityExtractor: (match) => [match[1]?.toUpperCase() ?? ''],
    description: 'Timezone abbreviation',
  },
  // "What time is it now" (generic, needs location context)
  {
    pattern: /what(?:'s| is)\s+(?:the\s+)?(?:current\s+)?time(?:\s+now)?(?:\?|$)/i,
    confidence: 0.85,
    entityExtractor: () => ['local'],
    description: 'Generic time question',
  },
  // Time in city
  {
    pattern: /\btime\s+(?:in|at)\s+(New\s+York|London|Tokyo|Paris|Sydney|Los\s+Angeles|Chicago|Dubai|Singapore|Hong\s+Kong)/i,
    confidence: 0.92,
    entityExtractor: (match) => [normalizeTimezone(match[1] ?? '')],
    description: 'Time in major city',
  },
];

// ─────────────────────────────────────────────────────────────────────────────────
// AUTHORITATIVE CATEGORY PATTERNS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Patterns for detecting legal queries requiring authoritative sources.
 */
const LEGAL_PATTERNS: readonly CategoryPattern[] = [
  // Legal questions with decision pressure
  {
    pattern: /\b(?:is\s+it\s+legal|can\s+I\s+legally|am\s+I\s+allowed)\s+(?:to\s+)?/i,
    confidence: 0.90,
    entityExtractor: () => [],
    description: 'Legal permissibility question',
  },
  // Specific law references
  {
    pattern: /\b(?:under|according\s+to)\s+(?:the\s+)?([A-Za-z\s]+(?:Act|Law|Code|Statute|Regulation))/i,
    confidence: 0.92,
    entityExtractor: (match) => [match[1]?.trim() ?? ''],
    description: 'Specific law reference',
  },
  // Legal terms
  {
    pattern: /\b(?:lawsuit|litigation|court\s+case|legal\s+precedent|statute\s+of\s+limitations|liability|negligence|tort|contract\s+law)\b/i,
    confidence: 0.85,
    entityExtractor: () => [],
    description: 'Legal terminology',
  },
  // Rights questions
  {
    pattern: /\b(?:what\s+are\s+my\s+rights|do\s+I\s+have\s+(?:the\s+)?right(?:s)?)\b/i,
    confidence: 0.88,
    entityExtractor: () => [],
    description: 'Rights question',
  },
];

/**
 * Patterns for detecting medical queries requiring authoritative sources.
 */
const MEDICAL_PATTERNS: readonly CategoryPattern[] = [
  // Drug interaction questions (critical)
  {
    pattern: /\b(?:can\s+I\s+take|is\s+it\s+safe\s+to\s+(?:take|mix)|interaction\s+between)\s+([A-Za-z]+)\s+(?:and|with|while\s+(?:taking|on))\s+([A-Za-z]+)/i,
    confidence: 0.95,
    entityExtractor: (match) => [match[1] ?? '', match[2] ?? ''],
    description: 'Drug interaction question',
  },
  // Dosage questions
  {
    pattern: /\b(?:dosage|dose|how\s+much)\s+(?:of\s+)?([A-Za-z]+)\s+(?:should\s+I|can\s+I|is\s+safe)/i,
    confidence: 0.92,
    entityExtractor: (match) => [match[1] ?? ''],
    description: 'Dosage question',
  },
  // Side effects
  {
    pattern: /\b(?:side\s+effects?|adverse\s+(?:effects?|reactions?))\s+(?:of|from)\s+([A-Za-z]+)/i,
    confidence: 0.88,
    entityExtractor: (match) => [match[1] ?? ''],
    description: 'Side effects question',
  },
  // Symptom questions
  {
    pattern: /\b(?:symptoms?\s+of|what\s+(?:are|causes?))\s+([A-Za-z\s]+(?:disease|syndrome|disorder|condition))/i,
    confidence: 0.85,
    entityExtractor: (match) => [match[1]?.trim() ?? ''],
    description: 'Symptom question',
  },
  // Treatment questions
  {
    pattern: /\b(?:treatment|cure|therapy)\s+(?:for|of)\s+([A-Za-z\s]+)/i,
    confidence: 0.82,
    entityExtractor: (match) => [match[1]?.trim() ?? ''],
    description: 'Treatment question',
  },
];

/**
 * Patterns for detecting government-related queries.
 */
const GOVERNMENT_PATTERNS: readonly CategoryPattern[] = [
  // Government official questions
  {
    pattern: /\b(?:who\s+is\s+(?:the\s+)?(?:current\s+)?)(president|prime\s+minister|governor|senator|mayor|secretary)\s+(?:of\s+)?([A-Za-z\s]+)?/i,
    confidence: 0.90,
    entityExtractor: (match) => [match[1] ?? '', match[2]?.trim() ?? ''].filter(Boolean),
    description: 'Government official question',
  },
  // Policy questions
  {
    pattern: /\b(?:government\s+)?policy\s+(?:on|regarding|about)\s+([A-Za-z\s]+)/i,
    confidence: 0.85,
    entityExtractor: (match) => [match[1]?.trim() ?? ''],
    description: 'Policy question',
  },
  // Tax questions
  {
    pattern: /\b(?:tax\s+(?:rate|bracket|law|code)|income\s+tax|capital\s+gains)\b/i,
    confidence: 0.88,
    entityExtractor: () => [],
    description: 'Tax question',
  },
  // Regulation questions
  {
    pattern: /\b(?:federal|state|local)\s+(?:regulation|law|requirement)\s+(?:on|for|about)/i,
    confidence: 0.85,
    entityExtractor: () => [],
    description: 'Regulation question',
  },
];

/**
 * Patterns for detecting academic/scientific queries.
 */
const ACADEMIC_PATTERNS: readonly CategoryPattern[] = [
  // Research paper references
  {
    pattern: /\b(?:according\s+to\s+(?:the\s+)?(?:research|study|paper)|peer[\s-]reviewed)\b/i,
    confidence: 0.85,
    entityExtractor: () => [],
    description: 'Research reference',
  },
  // Scientific consensus
  {
    pattern: /\b(?:scientific\s+consensus|current\s+(?:research|understanding|evidence))\s+(?:on|about|regarding)\b/i,
    confidence: 0.82,
    entityExtractor: () => [],
    description: 'Scientific consensus question',
  },
  // Citation needed
  {
    pattern: /\b(?:cite|citation|source|reference)\s+(?:for|about|on)\b/i,
    confidence: 0.78,
    entityExtractor: () => [],
    description: 'Citation request',
  },
];

// ─────────────────────────────────────────────────────────────────────────────────
// PATTERN REGISTRY
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Complete registry of patterns by category.
 */
export const LIVE_CATEGORY_PATTERNS: ReadonlyMap<LiveCategory, readonly CategoryPattern[]> = new Map([
  ['market', MARKET_PATTERNS],
  ['crypto', CRYPTO_PATTERNS],
  ['fx', FX_PATTERNS],
  ['weather', WEATHER_PATTERNS],
  ['time', TIME_PATTERNS],
]);

export const AUTHORITATIVE_CATEGORY_PATTERNS: ReadonlyMap<AuthoritativeCategory, readonly CategoryPattern[]> = new Map([
  ['legal', LEGAL_PATTERNS],
  ['medical', MEDICAL_PATTERNS],
  ['government', GOVERNMENT_PATTERNS],
  ['academic', ACADEMIC_PATTERNS],
]);

// ─────────────────────────────────────────────────────────────────────────────────
// ENTITY EXTRACTION HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Well-known company name to ticker mapping.
 */
const COMPANY_TO_TICKER: ReadonlyMap<string, string> = new Map([
  ['apple', 'AAPL'],
  ['microsoft', 'MSFT'],
  ['google', 'GOOGL'],
  ['alphabet', 'GOOGL'],
  ['amazon', 'AMZN'],
  ['meta', 'META'],
  ['facebook', 'META'],
  ['tesla', 'TSLA'],
  ['nvidia', 'NVDA'],
  ['netflix', 'NFLX'],
  ['disney', 'DIS'],
  ['jpmorgan', 'JPM'],
  ['jp morgan', 'JPM'],
  ['walmart', 'WMT'],
  ['coca-cola', 'KO'],
  ['coca cola', 'KO'],
  ['pepsi', 'PEP'],
  ['pepsico', 'PEP'],
  ['intel', 'INTC'],
  ['amd', 'AMD'],
  ['berkshire', 'BRK.A'],
  ['johnson & johnson', 'JNJ'],
  ['johnson and johnson', 'JNJ'],
  ['procter & gamble', 'PG'],
  ['procter and gamble', 'PG'],
  ['exxon', 'XOM'],
  ['chevron', 'CVX'],
  ['pfizer', 'PFE'],
  ['moderna', 'MRNA'],
  ['visa', 'V'],
  ['mastercard', 'MA'],
  ['paypal', 'PYPL'],
  ['square', 'SQ'],
  ['block', 'SQ'],
  ['uber', 'UBER'],
  ['lyft', 'LYFT'],
  ['airbnb', 'ABNB'],
  ['salesforce', 'CRM'],
  ['adobe', 'ADBE'],
  ['oracle', 'ORCL'],
  ['ibm', 'IBM'],
  ['cisco', 'CSCO'],
  ['qualcomm', 'QCOM'],
  ['broadcom', 'AVGO'],
]);

/**
 * Extract company name or ticker from text.
 */
function extractCompanyOrTicker(text: string, _message: string): string[] {
  const normalized = text.toLowerCase().trim();
  
  // Check for known company
  const ticker = COMPANY_TO_TICKER.get(normalized);
  if (ticker) {
    return [ticker];
  }
  
  // Check if it's already a ticker format
  if (/^[A-Z]{1,5}$/.test(text.trim().toUpperCase())) {
    return [text.trim().toUpperCase()];
  }
  
  // Return company name for later resolution
  return [text.trim()];
}

/**
 * Crypto name to symbol mapping.
 */
const CRYPTO_NAME_TO_SYMBOL: ReadonlyMap<string, string> = new Map([
  ['bitcoin', 'BTC'],
  ['ethereum', 'ETH'],
  ['ripple', 'XRP'],
  ['solana', 'SOL'],
  ['cardano', 'ADA'],
  ['dogecoin', 'DOGE'],
  ['polkadot', 'DOT'],
  ['avalanche', 'AVAX'],
  ['polygon', 'MATIC'],
  ['chainlink', 'LINK'],
  ['uniswap', 'UNI'],
  ['cosmos', 'ATOM'],
  ['litecoin', 'LTC'],
  ['crypto', 'BTC'], // Default
  ['cryptocurrency', 'BTC'], // Default
]);

/**
 * Convert crypto name to symbol.
 */
function cryptoNameToSymbol(name: string): string {
  const normalized = name.toLowerCase().trim();
  return CRYPTO_NAME_TO_SYMBOL.get(normalized) ?? name.toUpperCase();
}

/**
 * Currency name to code mapping.
 */
const CURRENCY_NAME_TO_CODE: ReadonlyMap<string, string> = new Map([
  ['dollar', 'USD'],
  ['dollars', 'USD'],
  ['us dollar', 'USD'],
  ['us dollars', 'USD'],
  ['euro', 'EUR'],
  ['euros', 'EUR'],
  ['pound', 'GBP'],
  ['pounds', 'GBP'],
  ['british pound', 'GBP'],
  ['sterling', 'GBP'],
  ['yen', 'JPY'],
  ['japanese yen', 'JPY'],
  ['yuan', 'CNY'],
  ['chinese yuan', 'CNY'],
  ['renminbi', 'CNY'],
  ['rupee', 'INR'],
  ['indian rupee', 'INR'],
  ['franc', 'CHF'],
  ['swiss franc', 'CHF'],
  ['canadian dollar', 'CAD'],
  ['australian dollar', 'AUD'],
  ['aussie dollar', 'AUD'],
]);

/**
 * Normalize currency name or code.
 */
function normalizeCurrency(currency: string): string {
  const normalized = currency.toLowerCase().trim();
  const code = CURRENCY_NAME_TO_CODE.get(normalized);
  if (code) return code;
  
  // If it's already a 3-letter code, uppercase it
  if (/^[A-Za-z]{3}$/.test(currency)) {
    return currency.toUpperCase();
  }
  
  return currency.toUpperCase();
}

/**
 * Normalize market index names.
 */
function normalizeIndex(index: string): string {
  const normalized = index.toUpperCase().replace(/\s+/g, '');
  
  const indexMap: Record<string, string> = {
    'S&P500': 'SPX',
    'SP500': 'SPX',
    'DOWJONES': 'DJI',
    'DOW': 'DJI',
    'DJIA': 'DJI',
  };
  
  return indexMap[normalized] ?? normalized;
}

/**
 * Normalize location for weather queries.
 */
function normalizeLocation(location: string): string {
  return location
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/,\s*$/, '');
}

/**
 * City to timezone mapping for common cities.
 */
const CITY_TO_TIMEZONE: ReadonlyMap<string, string> = new Map([
  ['new york', 'America/New_York'],
  ['los angeles', 'America/Los_Angeles'],
  ['chicago', 'America/Chicago'],
  ['london', 'Europe/London'],
  ['paris', 'Europe/Paris'],
  ['tokyo', 'Asia/Tokyo'],
  ['sydney', 'Australia/Sydney'],
  ['dubai', 'Asia/Dubai'],
  ['singapore', 'Asia/Singapore'],
  ['hong kong', 'Asia/Hong_Kong'],
  ['berlin', 'Europe/Berlin'],
  ['mumbai', 'Asia/Kolkata'],
  ['shanghai', 'Asia/Shanghai'],
  ['beijing', 'Asia/Shanghai'],
  ['moscow', 'Europe/Moscow'],
  ['toronto', 'America/Toronto'],
  ['vancouver', 'America/Vancouver'],
  ['san francisco', 'America/Los_Angeles'],
  ['seattle', 'America/Los_Angeles'],
  ['denver', 'America/Denver'],
  ['phoenix', 'America/Phoenix'],
  ['miami', 'America/New_York'],
  ['boston', 'America/New_York'],
  ['atlanta', 'America/New_York'],
  ['dallas', 'America/Chicago'],
  ['houston', 'America/Chicago'],
]);

/**
 * Normalize timezone from location or abbreviation.
 */
function normalizeTimezone(input: string): string {
  const normalized = input.toLowerCase().trim();
  
  // Check city mapping
  const timezone = CITY_TO_TIMEZONE.get(normalized);
  if (timezone) return timezone;
  
  // Standard timezone abbreviations
  const tzAbbreviations: Record<string, string> = {
    'est': 'America/New_York',
    'edt': 'America/New_York',
    'pst': 'America/Los_Angeles',
    'pdt': 'America/Los_Angeles',
    'cst': 'America/Chicago',
    'cdt': 'America/Chicago',
    'mst': 'America/Denver',
    'mdt': 'America/Denver',
    'utc': 'UTC',
    'gmt': 'UTC',
    'bst': 'Europe/London',
    'cet': 'Europe/Paris',
    'cest': 'Europe/Paris',
    'jst': 'Asia/Tokyo',
    'ist': 'Asia/Kolkata',
    'aest': 'Australia/Sydney',
    'aedt': 'Australia/Sydney',
  };
  
  return tzAbbreviations[normalized] ?? input;
}

// ─────────────────────────────────────────────────────────────────────────────────
// MAIN CLASSIFICATION FUNCTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Classify a message using pattern matching.
 * 
 * @param message - The user message to classify
 * @returns Pattern classification result with all matches
 */
export function classifyWithPatterns(message: string): PatternClassificationResult {
  const matches: PatternMatch[] = [];
  const liveCategories: LiveCategory[] = [];
  const authoritativeCategories: AuthoritativeCategory[] = [];
  const allEntities: string[] = [];
  
  // Check live category patterns
  for (const [category, patterns] of LIVE_CATEGORY_PATTERNS) {
    for (const pattern of patterns) {
      const match = message.match(pattern.pattern);
      if (match) {
        const entities = pattern.entityExtractor?.(match, message) ?? [];
        
        matches.push({
          category,
          confidence: pattern.confidence,
          matchedPattern: pattern.description,
          extractedEntities: entities,
        });
        
        if (!liveCategories.includes(category)) {
          liveCategories.push(category);
        }
        
        allEntities.push(...entities.filter(e => e && !allEntities.includes(e)));
        
        // Only take highest confidence match per category
        break;
      }
    }
  }
  
  // Check authoritative category patterns
  for (const [category, patterns] of AUTHORITATIVE_CATEGORY_PATTERNS) {
    for (const pattern of patterns) {
      const match = message.match(pattern.pattern);
      if (match) {
        const entities = pattern.entityExtractor?.(match, message) ?? [];
        
        matches.push({
          category,
          confidence: pattern.confidence,
          matchedPattern: pattern.description,
          extractedEntities: entities,
        });
        
        if (!authoritativeCategories.includes(category)) {
          authoritativeCategories.push(category);
        }
        
        allEntities.push(...entities.filter(e => e && !allEntities.includes(e)));
        
        // Only take highest confidence match per category
        break;
      }
    }
  }
  
  // Sort matches by confidence (highest first)
  matches.sort((a, b) => b.confidence - a.confidence);
  
  // Determine primary category
  const primaryCategory = matches.length > 0 ? matches[0]!.category : null;
  const highestConfidence = matches.length > 0 ? matches[0]!.confidence : 0;
  
  // Build reasoning
  const reasoning = matches.length > 0
    ? `Pattern match: ${matches[0]!.matchedPattern} (${(matches[0]!.confidence * 100).toFixed(0)}% confidence)`
    : 'No category patterns matched';
  
  return {
    matches,
    primaryCategory,
    liveCategories,
    authoritativeCategories,
    allEntities,
    highestConfidence,
    reasoning,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONFIDENCE THRESHOLDS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Confidence threshold for high-confidence pattern match.
 * Above this threshold, we trust the pattern match and skip LLM.
 */
export const HIGH_CONFIDENCE_THRESHOLD = 0.88;

/**
 * Confidence threshold for medium-confidence pattern match.
 * Above this threshold, we use the pattern match but may verify with LLM.
 */
export const MEDIUM_CONFIDENCE_THRESHOLD = 0.75;

/**
 * Check if pattern match is high confidence.
 */
export function isHighConfidenceMatch(result: PatternClassificationResult): boolean {
  return result.highestConfidence >= HIGH_CONFIDENCE_THRESHOLD;
}

/**
 * Check if pattern match is medium confidence.
 */
export function isMediumConfidenceMatch(result: PatternClassificationResult): boolean {
  return result.highestConfidence >= MEDIUM_CONFIDENCE_THRESHOLD && 
         result.highestConfidence < HIGH_CONFIDENCE_THRESHOLD;
}

/**
 * Check if pattern match requires LLM assistance.
 */
export function requiresLLMAssist(result: PatternClassificationResult): boolean {
  return result.highestConfidence < MEDIUM_CONFIDENCE_THRESHOLD || result.matches.length === 0;
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export {
  extractCompanyOrTicker,
  cryptoNameToSymbol,
  normalizeCurrency,
  normalizeIndex,
  normalizeLocation,
  normalizeTimezone,
  COMPANY_TO_TICKER,
  CRYPTO_NAME_TO_SYMBOL,
  CURRENCY_NAME_TO_CODE,
  CITY_TO_TIMEZONE,
};
