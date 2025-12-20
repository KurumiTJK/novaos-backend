// ═══════════════════════════════════════════════════════════════════════════════
// EVIDENCE INJECTION — Inject Evidence into Model Prompt
// Phase 6: Evidence & Injection
// 
// This module builds the EvidencePack and injects evidence into the model prompt.
// The evidence is formatted as XML for clear delineation.
// 
// OUTPUT FORMAT:
// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ <live_data_evidence>                                                        │
// │ <system_instructions>                                                       │
// │ You may ONLY use numeric values from the provided live data below.          │
// │ Do not extrapolate, estimate, or fabricate any numbers.                     │
// │ </system_instructions>                                                      │
// │                                                                             │
// │ <data category="market" entity="AAPL" freshness="verified">                 │
// │ AAPL (NASDAQ):                                                              │
// │ - Current: $178.50 (+$2.30, +1.31%)                                         │
// │ - Day Range: $175.20 - $179.80                                              │
// │ </data>                                                                     │
// │                                                                             │
// │ <user_query>                                                                │
// │ What's Apple's stock price?                                                 │
// │ </user_query>                                                               │
// │ </live_data_evidence>                                                       │
// └─────────────────────────────────────────────────────────────────────────────┘
// ═══════════════════════════════════════════════════════════════════════════════

import type { LiveCategory } from '../../types/categories.js';
import type {
  ResponseConstraints,
  NumericTokenSet,
} from '../../types/constraints.js';
import type {
  EvidencePack,
  ContextItem,
  ContextSource,
} from '../../types/lens.js';
import type {
  ProviderResult,
  ProviderOkResult,
  ProviderData,
} from '../../types/provider-results.js';

import {
  formatProviderData,
  buildTokenSet,
  FormattedDataResult,
} from './numeric-tokens.js';

import {
  FailureSemantics,
  ConstraintLevel,
} from './failure-semantics.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Options for evidence injection.
 */
export interface EvidenceInjectionOptions {
  /** Include timestamps in evidence */
  readonly includeTimestamps?: boolean;
  
  /** Include provider attribution */
  readonly includeProviderAttribution?: boolean;
  
  /** Temperature unit for weather */
  readonly temperatureUnit?: 'C' | 'F' | 'both';
  
  /** Speed unit for weather */
  readonly speedUnit?: 'mph' | 'kph';
  
  /** Time format */
  readonly timeFormat?: '12h' | '24h';
  
  /** Custom system instructions to append */
  readonly customInstructions?: readonly string[];
}

/**
 * Result of building augmented message.
 */
export interface AugmentedMessageResult {
  /** The augmented message with evidence */
  readonly augmentedMessage: string;
  
  /** The evidence pack */
  readonly evidencePack: EvidencePack;
  
  /** System prompt additions */
  readonly systemPromptAdditions: readonly string[];
  
  /** Whether evidence is complete */
  readonly isComplete: boolean;
  
  /** Reason if incomplete */
  readonly incompleteReason?: string;
}

/**
 * Freshness status for evidence.
 */
export type FreshnessStatus = 'verified' | 'stale' | 'degraded' | 'unavailable';

// ─────────────────────────────────────────────────────────────────────────────────
// SYSTEM INSTRUCTIONS BY CONSTRAINT LEVEL
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * System instructions for quote_evidence_only mode.
 */
const QUOTE_EVIDENCE_INSTRUCTIONS = [
  'You may ONLY use numeric values from the provided live data below.',
  'Do not extrapolate, estimate, or fabricate any numbers.',
  'If asked about data not in the evidence, state that you cannot provide it.',
  'Do not provide financial advice or recommendations.',
] as const;

/**
 * System instructions for forbid_numeric_claims mode.
 */
const FORBID_NUMERIC_INSTRUCTIONS = [
  'IMPORTANT: Live data is unavailable for this query.',
  'Do NOT include any specific numbers, prices, rates, or percentages in your response.',
  'You may describe trends qualitatively (e.g., "generally higher") but not with numbers.',
  'Direct the user to authoritative sources for current data.',
] as const;

