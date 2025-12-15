// ═══════════════════════════════════════════════════════════════════════════════
// VERIFICATION EXECUTOR — Fact Verification with Caching
// ═══════════════════════════════════════════════════════════════════════════════

import { 
  HardenedFetchClient, 
  getFetchClient,
  type FetchResult 
} from './fetch-client.js';
import { 
  loadVerificationConfig, 
  canVerify, 
  type VerificationConfig 
} from '../../config/index.js';
import { getStore, type KeyValueStore } from '../../storage/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export type VerificationStatus = 
  | 'verified'        // Confirmed by trusted source
  | 'likely_true'     // Found supporting evidence
  | 'uncertain'       // Couldn't verify
  | 'likely_false'    // Found contradicting evidence
  | 'unverifiable'    // Claim cannot be verified via web
  | 'error';          // Verification failed

export interface VerificationSource {
  url: string;
  domain: string;
  title?: string;
  snippet?: string;
  trustLevel: 'high' | 'medium' | 'low';
  fetchedAt: number;
}

export interface VerificationResult {
  claim: string;
  claimHash: string;
  status: VerificationStatus;
  confidence: number;      // 0-1
  sources: VerificationSource[];
  explanation?: string;
  cached: boolean;
  timing: {
    totalMs: number;
    fetchMs?: number;
    parseMs?: number;
  };
  metadata: {
    sourcesChecked: number;
    sourcesFailed: number;
    truncatedResponses: number;
  };
}

export interface VerificationRequest {
  claim: string;
  context?: string;
  preferredSources?: string[];
  maxSources?: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// VERIFICATION CACHE
// ─────────────────────────────────────────────────────────────────────────────────

class VerificationCache {
  private store: KeyValueStore;
  private config: VerificationConfig;
  
  constructor(store: KeyValueStore, config: VerificationConfig) {
    this.store = store;
    this.config = config;
  }
  
  private getCacheKey(claimHash: string): string {
    return `verify:${claimHash}`;
  }
  
  async get(claimHash: string): Promise<VerificationResult | null> {
    try {
      const data = await this.store.get(this.getCacheKey(claimHash));
      if (!data) return null;
      
      const cached = JSON.parse(data) as VerificationResult;
      cached.cached = true;
      return cached;
    } catch {
      return null;
    }
  }
  
