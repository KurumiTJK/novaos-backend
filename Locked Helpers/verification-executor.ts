// ═══════════════════════════════════════════════════════════════════════════════
// VERIFICATION EXECUTOR — Fix D-1
// Actually executes verification against sources
// Replaces the performative "verified: true" with real verification
// ═══════════════════════════════════════════════════════════════════════════════

import { createHash } from 'crypto';
import {
  VerificationPlan,
  ConfidenceLevel,
  Citation,
  VerificationTrigger,
} from './types';
import { detectDomain, checkFreshness, isImmediateDomain } from './freshness-checker';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface ExtractedClaim {
  id: string;
  text: string;
  type: 'factual' | 'temporal' | 'numeric' | 'attribution';
  confidence: number;
  domain: string;
  requiresVerification: boolean;
}

export interface VerificationSource {
  url: string;
  title: string;
  domain: string;
  fetchedAt: Date;
  content: string;
  trustScore: number; // 0-1, based on source authority
}

export interface ClaimVerificationResult {
  claimId: string;
  verified: boolean;
  confidence: number;
  sources: Citation[];
  conflict: boolean;
  conflictDetails?: string;
}

export interface VerificationResult {
  status: 'complete' | 'partial' | 'failed' | 'skipped';
  allClaimsVerified: boolean;
  verifiedCount: number;
  totalClaims: number;
  citations: Citation[];
  derivedConfidence: ConfidenceLevel;
  freshnessWarning?: string;
  claimResults: ClaimVerificationResult[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// CLAIM EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Extract verifiable claims from a message.
 */
export function extractClaims(message: string): ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];
  let claimIndex = 0;

  // Split into sentences
  const sentences = message.split(/[.!?]+/).filter(s => s.trim().length > 0);

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    
    // Skip questions
    if (trimmed.endsWith('?') || /^(what|who|when|where|why|how|is|are|do|does|can|should)\s/i.test(trimmed)) {
      continue;
    }

    // Check for factual claim patterns
    const claimPatterns = [
      // Numeric claims
      { pattern: /\b(\d+(?:\.\d+)?%|\$[\d,]+(?:\.\d{2})?|\d+(?:,\d{3})+)\b/i, type: 'numeric' as const },
      // Temporal claims
      { pattern: /\b(latest|current|now|today|recent|as of|since|after|before)\b/i, type: 'temporal' as const },
      // Attribution claims
      { pattern: /\b(according to|said|reported|announced|stated|claims?)\b/i, type: 'attribution' as const },
      // Factual assertions
      { pattern: /\b(is|are|was|were|has|have|had)\s+(the|a|an)?\s*\w+/i, type: 'factual' as const },
    ];

    for (const { pattern, type } of claimPatterns) {
      if (pattern.test(trimmed)) {
        const domain = detectDomain(trimmed);
        
        claims.push({
          id: `claim_${claimIndex++}`,
          text: trimmed,
          type,
          confidence: 0, // Will be set after verification
          domain,
          requiresVerification: type !== 'factual' || isImmediateDomain(domain),
        });
        break; // One claim type per sentence
      }
    }
  }

  return claims;
}

// ─────────────────────────────────────────────────────────────────────────────────
// URL VALIDATION — Prevent SSRF attacks
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Private/internal IP ranges that must be blocked.
 */
const BLOCKED_IP_PATTERNS = [
  /^127\./,                          // Localhost
  /^10\./,                           // Private Class A
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // Private Class B
  /^192\.168\./,                     // Private Class C
  /^169\.254\./,                     // Link-local
  /^0\./,                            // Current network
  /^100\.(6[4-9]|[7-9][0-9]|1[0-2][0-9])\./,  // Carrier-grade NAT
  /^::1$/,                           // IPv6 localhost
  /^fe80:/i,                         // IPv6 link-local
  /^fc00:/i,                         // IPv6 unique local
  /^fd00:/i,                         // IPv6 unique local
];

/**
 * Blocked hostnames.
 */
