// ═══════════════════════════════════════════════════════════════════════════════
// RESOURCE DISCOVERY ORCHESTRATOR — Main Pipeline Coordinator
// NovaOS Spark Engine — Phase 6: Resource Discovery
// ═══════════════════════════════════════════════════════════════════════════════
//
// The orchestrator coordinates all resource discovery components:
//   - URL canonicalization and deduplication
//   - Provider detection and ID extraction
//   - Topic matching
//   - Known source lookup
//   - Caching at each stage
//   - API key management
//
// Pipeline stages:
//   1. Discover: Find candidate URLs from various sources
//   2. Canonicalize: Normalize and deduplicate URLs
//   3. Classify: Match to topics and detect providers
//   4. Enrich: Fetch metadata from APIs (YouTube, GitHub, etc.)
//   5. Verify: Check accessibility and content walls
//   6. Rank: Score and filter resources
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { Result } from '../../../types/result.js';
import { ok, err } from '../../../types/result.js';
import { getLogger } from '../../../observability/logging/index.js';
import { incCounter, observeHistogram } from '../../../observability/metrics/index.js';

// Types
import type {
  CanonicalURL,
  DisplayURL,
  TopicId,
  ResourceProvider,
  RawResourceCandidate,
  EnrichedResource,
  VerifiedResource,
  ResourceSource,
  ResourceError,
  QualitySignals,
  ResourceSelectionCriteria,
} from './types.js';
import {
  createCanonicalURL,
  createResourceId,
  createResourceError,
  QUALITY_THRESHOLDS,
  RESOURCE_TTL,
} from './types.js';

// Components
import { canonicalizeURL, urlsAreEquivalent, deduplicateURLs } from './canonicalize.js';
import { detectProvider, extractYouTubeId, extractGitHubId } from './provider-id.js';
import { getKnownSourcesRegistry, type KnownSourceMatch } from './known-sources/index.js';
import type { TopicMatchResult } from './taxonomy/index.js';
import { getResourceCache, type CacheGetResult } from './cache/index.js';
import { getApiKeyManager, type KeySelection } from './api-keys/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'resource-discovery' });

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Discovery source configuration.
 */
export interface DiscoverySource {
  /** Source type */
  readonly type: ResourceSource['type'];
  
  /** Whether this source is enabled */
  readonly enabled: boolean;
  
  /** Priority (lower = higher priority) */
  readonly priority: number;
  
  /** Maximum results from this source */
  readonly maxResults: number;
}

/**
 * Orchestrator configuration.
 */
export interface OrchestratorConfig {
  /** Maximum concurrent operations */
  readonly maxConcurrency: number;
  
  /** Enable caching */
  readonly enableCache: boolean;
  
  /** Enable known source lookup */
  readonly enableKnownSources: boolean;
  
  /** Enable API enrichment */
  readonly enableEnrichment: boolean;
  
  /** Enable accessibility verification */
  readonly enableVerification: boolean;
  
  /** Timeout for enrichment operations (ms) */
  readonly enrichmentTimeoutMs: number;
  
  /** Timeout for verification operations (ms) */
  readonly verificationTimeoutMs: number;
  
  /** Discovery sources */
  readonly sources: readonly DiscoverySource[];
}

/**
 * Default orchestrator configuration.
 */
export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  maxConcurrency: 5,
  enableCache: true,
  enableKnownSources: true,
  enableEnrichment: true,
  enableVerification: true,
  enrichmentTimeoutMs: 10000,
  verificationTimeoutMs: 5000,
  sources: [
    { type: 'known_source', enabled: true, priority: 1, maxResults: 20 },
    { type: 'curated_list', enabled: true, priority: 2, maxResults: 10 },
    { type: 'youtube_api', enabled: true, priority: 3, maxResults: 10 },
    { type: 'github_api', enabled: true, priority: 4, maxResults: 10 },
    { type: 'tavily_search', enabled: true, priority: 5, maxResults: 10 },
    { type: 'google_cse', enabled: false, priority: 6, maxResults: 10 },  // Disabled - requires CSE setup
  ],
};

/**
 * Discovery request.
 */
export interface DiscoveryRequest {
  /** Topics to find resources for */
  readonly topics: readonly TopicId[];
  
  /** Selection criteria */
  readonly criteria?: ResourceSelectionCriteria;
  
  /** Additional context/keywords */
  readonly keywords?: readonly string[];
  
  /** Preferred providers */
  readonly preferredProviders?: readonly ResourceProvider[];
  
  /** Exclude URLs */
  readonly excludeUrls?: readonly string[];
  
  /** Maximum total results */
  readonly maxResults?: number;
  
  /** Content types to include */
  readonly includeTypes?: readonly string[];
}

/**
 * Discovery result.
 */
export interface DiscoveryResult {
  /** Discovered resources */
  readonly resources: readonly VerifiedResource[];
  
  /** Resources that failed verification */
  readonly failed: readonly { url: string; error: ResourceError }[];
  
  /** Statistics */
  readonly stats: DiscoveryStats;
}

/**
 * Discovery statistics.
 */
export interface DiscoveryStats {
  /** Total candidates found */
  readonly candidatesFound: number;
  
  /** After deduplication */
  readonly afterDeduplication: number;
  
  /** From known sources */
  readonly fromKnownSources: number;
  
  /** Successfully enriched */
  readonly enriched: number;
  
  /** Successfully verified */
  readonly verified: number;
  
  /** Cache hits */
  readonly cacheHits: number;
  
  /** Duration in milliseconds */
  readonly durationMs: number;
  
  /** By provider */
  readonly byProvider: Record<string, number>;
}

