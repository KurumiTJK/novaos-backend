// ═══════════════════════════════════════════════════════════════════════════════
// TAVILY SEARCH PROVIDER — Primary Search for MEDIUM Tier
// Fast, reliable search with good snippet extraction
// ═══════════════════════════════════════════════════════════════════════════════

import type { SearchProvider, SearchOptions, SearchResponse, SearchResult } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TAVILY API TYPES
// ─────────────────────────────────────────────────────────────────────────────────

interface TavilySearchRequest {
  query: string;
  search_depth?: 'basic' | 'advanced';
  include_answer?: boolean;
  include_raw_content?: boolean;
  max_results?: number;
  include_domains?: string[];
  exclude_domains?: string[];
}

interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  raw_content?: string;
  score: number;
  published_date?: string;
}

interface TavilySearchResponse {
  query: string;
  answer?: string;
  results: TavilySearchResult[];
  response_time: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// TAVILY PROVIDER
// ─────────────────────────────────────────────────────────────────────────────────

export class TavilySearchProvider implements SearchProvider {
  name = 'tavily';
  private apiKey: string | null;
  private baseUrl = 'https://api.tavily.com';

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.TAVILY_API_KEY ?? null;
  }

  isAvailable(): boolean {
    return this.apiKey !== null;
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResponse> {
    if (!this.apiKey) {
      return {
        query,
        results: [],
        retrievedAt: new Date().toISOString(),
        provider: this.name,
        success: false,
        error: 'Tavily API key not configured',
      };
    }

    const timeout = options?.timeoutMs ?? 5000;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const requestBody: TavilySearchRequest = {
        query,
        search_depth: 'basic',
        include_answer: options?.includeAnswer ?? false,
        max_results: options?.maxResults ?? 5,
      };

      if (options?.includeDomains?.length) {
        requestBody.include_domains = options.includeDomains;
      }

      if (options?.excludeDomains?.length) {
        requestBody.exclude_domains = options.excludeDomains;
      }

      const response = await fetch(`${this.baseUrl}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[TAVILY] API error: ${response.status} - ${errorText}`);
        return {
          query,
          results: [],
          retrievedAt: new Date().toISOString(),
          provider: this.name,
          success: false,
          error: `Tavily API error: ${response.status}`,
        };
      }

      const data = await response.json() as TavilySearchResponse;

      const results: SearchResult[] = data.results.map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.content.slice(0, 500), // Limit snippet length
        publishedAt: r.published_date,
      }));

      return {
        query,
        results,
        totalResults: results.length,
        retrievedAt: new Date().toISOString(),
        provider: this.name,
        success: true,
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      const isTimeout = error instanceof Error && error.name === 'AbortError';

      console.error(`[TAVILY] Search error: ${errorMsg}`);

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
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let tavilyProvider: TavilySearchProvider | null = null;

export function getTavilyProvider(): TavilySearchProvider {
  if (!tavilyProvider) {
    tavilyProvider = new TavilySearchProvider();
  }
  return tavilyProvider;
}