const BLOCKED_HOSTNAMES = [
  'localhost',
  'metadata.google.internal',
  'metadata.google',
  '169.254.169.254',  // AWS/GCP metadata
  'metadata',
];

/**
 * Validate a URL for SSRF safety.
 * @param url - URL to validate
 * @returns Object with valid flag and reason if invalid
 */
export function validateUrlForFetch(url: string): { valid: boolean; reason?: string } {
  let parsed: URL;
  
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }
  
  // Must be HTTPS (or HTTP for localhost in dev, but we block localhost anyway)
  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: 'Only HTTPS URLs allowed' };
  }
  
  // Check blocked hostnames
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    return { valid: false, reason: 'Blocked hostname' };
  }
  
  // Check if hostname is an IP address
  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    // Check against blocked IP patterns
    for (const pattern of BLOCKED_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        return { valid: false, reason: 'Private/internal IP blocked' };
      }
    }
  }
  
  // Check for IPv6 addresses
  if (hostname.startsWith('[') || hostname.includes(':')) {
    for (const pattern of BLOCKED_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        return { valid: false, reason: 'Private/internal IPv6 blocked' };
      }
    }
  }
  
  // Block numeric TLDs (often used for IP-based bypasses)
  const parts = hostname.split('.');
  const tld = parts[parts.length - 1];
  if (/^\d+$/.test(tld)) {
    return { valid: false, reason: 'Numeric TLD blocked' };
  }
  
  // Block localhost variants
  if (hostname === 'localhost' || 
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local')) {
    return { valid: false, reason: 'Localhost blocked' };
  }
  
  return { valid: true };
}

// ─────────────────────────────────────────────────────────────────────────────────
// SOURCE FETCHING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Web fetcher interface — implement with actual HTTP client.
 */
export interface WebFetcher {
  search(query: string, options?: { limit?: number }): Promise<SearchResult[]>;
  fetch(url: string): Promise<FetchResult>;
}

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  domain: string;
}

export interface FetchResult {
  url: string;
  content: string;
  title: string;
  fetchedAt: Date;
  success: boolean;
  error?: string;
}

/**
 * Source trust scores based on domain authority.
 */
const SOURCE_TRUST_SCORES: Record<string, number> = {
  // Government
  '.gov': 0.95,
  '.mil': 0.95,
  
  // Academic
  '.edu': 0.90,
  'nature.com': 0.92,
  'science.org': 0.92,
  'pubmed.ncbi': 0.90,
  
  // News (major)
  'reuters.com': 0.88,
  'apnews.com': 0.88,
  'bbc.com': 0.85,
  'nytimes.com': 0.82,
  'wsj.com': 0.82,
  'washingtonpost.com': 0.80,
  
  // Financial
  'sec.gov': 0.95,
  'bloomberg.com': 0.85,
  'finance.yahoo.com': 0.75,
  
  // Medical
  'cdc.gov': 0.95,
  'nih.gov': 0.95,
  'who.int': 0.93,
  'mayoclinic.org': 0.88,
  'webmd.com': 0.70,
  
  // Wikipedia (depends on citations)
  'wikipedia.org': 0.65,
  
  // Default
  'default': 0.50,
};

/**
 * Get trust score for a URL.
 */
