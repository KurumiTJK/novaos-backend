// ═══════════════════════════════════════════════════════════════════════════════
// SEARCH TYPES — Search Provider Interfaces
// ═══════════════════════════════════════════════════════════════════════════════

import type { ReliabilityTier } from '../../gates/lens/types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// SEARCH RESULT
// ─────────────────────────────────────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  source?: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// SEARCH RESPONSE
// ─────────────────────────────────────────────────────────────────────────────────

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  totalResults?: number;
  retrievedAt: string;
  provider: string;
  success: boolean;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// SEARCH OPTIONS
// ─────────────────────────────────────────────────────────────────────────────────

export interface SearchOptions {
  maxResults?: number;
  timeoutMs?: number;
  freshness?: 'day' | 'week' | 'month' | 'year';
  includeAnswer?: boolean;
  includeDomains?: string[];
  excludeDomains?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// SEARCH PROVIDER INTERFACE
// ─────────────────────────────────────────────────────────────────────────────────

export interface SearchProvider {
  name: string;
  isAvailable(): boolean;
  search(query: string, options?: SearchOptions): Promise<SearchResponse>;
}

// ─────────────────────────────────────────────────────────────────────────────────
// RELIABILITY PATTERNS
// ─────────────────────────────────────────────────────────────────────────────────

export const RELIABILITY_PATTERNS: Record<ReliabilityTier, string[]> = {
  official: [
    '.gov', '.mil', '.edu',
    'sec.gov', 'fda.gov', 'cdc.gov', 'nih.gov', 'who.int',
    'whitehouse.gov', 'congress.gov', 'supremecourt.gov',
  ],
  wire: [
    'reuters.com', 'apnews.com', 'bloomberg.com', 'afp.com',
  ],
  authoritative: [
    'nytimes.com', 'wsj.com', 'washingtonpost.com', 'bbc.com',
    'theguardian.com', 'economist.com', 'ft.com',
    'nature.com', 'science.org', 'pubmed.ncbi', 'lancet.com',
    'nejm.org', 'bmj.com',
  ],
  reference: [
    'wikipedia.org', 'britannica.com',
    'docs.', 'documentation.', 'developer.',
  ],
  community: [
    'reddit.com', 'quora.com', 'stackexchange.com', 'stackoverflow.com',
    'medium.com', 'substack.com', 'dev.to',
  ],
};

// ─────────────────────────────────────────────────────────────────────────────────
// GET RELIABILITY TIER
// ─────────────────────────────────────────────────────────────────────────────────

export function getReliabilityTier(url: string): ReliabilityTier {
  const lower = url.toLowerCase();

  for (const [tier, patterns] of Object.entries(RELIABILITY_PATTERNS)) {
    for (const pattern of patterns) {
      if (lower.includes(pattern)) {
        return tier as ReliabilityTier;
      }
    }
  }

  return 'community'; // Default to lowest tier
}

// ─────────────────────────────────────────────────────────────────────────────────
// IS OFFICIAL SOURCE
// ─────────────────────────────────────────────────────────────────────────────────

export function isOfficialSource(url: string): boolean {
  const tier = getReliabilityTier(url);
  return tier === 'official' || tier === 'wire';
}