  async set(result: VerificationResult): Promise<void> {
    try {
      await this.store.set(
        this.getCacheKey(result.claimHash),
        JSON.stringify(result),
        this.config.cacheTTLSeconds
      );
    } catch {
      // Cache failures are non-critical
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// VERIFICATION EXECUTOR
// ─────────────────────────────────────────────────────────────────────────────────

export class VerificationExecutor {
  private fetchClient: HardenedFetchClient;
  private cache: VerificationCache;
  private config: VerificationConfig;
  
  constructor(
    fetchClient?: HardenedFetchClient,
    store?: KeyValueStore,
    config?: VerificationConfig
  ) {
    this.fetchClient = fetchClient ?? getFetchClient();
    this.config = config ?? loadVerificationConfig();
    this.cache = new VerificationCache(store ?? getStore(), this.config);
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // MAIN VERIFICATION METHOD
  // ─────────────────────────────────────────────────────────────────────────────
  
  async verify(request: VerificationRequest): Promise<VerificationResult> {
    const startTime = Date.now();
    const claimHash = this.hashClaim(request.claim);
    
    // Check if verification is enabled
    if (!canVerify()) {
      return this.createResult(request.claim, claimHash, 'unverifiable', 0, [], {
        explanation: 'Verification is disabled',
        startTime,
      });
    }
    
    // Check cache first
    const cached = await this.cache.get(claimHash);
    if (cached) {
      return cached;
    }
    
    // Build verification sources
    const sources = this.buildVerificationSources(request);
    const maxSources = Math.min(
      request.maxSources ?? this.config.maxVerificationsPerRequest,
      this.config.maxVerificationsPerRequest
    );
    
    // Fetch and analyze sources
    const fetchResults: { source: string; result: FetchResult }[] = [];
    let fetchMs = 0;
    let sourcesFailed = 0;
    let truncatedResponses = 0;
    
    // Fetch concurrently with limit
    const fetchPromises = sources.slice(0, maxSources).map(async (source) => {
      const fetchStart = Date.now();
      const result = await this.fetchClient.fetch(source);
      fetchMs += Date.now() - fetchStart;
      
      if (!result.success) {
        sourcesFailed++;
      }
      if (result.truncated) {
        truncatedResponses++;
      }
      
      return { source, result };
    });
    
    const results = await Promise.all(fetchPromises);
    fetchResults.push(...results);
    
    // Analyze results
    const parseStart = Date.now();
    const analysis = this.analyzeResults(request.claim, fetchResults);
    const parseMs = Date.now() - parseStart;
    
    const result = this.createResult(
      request.claim,
      claimHash,
      analysis.status,
      analysis.confidence,
      analysis.sources,
      {
        explanation: analysis.explanation,
        startTime,
        fetchMs,
        parseMs,
        sourcesChecked: fetchResults.length,
        sourcesFailed,
        truncatedResponses,
      }
    );
    
    // Cache the result
    await this.cache.set(result);
    
    return result;
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // QUICK VERIFICATION (for Lens gate)
  // ─────────────────────────────────────────────────────────────────────────────
  
  async quickVerify(claim: string): Promise<{
    verified: boolean;
    confidence: number;
    source?: string;
  }> {
    const result = await this.verify({ claim, maxSources: 1 });
    
    return {
      verified: result.status === 'verified' || result.status === 'likely_true',
      confidence: result.confidence,
      source: result.sources[0]?.url,
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // SOURCE BUILDING
  // ─────────────────────────────────────────────────────────────────────────────
  
  private buildVerificationSources(request: VerificationRequest): string[] {
    const sources: string[] = [];
    
    // Add preferred sources first
    if (request.preferredSources?.length) {
      sources.push(...request.preferredSources);
    }
    
    // For demo purposes, we'd normally integrate with a search API
    // For now, we use trusted domains + claim-based URL construction
    const searchTerms = this.extractSearchTerms(request.claim);
    
    // Add Wikipedia search
    if (searchTerms) {
      sources.push(`https://en.wikipedia.org/wiki/${encodeURIComponent(searchTerms)}`);
    }
    
    return sources;
  }
  
  private extractSearchTerms(claim: string): string {
    // Extract key terms from claim for searching
    // This is simplified - a real implementation would use NLP
    return claim
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 3)
      .slice(0, 3)
      .join('_');
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // RESULT ANALYSIS
  // ─────────────────────────────────────────────────────────────────────────────
  
  private analyzeResults(
    claim: string,
    fetchResults: { source: string; result: FetchResult }[]
  ): {
    status: VerificationStatus;
    confidence: number;
    sources: VerificationSource[];
    explanation: string;
  } {
    const sources: VerificationSource[] = [];
    let supportingEvidence = 0;
    let contradictingEvidence = 0;
    let totalEvidence = 0;
    
    for (const { source, result } of fetchResults) {
      if (!result.success || !result.content) {
        continue;
      }
      
      const domain = this.extractDomain(result.finalUrl);
      const trustLevel = this.getTrustLevel(domain);
      const snippet = this.extractRelevantSnippet(result.content, claim);
      
      if (snippet) {
        totalEvidence++;
        
        // Simple heuristic: check if content supports or contradicts
        const support = this.assessSupport(claim, result.content);
        if (support > 0) supportingEvidence++;
        if (support < 0) contradictingEvidence++;
        
        sources.push({
          url: result.finalUrl,
          domain,
          snippet,
          trustLevel,
          fetchedAt: Date.now(),
        });
      }
    }
    
    // Determine status and confidence
    let status: VerificationStatus;
    let confidence: number;
    let explanation: string;
    
    if (totalEvidence === 0) {
      status = 'uncertain';
      confidence = 0;
      explanation = 'No relevant evidence found';
    } else if (supportingEvidence > 0 && contradictingEvidence === 0) {
      const hasTrusted = sources.some(s => s.trustLevel === 'high');
      status = hasTrusted ? 'verified' : 'likely_true';
      confidence = Math.min(0.9, 0.5 + (supportingEvidence * 0.2));
      explanation = `Found ${supportingEvidence} supporting source(s)`;
    } else if (contradictingEvidence > supportingEvidence) {
      status = 'likely_false';
      confidence = Math.min(0.9, 0.5 + (contradictingEvidence * 0.2));
      explanation = `Found contradicting evidence (${contradictingEvidence} sources)`;
    } else {
      status = 'uncertain';
      confidence = 0.3;
      explanation = 'Mixed or inconclusive evidence';
    }
    
    return { status, confidence, sources, explanation };
  }
  
  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return 'unknown';
    }
  }
  
  private getTrustLevel(domain: string): 'high' | 'medium' | 'low' {
    const trusted = this.config.trustedDomains;
    
    // Check if domain is in trusted list
    for (const td of trusted) {
      if (domain === td || domain.endsWith('.' + td)) {
        return 'high';
      }
    }
    
    // Known reliable but not top-tier
    const mediumTrust = ['bbc.com', 'nytimes.com', 'theguardian.com'];
    for (const mt of mediumTrust) {
      if (domain === mt || domain.endsWith('.' + mt)) {
        return 'medium';
      }
    }
    
    return 'low';
  }
  
  private extractRelevantSnippet(content: string, claim: string): string | undefined {
    // Extract keywords from claim
    const keywords = claim
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3);
    
    if (keywords.length === 0) return undefined;
    
    // Find paragraph containing most keywords
    const paragraphs = content.split(/\n\n|\r\n\r\n/);
    let bestParagraph = '';
    let bestScore = 0;
    
    for (const para of paragraphs) {
      const lower = para.toLowerCase();
      let score = 0;
      for (const kw of keywords) {
        if (lower.includes(kw)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestParagraph = para;
      }
    }
    
    if (bestScore === 0 || !bestParagraph) return undefined;
    
    // Truncate to reasonable length
    return bestParagraph.slice(0, 300) + (bestParagraph.length > 300 ? '...' : '');
  }
  
  private assessSupport(claim: string, content: string): number {
    // Very simplified sentiment/support analysis
    // Real implementation would use NLP/embeddings
    const claimWords = claim.toLowerCase().split(/\s+/);
    const contentLower = content.toLowerCase();
    
    let matches = 0;
    for (const word of claimWords) {
      if (word.length > 3 && contentLower.includes(word)) {
        matches++;
      }
    }
    
    // If we found significant overlap, assume support
    const overlap = matches / claimWords.length;
    if (overlap > 0.5) return 1;
    if (overlap > 0.2) return 0;
    return 0; // Not enough to determine
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────────────
  
  private hashClaim(claim: string): string {
    // Simple hash for caching
    let hash = 0;
    const normalized = claim.toLowerCase().trim();
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return 'c' + Math.abs(hash).toString(36);
  }
  
  private createResult(
    claim: string,
    claimHash: string,
    status: VerificationStatus,
    confidence: number,
    sources: VerificationSource[],
    options: {
      explanation?: string;
      startTime: number;
      fetchMs?: number;
      parseMs?: number;
      sourcesChecked?: number;
      sourcesFailed?: number;
      truncatedResponses?: number;
    }
  ): VerificationResult {
    return {
      claim,
      claimHash,
      status,
      confidence,
      sources,
      explanation: options.explanation,
      cached: false,
      timing: {
        totalMs: Date.now() - options.startTime,
        fetchMs: options.fetchMs,
        parseMs: options.parseMs,
      },
      metadata: {
        sourcesChecked: options.sourcesChecked ?? 0,
        sourcesFailed: options.sourcesFailed ?? 0,
        truncatedResponses: options.truncatedResponses ?? 0,
      },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let verificationExecutor: VerificationExecutor | null = null;

export function getVerificationExecutor(): VerificationExecutor {
  if (!verificationExecutor) {
    verificationExecutor = new VerificationExecutor();
  }
  return verificationExecutor;
}