function getTrustScore(url: string): number {
  const urlLower = url.toLowerCase();
  
  for (const [domain, score] of Object.entries(SOURCE_TRUST_SCORES)) {
    if (urlLower.includes(domain)) {
      return score;
    }
  }
  
  return SOURCE_TRUST_SCORES.default;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CLAIM VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Verify a single claim against sources.
 */
async function verifyClaim(
  claim: ExtractedClaim,
  sources: VerificationSource[]
): Promise<ClaimVerificationResult> {
  const matchingSources: VerificationSource[] = [];
  const conflictingSources: VerificationSource[] = [];

  // Simple keyword matching (production would use semantic similarity)
  const claimKeywords = extractKeywords(claim.text);

  for (const source of sources) {
    const sourceKeywords = extractKeywords(source.content);
    const overlap = claimKeywords.filter(k => sourceKeywords.includes(k));
    
    if (overlap.length >= 2) {
      // Check for contradiction indicators
      const hasContradiction = checkContradiction(claim.text, source.content);
      
      if (hasContradiction) {
        conflictingSources.push(source);
      } else {
        matchingSources.push(source);
      }
    }
  }

  // Build citations from matching sources
  const citations: Citation[] = matchingSources.slice(0, 3).map(source => ({
    url: source.url,
    title: source.title,
    domain: source.domain,
    accessedAt: source.fetchedAt,
    relevanceScore: source.trustScore,
  }));

  // Calculate verification confidence
  let confidence = 0;
  if (matchingSources.length > 0) {
    const avgTrust = matchingSources.reduce((sum, s) => sum + s.trustScore, 0) / matchingSources.length;
    const sourceBonus = Math.min(matchingSources.length * 0.1, 0.3);
    confidence = Math.min(avgTrust + sourceBonus, 1.0);
  }

  // Adjust for conflicts
  const hasConflict = conflictingSources.length > 0;
  if (hasConflict) {
    confidence *= 0.5; // Halve confidence if conflicting sources exist
  }

  return {
    claimId: claim.id,
    verified: matchingSources.length >= 1 && confidence >= 0.6,
    confidence,
    sources: citations,
    conflict: hasConflict,
    conflictDetails: hasConflict
      ? `${conflictingSources.length} source(s) contain potentially conflicting information`
      : undefined,
  };
}

/**
 * Extract keywords from text for matching.
 */
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
    'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'and', 'or', 'but', 'if', 'because', 'until', 'while', 'although',
    'this', 'that', 'these', 'those', 'it', 'its',
  ]);

  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));
}

/**
 * Check if source content contradicts a claim.
 * Simple heuristic — production would use NLI model.
 */
