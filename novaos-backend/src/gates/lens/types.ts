// ═══════════════════════════════════════════════════════════════════════════════
// LENS GATE TYPES — Tiered Verification System
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// SEARCH TIER
// ─────────────────────────────────────────────────────────────────────────────────

export type SearchTier = 'low' | 'medium' | 'high';

// ─────────────────────────────────────────────────────────────────────────────────
// RETRIEVAL STATUS
// ─────────────────────────────────────────────────────────────────────────────────

export type RetrievalStatus = 'ok' | 'partial' | 'failed';

// ─────────────────────────────────────────────────────────────────────────────────
// CONFIDENCE LEVELS
// ─────────────────────────────────────────────────────────────────────────────────

export type LensConfidenceLevel =
  | 'model_only'    // LOW — no retrieval
  | 'soft'          // MEDIUM — augmented but not verified
  | 'earned'        // HIGH — requirements met
  | 'degraded'      // HIGH — partial verification
  | 'insufficient'; // HIGH — requirements not met

// ─────────────────────────────────────────────────────────────────────────────────
// VERIFICATION STATUS
// ─────────────────────────────────────────────────────────────────────────────────

export type VerificationStatus =
  | 'not_applicable'  // LOW — webHelpful=false
  | 'skipped'         // LOW — webHelpful=true but risk < threshold
  | 'augmented'       // MEDIUM — search completed, soft certainty
  | 'verified'        // HIGH — requirements met
  | 'degraded'        // HIGH — partial verification
  | 'insufficient';   // HIGH — requirements not met OR retrieval failed

// ─────────────────────────────────────────────────────────────────────────────────
// RELIABILITY TIERS
// ─────────────────────────────────────────────────────────────────────────────────

export type ReliabilityTier =
  | 'official'      // Company blogs, gov sites, official releases
  | 'wire'          // Reuters, AP, Bloomberg
  | 'authoritative' // Major newspapers, established outlets
  | 'reference'     // Wikipedia, documentation sites
  | 'community';    // Reddit, forums, blogs

// ─────────────────────────────────────────────────────────────────────────────────
// RISK FACTORS
// ─────────────────────────────────────────────────────────────────────────────────

export type RiskFactor =
  | 'post_cutoff'
  | 'specific_numbers'
  | 'obscure_entity'
  | 'volatile_data'
  | 'recent_events'
  | 'verifiable_claim'
  | 'high_stakes'
  | 'time_sensitive_claim'
  | 'breaking_news';

// ─────────────────────────────────────────────────────────────────────────────────
// DEGRADATION REASONS
// ─────────────────────────────────────────────────────────────────────────────────

export type DegradationReason =
  | 'retrieval_failed'
  | 'retrieval_partial'
  | 'insufficient_sources'
  | 'conflicting_sources'
  | 'no_official_source'
  | 'claims_unverifiable';

// ─────────────────────────────────────────────────────────────────────────────────
// STAKES LEVEL (from existing types)
// ─────────────────────────────────────────────────────────────────────────────────

export type StakesLevel = 'low' | 'medium' | 'high' | 'critical';

// ─────────────────────────────────────────────────────────────────────────────────
// LLM CLASSIFICATION OUTPUT
// ─────────────────────────────────────────────────────────────────────────────────

export interface LensClassification {
  webHelpful: boolean;
  riskScore: number;
  riskFactors: RiskFactor[];
  reasoning: string;
  searchQuery?: string;
  forceHigh: boolean;
  hasRecencyRequest: boolean;
  isEvolvingDomain: boolean;
  isTimelessTopic: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────
// EVIDENCE ITEM
// ─────────────────────────────────────────────────────────────────────────────────

export interface EvidenceItem {
  title: string;
  url: string;
  excerpt: string;
  reliability: ReliabilityTier;
  publishedAt?: string;
  retrievedAt: string;
  isOfficial: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────
// EVIDENCE PACK
// ─────────────────────────────────────────────────────────────────────────────────

export interface EvidencePack {
  query: string;
  retrievedAt: string;
  tier: SearchTier;
  items: EvidenceItem[];
  deduped: boolean;
  duplicatesRemoved: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// VERIFIED CLAIM
// ─────────────────────────────────────────────────────────────────────────────────

export interface VerifiedClaim {
  claim: string;
  supported: boolean;
  sources: string[];
  sourceCount: number;
  hasOfficialSource: boolean;
  conflicting?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────
// LENS RESULT (Updated - Replaces old LensResult)
// ─────────────────────────────────────────────────────────────────────────────────

export interface TieredLensResult {
  // Classification
  webHelpful: boolean;
  riskScore: number;
  riskFactors: RiskFactor[];
  searchTier: SearchTier;

  // Retrieval outcome
  retrievalPerformed: boolean;
  retrievalStatus: RetrievalStatus | null;
  requirementsMet: boolean | null;  // null for LOW/MEDIUM
  verificationStatus: VerificationStatus;

  // Evidence (MEDIUM and HIGH)
  evidencePack?: EvidencePack;

  // HIGH-specific
  claimRequirements?: string[];
  claimsVerified?: VerifiedClaim[];
  claimsUnverified?: string[];

  // Confidence
  confidence: LensConfidenceLevel;
  stakes: StakesLevel;

  // Degradation
  degradationReason?: DegradationReason;
  degradationMessage?: string;

  // Backwards compatibility with old LensResult
  needsVerification: boolean;
  verified: boolean;
  domain?: string;
  status?: 'verified' | 'degraded' | 'stopped';
  message?: string;
  freshnessWindow?: string;
  sources?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// SEARCH CONFIG
// ─────────────────────────────────────────────────────────────────────────────────

export interface MediumSearchConfig {
  primaryProvider: 'tavily';
  fallbackProvider: 'google_cse';
  maxResults: number;
  maxFetchUrls: number;
  timeoutMs: number;
  requireOfficialSources: false;
  dedupe: boolean;
  capturePublishedAt: boolean;
}

export interface HighSearchConfig {
  providers: Array<'official' | 'google_cse' | 'tavily'>;
  parallelFetch: boolean;
  maxResults: number;
  maxFetchUrls: number;
  timeoutMs: number;
  requireOfficialSources: boolean;
  requireMultipleSources: boolean;
  minSourcesForClaim: number;
  officialSourceException: boolean;
  dedupe: boolean;
  capturePublishedAt: boolean;
}

export interface SearchConfig {
  medium: MediumSearchConfig;
  high: HighSearchConfig;
}

// ─────────────────────────────────────────────────────────────────────────────────
// FORCE HIGH DOMAINS
// ─────────────────────────────────────────────────────────────────────────────────

export const FORCE_HIGH_DOMAINS = [
  'health',
  'medical',
  'legal',
  'financial',
  'safety',
] as const;

export type ForceHighDomain = typeof FORCE_HIGH_DOMAINS[number];
