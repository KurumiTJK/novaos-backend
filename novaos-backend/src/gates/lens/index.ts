// ═══════════════════════════════════════════════════════════════════════════════
// LENS GATE — LLM-Powered Tiered Verification System
// Main entry point for the Lens gate
// ═══════════════════════════════════════════════════════════════════════════════
//
// CORE PRINCIPLE:
// Nova answers fast by default, and only checks the internet when not checking
// would be irresponsible.
//
// THREE TIERS:
// - LOW:    No search needed, answer from model knowledge
// - MEDIUM: Augment model knowledge with search (soft certainty)
// - HIGH:   Verify claims before answering (earned certainty)
//
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  PipelineState,
  PipelineContext,
  GateResult,
  LensResult,
} from '../../types/index.js';

import type {
  TieredLensResult,
  LensClassification,
  SearchTier,
  VerificationStatus,
  LensConfidenceLevel,
  EvidencePack,
  DegradationReason,
  StakesLevel,
} from './types.js';

import { classifyWithLLM, getFailSafeClassification } from './classifier.js';
import { applyDeterministicOverrides, detectDomain, detectStakes } from './overrides.js';
import { determineSearchTier, shouldSkipSearch, getTierExplanation } from './tier.js';
import { processEvidence, isEvidenceSufficient, verifyClaimsAgainstEvidence } from './evidence.js';
import { extractClaimRequirements, getRequiredClaims, buildSearchQueriesFromRequirements } from './claims.js';
import { getSearchManager, type SearchResponse } from '../../services/search/index.js';

// Re-export types
export * from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LENS GATE CONFIG
// ─────────────────────────────────────────────────────────────────────────────────

