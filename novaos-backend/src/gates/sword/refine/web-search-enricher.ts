// ═══════════════════════════════════════════════════════════════════════════════
// WEB SEARCH ENRICHER — Freshness Verification via Web Search
// NovaOS Gates — Phase 14C: SwordGate Refine Expansion
// ═══════════════════════════════════════════════════════════════════════════════
//
// Enriches topic landscapes with fresh information from web search:
//   - Verifies content freshness for volatile topics
//   - Detects deprecations and outdated practices
//   - Extracts latest version information
//   - Updates landscape with search findings
//
// Integrates with IWebSearchService (Tavily, etc.)
//
// ═══════════════════════════════════════════════════════════════════════════════

import { createTimestamp } from '../../../types/branded.js';
import type { Timestamp } from '../../../types/branded.js';
import type { AsyncAppResult } from '../../../types/result.js';
import { ok, err, appError } from '../../../types/result.js';

import type {
  TopicLandscape,
  VolatilityAssessment,
  FreshnessInfo,
  DeprecationWarning,
  IWebSearchService,
  WebSearchRequest,
  WebSearchResponse,
  WebSearchResult,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Configuration for web search enrichment.
 */
export interface WebSearchEnricherConfig {
  /** Maximum search results per query (default: 5) */
  readonly maxResultsPerQuery: number;

  /** Maximum total queries to run (default: 3) */
  readonly maxQueries: number;

  /** Time range for searches (default: 'year') */
  readonly defaultTimeRange: 'day' | 'week' | 'month' | 'year' | 'all';

  /** Preferred domains for technical content */
  readonly preferredDomains: readonly string[];

  /** Domains to exclude */
  readonly excludeDomains: readonly string[];

  /** Minimum volatility score to trigger enrichment (default: 0.6) */
  readonly volatilityThreshold: number;
}

/**
 * Default enricher configuration.
 */
export const DEFAULT_ENRICHER_CONFIG: WebSearchEnricherConfig = {
  maxResultsPerQuery: 5,
  maxQueries: 3,
  defaultTimeRange: 'year',
  preferredDomains: [
    'github.com',
    'stackoverflow.com',
    'dev.to',
    'medium.com',
    'docs.microsoft.com',
    'developer.mozilla.org',
    'react.dev',
    'nodejs.org',
    'python.org',
    'rust-lang.org',
  ],
  excludeDomains: [
    'pinterest.com',
    'facebook.com',
    'twitter.com',
  ],
  volatilityThreshold: 0.6,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// DEPRECATION PATTERNS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Patterns that indicate deprecated content.
 */
const DEPRECATION_PATTERNS: readonly {
  pattern: RegExp;
  severity: 'info' | 'warning' | 'critical';
}[] = [
  // Critical deprecations
  { pattern: /\b(end[- ]?of[- ]?life|EOL|no longer (supported|maintained))\b/i, severity: 'critical' },
  { pattern: /\b(security vulnerability|CVE-\d+|critical (bug|issue))\b/i, severity: 'critical' },
  { pattern: /\b(do not use|must migrate|breaking change)\b/i, severity: 'critical' },

  // Warnings
  { pattern: /\b(deprecated|deprecation|will be removed)\b/i, severity: 'warning' },
  { pattern: /\b(legacy|outdated|obsolete)\b/i, severity: 'warning' },
  { pattern: /\b(replaced by|superseded by|use .+ instead)\b/i, severity: 'warning' },
  { pattern: /\b(no longer recommended|avoid using)\b/i, severity: 'warning' },

  // Info
  { pattern: /\b(old (way|method|approach)|previous version)\b/i, severity: 'info' },
  { pattern: /\b(consider (using|migrating|upgrading))\b/i, severity: 'info' },
  { pattern: /\b(newer (version|alternative) available)\b/i, severity: 'info' },
];

/**
 * Patterns for extracting version information.
 */
const VERSION_PATTERNS: readonly RegExp[] = [
  /\b(v|version)\s*(\d+(?:\.\d+){0,3}(?:-[a-z]+\.\d+)?)\b/i,
  /\b(\d+\.\d+(?:\.\d+)?)\s*(release|released|stable|LTS)\b/i,
  /\blatest[:\s]+(\d+(?:\.\d+){0,3})\b/i,
  /\bcurrent[:\s]+(\d+(?:\.\d+){0,3})\b/i,
];

// ═══════════════════════════════════════════════════════════════════════════════
// WEB SEARCH ENRICHER CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Enriches topic landscapes with web search results.
 */
export class WebSearchEnricher {
  private readonly searchService: IWebSearchService;
  private readonly config: WebSearchEnricherConfig;

  constructor(
    searchService: IWebSearchService,
    config?: Partial<WebSearchEnricherConfig>
  ) {
    this.searchService = searchService;
    this.config = { ...DEFAULT_ENRICHER_CONFIG, ...config };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN ENRICHMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Enrich a topic landscape with web search results.
   *
   * @param landscape - The landscape to enrich
   * @returns Enriched landscape with freshness info and deprecations
   */
  async enrich(landscape: TopicLandscape): AsyncAppResult<TopicLandscape> {
    // Check if enrichment is needed
    if (!this.shouldEnrich(landscape.volatility)) {
      return ok(landscape);
    }

    // Check if service is available
    if (!this.searchService.isAvailable()) {
      console.warn('[WEB_SEARCH_ENRICHER] Search service not available');
      return ok(landscape);
    }

    try {
      // Generate search queries
      const queries = this.generateQueries(landscape);

      // Execute searches
      const searchResults = await this.executeSearches(queries);

      // Extract findings
      const freshness = this.buildFreshnessInfo(searchResults);
      const deprecations = this.extractDeprecations(searchResults, landscape.deprecations);

      // Return enriched landscape
      return ok({
        ...landscape,
        freshness,
        deprecations,
      });
    } catch (error) {
      console.error('[WEB_SEARCH_ENRICHER] Enrichment failed:', error);
      return err(appError('ENRICHMENT_ERROR', 'Failed to enrich landscape with web search'));
    }
  }

  /**
   * Check if a landscape should be enriched based on volatility.
   */
  shouldEnrich(volatility: VolatilityAssessment): boolean {
    return volatility.needsFreshness || volatility.score >= this.config.volatilityThreshold;
  }

  /**
   * Check if the search service is available.
   */
  isAvailable(): boolean {
    return this.searchService.isAvailable();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // QUERY GENERATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate search queries for a landscape.
   */
  private generateQueries(landscape: TopicLandscape): string[] {
    const queries: string[] = [];
    const currentYear = new Date().getFullYear();
    const topic = landscape.primaryTopic;

    // Use suggested search topics from volatility assessment if available
    if (landscape.volatility.suggestedSearchTopics?.length) {
      queries.push(...landscape.volatility.suggestedSearchTopics.slice(0, 2));
    }

    // Add standard freshness queries
    queries.push(`${topic} ${currentYear} latest changes`);
    queries.push(`${topic} deprecated features ${currentYear}`);

    // Add category-specific queries based on volatility signals
    for (const signal of landscape.volatility.signals) {
      switch (signal.category) {
        case 'tool_specific':
        case 'version_sensitive':
          queries.push(`${topic} latest version release notes`);
          break;
        case 'api_dependent':
          queries.push(`${topic} API changes breaking ${currentYear}`);
          break;
        case 'security_threat':
          queries.push(`${topic} security vulnerabilities ${currentYear}`);
          break;
        case 'certification':
          queries.push(`${topic} exam updates ${currentYear}`);
          break;
        case 'platform_dependent':
          queries.push(`${topic} migration guide ${currentYear}`);
          break;
      }
    }

    // Deduplicate and limit
    const uniqueQueries = [...new Set(queries)];
    return uniqueQueries.slice(0, this.config.maxQueries);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SEARCH EXECUTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute multiple search queries.
   */
  private async executeSearches(queries: string[]): Promise<WebSearchResponse[]> {
    const results: WebSearchResponse[] = [];

    for (const query of queries) {
      try {
        const request: WebSearchRequest = {
          query,
          maxResults: this.config.maxResultsPerQuery,
          preferredDomains: [...this.config.preferredDomains],
          excludeDomains: [...this.config.excludeDomains],
          timeRange: this.config.defaultTimeRange,
        };

        const response = await this.searchService.search(request);
        results.push(response);
      } catch (error) {
        console.warn(`[WEB_SEARCH_ENRICHER] Query failed: ${query}`, error);
        // Continue with other queries
      }
    }

    return results;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FRESHNESS EXTRACTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Build freshness info from search results.
   */
  private buildFreshnessInfo(searchResults: WebSearchResponse[]): FreshnessInfo {
    const timestamp = createTimestamp();
    const allResults = searchResults.flatMap(r => r.results);

    // Extract unique sources
    const sources = [...new Set(allResults.map(r => r.domain))];

    // Extract key findings
    const findings = this.extractFindings(allResults);

    // Extract latest version
    const latestVersion = this.extractLatestVersion(allResults);

    // Determine if content appears current
    const isCurrent = this.assessCurrentness(allResults);

    return {
      checkedAt: timestamp,
      sources,
      findings,
      isCurrent,
      latestVersion,
    };
  }

  /**
   * Extract key findings from search results.
   */
  private extractFindings(results: WebSearchResult[]): string[] {
    const findings: string[] = [];
    const currentYear = new Date().getFullYear();
    const recentYears = [currentYear, currentYear - 1];

    for (const result of results.slice(0, 10)) {
      const snippet = result.snippet;

      // Look for version mentions
      if (snippet.match(/\b(v|version)\s*\d+/i)) {
        findings.push(this.truncateSnippet(snippet));
        continue;
      }

      // Look for recent dates
      if (recentYears.some(year => snippet.includes(String(year)))) {
        findings.push(this.truncateSnippet(snippet));
        continue;
      }

      // Look for significant changes
      if (snippet.match(/\b(new|released|updated|changed|deprecated)\b/i)) {
        findings.push(this.truncateSnippet(snippet));
      }
    }

    return findings.slice(0, 5);
  }

  /**
   * Truncate a snippet to reasonable length.
   */
  private truncateSnippet(snippet: string, maxLength: number = 200): string {
    if (snippet.length <= maxLength) {
      return snippet;
    }

    // Try to cut at a sentence boundary
    const truncated = snippet.substring(0, maxLength);
    const lastPeriod = truncated.lastIndexOf('.');
    if (lastPeriod > maxLength * 0.5) {
      return truncated.substring(0, lastPeriod + 1);
    }

    return truncated + '...';
  }

  /**
   * Extract latest version from search results.
   */
  private extractLatestVersion(results: WebSearchResult[]): string | undefined {
    const versions: string[] = [];

    for (const result of results) {
      const text = `${result.title} ${result.snippet}`;

      for (const pattern of VERSION_PATTERNS) {
        const match = text.match(pattern);
        if (match) {
          const version = match[2] || match[1];
          if (version && this.isValidVersion(version)) {
            versions.push(version);
          }
        }
      }
    }

    if (versions.length === 0) {
      return undefined;
    }

    // Return highest version found
    return versions.sort(this.compareVersions).pop();
  }

  /**
   * Check if a string is a valid version number.
   */
  private isValidVersion(version: string): boolean {
    return /^\d+(\.\d+){0,3}(-[a-z]+\.\d+)?$/i.test(version);
  }

  /**
   * Compare two version strings.
   */
  private compareVersions(a: string, b: string): number {
    const partsA = a.split('.').map(p => parseInt(p, 10) || 0);
    const partsB = b.split('.').map(p => parseInt(p, 10) || 0);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const partA = partsA[i] ?? 0;
      const partB = partsB[i] ?? 0;
      if (partA !== partB) {
        return partA - partB;
      }
    }

    return 0;
  }

  /**
   * Assess if content appears current based on search results.
   */
  private assessCurrentness(results: WebSearchResult[]): boolean {
    const currentYear = new Date().getFullYear();
    let recentCount = 0;
    let deprecatedCount = 0;

    for (const result of results) {
      const text = `${result.title} ${result.snippet}`;

      // Check for recent dates
      if (text.includes(String(currentYear)) || text.includes(String(currentYear - 1))) {
        recentCount++;
      }

      // Check for deprecation signals
      if (text.match(/\b(deprecated|obsolete|end[- ]?of[- ]?life)\b/i)) {
        deprecatedCount++;
      }
    }

    // Consider current if we have recent content and not too many deprecation signals
    return recentCount > 0 && deprecatedCount < results.length * 0.3;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DEPRECATION EXTRACTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Extract deprecation warnings from search results.
   */
  private extractDeprecations(
    searchResults: WebSearchResponse[],
    existing: readonly DeprecationWarning[]
  ): readonly DeprecationWarning[] {
    const newDeprecations: DeprecationWarning[] = [...existing];
    const existingSubjects = new Set(existing.map(d => d.subject.toLowerCase()));

    for (const response of searchResults) {
      for (const result of response.results) {
        const text = `${result.title} ${result.snippet}`;

        for (const { pattern, severity } of DEPRECATION_PATTERNS) {
          if (pattern.test(text)) {
            // Extract subject (usually from title or first part of snippet)
            const subject = this.extractDeprecationSubject(result.title, text);

            // Skip if we already have this deprecation
            if (existingSubjects.has(subject.toLowerCase())) {
              continue;
            }

            // Extract alternative if mentioned
            const alternative = this.extractAlternative(text);

            newDeprecations.push({
              subject,
              reason: this.truncateSnippet(result.snippet, 150),
              alternative,
              severity,
            });

            existingSubjects.add(subject.toLowerCase());
            break; // Only one deprecation per result
          }
        }
      }
    }

    return newDeprecations;
  }

  /**
   * Extract deprecation subject from title and text.
   */
  private extractDeprecationSubject(title: string, text: string): string {
    // Try to extract from title
    const titleMatch = title.match(/^([^:|\-–]+)/);
    if (titleMatch) {
      return titleMatch[1].trim().substring(0, 50);
    }

    // Fall back to first significant phrase
    const phraseMatch = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/);
    if (phraseMatch) {
      return phraseMatch[1].substring(0, 50);
    }

    return 'Unknown component';
  }

  /**
   * Extract alternative recommendation from text.
   */
  private extractAlternative(text: string): string | undefined {
    const patterns = [
      /use\s+([A-Za-z0-9_\-\.]+)\s+instead/i,
      /replaced\s+(?:by|with)\s+([A-Za-z0-9_\-\.]+)/i,
      /migrate\s+to\s+([A-Za-z0-9_\-\.]+)/i,
      /superseded\s+by\s+([A-Za-z0-9_\-\.]+)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return undefined;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a WebSearchEnricher instance.
 */
export function createWebSearchEnricher(
  searchService: IWebSearchService,
  config?: Partial<WebSearchEnricherConfig>
): WebSearchEnricher {
  return new WebSearchEnricher(searchService, config);
}
