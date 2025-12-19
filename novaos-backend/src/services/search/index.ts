// ═══════════════════════════════════════════════════════════════════════════════
// SEARCH PROVIDER MANAGER — Orchestrates Search Providers
// Handles fallback, parallel fetching, and result aggregation
// ═══════════════════════════════════════════════════════════════════════════════

import type { SearchProvider, SearchResponse, SearchOptions, SearchResult } from './types.js';
import { TavilySearchProvider, getTavilyProvider } from './tavily.js';
import { GoogleCSEProvider, getGoogleCSEProvider } from './google-cse.js';
import type { SearchTier, EvidencePack, EvidenceItem } from '../../gates/lens/types.js';
import { getReliabilityTier, isOfficialSource } from './types.js';

// Re-export types
export * from './types.js';
export { TavilySearchProvider, getTavilyProvider } from './tavily.js';
export { GoogleCSEProvider, getGoogleCSEProvider } from './google-cse.js';

// ─────────────────────────────────────────────────────────────────────────────────
// SEARCH MANAGER CONFIG
// ─────────────────────────────────────────────────────────────────────────────────

export interface SearchManagerConfig {
  tavilyApiKey?: string;
  googleCSEApiKey?: string;
  googleCSEId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// SEARCH MANAGER
// ─────────────────────────────────────────────────────────────────────────────────

export class SearchManager {
  private tavily: TavilySearchProvider;
  private googleCSE: GoogleCSEProvider;

  constructor(config?: SearchManagerConfig) {
    this.tavily = config?.tavilyApiKey
      ? new TavilySearchProvider(config.tavilyApiKey)
      : getTavilyProvider();

    this.googleCSE = config?.googleCSEApiKey
      ? new GoogleCSEProvider(config.googleCSEApiKey, config.googleCSEId)
      : getGoogleCSEProvider();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MEDIUM TIER SEARCH
  // ─────────────────────────────────────────────────────────────────────────────

  async searchMedium(query: string, options?: SearchOptions): Promise<SearchResponse> {
    const searchOptions: SearchOptions = {
      maxResults: 5,
      timeoutMs: 3000,
      ...options,
    };

    // Try Tavily first
    if (this.tavily.isAvailable()) {
      const result = await this.tavily.search(query, searchOptions);
      if (result.success && result.results.length > 0) {
        return result;
      }
      console.warn('[SEARCH] Tavily failed, falling back to Google CSE');
    }

    // Fallback to Google CSE
    if (this.googleCSE.isAvailable()) {
      return this.googleCSE.search(query, searchOptions);
    }

    return {
      query,
      results: [],
      retrievedAt: new Date().toISOString(),
      provider: 'none',
      success: false,
      error: 'No search providers available',
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HIGH TIER SEARCH (Multiple Sources)
  // ─────────────────────────────────────────────────────────────────────────────

  async searchHigh(
    query: string,
    options?: SearchOptions & { requireOfficial?: boolean }
  ): Promise<SearchResponse> {
    const searchOptions: SearchOptions = {
      maxResults: 10,
      timeoutMs: 5000,
      ...options,
    };

    const responses: SearchResponse[] = [];

    // Parallel search from all available providers
    const promises: Promise<SearchResponse>[] = [];

    if (this.tavily.isAvailable()) {
      promises.push(this.tavily.search(query, searchOptions));
    }

    if (this.googleCSE.isAvailable()) {
      promises.push(this.googleCSE.search(query, searchOptions));
    }

    // If official sources required, also search with restricted domains
    if (options?.requireOfficial && this.googleCSE.isAvailable()) {
      promises.push(
        this.googleCSE.search(query, {
          ...searchOptions,
          includeDomains: ['.gov', '.edu', 'reuters.com', 'apnews.com', 'bloomberg.com'],
        })
      );
    }

    const results = await Promise.allSettled(promises);

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.success) {
        responses.push(result.value);
      }
    }

    // Merge and dedupe results
    const mergedResults = this.mergeAndDedupeResults(
      responses.flatMap(r => r.results)
    );

    return {
      query,
      results: mergedResults,
      totalResults: mergedResults.length,
      retrievedAt: new Date().toISOString(),
      provider: 'multi',
      success: mergedResults.length > 0,
      error: mergedResults.length === 0 ? 'No results from any provider' : undefined,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // BUILD EVIDENCE PACK
  // ─────────────────────────────────────────────────────────────────────────────

  buildEvidencePack(
    response: SearchResponse,
    tier: SearchTier
  ): EvidencePack {
    const originalCount = response.results.length;
    const deduped = this.mergeAndDedupeResults(response.results);

    const items: EvidenceItem[] = deduped.map(r => ({
      title: r.title,
      url: r.url,
      excerpt: r.snippet,
      reliability: getReliabilityTier(r.url),
      publishedAt: r.publishedAt,
      retrievedAt: response.retrievedAt,
      isOfficial: isOfficialSource(r.url),
    }));

    return {
      query: response.query,
      retrievedAt: response.retrievedAt,
      tier,
      items,
      deduped: originalCount !== deduped.length,
      duplicatesRemoved: originalCount - deduped.length,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MERGE AND DEDUPE
  // ─────────────────────────────────────────────────────────────────────────────

  private mergeAndDedupeResults(results: SearchResult[]): SearchResult[] {
    const seen = new Map<string, SearchResult>();

    for (const result of results) {
      // Normalize URL for deduplication
      const normalizedUrl = this.normalizeUrl(result.url);

      if (!seen.has(normalizedUrl)) {
        seen.set(normalizedUrl, result);
      } else {
        // Keep the one with more complete data
        const existing = seen.get(normalizedUrl)!;
        if (
          result.snippet.length > existing.snippet.length ||
          (result.publishedAt && !existing.publishedAt)
        ) {
          seen.set(normalizedUrl, result);
        }
      }
    }

    return Array.from(seen.values());
  }

  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Remove trailing slash, www prefix, and common tracking params
      let normalized = parsed.hostname.replace(/^www\./, '') + parsed.pathname.replace(/\/$/, '');
      return normalized.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // AVAILABILITY CHECK
  // ─────────────────────────────────────────────────────────────────────────────

  getAvailableProviders(): string[] {
    const available: string[] = [];
    if (this.tavily.isAvailable()) available.push('tavily');
    if (this.googleCSE.isAvailable()) available.push('google_cse');
    return available;
  }

  hasAnyProvider(): boolean {
    return this.tavily.isAvailable() || this.googleCSE.isAvailable();
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let searchManager: SearchManager | null = null;

export function getSearchManager(): SearchManager {
  if (!searchManager) {
    searchManager = new SearchManager();
  }
  return searchManager;
}
