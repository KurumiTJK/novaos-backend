// ═══════════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR — Live Data Orchestration for Lens Gate
// Phase 7: Lens Gate
// 
// This module orchestrates the complete live data flow:
// 1. Classification (via classification module)
// 2. Risk Assessment (via risk module)
// 3. Entity Resolution (via entity resolver)
// 4. Provider Fetching (via provider registry)
// 5. Failure Semantics (via failure-semantics module)
// 6. Evidence Building (via evidence-injection module)
// 
// CRITICAL INVARIANTS:
// - live_feed/mixed → forceHigh = true (IMMUTABLE)
// - time + failure → refuse (NO qualitative fallback)
// - All numeric values in output MUST come from evidence tokens
// ═══════════════════════════════════════════════════════════════════════════════

import type { LiveCategory } from '../../../types/categories.js';
import type { DataNeedClassification, TruthMode } from '../../../types/data-need.js';
import type { ResolvedEntities, ResolvedEntity } from '../../../types/entities.js';
import type {
  LensGateResult,
  LensMode,
  EvidencePack,
  RetrievalOutcome,
  RetrievalStatus,
  ContextItem,
} from '../../../types/lens.js';
import type {
  ProviderResult,
  ProviderData,
  ProviderOkResult,
} from '../../../types/provider-results.js';
import type {
  ResponseConstraints,
  NumericTokenSet,
} from '../../../types/constraints.js';

import { isProviderOk } from '../../../types/provider-results.js';
import {
  createPassthroughResult,
  createDegradedResult,
  createBlockedResult,
  type LensUserOption,
} from '../../../types/lens.js';
import {
  createDefaultConstraints,
  createStrictConstraints,
  createDegradedConstraints,
} from '../../../types/constraints.js';
import { createEmptyEntities } from '../../../types/entities.js';

// Import from sibling modules
import { classify, classifySync, type ClassificationContext } from '../classification/index.js';
import { assessRisk, validateForceHighInvariant, type RiskAssessment } from '../risk/index.js';
import {
  handleTimeData,
  handleMultipleTimeQueries,
  hasTimeEntity,
  extractTimeEntities,
  type TimeHandlerResult,
} from './time-handler.js';

// Import from services
import { getProviderForCategory, isCategoryAvailable } from '../../../services/data-providers/registry.js';
import {
  getFailureSemantics,
  combineSemantics,
  type FailureSemantics,
  type ProviderStatus,
} from '../../../services/live-data/failure-semantics.js';
import {
  buildEvidencePack,
  buildAugmentedMessage,
} from '../../../services/live-data/evidence-injection.js';
import {
  formatProviderData,
  buildTokenSet,
  buildTokenSetFromData,
} from '../../../services/live-data/numeric-tokens.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Options for orchestration.
 */
export interface OrchestrationOptions {
  /** Classification context */
  readonly classificationContext?: ClassificationContext;
  
  /** Whether to skip classification (use provided classification) */
  readonly skipClassification?: boolean;
  
  /** Pre-computed classification (if skipClassification is true) */
  readonly classification?: DataNeedClassification;
  
  /** Timeout for provider calls in milliseconds */
  readonly providerTimeoutMs?: number;
  
  /** Whether to allow parallel provider calls */
  readonly parallelFetch?: boolean;
  
  /** Maximum number of retries for failed providers */
  readonly maxRetries?: number;
  
  /** User's timezone for time queries */
  readonly userTimezone?: string;
  
  /** User's location for weather queries */
  readonly userLocation?: string;
  
  /** Correlation ID for telemetry */
  readonly correlationId?: string;
}

/**
 * Internal state during orchestration.
 */
interface OrchestrationState {
  readonly message: string;
  readonly classification: DataNeedClassification;
  readonly riskAssessment: RiskAssessment;
  readonly providerResults: Map<LiveCategory, ProviderResult>;
  readonly failedCategories: LiveCategory[];
  readonly successfulData: ProviderData[];
  readonly startTime: number;
}