/**
 * Classification result for a URL.
 */
export interface ClassificationResult {
  readonly url: CanonicalURL;
  readonly provider: ResourceProvider;
  readonly providerId: unknown;
  readonly topics: readonly TopicMatchResult[];
  readonly knownSource: KnownSourceMatch | null;
  readonly confidence: number;
}

/**
 * Orchestrator error codes.
 */
export type OrchestratorErrorCode =
  | 'NO_TOPICS'
  | 'NO_SOURCES_ENABLED'
  | 'ALL_FAILED'
  | 'TIMEOUT'
  | 'CANCELLED';

/**
 * Orchestrator error.
 */
export interface OrchestratorError {
  readonly code: OrchestratorErrorCode;
  readonly message: string;
  readonly cause?: Error;
}

// ─────────────────────────────────────────────────────────────────────────────────
// YOUTUBE API TYPES
// ─────────────────────────────────────────────────────────────────────────────────

interface YouTubeSearchResponse {
  items?: Array<{
    id: { videoId?: string; playlistId?: string };
    snippet: {
      title: string;
      description: string;
      channelTitle: string;
      publishedAt: string;
      thumbnails?: {
        default?: { url: string };
        medium?: { url: string };
        high?: { url: string };
      };
    };
  }>;
  pageInfo?: {
    totalResults: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// GITHUB API TYPES
// ─────────────────────────────────────────────────────────────────────────────────

interface GitHubSearchResponse {
  total_count: number;
  items: Array<{
    id: number;
    name: string;
    full_name: string;
    html_url: string;
    description: string | null;
    stargazers_count: number;
    forks_count: number;
    language: string | null;
    topics: string[];
    updated_at: string;
    owner: {
      login: string;
      avatar_url: string;
    };
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────────
// TAVILY API TYPES
// ─────────────────────────────────────────────────────────────────────────────────

interface TavilySearchResponse {
  query: string;
  results: Array<{
    title: string;
    url: string;
    content: string;
    score: number;
    published_date?: string;
  }>;
  response_time?: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// GOOGLE CSE API TYPES
// ─────────────────────────────────────────────────────────────────────────────────

interface GoogleCSEResponse {
  kind: string;
  searchInformation?: {
    totalResults: string;
    searchTime: number;
  };
  items?: Array<{
    title: string;
    link: string;
    displayLink: string;
    snippet: string;
    formattedUrl?: string;
    htmlSnippet?: string;
    pagemap?: {
      metatags?: Array<Record<string, string>>;
    };
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────────
// RESOURCE DISCOVERY ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Main resource discovery orchestrator.
 */
export class ResourceDiscoveryOrchestrator {
  private readonly config: OrchestratorConfig;
  
  constructor(config?: Partial<OrchestratorConfig>) {
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Main Discovery Pipeline
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Discover resources for given topics.
   */
  async discover(request: DiscoveryRequest): Promise<Result<DiscoveryResult, OrchestratorError>> {
    const startTime = Date.now();
    const stats: {
      candidatesFound: number;
      afterDeduplication: number;
      fromKnownSources: number;
      enriched: number;
      verified: number;
      cacheHits: number;
      byProvider: Record<string, number>;
      durationMs?: number;
    } = {
      candidatesFound: 0,
      afterDeduplication: 0,
      fromKnownSources: 0,
      enriched: 0,
      verified: 0,
      cacheHits: 0,
      byProvider: {},
    };
    
    logger.info('Starting resource discovery', {
      topics: request.topics,
      maxResults: request.maxResults,
    });
    
    // Validate request
    if (!request.topics || request.topics.length === 0) {
      return err({
        code: 'NO_TOPICS',
        message: 'At least one topic is required',
      });
    }
    
    const enabledSources = this.config.sources.filter(s => s.enabled);
    if (enabledSources.length === 0) {
      return err({
        code: 'NO_SOURCES_ENABLED',
        message: 'No discovery sources are enabled',
      });
    }
    
    try {
      // Stage 1: Find candidates from all sources
      const candidates = await this.findCandidates(request, stats);
      stats.candidatesFound = candidates.length;
      
      logger.info('Candidates found', { count: candidates.length });
      
      // Stage 2: Canonicalize and deduplicate
      const deduplicated = this.deduplicateCandidates(candidates, request.excludeUrls);
      stats.afterDeduplication = deduplicated.length;
      
      // Stage 3: Classify (provider detection, topic matching)
      const classified = await this.classifyCandidates(deduplicated);
      
      // Stage 4: Enrich with API metadata
      const enriched = await this.enrichCandidates(classified, stats);
      stats.enriched = enriched.length;
      
      // Stage 5: Verify accessibility
      const { verified, failed } = await this.verifyCandidates(enriched, stats);
      stats.verified = verified.length;
      
      // Stage 6: Rank and filter
      const ranked = this.rankResources(verified, request.criteria);
      
      // Apply max results limit
      const maxResults = request.maxResults ?? 20;
      const limited = ranked.slice(0, maxResults);
      
      stats.durationMs = Date.now() - startTime;
      
      logger.info('Resource discovery complete', {
        found: limited.length,
        duration: stats.durationMs,
      });
      
      incCounter('discovery_requests_total', { status: 'success' });
      observeHistogram('discovery_duration_ms', stats.durationMs!);
      
      return ok({
        resources: limited,
        failed,
        stats: stats as DiscoveryStats,
      });
    } catch (error) {
      logger.error('Resource discovery failed', { error });
      incCounter('discovery_requests_total', { status: 'error' });
      
      return err({
        code: 'ALL_FAILED',
        message: error instanceof Error ? error.message : 'Discovery failed',
        cause: error instanceof Error ? error : undefined,
      });
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Stage 1: Find Candidates
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Find candidate URLs from all enabled sources.
   */
  private async findCandidates(
    request: DiscoveryRequest,
    stats: { fromKnownSources: number; [key: string]: unknown }
  ): Promise<RawResourceCandidate[]> {
    const candidates: RawResourceCandidate[] = [];
    
    // Sort sources by priority
    const sources = [...this.config.sources]
      .filter(s => s.enabled)
      .sort((a, b) => a.priority - b.priority);
    
    for (const source of sources) {
      try {
        logger.debug('Searching source', { type: source.type });
        const sourceCandidates = await this.findFromSource(source, request);
        candidates.push(...sourceCandidates);
        
        logger.debug('Source results', { type: source.type, count: sourceCandidates.length });
        
        // Track known source count
        if (source.type === 'known_source') {
          stats.fromKnownSources = sourceCandidates.length;
        }
      } catch (error) {
        logger.warn('Source failed', { source: source.type, error });
      }
    }
    
    return candidates;
  }
  
  /**
   * Find candidates from a specific source.
   */
  private async findFromSource(
    source: DiscoverySource,
    request: DiscoveryRequest
  ): Promise<RawResourceCandidate[]> {
    switch (source.type) {
      case 'known_source':
        return this.findFromKnownSources(request, source.maxResults);
      
      case 'curated_list':
        // Would load from curated lists
        return [];
      
      case 'youtube_api':
        return this.findFromYouTubeApi(request, source.maxResults);
      
      case 'github_api':
        return this.findFromGitHubApi(request, source.maxResults);
      
      case 'tavily_search':
        return this.findFromTavily(request, source.maxResults);
      
      case 'google_cse':
        return this.findFromGoogleCSE(request, source.maxResults);
      
      case 'web_search':
        // Legacy - try Tavily first, fall back to Google CSE
        const tavilyResults = await this.findFromTavily(request, source.maxResults);
        if (tavilyResults.length > 0) return tavilyResults;
        return this.findFromGoogleCSE(request, source.maxResults);
      
      default:
        return [];
    }
  }
  
  /**
   * Find resources from known sources registry.
   */
  private findFromKnownSources(
    request: DiscoveryRequest,
    maxResults: number
  ): RawResourceCandidate[] {
    const registry = getKnownSourcesRegistry();
    const candidates: RawResourceCandidate[] = [];
    
    for (const topicId of request.topics) {
      const sources = registry.getByTopic(topicId);
      
      for (const source of sources.slice(0, maxResults)) {
        const now = new Date();
        candidates.push({
          id: createResourceId(`known:${source.id}:${topicId}`),
          canonicalUrl: source.baseUrl as CanonicalURL,
          displayUrl: source.baseUrl as unknown as DisplayURL,
          source: {
            type: 'known_source',
            sourceId: source.id,
            discoveredAt: now,
          },
          provider: source.provider ?? 'other',
          topicIds: [topicId],
          title: source.name,
          snippet: source.description,
          createdAt: now,
          expiresAt: new Date(now.getTime() + RESOURCE_TTL.KNOWN_SOURCE_MS),
        });
      }
    }
    
    return candidates;
  }
  
  /**
   * Find resources from YouTube API.
   * PHASE 17D: Actual implementation with YouTube Data API v3
   */
  private async findFromYouTubeApi(
    request: DiscoveryRequest,
    maxResults: number
  ): Promise<RawResourceCandidate[]> {
    // Check if we have API keys available
    const keyManager = getApiKeyManager();
    const keyResult = keyManager.getKey('youtube');
    
    if (!keyResult.ok) {
      logger.debug('YouTube API key unavailable', { error: keyResult.error });
      return [];
    }
    
    const keySelection = keyResult.value;
    
    const candidates: RawResourceCandidate[] = [];
    
    try {
      // Build search query - prioritize keywords (main goal) over granular topics
      const query = this.buildSearchQuery(request, 'tutorial');
      
      logger.info('YouTube API search', { query, maxResults });
      
      // Call YouTube Data API v3
      const url = new URL('https://www.googleapis.com/youtube/v3/search');
      url.searchParams.set('part', 'snippet');
      url.searchParams.set('q', query);
      url.searchParams.set('type', 'video');
      url.searchParams.set('maxResults', String(Math.min(maxResults, 25)));
      url.searchParams.set('relevanceLanguage', 'en');
      url.searchParams.set('safeSearch', 'moderate');
      url.searchParams.set('videoDuration', 'medium'); // 4-20 minutes
      url.searchParams.set('key', keySelection.key);
      
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        logger.error('YouTube API error', { 
          status: response.status, 
          error: errorText 
        });
        
        // Mark key as rate limited if quota exceeded
        if (response.status === 403) {
          keyManager.markRateLimited(keySelection.keyId);
        }
        
        return [];
      }
      
      const data = await response.json() as YouTubeSearchResponse;
      
      logger.info('YouTube API response', { 
        itemCount: data.items?.length ?? 0,
        totalResults: data.pageInfo?.totalResults ?? 0 
      });
      
      // Record usage
      keyManager.recordUsage(keySelection.keyId, data.items?.length ?? 1);
      
      // Convert to candidates
      for (const item of data.items ?? []) {
        if (!item.id.videoId) continue;
        
        const videoUrl = `https://www.youtube.com/watch?v=${item.id.videoId}`;
        const now = new Date();
        
        candidates.push({
          id: createResourceId(`youtube:${item.id.videoId}`),
          canonicalUrl: videoUrl as CanonicalURL,
          displayUrl: videoUrl as unknown as DisplayURL,
          source: {
            type: 'youtube_api',
            discoveredAt: now,
          },
          provider: 'youtube',
          topicIds: request.topics,
          title: item.snippet.title,
          snippet: item.snippet.description?.substring(0, 500),
          createdAt: now,
          expiresAt: new Date(now.getTime() + RESOURCE_TTL.API_SEARCH_MS),
          metadata: {
            channelTitle: item.snippet.channelTitle,
            publishedAt: item.snippet.publishedAt,
            thumbnailUrl: item.snippet.thumbnails?.medium?.url ?? item.snippet.thumbnails?.default?.url,
          },
        });
      }
      
      logger.info('YouTube candidates created', { count: candidates.length });
      
      // Log discovered resources for verification
      for (const c of candidates.slice(0, 5)) {
        logger.info('YouTube resource', { 
          title: c.title?.substring(0, 60), 
          url: c.canonicalUrl 
        });
      }
      
    } catch (error) {
      logger.error('YouTube API fetch error', { error });
    }
    
    return candidates;
  }
  
  /**
   * Find resources from GitHub API.
   * PHASE 17D: Actual implementation with GitHub Search API
   */
  private async findFromGitHubApi(
    request: DiscoveryRequest,
    maxResults: number
  ): Promise<RawResourceCandidate[]> {
    // Check if we have API keys available
    const keyManager = getApiKeyManager();
    const keyResult = keyManager.getKey('github');
    
    if (!keyResult.ok) {
      logger.debug('GitHub API key unavailable', { error: keyResult.error });
      return [];
    }
    
    const keySelection = keyResult.value;
    
    const candidates: RawResourceCandidate[] = [];
    
    try {
      // Build search query - prioritize keywords (main goal) over granular topics
      const query = this.buildSearchQuery(request, 'tutorial learning');
      
      logger.info('GitHub API search', { query, maxResults });
      
      // Call GitHub Search API
      const url = new URL('https://api.github.com/search/repositories');
      url.searchParams.set('q', `${query} in:name,description,readme`);
      url.searchParams.set('sort', 'stars');
      url.searchParams.set('order', 'desc');
      url.searchParams.set('per_page', String(Math.min(maxResults, 30)));
      
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': `token ${keySelection.key}`,
          'User-Agent': 'NovaOS-ResourceDiscovery/1.0',
        },
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        logger.error('GitHub API error', { 
          status: response.status, 
          error: errorText 
        });
        
        // Mark key as rate limited if quota exceeded
        if (response.status === 403 || response.status === 429) {
          keyManager.markRateLimited(keySelection.keyId);
        }
        
        return [];
      }
      
      const data = await response.json() as GitHubSearchResponse;
      
      logger.info('GitHub API response', { 
        itemCount: data.items?.length ?? 0,
        totalCount: data.total_count 
      });
      
      // Record usage
      keyManager.recordUsage(keySelection.keyId, 1);
      
      // Convert to candidates
      for (const item of data.items ?? []) {
        const now = new Date();
        
        candidates.push({
          id: createResourceId(`github:${item.id}`),
          canonicalUrl: item.html_url as CanonicalURL,
          displayUrl: item.html_url as unknown as DisplayURL,
          source: {
            type: 'github_api',
            discoveredAt: now,
          },
          provider: 'github',
          topicIds: request.topics,
          title: item.full_name,
          snippet: item.description ?? `A ${item.language ?? 'programming'} repository with ${item.stargazers_count} stars`,
          createdAt: now,
          expiresAt: new Date(now.getTime() + RESOURCE_TTL.API_SEARCH_MS),
          metadata: {
            stars: item.stargazers_count,
            forks: item.forks_count,
            language: item.language,
            topics: item.topics,
            owner: item.owner.login,
            updatedAt: item.updated_at,
          },
        });
      }
      
      logger.info('GitHub candidates created', { count: candidates.length });
      
      // Log discovered resources for verification
      for (const item of (data.items ?? []).slice(0, 5)) {
        logger.info('GitHub resource', { 
          repo: item.full_name, 
          stars: item.stargazers_count,
          url: item.html_url 
        });
      }
      
    } catch (error) {
      logger.error('GitHub API fetch error', { error });
    }
    
    return candidates;
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // TAVILY SEARCH API
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Find resources from Tavily AI Search API.
   * Tavily provides AI-optimized search results with summaries.
   */
  private async findFromTavily(
    request: DiscoveryRequest,
    maxResults: number
  ): Promise<RawResourceCandidate[]> {
    // Get Tavily API key from environment
    const apiKey = process.env.TAVILY_API_KEY;
    
    if (!apiKey) {
      logger.debug('Tavily API key not configured');
      return [];
    }
    
    const candidates: RawResourceCandidate[] = [];
    
    try {
      // Build search query - prioritize keywords (main goal) over granular topics
      const query = this.buildSearchQuery(request, 'tutorial guide documentation');
      
      logger.info('Tavily API search', { query, maxResults });
      
      // Call Tavily Search API
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: 'basic',
          include_answer: false,
          include_raw_content: false,
          max_results: Math.min(maxResults, 20),
          include_domains: [
            'doc.rust-lang.org',
            'docs.python.org',
            'developer.mozilla.org',
            'learn.microsoft.com',
            'dev.to',
            'medium.com',
            'freecodecamp.org',
            'codecademy.com',
            'exercism.org',
            'rust-lang.org',
            'typescriptlang.org',
          ],
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Tavily API error', { 
          status: response.status, 
          error: errorText 
        });
        return [];
      }
      
      const data = await response.json() as TavilySearchResponse;
      
      logger.info('Tavily API response', { 
        resultCount: data.results?.length ?? 0 
      });
      
      // Convert to candidates
      for (const result of data.results ?? []) {
        const now = new Date();
        
        candidates.push({
          id: createResourceId(`tavily:${Buffer.from(result.url).toString('base64').substring(0, 32)}`),
          canonicalUrl: result.url as CanonicalURL,
          displayUrl: result.url as unknown as DisplayURL,
          source: {
            type: 'tavily_search' as any,
            discoveredAt: now,
          },
          provider: this.detectProviderFromUrl(result.url),
          topicIds: request.topics,
          title: result.title,
          snippet: result.content?.substring(0, 500),
          createdAt: now,
          expiresAt: new Date(now.getTime() + RESOURCE_TTL.API_SEARCH_MS),
          metadata: {
            score: result.score,
            publishedDate: result.published_date,
          },
        });
      }
      
      logger.info('Tavily candidates created', { count: candidates.length });
      
      // Log discovered resources for verification
      for (const result of (data.results ?? []).slice(0, 5)) {
        logger.info('Tavily resource', { 
          title: result.title?.substring(0, 60), 
          url: result.url,
          score: result.score
        });
      }
      
    } catch (error) {
      logger.error('Tavily API fetch error', { error });
    }
    
    return candidates;
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // GOOGLE CUSTOM SEARCH ENGINE (CSE)
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Find resources from Google Custom Search Engine.
   */
  private async findFromGoogleCSE(
    request: DiscoveryRequest,
    maxResults: number
  ): Promise<RawResourceCandidate[]> {
    // Get Google CSE credentials from environment
    const apiKey = process.env.GOOGLE_CSE_API_KEY;
    const searchEngineId = process.env.GOOGLE_CSE_ID;
    
    if (!apiKey || !searchEngineId) {
      logger.debug('Google CSE not configured', { 
        hasApiKey: !!apiKey, 
        hasSearchEngineId: !!searchEngineId 
      });
      return [];
    }
    
    const candidates: RawResourceCandidate[] = [];
    
    try {
      // Build search query from topics
      const searchTerms = request.topics.map(t => {
        const topicStr = typeof t === 'string' ? t : (t as any).id ?? String(t);
        return topicStr.split(':').slice(1).join(' ');
      }).join(' ');
      
      const query = `${searchTerms} tutorial beginner guide`;
      
      logger.info('Google CSE search', { query, maxResults });
      
      // Call Google Custom Search API
      const url = new URL('https://www.googleapis.com/customsearch/v1');
      url.searchParams.set('key', apiKey);
      url.searchParams.set('cx', searchEngineId);
      url.searchParams.set('q', query);
      url.searchParams.set('num', String(Math.min(maxResults, 10))); // Google CSE max is 10 per request
      
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Google CSE error', { 
          status: response.status, 
          error: errorText 
        });
        return [];
      }
      
      const data = await response.json() as GoogleCSEResponse;
      
      logger.info('Google CSE response', { 
        resultCount: data.items?.length ?? 0,
        totalResults: data.searchInformation?.totalResults
      });
      
      // Convert to candidates
      for (const item of data.items ?? []) {
        const now = new Date();
        
        candidates.push({
          id: createResourceId(`gcse:${Buffer.from(item.link).toString('base64').substring(0, 32)}`),
          canonicalUrl: item.link as CanonicalURL,
          displayUrl: item.displayLink as unknown as DisplayURL,
          source: {
            type: 'google_cse' as any,
            discoveredAt: now,
          },
          provider: this.detectProviderFromUrl(item.link),
          topicIds: request.topics,
          title: item.title,
          snippet: item.snippet?.substring(0, 500),
          createdAt: now,
          expiresAt: new Date(now.getTime() + RESOURCE_TTL.API_SEARCH_MS),
          metadata: {
            displayLink: item.displayLink,
            formattedUrl: item.formattedUrl,
            htmlSnippet: item.htmlSnippet,
          },
        });
      }
      
      logger.info('Google CSE candidates created', { count: candidates.length });
      
      // Log discovered resources for verification
      for (const item of (data.items ?? []).slice(0, 5)) {
        logger.info('Google CSE resource', { 
          title: item.title?.substring(0, 60), 
          url: item.link 
        });
      }
      
    } catch (error) {
      logger.error('Google CSE fetch error', { error });
    }
    
    return candidates;
  }
  
  /**
   * Detect provider from URL for web search results.
   */
  private detectProviderFromUrl(url: string): ResourceProvider {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      
      if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
        return 'youtube';
      }
      if (hostname.includes('github.com')) {
        return 'github';
      }
      if (hostname.includes('stackoverflow.com')) {
        return 'stackoverflow';
      }
      if (hostname.includes('npmjs.com') || hostname.includes('npmjs.org')) {
        return 'npm';
      }
      if (hostname.includes('crates.io')) {
        return 'crates';
      }
      if (hostname.includes('pypi.org')) {
        return 'pypi';
      }
      if (hostname.includes('developer.mozilla.org')) {
        return 'mdn';
      }
      
      return 'other';
    } catch {
      return 'other';
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Stage 2: Deduplicate
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Deduplicate candidates by canonical URL.
   */
  private deduplicateCandidates(
    candidates: RawResourceCandidate[],
    excludeUrls?: readonly string[]
  ): RawResourceCandidate[] {
    const seen = new Set<string>();
    const excluded = new Set(excludeUrls ?? []);
    const result: RawResourceCandidate[] = [];
    
    for (const candidate of candidates) {
      const canonical = candidate.canonicalUrl;
      
      // Skip if excluded
      if (excluded.has(canonical)) {
        continue;
      }
      
      // Skip if already seen
      if (seen.has(canonical)) {
        continue;
      }
      
      seen.add(canonical);
      result.push(candidate);
    }
    
    return result;
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Stage 3: Classify
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Classify candidates with provider detection and topic matching.
   */
  private async classifyCandidates(
    candidates: RawResourceCandidate[]
  ): Promise<Array<RawResourceCandidate & { classification: ClassificationResult }>> {
    const results: Array<RawResourceCandidate & { classification: ClassificationResult }> = [];
    
    for (const candidate of candidates) {
      const classification = this.classifyUrl(candidate.canonicalUrl);
      results.push({ ...candidate, classification });
    }
    
    return results;
  }
  
  /**
   * Classify a single URL.
   */
  classifyUrl(url: string): ClassificationResult {
    // Canonicalize
    const canonResult = canonicalizeURL(url);
    const canonical = canonResult?.canonical ?? createCanonicalURL(url);
    
    // Detect provider
    const providerResult = detectProvider(url);
    
    // Topic matching is done at candidate level (already have topicIds)
    // No need to match URL to topics here
    const topicMatches: TopicMatchResult[] = [];
    
    // Check known sources (safely)
    let knownSource: KnownSourceMatch | null = null;
    try {
      const knownSourcesRegistry = getKnownSourcesRegistry();
      if (typeof knownSourcesRegistry.matchUrl === 'function') {
        knownSource = knownSourcesRegistry.matchUrl(url);
      }
    } catch {
      // Known source lookup failed, continue without it
    }
    
    // Calculate confidence
    const confidence = this.calculateClassificationConfidence(
      providerResult,
      topicMatches,
      knownSource
    );
    
    return {
      url: canonical,
      provider: providerResult.provider,
      providerId: providerResult.id,
      topics: topicMatches,
      knownSource,
      confidence,
    };
  }
  
  /**
   * Calculate classification confidence.
   */
  private calculateClassificationConfidence(
    _providerResult: { provider: ResourceProvider; id: unknown },
    topicMatches: readonly TopicMatchResult[],
    knownSource: KnownSourceMatch | null
  ): number {
    let confidence = 0.5; // Base confidence
    
    // Boost for known source
    if (knownSource) {
      confidence += 0.3;
    }
    
    // Boost for topic matches
    if (topicMatches.length > 0) {
      const avgTopicConfidence = topicMatches.reduce((sum, m) => sum + m.confidence, 0) / topicMatches.length;
      confidence += avgTopicConfidence * 0.2;
    }
    
    return Math.min(confidence, 1);
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Stage 4: Enrich
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Enrich candidates with provider-specific metadata.
   */
  private async enrichCandidates(
    candidates: Array<RawResourceCandidate & { classification: ClassificationResult }>,
    stats: { cacheHits: number; byProvider: Record<string, number>; [key: string]: unknown }
  ): Promise<EnrichedResource[]> {
    const enriched: EnrichedResource[] = [];
    const cache = getResourceCache();
    
    // Process in batches for concurrency control
    const batches = this.batch(candidates, this.config.maxConcurrency);
    
    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map(async (candidate) => {
          // Check cache first
          if (this.config.enableCache) {
            const cached = await cache.getEnriched(candidate.canonicalUrl);
            if (cached.ok) {
              stats.cacheHits++;
              return cached.value.data;
            }
          }
          
          // Enrich by provider
          const result = await this.enrichByProvider(candidate);
          
          // Cache result
          if (result && this.config.enableCache) {
            await cache.setEnriched(candidate.canonicalUrl, result);
          }
          
          return result;
        })
      );
      
      for (const result of batchResults) {
        if (result) {
          enriched.push(result);
          
          // Track by provider
          const provider = result.provider;
          stats.byProvider[provider] = (stats.byProvider[provider] ?? 0) + 1;
        }
      }
    }
    
    return enriched;
  }
  
  /**
   * Enrich a single candidate by its provider.
   */
  private async enrichByProvider(
    candidate: RawResourceCandidate & { classification: ClassificationResult }
  ): Promise<EnrichedResource | null> {
    const now = new Date();
    
    // Build base enriched resource
    const base: EnrichedResource = {
      id: candidate.id,
      canonicalUrl: candidate.canonicalUrl,
      displayUrl: candidate.displayUrl,
      url: candidate.canonicalUrl,
      title: candidate.title ?? 'Untitled',
      description: candidate.snippet ?? '',
      source: candidate.source,
      provider: candidate.classification.provider,
      providerId: candidate.classification.providerId
        ? String(candidate.classification.providerId)
        : undefined,
      topics: candidate.classification.topics.map(t => ({
        id: t.topicId,
        name: t.topicId.split(':').pop() ?? t.topicId,
      })),
      contentType: this.inferContentType(candidate.classification.provider),
      difficulty: 'beginner',
      estimatedMinutes: this.inferDuration(candidate.classification.provider),
      candidateCreatedAt: candidate.createdAt,
      enrichedAt: now,
      qualitySignals: this.computeInitialQuality(candidate),
    };
    
    return base;
  }
  
  /**
   * Infer content type from provider.
   */
  private inferContentType(provider: ResourceProvider): string {
    switch (provider) {
      case 'youtube':
        return 'video';
      case 'github':
        return 'repository';
      case 'npm':
      case 'crates':
      case 'pypi':
        return 'documentation';
      case 'stackoverflow':
        return 'article';
      case 'mdn':
        return 'documentation';
      default:
        return 'article';
    }
  }
  
  /**
   * Infer estimated duration from provider.
   */
  private inferDuration(provider: ResourceProvider): number {
    switch (provider) {
      case 'youtube':
        return 15; // Average tutorial video
      case 'github':
        return 30; // Time to explore a repo
      case 'stackoverflow':
        return 5;
      case 'mdn':
        return 10;
      default:
        return 15;
    }
  }
  
  /**
   * Compute initial quality signals.
   */
  private computeInitialQuality(
    candidate: RawResourceCandidate & { classification: ClassificationResult }
  ): QualitySignals {
    let popularity = 0.5;
    let authority = 0.5;
    
    // Boost for known sources
    if (candidate.classification.knownSource) {
      authority = 0.8 + (candidate.classification.knownSource.authority === 'official' ? 0.2 : 0);
    }
    
    // Use metadata if available
    const metadata = (candidate as any).metadata;
    if (metadata?.stars) {
      // GitHub stars
      popularity = Math.min(0.9, 0.3 + Math.log10(metadata.stars + 1) / 5);
    }
    
    return {
      popularity,
      recency: 0.7, // Assume reasonably recent
      authority,
      completeness: 0.6,
      composite: (popularity + 0.7 + authority + 0.6) / 4,
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Stage 5: Verify
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Verify accessibility of enriched resources.
   */
  private async verifyCandidates(
    enriched: EnrichedResource[],
    stats: { cacheHits: number; [key: string]: unknown }
  ): Promise<{ verified: VerifiedResource[]; failed: { url: string; error: ResourceError }[] }> {
    const verified: VerifiedResource[] = [];
    const failed: { url: string; error: ResourceError }[] = [];
    const cache = getResourceCache();
    
    // Process in batches
    const batches = this.batch(enriched, this.config.maxConcurrency);
    
    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map(async (resource) => {
          // Check cache first
          if (this.config.enableCache) {
            const cached = await cache.getVerified(resource.canonicalUrl);
            if (cached.ok) {
              stats.cacheHits++;
              return { verified: cached.value.data, failed: null };
            }
          }
          
          // Verify
          const result = await this.verifyResource(resource);
          
          if (result.ok) {
            // Cache result
            if (this.config.enableCache) {
              await cache.setVerified(resource.canonicalUrl, result.value);
            }
            return { verified: result.value, failed: null };
          } else {
            return {
              verified: null,
              failed: { url: resource.canonicalUrl, error: result.error },
            };
          }
        })
      );
      
      for (const result of batchResults) {
        if (result.verified) {
          verified.push(result.verified);
        }
        if (result.failed) {
          failed.push(result.failed);
        }
      }
    }
    
    return { verified, failed };
  }
  
  /**
   * Verify a single resource.
   */
  private async verifyResource(
    enriched: EnrichedResource
  ): Promise<Result<VerifiedResource, ResourceError>> {
    // For now, create unverified resource
    // Full verification (HEAD request, content wall detection) would go here
    return ok(this.createUnverifiedResource(enriched));
  }
  
  /**
   * Create a resource without verification (assumed accessible).
   */
  private createUnverifiedResource(enriched: EnrichedResource): VerifiedResource {
    const now = new Date();
    
    return {
      ...enriched,
      discoveredAt: enriched.candidateCreatedAt,
      verifiedAt: now,
      expiresAt: new Date(now.getTime() + RESOURCE_TTL.VERIFICATION_MS),
      accessibility: 'accessible',
      evidence: {
        verifiedAt: now,
        level: 'low',
        httpStatus: 200,
        responseTimeMs: 0,
        usesHttps: true,
        walls: {
          hasPaywall: false,
          hasLoginWall: false,
          hasBotWall: false,
          hasAgeGate: false,
          hasCookieWall: false,
          hasGeoBlock: false,
        },
        isSoft404: false,
        isJsAppShell: false,
      },
      usability: {
        score: 0.7,
        recommended: true,
        issues: [],
        strengths: ['From known source'],
        audienceMatch: 0.8,
        prerequisitesCovered: true,
        missingPrerequisites: [],
      },
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Stage 6: Rank
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Rank and filter verified resources.
   */
  private rankResources(
    resources: VerifiedResource[],
    criteria?: ResourceSelectionCriteria
  ): VerifiedResource[] {
    // Filter by criteria
    let filtered = resources;
    
    if (criteria) {
      filtered = resources.filter(r => {
        // Check quality threshold
        const avgQuality = (
          r.qualitySignals.popularity +
          r.qualitySignals.recency +
          r.qualitySignals.authority +
          r.qualitySignals.completeness
        ) / 4;
        
        if (criteria.minQualityScore && avgQuality < criteria.minQualityScore) {
          return false;
        }
        
        // Check preferred providers
        if (criteria.preferredProviders && criteria.preferredProviders.length > 0) {
          if (!criteria.preferredProviders.includes(r.provider)) {
            return false;
          }
        }
        
        return true;
      });
    }
    
    // Sort by composite score
    return filtered.sort((a, b) => {
      const scoreA = this.computeCompositeScore(a);
      const scoreB = this.computeCompositeScore(b);
      return scoreB - scoreA;
    });
  }
  
  /**
   * Compute composite score for ranking.
   */
  private computeCompositeScore(resource: VerifiedResource): number {
    const quality = (
      resource.qualitySignals.popularity * 0.2 +
      resource.qualitySignals.recency * 0.2 +
      resource.qualitySignals.authority * 0.4 +
      resource.qualitySignals.completeness * 0.2
    );
    
    const usability = resource.usability.score;
    
    // Boost for known sources
    const knownSourceBoost = resource.source.type === 'known_source' ? 0.1 : 0;
    
    return quality * 0.6 + usability * 0.4 + knownSourceBoost;
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Single URL Operations
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Process a single URL through the pipeline.
   */
  async processUrl(url: string): Promise<Result<VerifiedResource, ResourceError>> {
    // Canonicalize
    const canonResult = canonicalizeURL(url);
    if (!canonResult) {
      return err(createResourceError('INVALID_URL', `Invalid URL: ${url}`));
    }
    
    // Check cache
    const cache = getResourceCache();
    const cached = await cache.getVerified(canonResult.canonical);
    if (cached.ok) {
      return ok(cached.value.data);
    }
    
    // Create candidate
    const now = new Date();
    const classification = this.classifyUrl(url);
    const candidate: RawResourceCandidate = {
      id: createResourceId(`user:${canonResult.canonical}`),
      canonicalUrl: canonResult.canonical,
      displayUrl: canonResult.display as unknown as DisplayURL,
      source: {
        type: 'user_provided',
        discoveredAt: now,
      },
      provider: classification.provider,
      topicIds: classification.topics.map(t => t.topicId),
      createdAt: now,
      expiresAt: new Date(now.getTime() + RESOURCE_TTL.VERIFICATION_MS),
    };
    
    // Classify
    const classified = { ...candidate, classification };
    
    // Enrich
    const enriched = await this.enrichByProvider(classified);
    if (!enriched) {
      return err(createResourceError('ENRICHMENT_FAILED', 'Failed to enrich resource'));
    }
    
    // Verify
    const verified = await this.verifyResource(enriched);
    if (!verified.ok) {
      return verified;
    }
    
    // Cache
    await cache.setVerified(canonResult.canonical, verified.value);
    
    return verified;
  }
  
  /**
   * Check if a URL is from a known source.
   */
  isKnownSource(url: string): boolean {
    const registry = getKnownSourcesRegistry();
    return registry.isKnownSource(url);
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Build a sensible search query from a discovery request.
   * 
   * Priority:
   * 1. Use keywords if provided (should contain the main goal like "coding", "python")
   * 2. Extract main topic from topic IDs (limit to 3-4)
   * 3. Append the suffix (e.g., "tutorial", "guide")
   * 
   * This prevents the garbage queries that happen when all granular topics
   * are concatenated into one string.
   */
  private buildSearchQuery(request: DiscoveryRequest, suffix: string): string {
    const parts: string[] = [];
    
    // Priority 1: Use keywords if provided (these should be the main goal)
    if (request.keywords && request.keywords.length > 0) {
      // Keywords are likely the main topic - use them directly
      parts.push(...request.keywords.slice(0, 3));
    }
    
    // Priority 2: Extract main topics from topic IDs (if no keywords or need more context)
    if (parts.length === 0 || parts.length < 2) {
      const topicTerms: string[] = [];
      
      for (const t of request.topics) {
        const topicStr = typeof t === 'string' ? t : (t as any).id ?? String(t);
        
        // Extract human-readable name from topic ID
        // e.g., "topic:python" -> "python"
        // e.g., "language:rust:ownership" -> "rust"
        const cleaned = topicStr
          .replace(/^topic:/i, '')
          .replace(/^language:/i, '')
          .split(':')[0]
          .replace(/-/g, ' ')
          .trim();
        
        if (cleaned && cleaned.length > 2 && !topicTerms.includes(cleaned)) {
          topicTerms.push(cleaned);
        }
        
        // Limit to prevent query bloat
        if (topicTerms.length >= 4) break;
      }
      
      // Only add topics that aren't already covered by keywords
      for (const term of topicTerms) {
        if (!parts.some(p => p.toLowerCase().includes(term.toLowerCase()))) {
          parts.push(term);
        }
        if (parts.length >= 4) break;
      }
    }
    
    // Fallback if still empty
    if (parts.length === 0) {
      parts.push('programming');
    }
    
    // Build final query
    const mainQuery = parts.join(' ');
    return `${mainQuery} ${suffix}`.trim();
  }

  /**
   * Batch items for concurrent processing.
   */
  private batch<T>(items: T[], size: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      batches.push(items.slice(i, i + size));
    }
    return batches;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let orchestratorInstance: ResourceDiscoveryOrchestrator | null = null;

/**
 * Get the resource discovery orchestrator singleton.
 */
export function getResourceDiscoveryOrchestrator(): ResourceDiscoveryOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new ResourceDiscoveryOrchestrator();
  }
  return orchestratorInstance;
}

/**
 * Initialize the orchestrator with config.
 */
export function initResourceDiscoveryOrchestrator(
  config?: Partial<OrchestratorConfig>
): ResourceDiscoveryOrchestrator {
  orchestratorInstance = new ResourceDiscoveryOrchestrator(config);
  return orchestratorInstance;
}

/**
 * Reset the orchestrator (for testing).
 */
export function resetResourceDiscoveryOrchestrator(): void {
  orchestratorInstance = null;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONVENIENCE FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Discover resources for topics.
 */
export async function discoverResources(
  request: DiscoveryRequest
): Promise<Result<DiscoveryResult, OrchestratorError>> {
  return getResourceDiscoveryOrchestrator().discover(request);
}

/**
 * Process a single URL.
 */
export async function processResourceUrl(
  url: string
): Promise<Result<VerifiedResource, ResourceError>> {
  return getResourceDiscoveryOrchestrator().processUrl(url);
}