/**
 * System instructions for qualitative_only mode.
 */
const QUALITATIVE_INSTRUCTIONS = [
  'IMPORTANT: Live data is unavailable.',
  'Provide ONLY qualitative information - no specific numbers at all.',
  'You may discuss general concepts, historical context, or direct to sources.',
  'Do not estimate, guess, or use remembered values.',
] as const;

/**
 * System instructions for stale data.
 */
const STALE_DATA_INSTRUCTIONS = [
  'NOTE: The data below may be slightly outdated.',
  'Include a freshness warning in your response.',
  'Suggest the user verify with current sources for time-sensitive decisions.',
] as const;

/**
 * Get system instructions for constraint level.
 */
function getSystemInstructions(
  constraintLevel: ConstraintLevel,
  isStale: boolean = false
): readonly string[] {
  const base = (() => {
    switch (constraintLevel) {
      case 'quote_evidence_only':
        return QUOTE_EVIDENCE_INSTRUCTIONS;
      case 'forbid_numeric_claims':
        return FORBID_NUMERIC_INSTRUCTIONS;
      case 'qualitative_only':
        return QUALITATIVE_INSTRUCTIONS;
      case 'insufficient':
        return ['ERROR: Insufficient data to proceed.'];
      case 'permissive':
        return []; // No special instructions
      default:
        return FORBID_NUMERIC_INSTRUCTIONS; // Default to safe
    }
  })();
  
  if (isStale && constraintLevel === 'quote_evidence_only') {
    return [...STALE_DATA_INSTRUCTIONS, ...base];
  }
  
  return base;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONTEXT ITEM BUILDING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create a context item from provider result.
 */
function createContextItem(
  formattedResult: FormattedDataResult,
  providerResult: ProviderOkResult,
  id: string
): ContextItem {
  const isStale = Date.now() - providerResult.fetchedAt > providerResult.freshnessPolicy.maxAgeMs;
  
  return {
    id,
    source: 'provider' as ContextSource,
    content: formattedResult.text,
    category: formattedResult.category,
    relevance: 1.0, // Provider data is always highly relevant
    fetchedAt: providerResult.fetchedAt,
    isStale,
    stalenessWarning: isStale 
      ? `Data fetched ${formatAge(Date.now() - providerResult.fetchedAt)} ago`
      : undefined,
    citation: providerResult.provider,
    entity: formattedResult.entity,
  };
}

/**
 * Format age in human-readable form.
 */
function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// ─────────────────────────────────────────────────────────────────────────────────
// EVIDENCE PACK BUILDING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Build an EvidencePack from provider results.
 * 
 * @param providerResults - Map of category to provider result
 * @param constraints - Response constraints
 * @param options - Injection options
 * @returns Complete evidence pack
 */
export function buildEvidencePack(
  providerResults: ReadonlyMap<LiveCategory, ProviderResult>,
  constraints: ResponseConstraints,
  options: EvidenceInjectionOptions = {}
): EvidencePack {
  const contextItems: ContextItem[] = [];
  const allTokens: import('../../types/constraints.js').NumericToken[] = [];
  const freshnessWarnings: string[] = [];
  const requiredCitations: string[] = [];
  const textBlocks: string[] = [];
  
  let isComplete = true;
  let incompleteReason: string | undefined;
  
  // Process each provider result
  let itemIndex = 0;
  for (const [category, result] of providerResults) {
    if (!result.ok) {
      isComplete = false;
      incompleteReason = `Failed to retrieve ${category} data: ${result.error.message}`;
      continue;
    }
    
    // Format the data
    const formatted = formatProviderData(result.data, {
      fetchedAt: result.fetchedAt,
      includeOptional: true,
      temperatureUnit: options.temperatureUnit,
      speedUnit: options.speedUnit,
      timeFormat: options.timeFormat,
    });
    
    // Create context item
    const contextItem = createContextItem(formatted, result, `ctx_${itemIndex++}`);
    contextItems.push(contextItem);
    
    // Collect tokens
    allTokens.push(...formatted.tokens);
    
    // Collect text for formatted context
    textBlocks.push(formatted.text);
    
    // Collect citations
    requiredCitations.push(result.provider);
    
    // Check freshness
    if (contextItem.isStale && contextItem.stalenessWarning) {
      freshnessWarnings.push(contextItem.stalenessWarning);
    }
  }
  
  // Build token set
  const numericTokens = buildTokenSet(allTokens);
  
  // Build formatted context
  const formattedContext = textBlocks.join('\n\n');
  
  // Get system instructions
  const isStale = freshnessWarnings.length > 0;
  const systemInstructions = getSystemInstructions(
    constraints.level === 'strict' && constraints.numericPrecisionAllowed
      ? 'quote_evidence_only'
      : constraints.level === 'strict'
        ? 'forbid_numeric_claims'
        : 'permissive',
    isStale
  );
  
  // Add custom instructions
  const systemPromptAdditions = [
    ...systemInstructions,
    ...(options.customInstructions ?? []),
  ];
  
  return {
    contextItems,
    numericTokens,
    constraints,
    formattedContext,
    systemPromptAdditions,
    requiredCitations: [...new Set(requiredCitations)], // Dedupe
    freshnessWarnings,
    isComplete,
    incompleteReason,
  };
}

/**
 * Build evidence pack from a single provider result.
 */
export function buildSingleEvidencePack(
  providerResult: ProviderOkResult,
  category: LiveCategory,
  constraints: ResponseConstraints,
  options: EvidenceInjectionOptions = {}
): EvidencePack {
  const resultMap = new Map<LiveCategory, ProviderResult>();
  resultMap.set(category, providerResult);
  return buildEvidencePack(resultMap, constraints, options);
}

// ─────────────────────────────────────────────────────────────────────────────────
// XML INJECTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Build XML evidence block for injection.
 * 
 * @param evidencePack - Evidence pack to inject
 * @param userQuery - Original user query
 * @param options - Injection options
 * @returns XML string
 */
export function buildEvidenceXml(
  evidencePack: EvidencePack,
  userQuery: string,
  options: EvidenceInjectionOptions = {}
): string {
  const lines: string[] = [];
  
  lines.push('<live_data_evidence>');
  
  // System instructions
  if (evidencePack.systemPromptAdditions.length > 0) {
    lines.push('<system_instructions>');
    for (const instruction of evidencePack.systemPromptAdditions) {
      lines.push(instruction);
    }
    lines.push('</system_instructions>');
    lines.push('');
  }
  
  // Data blocks
  for (const item of evidencePack.contextItems) {
    const freshness = getFreshnessStatus(item);
    const attrs = buildDataAttributes(item, freshness, options);
    
    lines.push(`<data ${attrs}>`);
    lines.push(item.content);
    lines.push('</data>');
    lines.push('');
  }
  
  // Freshness warnings
  if (evidencePack.freshnessWarnings.length > 0) {
    lines.push('<freshness_warnings>');
    for (const warning of evidencePack.freshnessWarnings) {
      lines.push(`- ${warning}`);
    }
    lines.push('</freshness_warnings>');
    lines.push('');
  }
  
  // User query
  lines.push('<user_query>');
  lines.push(escapeXml(userQuery));
  lines.push('</user_query>');
  
  lines.push('</live_data_evidence>');
  
  return lines.join('\n');
}

/**
 * Get freshness status for a context item.
 */
function getFreshnessStatus(item: ContextItem): FreshnessStatus {
  if (item.isStale) {
    return 'stale';
  }
  return 'verified';
}

/**
 * Build XML attributes for data element.
 */
function buildDataAttributes(
  item: ContextItem,
  freshness: FreshnessStatus,
  options: EvidenceInjectionOptions
): string {
  const attrs: string[] = [];
  
  attrs.push(`category="${item.category}"`);
  
  if (item.entity) {
    attrs.push(`entity="${escapeXml(item.entity)}"`);
  }
  
  attrs.push(`freshness="${freshness}"`);
  
  if (options.includeTimestamps) {
    attrs.push(`fetched_at="${new Date(item.fetchedAt).toISOString()}"`);
  }
  
  if (options.includeProviderAttribution && item.citation) {
    attrs.push(`provider="${escapeXml(item.citation)}"`);
  }
  
  return attrs.join(' ');
}

/**
 * Escape XML special characters.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─────────────────────────────────────────────────────────────────────────────────
// MAIN INJECTION FUNCTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Inject evidence into the user message.
 * 
 * This replaces the original user message with an augmented version
 * containing the evidence block.
 * 
 * @param originalMessage - Original user query
 * @param evidencePack - Evidence pack to inject
 * @param options - Injection options
 * @returns Augmented message string
 */
export function injectEvidence(
  originalMessage: string,
  evidencePack: EvidencePack,
  options: EvidenceInjectionOptions = {}
): string {
  return buildEvidenceXml(evidencePack, originalMessage, options);
}

/**
 * Build complete augmented message with evidence.
 * 
 * This is the main entry point for evidence injection.
 * 
 * @param originalMessage - Original user query
 * @param providerResults - Provider results by category
 * @param constraints - Response constraints
 * @param options - Injection options
 * @returns Complete augmented message result
 */
export function buildAugmentedMessage(
  originalMessage: string,
  providerResults: ReadonlyMap<LiveCategory, ProviderResult>,
  constraints: ResponseConstraints,
  options: EvidenceInjectionOptions = {}
): AugmentedMessageResult {
  // Build evidence pack
  const evidencePack = buildEvidencePack(providerResults, constraints, options);
  
  // Inject into message
  const augmentedMessage = injectEvidence(originalMessage, evidencePack, options);
  
  return {
    augmentedMessage,
    evidencePack,
    systemPromptAdditions: evidencePack.systemPromptAdditions,
    isComplete: evidencePack.isComplete,
    incompleteReason: evidencePack.incompleteReason,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// DEGRADED MODE MESSAGE BUILDING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Build message for degraded mode (no live data available).
 * 
 * @param originalMessage - Original user query
 * @param category - Category that failed
 * @param reason - Reason for degradation
 * @returns Degraded mode message
 */
export function buildDegradedMessage(
  originalMessage: string,
  category: LiveCategory,
  reason: string
): string {
  const lines: string[] = [];
  
  lines.push('<live_data_evidence>');
  lines.push('<system_instructions>');
  lines.push(...FORBID_NUMERIC_INSTRUCTIONS);
  lines.push('</system_instructions>');
  lines.push('');
  lines.push('<data_unavailable>');
  lines.push(`Category: ${category}`);
  lines.push(`Reason: ${reason}`);
  lines.push('</data_unavailable>');
  lines.push('');
  lines.push('<user_query>');
  lines.push(escapeXml(originalMessage));
  lines.push('</user_query>');
  lines.push('</live_data_evidence>');
  
  return lines.join('\n');
}

/**
 * Build message for qualitative mode.
 * 
 * @param originalMessage - Original user query
 * @param category - Category
 * @param reason - Reason for qualitative mode
 * @returns Qualitative mode message
 */
export function buildQualitativeMessage(
  originalMessage: string,
  category: LiveCategory,
  reason: string
): string {
  const lines: string[] = [];
  
  lines.push('<live_data_evidence>');
  lines.push('<system_instructions>');
  lines.push(...QUALITATIVE_INSTRUCTIONS);
  lines.push('</system_instructions>');
  lines.push('');
  lines.push('<context>');
  lines.push(`This is a ${category} query but live data is unavailable.`);
  lines.push(`Reason: ${reason}`);
  lines.push('Provide qualitative information only.');
  lines.push('</context>');
  lines.push('');
  lines.push('<user_query>');
  lines.push(escapeXml(originalMessage));
  lines.push('</user_query>');
  lines.push('</live_data_evidence>');
  
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────────
// PARTIAL DATA HANDLING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Build message with partial data (some providers succeeded, some failed).
 * 
 * @param originalMessage - Original user query
 * @param successfulResults - Successful provider results
 * @param failedCategories - Categories that failed
 * @param constraints - Response constraints
 * @param options - Injection options
 * @returns Partial data message result
 */
export function buildPartialDataMessage(
  originalMessage: string,
  successfulResults: ReadonlyMap<LiveCategory, ProviderOkResult>,
  failedCategories: readonly LiveCategory[],
  constraints: ResponseConstraints,
  options: EvidenceInjectionOptions = {}
): AugmentedMessageResult {
  // Build evidence from successful results
  const providerResults = new Map<LiveCategory, ProviderResult>();
  for (const [category, result] of successfulResults) {
    providerResults.set(category, result);
  }
  
  const evidencePack = buildEvidencePack(providerResults, constraints, options);
  
  // Add failed categories to warnings
  const failedWarnings = failedCategories.map(
    cat => `${cat} data unavailable`
  );
  
  // Build XML with partial data indicator
  const lines: string[] = [];
  
  lines.push('<live_data_evidence>');
  lines.push('<system_instructions>');
  
  for (const instruction of evidencePack.systemPromptAdditions) {
    lines.push(instruction);
  }
  
  if (failedCategories.length > 0) {
    lines.push('');
    lines.push('NOTE: Some requested data is unavailable:');
    for (const cat of failedCategories) {
      lines.push(`- ${cat}: data could not be retrieved`);
    }
    lines.push('Only use numbers from the available data below.');
  }
  
  lines.push('</system_instructions>');
  lines.push('');
  
  // Add available data
  for (const item of evidencePack.contextItems) {
    const freshness = getFreshnessStatus(item);
    const attrs = buildDataAttributes(item, freshness, options);
    
    lines.push(`<data ${attrs}>`);
    lines.push(item.content);
    lines.push('</data>');
    lines.push('');
  }
  
  // Add unavailable categories
  if (failedCategories.length > 0) {
    lines.push('<unavailable_data>');
    for (const cat of failedCategories) {
      lines.push(`<category name="${cat}" status="failed" />`);
    }
    lines.push('</unavailable_data>');
    lines.push('');
  }
  
  lines.push('<user_query>');
  lines.push(escapeXml(originalMessage));
  lines.push('</user_query>');
  lines.push('</live_data_evidence>');
  
  const augmentedMessage = lines.join('\n');
  
  return {
    augmentedMessage,
    evidencePack: {
      ...evidencePack,
      freshnessWarnings: [...evidencePack.freshnessWarnings, ...failedWarnings],
      isComplete: false,
      incompleteReason: `Failed categories: ${failedCategories.join(', ')}`,
    },
    systemPromptAdditions: evidencePack.systemPromptAdditions,
    isComplete: false,
    incompleteReason: `Failed categories: ${failedCategories.join(', ')}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Validate evidence injection result.
 */
export function validateInjection(result: AugmentedMessageResult): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  // Must have augmented message
  if (!result.augmentedMessage) {
    errors.push('Missing augmented message');
  }
  
  // Must have evidence pack
  if (!result.evidencePack) {
    errors.push('Missing evidence pack');
  }
  
  // If complete, should have context items
  if (result.isComplete && result.evidencePack.contextItems.length === 0) {
    errors.push('Complete evidence should have context items');
  }
  
  // XML should be well-formed (basic check)
  if (result.augmentedMessage) {
    if (!result.augmentedMessage.includes('<live_data_evidence>')) {
      errors.push('Missing opening live_data_evidence tag');
    }
    if (!result.augmentedMessage.includes('</live_data_evidence>')) {
      errors.push('Missing closing live_data_evidence tag');
    }
    if (!result.augmentedMessage.includes('<user_query>')) {
      errors.push('Missing user_query tag');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export {
  QUOTE_EVIDENCE_INSTRUCTIONS,
  FORBID_NUMERIC_INSTRUCTIONS,
  QUALITATIVE_INSTRUCTIONS,
  STALE_DATA_INSTRUCTIONS,
  getSystemInstructions,
};
