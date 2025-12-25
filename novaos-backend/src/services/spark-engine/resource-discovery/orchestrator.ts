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
import { getTopicRegistry, type TopicMatchResult } from './taxonomy/index.js';
import { getKnownSourcesRegistry, type KnownSourceMatch } from './known-sources/index.js';
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
    { type: 'web_search', enabled: false, priority: 5, maxResults: 5 },
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
        const sourceCandidates = await this.findFromSource(source, request);
        candidates.push(...sourceCandidates);
        
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
      
      case 'web_search':
        // Web search disabled by default (last resort)
        return [];
      
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
   */
  private async findFromYouTubeApi(
    request: DiscoveryRequest,
    _maxResults: number
  ): Promise<RawResourceCandidate[]> {
    // Check if we have API keys available
    const keyManager = getApiKeyManager();
    if (!keyManager.hasAvailableQuota('youtube')) {
      logger.debug('YouTube API quota unavailable');
      return [];
    }
    
    // YouTube API search would go here
    // For now, return empty (would be implemented with actual API calls)
    return [];
  }
  
  /**
   * Find resources from GitHub API.
   */
  private async findFromGitHubApi(
    request: DiscoveryRequest,
    _maxResults: number
  ): Promise<RawResourceCandidate[]> {
    // Check if we have API keys available
    const keyManager = getApiKeyManager();
    if (!keyManager.hasAvailableQuota('github')) {
      logger.debug('GitHub API quota unavailable');
      return [];
    }
    
    // GitHub API search would go here
    return [];
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
    const provider = providerResult?.provider ?? 'unknown';
    
    // Extract provider-specific ID
    let providerId: unknown = null;
    switch (provider) {
      case 'youtube':
        providerId = extractYouTubeId(url);
        break;
      case 'github':
        providerId = extractGitHubId(url);
        break;
    }
    
    // Match topics (would use text from title/description)
    const topicRegistry = getTopicRegistry();
    const matcher = topicRegistry.getMatcher();
    const topics = matcher.match(url); // Simple URL-based matching
    
    // Check known sources
    const knownSourceRegistry = getKnownSourcesRegistry();
    const knownSource = knownSourceRegistry.matchUrl(url);
    
    // Calculate confidence
    let confidence = 0.5;
    if (knownSource) {
      confidence = knownSource.confidence;
    } else if (providerResult) {
      confidence = providerResult.confidence === 'high' ? 0.9 :
                   providerResult.confidence === 'medium' ? 0.7 : 0.5;
    }
    
    return {
      url: canonical,
      provider,
      providerId,
      topics,
      knownSource,
      confidence,
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Stage 4: Enrich
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Enrich candidates with API metadata.
   */
  private async enrichCandidates(
    candidates: Array<RawResourceCandidate & { classification: ClassificationResult }>,
    stats: { cacheHits: number; byProvider: Record<string, number>; [key: string]: unknown }
  ): Promise<EnrichedResource[]> {
    if (!this.config.enableEnrichment) {
      // Skip enrichment, create minimal EnrichedResource
      return candidates.map(c => this.createMinimalEnrichedResource(c));
    }
    
    const cache = getResourceCache();
    const results: EnrichedResource[] = [];
    
    // Process in batches for concurrency control
    const batches = this.batch(candidates, this.config.maxConcurrency);
    
    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map(async (candidate) => {
          // Check cache first
          const cached = await cache.getEnriched(candidate.classification.url);
          if (cached.ok) {
            stats.cacheHits = (stats.cacheHits ?? 0) + 1;
            return cached.value.data;
          }
          
          // Enrich based on provider
          const enriched = await this.enrichByProvider(candidate);
          
          // Cache the result
          if (enriched) {
            await cache.setEnriched(candidate.classification.url, enriched);
            
            // Track by provider
            const provider = candidate.classification.provider;
            stats.byProvider = stats.byProvider ?? {};
            stats.byProvider[provider] = (stats.byProvider[provider] ?? 0) + 1;
          }
          
          return enriched;
        })
      );
      
      results.push(...batchResults.filter((r): r is EnrichedResource => r !== null));
    }
    
    return results;
  }
  
  /**
   * Enrich a candidate based on its provider.
   */
  private async enrichByProvider(
    candidate: RawResourceCandidate & { classification: ClassificationResult }
  ): Promise<EnrichedResource | null> {
    // For now, create minimal enriched resource
    // Full API enrichment would go here
    return this.createMinimalEnrichedResource(candidate);
  }
  
  /**
   * Create a minimal enriched resource without API calls.
   */
  private createMinimalEnrichedResource(
    candidate: RawResourceCandidate & { classification: ClassificationResult }
  ): EnrichedResource {
    const now = new Date();
    
    return {
      id: createResourceId(`${candidate.classification.provider}:${candidate.canonicalUrl}`),
      canonicalUrl: candidate.canonicalUrl,
      displayUrl: candidate.displayUrl,
      provider: candidate.classification.provider,
      providerId: candidate.classification.providerId as string | undefined,
      source: candidate.source,
      candidateCreatedAt: candidate.createdAt,
      enrichedAt: now,
      enrichmentExpiresAt: new Date(now.getTime() + RESOURCE_TTL.ENRICHMENT_MS),
      title: candidate.title ?? 'Unknown',
      description: candidate.snippet ?? '',
      contentType: 'article',
      format: 'text',
      difficulty: 'intermediate',
      metadata: { 
        provider: 'unknown' as const,
        title: candidate.title ?? 'Unknown',
      },
      topicIds: candidate.topicIds,
      qualitySignals: this.computeQualitySignals(candidate),
    };
  }
  
  /**
   * Compute quality signals for a candidate.
   */
  private computeQualitySignals(
    candidate: RawResourceCandidate & { classification: ClassificationResult }
  ): QualitySignals {
    let authority = 0.5;
    
    // Boost for known sources
    if (candidate.classification.knownSource) {
      const authorityLevel = candidate.classification.knownSource.source.authority;
      authority = authorityLevel === 'official' ? 1.0 :
                  authorityLevel === 'authoritative' ? 0.9 :
                  authorityLevel === 'community' ? 0.7 : 0.6;
    }
    
    const popularity = 0.5;
    const recency = 0.5;
    const completeness = 0.5;
    
    return {
      popularity,
      recency,
      authority,
      completeness,
      composite: (popularity + recency + authority + completeness) / 4,
      details: {
        ageInDays: 0,
      },
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
  ): Promise<{
    verified: VerifiedResource[];
    failed: Array<{ url: string; error: ResourceError }>;
  }> {
    if (!this.config.enableVerification) {
      // Skip verification, assume all accessible
      return {
        verified: enriched.map(e => this.createUnverifiedResource(e)),
        failed: [],
      };
    }
    
    const cache = getResourceCache();
    const verified: VerifiedResource[] = [];
    const failed: Array<{ url: string; error: ResourceError }> = [];
    
    // Process in batches
    const batches = this.batch(enriched, this.config.maxConcurrency);
    
    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map(async (resource) => {
          // Check cache first
          const cached = await cache.getVerified(resource.canonicalUrl);
          if (cached.ok) {
            stats.cacheHits = (stats.cacheHits ?? 0) + 1;
            return { verified: cached.value.data, failed: null };
          }
          
          // Verify accessibility
          const result = await this.verifyResource(resource);
          
          if (result.ok) {
            await cache.setVerified(resource.canonicalUrl, result.value);
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