/**
 * Result of a single category fetch.
 */
interface CategoryFetchResult {
  readonly category: LiveCategory;
  readonly result: ProviderResult | null;
  readonly entity: ResolvedEntity | null;
  readonly latencyMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Default provider timeout in milliseconds.
 */
const DEFAULT_PROVIDER_TIMEOUT_MS = 5000;

/**
 * Default maximum retries.
 */
const DEFAULT_MAX_RETRIES = 1;

// ─────────────────────────────────────────────────────────────────────────────────
// MAIN ORCHESTRATION FUNCTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Orchestrate complete live data handling for a user message.
 * 
 * This is the main entry point for the Lens gate's live data functionality.
 * It coordinates classification, risk assessment, data fetching, and evidence building.
 * 
 * @param message - The user message
 * @param options - Orchestration options
 * @returns Complete LensGateResult
 * 
 * @example
 * const result = await orchestrate("What's AAPL trading at?");
 * if (result.mode === 'live_fetch') {
 *   // Use result.evidence for response generation
 * }
 */
export async function orchestrate(
  message: string,
  options: OrchestrationOptions = {}
): Promise<LensGateResult> {
  const startTime = Date.now();
  const correlationId = options.correlationId ?? generateCorrelationId();
  
  console.log(`[ORCHESTRATOR] Starting orchestration (correlationId: ${correlationId})`);
  
  try {
    // ─── STEP 1: CLASSIFICATION ───
    const classification = await getClassification(message, options);
    
    console.log(`[ORCHESTRATOR] Classification: truthMode=${classification.truthMode}, ` +
      `categories=[${classification.liveCategories.join(', ')}]`);
    
    // ─── STEP 2: CHECK IF LIVE DATA NEEDED ───
    if (!requiresLiveData(classification)) {
      console.log('[ORCHESTRATOR] No live data needed - passthrough');
      return createPassthroughResult(
        classification,
        classification.entities ?? createEmptyEntities(),
        createDefaultConstraints('Passthrough - no live data needed')
      );
    }
    
    // ─── STEP 3: RISK ASSESSMENT ───
    const riskAssessment = assessRisk(classification);
    
    // Validate forceHigh invariant
    validateForceHighInvariant(classification.truthMode, riskAssessment.forceHigh);
    
    console.log(`[ORCHESTRATOR] Risk: forceHigh=${riskAssessment.forceHigh}, ` +
      `score=${riskAssessment.riskScore}, stakes=${riskAssessment.stakes}`);
    
    // ─── STEP 4: FETCH PROVIDER DATA ───
    const fetchResults = await fetchAllCategories(
      classification.liveCategories,
      classification.entities,
      options
    );
    
    // ─── STEP 5: PROCESS RESULTS ───
    const state: OrchestrationState = {
      message,
      classification,
      riskAssessment,
      providerResults: new Map(fetchResults.map(r => [r.category, r.result!])),
      failedCategories: fetchResults.filter(r => !r.result || !isProviderOk(r.result)).map(r => r.category),
      successfulData: fetchResults
        .filter(r => r.result && isProviderOk(r.result))
        .map(r => (r.result as ProviderOkResult).data),
      startTime,
    };
    
    // ─── STEP 6: HANDLE TIME CATEGORY SPECIALLY ───
    if (hasTimeCategory(classification.liveCategories)) {
      const timeResult = await handleTimeCategory(state, options);
      if (timeResult) {
        return timeResult;
      }
    }
    
    // ─── STEP 7: DETERMINE FAILURE SEMANTICS ───
    const semantics = determineSemantics(state);
    
    console.log(`[ORCHESTRATOR] Semantics: proceed=${semantics.modelProceed}, ` +
      `constraints=${semantics.constraintLevel}`);
    
    // ─── STEP 8: BUILD RESULT ───
    const result = buildResult(state, semantics, correlationId);
    
    const elapsed = Date.now() - startTime;
    console.log(`[ORCHESTRATOR] Complete in ${elapsed}ms: mode=${result.mode}`);
    
    return result;
    
  } catch (error) {
    console.error('[ORCHESTRATOR] Error:', error);
    
    // Create minimal classification for error state
    const errorClassification: DataNeedClassification = {
      truthMode: 'local',
      primaryCategory: 'general',
      categories: ['general'],
      liveCategories: [],
      authoritativeCategories: [],
      entities: createEmptyEntities(),
      entitiesComplete: true,
      entitiesNeedingClarification: [],
      confidence: 'low',
      confidenceScore: 0,
      reasoning: 'Orchestration error',
      method: 'rule_based',
      fallbackMode: 'refuse',
      freshnessCritical: false,
      maxDataAgeMs: null,
      requiresNumericPrecision: false,
      allowsActionRecommendations: false,
    };
    
    const userOptions: LensUserOption[] = [
      { id: 'retry', label: 'Try Again', requiresAck: false, action: 'retry' },
      { id: 'cancel', label: 'Cancel', requiresAck: false, action: 'cancel' },
    ];
    
    // Return blocked result on error
    return createBlockedResult(
      errorClassification,
      createEmptyEntities(),
      error instanceof Error ? error.message : 'Unknown error',
      userOptions
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Get classification, either from options or by running classifier.
 */
async function getClassification(
  message: string,
  options: OrchestrationOptions
): Promise<DataNeedClassification> {
  if (options.skipClassification && options.classification) {
    return options.classification;
  }
  
  const context: ClassificationContext = {
    ...options.classificationContext,
    userTimezone: options.userTimezone,
    userLocation: options.userLocation,
  };
  
  return classify(message, context);
}

/**
 * Check if classification requires live data.
 */
function requiresLiveData(classification: DataNeedClassification): boolean {
  const { truthMode, liveCategories } = classification;
  
  return (
    truthMode === 'live_feed' ||
    truthMode === 'mixed' ||
    liveCategories.length > 0
  );
}

// ─────────────────────────────────────────────────────────────────────────────────
// PROVIDER FETCHING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Fetch data from all required category providers.
 */
async function fetchAllCategories(
  categories: readonly LiveCategory[],
  entities: ResolvedEntities,
  options: OrchestrationOptions
): Promise<CategoryFetchResult[]> {
  const { parallelFetch = true, providerTimeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS } = options;
  
  // Build entity lookup
  const entityByCategory = buildEntityLookup(entities);
  
  // Create fetch promises
  const fetchPromises = categories.map(category => 
    fetchCategory(category, entityByCategory.get(category) ?? null, providerTimeoutMs)
  );
  
  // Execute fetches
  if (parallelFetch) {
    return Promise.all(fetchPromises);
  } else {
    // Sequential fetching
    const results: CategoryFetchResult[] = [];
    for (const promise of fetchPromises) {
      results.push(await promise);
    }
    return results;
  }
}

/**
 * Fetch data from a single category provider.
 */
async function fetchCategory(
  category: LiveCategory,
  entity: ResolvedEntity | null,
  timeoutMs: number
): Promise<CategoryFetchResult> {
  const startTime = Date.now();
  
  // Check if category is available
  if (!isCategoryAvailable(category)) {
    console.warn(`[ORCHESTRATOR] Category ${category} not available`);
    return {
      category,
      result: null,
      entity,
      latencyMs: Date.now() - startTime,
    };
  }
  
  try {
    const provider = getProviderForCategory(category);
    if (!provider) {
      console.warn(`[ORCHESTRATOR] No provider for category ${category}`);
      return {
        category,
        result: null,
        entity,
        latencyMs: Date.now() - startTime,
      };
    }
    
    // Create timeout promise
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs);
    });
    
    // Get the query from entity
    const query = entity?.canonicalForm ?? entity?.raw.rawText ?? '';
    
    // Race provider call against timeout
    const result = await Promise.race([
      provider.fetch(query),
      timeoutPromise,
    ]);
    
    return {
      category,
      result: result as ProviderResult | null,
      entity,
      latencyMs: Date.now() - startTime,
    };
    
  } catch (error) {
    console.error(`[ORCHESTRATOR] Error fetching ${category}:`, error);
    return {
      category,
      result: null,
      entity,
      latencyMs: Date.now() - startTime,
    };
  }
}

/**
 * Build lookup map from category to primary entity.
 */
function buildEntityLookup(
  entities: ResolvedEntities
): Map<LiveCategory, ResolvedEntity> {
  const lookup = new Map<LiveCategory, ResolvedEntity>();
  
  for (const entity of entities.resolved) {
    // Only store first entity per category (primary)
    if (!lookup.has(entity.category)) {
      lookup.set(entity.category, entity);
    }
  }
  
  return lookup;
}

// ─────────────────────────────────────────────────────────────────────────────────
// TIME CATEGORY HANDLING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Check if categories include time.
 */
function hasTimeCategory(categories: readonly LiveCategory[]): boolean {
  return categories.includes('time');
}

/**
 * Handle time category specially (no fallback allowed).
 */
async function handleTimeCategory(
  state: OrchestrationState,
  options: OrchestrationOptions
): Promise<LensGateResult | null> {
  const timeEntities = extractTimeEntities(state.classification.entities.resolved);
  
  if (timeEntities.length === 0) {
    return null;
  }
  
  // Get time provider results
  const timeResults = new Map<string, ProviderResult | null>();
  for (const entity of timeEntities) {
    const timezone = entity.canonicalForm ?? 'UTC';
    const result = state.providerResults.get('time') ?? null;
    timeResults.set(timezone, result);
  }
  
  // Handle time queries
  const batchResult = handleMultipleTimeQueries(
    timeResults,
    timeEntities,
    { defaultTimezone: options.userTimezone }
  );
  
  // If any time query failed, we must refuse
  if (!batchResult.success) {
    const failedZones = batchResult.failedTimezones.join(', ');
    console.warn(`[ORCHESTRATOR] Time queries failed for: ${failedZones} - refusing`);
    
    // Get the first refusal message
    let refusalMessage = 'Time data unavailable';
    for (const [, result] of batchResult.results) {
      if (result.isRefusal && result.refusalMessage) {
        refusalMessage = result.refusalMessage;
        break;
      }
    }
    
    const userOptions: LensUserOption[] = [
      { id: 'retry', label: 'Try Again', requiresAck: false, action: 'retry' },
      { id: 'cancel', label: 'Cancel', requiresAck: false, action: 'cancel' },
    ];
    
    return createBlockedResult(
      state.classification,
      state.classification.entities ?? createEmptyEntities(),
      refusalMessage,
      userOptions
    );
  }
  
  // Time queries succeeded - continue normal processing
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────────
// FAILURE SEMANTICS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Determine failure semantics from orchestration state.
 */
function determineSemantics(state: OrchestrationState): FailureSemantics {
  const { classification, providerResults, failedCategories } = state;
  const { truthMode, liveCategories, fallbackMode } = classification;
  
  // If no failures, return verified semantics
  if (failedCategories.length === 0) {
    return getFailureSemantics(truthMode, liveCategories[0]!, 'verified', fallbackMode);
  }
  
  // If all failed, return failed semantics
  if (failedCategories.length === liveCategories.length) {
    return getFailureSemantics(truthMode, liveCategories[0]!, 'failed', fallbackMode);
  }
  
  // Partial failure - combine semantics from each category
  const semanticsList: FailureSemantics[] = [];
  
  for (const category of liveCategories) {
    const result = providerResults.get(category);
    const status: ProviderStatus = !result ? 'failed' :
      isProviderOk(result) ? 'verified' : 'failed';
    
    semanticsList.push(getFailureSemantics(truthMode, category, status, fallbackMode));
  }
  
  return combineSemantics(semanticsList);
}

// ─────────────────────────────────────────────────────────────────────────────────
// RESULT BUILDING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Build the final LensGateResult.
 */
function buildResult(
  state: OrchestrationState,
  semantics: FailureSemantics,
  correlationId: string
): LensGateResult {
  const { classification, riskAssessment, successfulData, failedCategories, startTime } = state;
  
  // Determine mode
  const mode = determineMode(semantics, failedCategories.length, classification.liveCategories.length);
  
  // Build retrieval outcome
  const retrieval = buildRetrievalOutcome(state);
  
  // Build evidence pack (if we have data)
  let evidence: EvidencePack | undefined;
  let constraints: ResponseConstraints | undefined;
  
  if (successfulData.length > 0) {
    const evidenceResult = buildEvidenceFromData(successfulData, semantics, classification.liveCategories);
    evidence = evidenceResult.evidence;
    constraints = evidenceResult.constraints;
  } else {
    constraints = buildConstraintsFromSemantics(semantics, undefined, classification.liveCategories);
  }
  
  return {
    classification,
    retrieval,
    evidence,
    constraints: constraints ?? createDefaultConstraints('Default constraints'),
    mode,
    forceHigh: riskAssessment.forceHigh,
    riskAssessment: {
      score: riskAssessment.riskScore,
      factors: [...riskAssessment.riskFactors],
      stakes: riskAssessment.stakes,
    },
    processingTimeMs: Date.now() - startTime,
    correlationId,
  };
}

/**
 * Determine the lens mode from semantics.
 */
function determineMode(
  semantics: FailureSemantics,
  failedCount: number,
  totalCount: number
): LensMode {
  switch (semantics.modelProceed) {
    case 'refuse':
      return 'blocked';
    case 'proceed_degraded':
      return 'degraded';
    case 'proceed':
      if (failedCount === 0) {
        return 'live_fetch';
      } else if (failedCount < totalCount) {
        return 'degraded';
      } else {
        return 'blocked';
      }
    default:
      return 'passthrough';
  }
}

/**
 * Build retrieval outcome from state.
 */
function buildRetrievalOutcome(state: OrchestrationState): RetrievalOutcome {
  const { classification, providerResults, failedCategories, successfulData, startTime } = state;
  
  // Determine status
  let status: RetrievalStatus;
  if (failedCategories.length === 0) {
    status = 'success';
  } else if (failedCategories.length === classification.liveCategories.length) {
    status = 'failed';
  } else {
    status = 'partial';
  }
  
  // Build category results
  const categoryResults = new Map<LiveCategory, {
    status: 'success' | 'failed' | 'stale';
    data?: ProviderData;
    error?: string;
  }>();
  
  for (const [category, result] of providerResults) {
    if (!result) {
      categoryResults.set(category, { status: 'failed', error: 'No response' });
    } else if (isProviderOk(result)) {
      categoryResults.set(category, { status: 'success', data: result.data });
    } else {
      categoryResults.set(category, { status: 'failed', error: result.error.message });
    }
  }
  
  return {
    status,
    categoryResults,
    successfulData,
    failedCategories,
    totalLatencyMs: Date.now() - startTime,
  };
}

/**
 * Build evidence pack from successful data.
 */
function buildEvidenceFromData(
  data: readonly ProviderData[],
  semantics: FailureSemantics,
  categories?: readonly LiveCategory[]
): { evidence: EvidencePack; constraints: ResponseConstraints } {
  const fetchedAt = Date.now();
  
  // Format all data and extract tokens
  const formattedResults = data.map(d => formatProviderData(d, { fetchedAt }));
  
  // Combine text
  const formattedContext = formattedResults.map(r => r.text).join('\n\n');
  
  // Build token set
  const allTokens = formattedResults.flatMap(r => [...r.tokens]);
  const tokenSet = buildTokenSet(allTokens);
  
  // Build context items
  const contextItems: ContextItem[] = formattedResults.map(r => ({
    source: `${r.category}_provider`,
    category: r.category,
    content: r.text,
    relevance: 1.0,
    staleness: 0,
  }));
  
  // Build constraints based on semantics
  const constraints = buildConstraintsFromSemantics(semantics, tokenSet, categories);
  
  // Build evidence pack
  const evidence: EvidencePack = {
    contextItems,
    numericTokens: tokenSet,
    constraints,
    formattedContext,
    systemPromptAdditions: buildSystemPromptAdditions(semantics),
  };
  
  return { evidence, constraints };
}

/**
 * Build constraints from failure semantics.
 */
function buildConstraintsFromSemantics(
  semantics: FailureSemantics,
  tokenSet?: NumericTokenSet,
  categories?: readonly LiveCategory[]
): ResponseConstraints {
  const cats = categories ?? [];
  
  switch (semantics.constraintLevel) {
    case 'quote_evidence_only':
      if (tokenSet) {
        return createStrictConstraints(tokenSet, [...cats], 'Strict constraints - only evidence tokens allowed');
      }
      return createDegradedConstraints('Live data unavailable - numeric claims forbidden');
    case 'forbid_numeric_claims':
      return createDegradedConstraints('Live data unavailable - numeric claims forbidden');
    case 'qualitative_only':
      return createDegradedConstraints('Proceeding with qualitative information only');
    case 'insufficient':
      return createDegradedConstraints('Insufficient data to provide accurate response');
    case 'permissive':
    default:
      return createDefaultConstraints('Default permissive constraints');
  }
}

/**
 * Build system prompt additions based on semantics.
 */
function buildSystemPromptAdditions(semantics: FailureSemantics): string[] {
  const additions: string[] = [];
  
  if (semantics.constraintLevel === 'quote_evidence_only') {
    additions.push(
      'IMPORTANT: Only use numeric values that appear in the evidence above.',
      'Do not extrapolate, calculate, or invent any numbers.'
    );
  }
  
  if (semantics.constraintLevel === 'forbid_numeric_claims') {
    additions.push(
      'IMPORTANT: Do not include any specific numeric values in your response.',
      'Provide only qualitative information.'
    );
  }
  
  if (semantics.constraintLevel === 'qualitative_only') {
    additions.push(
      'NOTE: Live data was partially unavailable.',
      'Provide qualitative information where specific data is missing.'
    );
  }
  
  if (semantics.freshnessWarning) {
    additions.push(semantics.freshnessWarning);
  }
  
  return additions;
}

// ─────────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Generate a correlation ID for telemetry.
 */
function generateCorrelationId(): string {
  return `lens-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────────────────────────────────────────────────────────────────
// SYNCHRONOUS ORCHESTRATION (for testing/fallback)
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Synchronous orchestration using pattern-only classification.
 * Does not fetch provider data - returns passthrough or blocked based on classification.
 * 
 * Use this when async orchestration is not possible or for quick classification checks.
 */
export function orchestrateSync(
  message: string,
  options: OrchestrationOptions = {}
): LensGateResult {
  // Use sync classification
  const classification = classifySync(message, {
    userTimezone: options.userTimezone,
    userLocation: options.userLocation,
  });
  
  // If no live data needed, passthrough
  if (!requiresLiveData(classification)) {
    return createPassthroughResult(
      classification,
      classification.entities ?? createEmptyEntities(),
      createDefaultConstraints('Sync passthrough - no live data needed')
    );
  }
  
  // Can't fetch data synchronously - return degraded
  const riskAssessment = assessRisk(classification);
  
  return {
    classification,
    retrieval: {
      status: 'skipped',
      categoryResults: new Map(),
      successfulData: [],
      failedCategories: [...classification.liveCategories],
      totalLatencyMs: 0,
    },
    constraints: createDegradedConstraints('Sync mode - proceeding with qualitative information only'),
    mode: 'degraded',
    forceHigh: riskAssessment.forceHigh,
    riskAssessment: {
      score: riskAssessment.riskScore,
      factors: [...riskAssessment.riskFactors],
      stakes: riskAssessment.stakes,
    },
    processingTimeMs: 0,
    correlationId: generateCorrelationId(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export {
  DEFAULT_PROVIDER_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  requiresLiveData,
  generateCorrelationId,
};