export interface LensGateConfig {
  enableSearch?: boolean;
  forceClassifier?: 'llm' | 'fallback';
  timeoutMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────────

export async function executeLensGateAsync(
  state: PipelineState,
  _context: PipelineContext,
  config?: LensGateConfig
): Promise<GateResult<TieredLensResult>> {
  const start = Date.now();
  const message = state.normalizedInput;

  try {
    // ─── STEP 1: CLASSIFY ───
    let classification: LensClassification;
    
    if (config?.forceClassifier === 'fallback') {
      classification = getFailSafeClassification(message);
    } else {
      classification = await classifyWithLLM(message);
    }

    // ─── STEP 2: APPLY DETERMINISTIC OVERRIDES ───
    classification = applyDeterministicOverrides(classification, message);

    // ─── STEP 3: DETERMINE TIER ───
    const searchTier = determineSearchTier(classification);
    const domain = detectDomain(message);
    const stakes = detectStakes(classification, domain);

    console.log(`[LENS] Classification: tier=${searchTier}, webHelpful=${classification.webHelpful}, riskScore=${classification.riskScore.toFixed(2)}, forceHigh=${classification.forceHigh}`);
    console.log(`[LENS] Reason: ${classification.reasoning}`);

    // ─── STEP 4: HANDLE LOW TIER ───
    if (searchTier === 'low') {
      const skipInfo = shouldSkipSearch(classification, searchTier);
      
      const result: TieredLensResult = {
        // Classification
        webHelpful: classification.webHelpful,
        riskScore: classification.riskScore,
        riskFactors: classification.riskFactors,
        searchTier: 'low',
        
        // Retrieval
        retrievalPerformed: false,
        retrievalStatus: null,
        requirementsMet: null,
        verificationStatus: skipInfo.reason === 'not_applicable' ? 'not_applicable' : 'skipped',
        
        // Confidence
        confidence: 'model_only',
        stakes,
        
        // Backwards compatibility
        needsVerification: false,
        verified: true,
        domain,
      };

      return {
        gateId: 'lens',
        status: 'pass',
        output: result,
        action: 'continue',
        executionTimeMs: Date.now() - start,
      };
    }

    // ─── STEP 5: CHECK IF SEARCH IS AVAILABLE ───
    const searchManager = getSearchManager();
    const searchAvailable = config?.enableSearch !== false && searchManager.hasAnyProvider();

    if (!searchAvailable) {
      console.warn('[LENS] Search not available');
      
      // MEDIUM tier: don't degrade, just return with model_only confidence
      if (searchTier === 'medium') {
        const result: TieredLensResult = {
          webHelpful: classification.webHelpful,
          riskScore: classification.riskScore,
          riskFactors: classification.riskFactors,
          searchTier: 'medium',
          retrievalPerformed: false,
          retrievalStatus: null,
          requirementsMet: null,
          verificationStatus: 'skipped',
          confidence: 'model_only',
          stakes,
          needsVerification: true,
          verified: false,
          domain,
        };

        return {
          gateId: 'lens',
          status: 'pass',  // MEDIUM always passes
          output: result,
          action: 'continue',
          executionTimeMs: Date.now() - start,
        };
      }

      // HIGH tier: degrade when search unavailable
      return buildDegradedResult(classification, searchTier, stakes, domain, 'retrieval_failed', start);
    }

    // ─── STEP 6: HANDLE MEDIUM TIER ───
    if (searchTier === 'medium') {
      return executeMediumTier(classification, message, stakes, domain, start);
    }

    // ─── STEP 7: HANDLE HIGH TIER ───
    return executeHighTier(classification, message, stakes, domain, start);

  } catch (error) {
    console.error('[LENS] Error:', error);
    
    // Try to detect domain even in error case
    const domain = detectDomain(message);
    
    // Fail open - return LOW tier result with proper backwards compatibility
    return {
      gateId: 'lens',
      status: 'pass',
      output: {
        webHelpful: false,
        riskScore: 0,
        riskFactors: [],
        searchTier: 'low',
        retrievalPerformed: false,
        retrievalStatus: null,
        requirementsMet: null,
        verificationStatus: 'not_applicable',
        confidence: 'model_only',
        stakes: 'low',
        needsVerification: false,
        verified: true,
        domain,
        message: 'Lens classification failed - proceeding with model knowledge',
      },
      action: 'continue',
      executionTimeMs: Date.now() - start,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// MEDIUM TIER EXECUTION
// ─────────────────────────────────────────────────────────────────────────────────

async function executeMediumTier(
  classification: LensClassification,
  message: string,
  stakes: StakesLevel,
  domain: string | undefined,
  start: number
): Promise<GateResult<TieredLensResult>> {
  const searchManager = getSearchManager();
  const query = classification.searchQuery || message;

  console.log(`[LENS] MEDIUM tier - searching: "${query}"`);

  // Execute search
  const searchResponse = await searchManager.searchMedium(query, {
    maxResults: 5,
    timeoutMs: 3000,
  });

  // Build evidence pack
  const evidencePack = searchManager.buildEvidencePack(searchResponse, 'medium');

  // Determine retrieval status
  let retrievalStatus: 'ok' | 'partial' | 'failed';
  if (!searchResponse.success) {
    retrievalStatus = 'failed';
  } else if (searchResponse.results.length === 0) {
    retrievalStatus = 'partial';
  } else {
    retrievalStatus = 'ok';
  }

  const result: TieredLensResult = {
    // Classification
    webHelpful: classification.webHelpful,
    riskScore: classification.riskScore,
    riskFactors: classification.riskFactors,
    searchTier: 'medium',
    
    // Retrieval
    retrievalPerformed: true,
    retrievalStatus,
    requirementsMet: null, // MEDIUM doesn't verify requirements
    verificationStatus: retrievalStatus === 'ok' ? 'augmented' : 'skipped',
    
    // Evidence
    evidencePack,
    
    // Confidence
    confidence: retrievalStatus === 'ok' ? 'soft' : 'model_only',
    stakes,
    
    // Backwards compatibility - MEDIUM never sets status to 'degraded'
    needsVerification: true,
    verified: false, // MEDIUM provides soft certainty, not verification
    domain,
    sources: evidencePack.items.map(item => item.url),
  };

  // MEDIUM never blocks - it always continues
  return {
    gateId: 'lens',
    status: 'pass',
    output: result,
    action: 'continue',
    executionTimeMs: Date.now() - start,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// HIGH TIER EXECUTION
// ─────────────────────────────────────────────────────────────────────────────────

async function executeHighTier(
  classification: LensClassification,
  message: string,
  stakes: StakesLevel,
  domain: string | undefined,
  start: number
): Promise<GateResult<TieredLensResult>> {
  const searchManager = getSearchManager();

  console.log(`[LENS] HIGH tier - extracting claim requirements`);

  // ─── STEP 1: CLAIM FREEZING ───
  const claimRequirements = await extractClaimRequirements(message);
  const requiredClaims = getRequiredClaims(claimRequirements);
  const searchQueries = buildSearchQueriesFromRequirements(claimRequirements);

  // If no specific queries, use the classified search query
  if (searchQueries.length === 0 && classification.searchQuery) {
    searchQueries.push(classification.searchQuery);
  }

  console.log(`[LENS] HIGH tier - ${requiredClaims.length} required claims, ${searchQueries.length} queries`);

  // ─── STEP 2: RETRIEVAL ───
  let allResults: SearchResponse = {
    query: searchQueries.join(' | '),
    results: [],
    retrievedAt: new Date().toISOString(),
    provider: 'multi',
    success: false,
  };

  for (const query of searchQueries.slice(0, 3)) { // Limit to 3 queries
    console.log(`[LENS] HIGH tier - searching: "${query}"`);
    const response = await searchManager.searchHigh(query, {
      maxResults: 10,
      timeoutMs: 5000,
      requireOfficial: true,
    });

    console.log(`[LENS] HIGH tier - search result: success=${response.success}, results=${response.results.length}, provider=${response.provider}`);
    
    if (response.success) {
      allResults.results.push(...response.results);
      allResults.success = true;
    }
  }

  // Dedupe results
  const uniqueUrls = new Set<string>();
  allResults.results = allResults.results.filter(r => {
    if (uniqueUrls.has(r.url)) return false;
    uniqueUrls.add(r.url);
    return true;
  });

  console.log(`[LENS] HIGH tier - total unique results: ${allResults.results.length}`);
  
  // Debug: log first few results to verify snippets exist
  if (allResults.results.length > 0) {
    console.log(`[LENS] HIGH tier - sample result: title="${allResults.results[0].title}", snippet length=${allResults.results[0].snippet?.length ?? 0}`);
  }

  // Build evidence pack
  const evidencePack = searchManager.buildEvidencePack(allResults, 'high');
  
  console.log(`[LENS] HIGH tier - evidence pack: ${evidencePack.items.length} items, weight=${(evidencePack.totalWeight ?? 0).toFixed(2)}`);
  
  // Debug: verify excerpts exist
  if (evidencePack.items.length > 0) {
    console.log(`[LENS] HIGH tier - sample evidence: excerpt length=${evidencePack.items[0].excerpt?.length ?? 0}`);
  }

  // ─── STEP 3: PROCESS EVIDENCE ───
  const processedEvidence = processEvidence(evidencePack);

  // ─── STEP 4: CHECK EVIDENCE SUFFICIENCY ───
  const sufficiencyCheck = isEvidenceSufficient(processedEvidence, true, true);

  if (!sufficiencyCheck.sufficient) {
    console.warn(`[LENS] HIGH tier - insufficient evidence: ${sufficiencyCheck.reason}`);
    
    return buildInsufficientResult(
      classification,
      stakes,
      domain,
      evidencePack,
      requiredClaims,
      sufficiencyCheck.reason || 'Insufficient evidence',
      start
    );
  }

  // ─── STEP 5: VERIFY CLAIMS ───
  const verificationResult = verifyClaimsAgainstEvidence(
    requiredClaims,
    processedEvidence,
    { minSources: 2, officialSourceException: true }
  );

  console.log(`[LENS] HIGH tier - verified: ${verificationResult.verified.length}, unverified: ${verificationResult.unverified.length}`);

  // ─── STEP 6: BUILD RESULT ───
  const allVerified = verificationResult.requirementsMet;
  const hasConflicts = verificationResult.verified.some(v => v.conflicting);

  let verificationStatus: VerificationStatus;
  let confidence: LensConfidenceLevel;

  if (allVerified && !hasConflicts) {
    verificationStatus = 'verified';
    confidence = 'earned';
  } else if (verificationResult.verified.length > 0) {
    verificationStatus = 'degraded';
    confidence = 'degraded';
  } else {
    verificationStatus = 'insufficient';
    confidence = 'insufficient';
  }

  const result: TieredLensResult = {
    // Classification
    webHelpful: classification.webHelpful,
    riskScore: classification.riskScore,
    riskFactors: classification.riskFactors,
    searchTier: 'high',
    
    // Retrieval
    retrievalPerformed: true,
    retrievalStatus: allResults.success ? 'ok' : 'partial',
    requirementsMet: allVerified,
    verificationStatus,
    
    // Evidence
    evidencePack,
    
    // HIGH-specific
    claimRequirements: requiredClaims,
    claimsVerified: verificationResult.verified,
    claimsUnverified: verificationResult.unverified,
    
    // Confidence
    confidence,
    stakes,
    
    // Degradation info
    degradationReason: !allVerified ? 'claims_unverifiable' : undefined,
    degradationMessage: !allVerified 
      ? `Unable to verify all claims. Unverified: ${verificationResult.unverified.join(', ')}`
      : undefined,
    
    // Backwards compatibility
    needsVerification: true,
    verified: allVerified,
    domain,
    status: allVerified ? 'verified' : 'degraded',
    sources: evidencePack.items.map(item => item.url),
  };

  // HIGH tier can block if requirements not met and stakes are critical
  if (!allVerified && stakes === 'critical') {
    return {
      gateId: 'lens',
      status: 'soft_fail',
      output: result,
      action: 'degrade',
      failureReason: 'Critical claims could not be verified',
      executionTimeMs: Date.now() - start,
    };
  }

  return {
    gateId: 'lens',
    status: allVerified ? 'pass' : 'soft_fail',
    output: result,
    action: 'continue',
    executionTimeMs: Date.now() - start,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// BUILD DEGRADED RESULT
// ─────────────────────────────────────────────────────────────────────────────────

function buildDegradedResult(
  classification: LensClassification,
  searchTier: SearchTier,
  stakes: StakesLevel,
  domain: string | undefined,
  reason: DegradationReason,
  start: number
): GateResult<TieredLensResult> {
  const result: TieredLensResult = {
    webHelpful: classification.webHelpful,
    riskScore: classification.riskScore,
    riskFactors: classification.riskFactors,
    searchTier,
    retrievalPerformed: false,
    retrievalStatus: 'failed',
    requirementsMet: false,
    verificationStatus: 'degraded',
    confidence: 'degraded',
    stakes,
    degradationReason: reason,
    degradationMessage: 'Search services unavailable - proceeding with model knowledge',
    needsVerification: true,
    verified: false,
    domain,
    status: 'degraded',
    message: 'Could not verify against current sources',
  };

  return {
    gateId: 'lens',
    status: 'soft_fail',
    output: result,
    action: 'degrade',
    failureReason: 'Search unavailable',
    executionTimeMs: Date.now() - start,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// BUILD INSUFFICIENT RESULT
// ─────────────────────────────────────────────────────────────────────────────────

function buildInsufficientResult(
  classification: LensClassification,
  stakes: StakesLevel,
  domain: string | undefined,
  evidencePack: EvidencePack,
  claimRequirements: string[],
  reason: string,
  start: number
): GateResult<TieredLensResult> {
  const result: TieredLensResult = {
    webHelpful: classification.webHelpful,
    riskScore: classification.riskScore,
    riskFactors: classification.riskFactors,
    searchTier: 'high',
    retrievalPerformed: true,
    retrievalStatus: 'partial',
    requirementsMet: false,
    verificationStatus: 'insufficient',
    evidencePack,
    claimRequirements,
    claimsVerified: [],
    claimsUnverified: claimRequirements,
    confidence: 'insufficient',
    stakes,
    degradationReason: 'insufficient_sources',
    degradationMessage: `Unable to verify: ${reason}`,
    needsVerification: true,
    verified: false,
    domain,
    status: 'degraded',
    message: `Verification incomplete: ${reason}`,
  };

  return {
    gateId: 'lens',
    status: 'soft_fail',
    output: result,
    action: stakes === 'critical' ? 'stop' : 'degrade',
    failureReason: reason,
    executionTimeMs: Date.now() - start,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// LEGACY SYNC VERSION (for backwards compatibility)
// ─────────────────────────────────────────────────────────────────────────────────

export function executeLensGate(
  state: PipelineState,
  _context: PipelineContext
): GateResult<LensResult> {
  const start = Date.now();
  const message = state.normalizedInput;

  // Use fail-safe classification (sync)
  const classification = getFailSafeClassification(message);
  const classificationWithOverrides = applyDeterministicOverrides(classification, message);
  const searchTier = determineSearchTier(classificationWithOverrides);
  const domain = detectDomain(message);
  const stakes = detectStakes(classificationWithOverrides, domain);

  // Map to legacy result format
  const result: LensResult = {
    needsVerification: classificationWithOverrides.webHelpful && searchTier !== 'low',
    verified: false,
    domain,
    stakes,
    confidence: classificationWithOverrides.riskScore,
    status: searchTier === 'low' ? undefined : 'degraded',
    message: searchTier !== 'low' 
      ? `This may require ${searchTier === 'high' ? 'verification' : 'current information'} which cannot be provided synchronously`
      : undefined,
  };

  return {
    gateId: 'lens',
    status: searchTier === 'low' ? 'pass' : 'soft_fail',
    output: result,
    action: searchTier === 'low' ? 'continue' : 'degrade',
    executionTimeMs: Date.now() - start,
  };
}
