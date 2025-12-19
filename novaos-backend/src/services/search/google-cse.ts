// ═══════════════════════════════════════════════════════════════════════════════
// GOOGLE CSE SEARCH PROVIDER — Fallback/HIGH Tier Search
// More comprehensive results, good for verification
// ═══════════════════════════════════════════════════════════════════════════════

import type { SearchProvider, SearchOptions, SearchResponse, SearchResult } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// GOOGLE CSE API TYPES
// ─────────────────────────────────────────────────────────────────────────────────

interface GoogleCSEResult {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
  pagemap?: {
    metatags?: Array<{
      'article:published_time'?: string;
      'og:updated_time'?: string;
    }>;
  };
}

interface GoogleCSEResponse {
  items?: GoogleCSEResult[];
  searchInformation?: {
    totalResults: string;
    searchTime: number;
  };
  error?: {
    message: string;
    code: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// GOOGLE CSE PROVIDER
// ─────────────────────────────────────────────────────────────────────────────────

export class GoogleCSEProvider implements SearchProvider {
  name = 'google_cse';
  private apiKey: string | null;
  private searchEngineId: string | null;
  private baseUrl = 'https://www.googleapis.com/customsearch/v1';

  constructor(apiKey?: string, searchEngineId?: string) {
    this.apiKey = apiKey ?? process.env.GOOGLE_CSE_API_KEY ?? null;
    this.searchEngineId = searchEngineId ?? process.env.GOOGLE_CSE_ID ?? null;
  }

  isAvailable(): boolean {
    return this.apiKey !== null && this.searchEngineId !== null;
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResponse> {
    if (!this.apiKey || !this.searchEngineId) {
      return {
        query,
        results: [],
        retrievedAt: new Date().toISOString(),
        provider: this.name,
        success: false,
        error: 'Google CSE API key or Search Engine ID not configured',
      };
    }

    const timeout = options?.timeoutMs ?? 5000;
    const maxResults = Math.min(options?.maxResults ?? 10, 10); // Google CSE max is 10 per request

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // Build URL with query parameters
      const params = new URLSearchParams({
        key: this.apiKey,
        cx: this.searchEngineId,
        q: query,
        num: String(maxResults),
      });

      // Add date restriction if freshness specified
      if (options?.freshness) {
        const dateRestrict = this.mapFreshness(options.freshness);
        if (dateRestrict) {
          params.append('dateRestrict', dateRestrict);
        }
      }

      // Add site restriction if includeDomains specified
      if (options?.includeDomains?.length) {
        const siteSearch = options.includeDomains.join(' OR site:');
        params.set('q', `${query} site:${siteSearch}`);
      }

      const response = await fetch(`${this.baseUrl}?${params.toString()}`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json() as GoogleCSEResponse;
        const errorMsg = errorData.error?.message ?? `HTTP ${response.status}`;
        console.error(`[GOOGLE_CSE] API error: ${errorMsg}`);
        return {
          query,
          results: [],
          retrievedAt: new Date().toISOString(),
          provider: this.name,
          success: false,
          error: `Google CSE error: ${errorMsg}`,
        };
      }

      const data = await response.json() as GoogleCSEResponse;

      const results: SearchResult[] = (data.items ?? []).map(item => ({
        title: item.title,
        url: item.link,
        snippet: item.snippet,
        source: item.displayLink,
        publishedAt: this.extractPublishedDate(item),
      }));

      return {
        query,
        results,
        totalResults: data.searchInformation?.totalResults
          ? parseInt(data.searchInformation.totalResults, 10)
          : results.length,
        retrievedAt: new Date().toISOString(),
        provider: this.name,
        success: true,
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      const isTimeout = error instanceof Error && error.name === 'AbortError';

      console.error(`[GOOGLE_CSE] Search error: ${errorMsg}`);

      return {
        query,
        results: [],
        retrievedAt: new Date().toISOString(),
        provider: this.name,
        success: false,
        error: isTimeout ? 'Search timeout' : errorMsg,
      };
    }
  }

  private mapFreshness(freshness: 'day' | 'week' | 'month' | 'year'): string | null {
    const map: Record<string, string> = {
      day: 'd1',
      week: 'w1',
      month: 'm1',
      year: 'y1',
    };
    return map[freshness] ?? null;
  }

  private extractPublishedDate(item: GoogleCSEResult): string | undefined {
    const metatags = item.pagemap?.metatags?.[0];
    if (metatags) {
      return metatags['article:published_time'] ?? metatags['og:updated_time'];
    }
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let googleCSEProvider: GoogleCSEProvider | null = null;

export function getGoogleCSEProvider(): GoogleCSEProvider {
  if (!googleCSEProvider) {
    googleCSEProvider = new GoogleCSEProvider();
  }
  return googleCSEProvider;
}
