// ═══════════════════════════════════════════════════════════════════════════════
// FRESHNESS & DOMAIN — Fixes E-1, E-2
// Implements domain detection and freshness window enforcement
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// FRESHNESS WINDOWS — Fix E-1
// ─────────────────────────────────────────────────────────────────────────────────

export interface FreshnessWindow {
  domain: string;
  maxAgeMs: number | null; // null = never stale
  immediate: boolean; // If true, unverified = no numerics
  description: string;
}

export const FRESHNESS_WINDOWS: Record<string, FreshnessWindow> = {
  // Immediate domains — data changes rapidly
  stock_prices: {
    domain: 'stock_prices',
    maxAgeMs: 15 * 60 * 1000, // 15 minutes
    immediate: true,
    description: 'Market data',
  },
  crypto_prices: {
    domain: 'crypto_prices',
    maxAgeMs: 5 * 60 * 1000, // 5 minutes
    immediate: true,
    description: 'Cryptocurrency prices',
  },
  weather: {
    domain: 'weather',
    maxAgeMs: 60 * 60 * 1000, // 1 hour
    immediate: true,
    description: 'Weather conditions',
  },
  breaking_news: {
    domain: 'breaking_news',
    maxAgeMs: 4 * 60 * 60 * 1000, // 4 hours
    immediate: true,
    description: 'Breaking news',
  },
  
  // Hours domains
  news: {
    domain: 'news',
    maxAgeMs: 24 * 60 * 60 * 1000, // 24 hours
    immediate: false,
    description: 'News articles',
  },
  sports_scores: {
    domain: 'sports_scores',
    maxAgeMs: 2 * 60 * 60 * 1000, // 2 hours
    immediate: false,
    description: 'Sports scores',
  },
  
  // Days domains
  exchange_rates: {
    domain: 'exchange_rates',
    maxAgeMs: 24 * 60 * 60 * 1000, // 1 day
    immediate: false,
    description: 'Exchange rates',
  },
  product_prices: {
    domain: 'product_prices',
    maxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
    immediate: false,
    description: 'Product prices',
  },
  company_info: {
    domain: 'company_info',
    maxAgeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
    immediate: false,
    description: 'Company information',
  },
  
  // Months domains
  laws_regulations: {
    domain: 'laws_regulations',
    maxAgeMs: 90 * 24 * 60 * 60 * 1000, // 3 months
    immediate: false,
    description: 'Laws and regulations',
  },
  medical_guidelines: {
    domain: 'medical_guidelines',
    maxAgeMs: 180 * 24 * 60 * 60 * 1000, // 6 months
    immediate: false,
    description: 'Medical guidelines',
  },
  
  // Never stale
  historical_facts: {
    domain: 'historical_facts',
    maxAgeMs: null,
    immediate: false,
    description: 'Historical facts',
  },
  math_principles: {
    domain: 'math_principles',
    maxAgeMs: null,
    immediate: false,
    description: 'Mathematical principles',
  },
  physics_laws: {
    domain: 'physics_laws',
    maxAgeMs: null,
    immediate: false,
    description: 'Physical laws',
  },
  
  // Default
  general: {
    domain: 'general',
    maxAgeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
    immediate: false,
    description: 'General information',
  },
};

// ─────────────────────────────────────────────────────────────────────────────────
// DOMAIN DETECTION — Fix E-2
// ─────────────────────────────────────────────────────────────────────────────────

interface DomainPattern {
  domain: string;
  patterns: RegExp[];
  priority: number; // Higher = more specific
}

const DOMAIN_PATTERNS: DomainPattern[] = [
  // Crypto (before stock to catch bitcoin/ethereum)
  {
    domain: 'crypto_prices',
    patterns: [
      /\b(?:bitcoin|btc|ethereum|eth|crypto(?:currency)?|altcoin|token|defi)\b/i,
      /\b(?:binance|coinbase|kraken|uniswap)\b/i,
    ],
    priority: 10,
  },
  
  // Stock market
  {
    domain: 'stock_prices',
    patterns: [
      /\b(?:stock|share|equity|ticker|NYSE|NASDAQ|S&P|dow jones)\b/i,
      /\b(?:market price|trading at|stock price|share price)\b/i,
      /\b[A-Z]{1,5}\s+(?:stock|price|trading)\b/i, // "AAPL stock"
    ],
    priority: 9,
  },
  
  // Weather
  {
    domain: 'weather',
    patterns: [
      /\b(?:weather|forecast|temperature|rain|snow|humidity|wind)\b/i,
      /\b(?:sunny|cloudy|stormy|precipitation)\b/i,
    ],
    priority: 8,
  },
  
  // Breaking news
  {
    domain: 'breaking_news',
    patterns: [
      /\b(?:breaking news|just (?:happened|announced)|latest news)\b/i,
      /\b(?:live update|developing story)\b/i,
    ],
    priority: 7,
  },
  
  // General news
  {
    domain: 'news',
    patterns: [
      /\b(?:news|headline|article|report|coverage)\b/i,
      /\b(?:announced|reported|according to)\b/i,
    ],
    priority: 5,
  },
  
  // Sports
  {
    domain: 'sports_scores',
    patterns: [
      /\b(?:score|game|match|won|lost|tied|championship)\b/i,
      /\b(?:NFL|NBA|MLB|NHL|FIFA|Olympics)\b/i,
    ],
    priority: 6,
  },
  
  // Exchange rates
  {
    domain: 'exchange_rates',
    patterns: [
      /\b(?:exchange rate|forex|currency|USD|EUR|GBP|JPY)\b/i,
      /\b(?:convert|conversion)\s+(?:to|from|between)\b/i,
    ],
    priority: 7,
  },
  
  // Product prices
  {
    domain: 'product_prices',
    patterns: [
      /\b(?:price|cost|how much|pricing)\b.*\b(?:buy|purchase|order)\b/i,
      /\b(?:product|item|goods)\b.*\b(?:price|cost)\b/i,
    ],
    priority: 4,
  },
  
  // Laws
  {
    domain: 'laws_regulations',
    patterns: [
      /\b(?:law|legal|regulation|statute|legislation|act of)\b/i,
      /\b(?:illegal|lawful|prohibited|permitted|required by law)\b/i,
    ],
    priority: 6,
  },
  
  // Medical
  {
    domain: 'medical_guidelines',
    patterns: [
      /\b(?:medical|clinical|treatment|diagnosis|therapy|guideline)\b/i,
      /\b(?:CDC|WHO|FDA|NIH)\s+(?:recommend|guideline)\b/i,
    ],
    priority: 6,
  },
  
  // Math (never stale)
  {
    domain: 'math_principles',
    patterns: [
      /\b(?:theorem|proof|equation|formula|mathematical)\b/i,
      /\b(?:calculus|algebra|geometry|trigonometry)\b/i,
    ],
    priority: 3,
  },
  
  // Physics (never stale)
  {
    domain: 'physics_laws',
    patterns: [
      /\b(?:physics|newton|einstein|quantum|relativity)\b/i,
      /\b(?:gravity|momentum|entropy|thermodynamics)\b/i,
    ],
    priority: 3,
  },
  
  // Historical (never stale)
  {
    domain: 'historical_facts',
    patterns: [
      /\b(?:history|historical|ancient|century|era|dynasty)\b/i,
      /\b(?:in \d{4}|during the)\b/i,
    ],
    priority: 2,
  },
];