function checkContradiction(claim: string, sourceContent: string): boolean {
  const contradictionPatterns = [
    // Negation near claim keywords
    /\b(not|never|no|none|neither|nor|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|won't|wouldn't|couldn't|shouldn't)\b/i,
    // Explicit contradiction phrases
    /\b(contrary to|false|incorrect|inaccurate|misleading|debunked|myth|wrong)\b/i,
  ];

  const claimKeywords = extractKeywords(claim);
  
  // Check if contradictions appear near claim keywords in source
  for (const keyword of claimKeywords) {
    const keywordIndex = sourceContent.toLowerCase().indexOf(keyword);
    if (keywordIndex !== -1) {
      // Get context around keyword (100 chars before and after)
      const contextStart = Math.max(0, keywordIndex - 100);
      const contextEnd = Math.min(sourceContent.length, keywordIndex + keyword.length + 100);
      const context = sourceContent.slice(contextStart, contextEnd);
      
      for (const pattern of contradictionPatterns) {
        if (pattern.test(context)) {
          return true;
        }
      }
    }
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────────
// VERIFICATION EXECUTOR
// ─────────────────────────────────────────────────────────────────────────────────

export interface VerificationExecutorOptions {
  webFetcher: WebFetcher;
  maxSources: number;
  timeoutMs: number;
}

/**
 * Execute verification for a message.
 * This is the main entry point that actually does verification.
 */
export async function executeVerification(
  message: string,
  triggers: VerificationTrigger[],
  options: VerificationExecutorOptions
): Promise<VerificationResult> {
  const { webFetcher, maxSources, timeoutMs } = options;
  
  // If no triggers, skip verification
  if (triggers.length === 0) {
    return {
      status: 'skipped',
      allClaimsVerified: false,
      verifiedCount: 0,
      totalClaims: 0,
      citations: [],
      derivedConfidence: 'medium',
      claimResults: [],
    };
  }

  try {
    // Step 1: Extract claims
    const claims = extractClaims(message);
    const verifiableClaims = claims.filter(c => c.requiresVerification);

    if (verifiableClaims.length === 0) {
      return {
        status: 'complete',
        allClaimsVerified: true,
        verifiedCount: 0,
        totalClaims: 0,
        citations: [],
        derivedConfidence: 'medium',
        claimResults: [],
      };
    }

    // Step 2: Search for sources
    const searchQueries = buildSearchQueries(verifiableClaims);
    const allSources: VerificationSource[] = [];

    for (const query of searchQueries.slice(0, 3)) {
      try {
        const results = await webFetcher.search(query, { limit: maxSources });
        
        for (const result of results.slice(0, 3)) {
          try {
            // SSRF protection: Validate URL before fetching
            const urlValidation = validateUrlForFetch(result.url);
            if (!urlValidation.valid) {
              console.warn(`[Verification] Blocked URL: ${result.url} - ${urlValidation.reason}`);
              continue;
            }
            
            const fetched = await webFetcher.fetch(result.url);
            if (fetched.success) {
              allSources.push({
                url: fetched.url,
                title: fetched.title,
                domain: result.domain,
                fetchedAt: fetched.fetchedAt,
                content: fetched.content.slice(0, 5000), // Limit content size
                trustScore: getTrustScore(result.url),
              });
            }
          } catch {
            // Skip failed fetches
          }
        }
      } catch {
        // Skip failed searches
      }
    }

    // Step 3: Verify each claim
    const claimResults: ClaimVerificationResult[] = [];
    for (const claim of verifiableClaims) {
      const result = await verifyClaim(claim, allSources);
      claimResults.push(result);
    }

    // Step 4: Aggregate results
    const verifiedCount = claimResults.filter(r => r.verified).length;
    const allVerified = verifiedCount === verifiableClaims.length;
    const hasConflicts = claimResults.some(r => r.conflict);

    // Collect all citations
    const allCitations: Citation[] = [];
    for (const result of claimResults) {
      for (const citation of result.sources) {
        if (!allCitations.find(c => c.url === citation.url)) {
          allCitations.push(citation);
        }
      }
    }

    // Derive confidence
    let derivedConfidence: ConfidenceLevel;
    if (allVerified && !hasConflicts) {
      derivedConfidence = 'high';
    } else if (verifiedCount > 0 || hasConflicts) {
      derivedConfidence = 'medium';
    } else {
      derivedConfidence = 'low';
    }

    // Check freshness for any immediate domains
    let freshnessWarning: string | undefined;
    for (const claim of verifiableClaims) {
      if (isImmediateDomain(claim.domain)) {
        const freshness = checkFreshness(claim.domain, allSources[0]?.fetchedAt ?? null);
        if (freshness.isStale) {
          freshnessWarning = `${freshness.window.description} may be stale (${freshness.staleBy} old)`;
          derivedConfidence = 'low';
          break;
        }
      }
    }

    return {
      status: allSources.length > 0 ? 'complete' : 'partial',
      allClaimsVerified: allVerified,
      verifiedCount,
      totalClaims: verifiableClaims.length,
      citations: allCitations,
      derivedConfidence,
      freshnessWarning,
      claimResults,
    };

  } catch (error) {
    console.error('[VerificationExecutor] Verification failed:', error);
    return {
      status: 'failed',
      allClaimsVerified: false,
      verifiedCount: 0,
      totalClaims: 0,
      citations: [],
      derivedConfidence: 'low',
      freshnessWarning: 'Verification failed — treat information with caution',
      claimResults: [],
    };
  }
}

/**
 * Build search queries from claims.
 */
function buildSearchQueries(claims: ExtractedClaim[]): string[] {
  const queries: string[] = [];

  for (const claim of claims) {
    // Extract key terms for search
    const keywords = extractKeywords(claim.text);
    if (keywords.length >= 2) {
      // Take most significant keywords
      const query = keywords.slice(0, 5).join(' ');
      if (!queries.includes(query)) {
        queries.push(query);
      }
    }
  }

  return queries;
}

// ─────────────────────────────────────────────────────────────────────────────────
// LENS GATE INTEGRATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Updated LensGate execution that actually verifies.
 * This shows how to integrate the verification executor.
 */
export async function executeLensGateWithVerification(
  state: any,
  context: any,
  webFetcher: WebFetcher | null
): Promise<{
  plan: VerificationPlan;
  result: VerificationResult | null;
}> {
  // Step 1: Check if verification required
  const triggers = detectVerificationTriggers(state.input.message);
  const domain = detectDomain(state.input.message);
  const stakesLevel = state.risk?.stakesLevel ?? 'low';

  // Step 2: Determine if we CAN verify
  const canVerify = webFetcher !== null;

  // Step 3: If required but can't verify, handle based on stakes
  if (triggers.length > 0 && !canVerify) {
    if (stakesLevel === 'high' || stakesLevel === 'critical') {
      // High stakes: STOP with options
      return {
        plan: {
          required: true,
          mode: 'stopped',
          plan: {
            triggers,
            domain,
            verificationStatus: 'unavailable',
            verified: false,
            confidence: 'low',
            citations: [],
          },
          userOptions: [
            { id: 'enable_web', label: 'Enable web access to verify' },
            { id: 'provide_source', label: 'Provide a source URL' },
            { id: 'proceed_unverified', label: 'Proceed without verification', requiresAck: true },
            { id: 'stop', label: 'Cancel this request' },
          ],
        },
        result: null,
      };
    } else {
      // Low/medium stakes: DEGRADE
      return {
        plan: {
          required: true,
          mode: 'degraded',
          plan: {
            triggers,
            domain,
            verificationStatus: 'skipped',
            verified: false,
            confidence: 'low',
            citations: [],
            freshnessWarning: 'Could not verify against current sources',
          },
        },
        result: {
          status: 'skipped',
          allClaimsVerified: false,
          verifiedCount: 0,
          totalClaims: 0,
          citations: [],
          derivedConfidence: 'low',
          claimResults: [],
        },
      };
    }
  }

  // Step 4: Execute verification if required
  if (triggers.length > 0 && canVerify) {
    const result = await executeVerification(
      state.input.message,
      triggers,
      {
        webFetcher,
        maxSources: 5,
        timeoutMs: 10000,
      }
    );

    return {
      plan: {
        required: true,
        mode: 'verified',
        plan: {
          triggers,
          domain,
          verificationStatus: result.status,
          verified: result.allClaimsVerified,
          confidence: result.derivedConfidence,
          citations: result.citations,
          freshnessWarning: result.freshnessWarning,
        },
      },
      result,
    };
  }

  // Step 5: No verification required
  return {
    plan: {
      required: false,
      mode: 'skipped',
      plan: {
        triggers: [],
        domain,
        verificationStatus: 'not_required',
        verified: false,
        confidence: 'medium',
        citations: [],
      },
    },
    result: null,
  };
}

/**
 * Detect verification triggers in a message.
 */
function detectVerificationTriggers(message: string): VerificationTrigger[] {
  const triggers: VerificationTrigger[] = [];

  const patterns: Array<{ trigger: VerificationTrigger; pattern: RegExp }> = [
    { trigger: 'temporal_claim', pattern: /\b(latest|current|now|today|recent|as of)\b/i },
    { trigger: 'health_claim', pattern: /\b(treatment|diagnosis|medication|symptoms?|cure|therapy)\b/i },
    { trigger: 'legal_claim', pattern: /\b(law|legal|illegal|statute|regulation|court)\b/i },
    { trigger: 'financial_claim', pattern: /\b(price|cost|worth|value|invest|stock|rate)\b/i },
    { trigger: 'numeric_claim', pattern: /\b(\d+(?:\.\d+)?%|\$[\d,]+(?:\.\d{2})?)\b/i },
    { trigger: 'public_figure_claim', pattern: /\b(said|stated|announced|tweeted|posted)\b.*\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/i },
  ];

  for (const { trigger, pattern } of patterns) {
    if (pattern.test(message) && !triggers.includes(trigger)) {
      triggers.push(trigger);
    }
  }

  return triggers;
}