/**
 * Detect the domain of a message.
 * Returns the most specific matching domain.
 */
export function detectDomain(message: string): string {
  let bestMatch: { domain: string; priority: number } | null = null;

  for (const { domain, patterns, priority } of DOMAIN_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(message)) {
        if (!bestMatch || priority > bestMatch.priority) {
          bestMatch = { domain, priority };
        }
        break; // Found match for this domain, check next domain
      }
    }
  }

  return bestMatch?.domain ?? 'general';
}

/**
 * Detect all matching domains (for multi-domain queries).
 */
export function detectAllDomains(message: string): string[] {
  const domains: Set<string> = new Set();

  for (const { domain, patterns } of DOMAIN_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(message)) {
        domains.add(domain);
        break;
      }
    }
  }

  if (domains.size === 0) {
    domains.add('general');
  }

  return Array.from(domains);
}

// ─────────────────────────────────────────────────────────────────────────────────
// FRESHNESS CHECKER — Fix E-1
// ─────────────────────────────────────────────────────────────────────────────────

export interface FreshnessResult {
  domain: string;
  window: FreshnessWindow;
  isStale: boolean;
  staleBy: string | null; // Human-readable duration
  requiredAction: 'none' | 'warn' | 'verify' | 'block_numerics';
}

/**
 * Check freshness of data for a domain.
 * 
 * @param domain - The domain to check
 * @param dataTimestamp - When the data was obtained (null if unknown)
 * @returns Freshness result with required action
 */
export function checkFreshness(
  domain: string,
  dataTimestamp: Date | null
): FreshnessResult {
  const window = FRESHNESS_WINDOWS[domain] || FRESHNESS_WINDOWS.general;

  // If no max age (never stale), always fresh
  if (window.maxAgeMs === null) {
    return {
      domain,
      window,
      isStale: false,
      staleBy: null,
      requiredAction: 'none',
    };
  }

  // If no timestamp, assume stale
  if (!dataTimestamp) {
    return {
      domain,
      window,
      isStale: true,
      staleBy: 'unknown age',
      requiredAction: window.immediate ? 'block_numerics' : 'verify',
    };
  }

  const ageMs = Date.now() - dataTimestamp.getTime();
  const isStale = ageMs > window.maxAgeMs;

  if (!isStale) {
    return {
      domain,
      window,
      isStale: false,
      staleBy: null,
      requiredAction: 'none',
    };
  }

  // Calculate stale by duration
  const staleByMs = ageMs - window.maxAgeMs;
  const staleBy = formatDuration(staleByMs);

  // Determine required action
  let requiredAction: FreshnessResult['requiredAction'];
  if (window.immediate) {
    requiredAction = 'block_numerics';
  } else if (staleByMs > window.maxAgeMs) {
    // Very stale (2x+ the window)
    requiredAction = 'verify';
  } else {
    requiredAction = 'warn';
  }

  return {
    domain,
    window,
    isStale,
    staleBy,
    requiredAction,
  };
}

/**
 * Format milliseconds as human-readable duration.
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''}`;
  }
  if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  }
  if (minutes > 0) {
    return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  }
  return `${seconds} second${seconds !== 1 ? 's' : ''}`;
}

// ─────────────────────────────────────────────────────────────────────────────────
// IMMEDIATE DOMAIN HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Check if a domain is an immediate domain (requires real-time data).
 */
export function isImmediateDomain(domain: string): boolean {
  const window = FRESHNESS_WINDOWS[domain];
  return window?.immediate ?? false;
}

/**
 * Get list of all immediate domains.
 */
export function getImmediateDomains(): string[] {
  return Object.entries(FRESHNESS_WINDOWS)
    .filter(([_, w]) => w.immediate)
    .map(([d, _]) => d);
}
