// ═══════════════════════════════════════════════════════════════════════════════
// LLM ASSIST — LLM-Powered Classification for Ambiguous Cases
// Phase 7: Lens Gate
// 
// This module provides LLM-powered classification when pattern matching
// has low confidence or fails to match. Uses GPT-4o-mini for semantic
// understanding of data needs.
// 
// DESIGN PRINCIPLES:
// 1. LLM is fallback, not default (patterns are faster and deterministic)
// 2. Fail-open: if LLM fails, use conservative pattern-based fallback
// 3. Structured output parsing with validation
// 4. Timeout handling to prevent blocking
// ═══════════════════════════════════════════════════════════════════════════════

import OpenAI from 'openai';
import type { LiveCategory, AuthoritativeCategory, DataCategory } from '../../../types/categories.js';
import type { TruthMode } from '../../../types/data-need.js';
import { isLiveCategory, isAuthoritativeCategory } from '../../../types/categories.js';
import { isTruthMode } from '../../../types/data-need.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Result of LLM-assisted classification.
 */
export interface LLMClassificationResult {
  /** Determined truth mode */
  readonly truthMode: TruthMode;
  
  /** Primary data category */
  readonly primaryCategory: DataCategory;
  
  /** All detected live categories */
  readonly liveCategories: readonly LiveCategory[];
  
  /** All detected authoritative categories */
  readonly authoritativeCategories: readonly AuthoritativeCategory[];
  
  /** Extracted entities with their categories */
  readonly entities: readonly LLMExtractedEntity[];
  
  /** Confidence score (0-1) */
  readonly confidence: number;
  
  /** Reasoning for the classification */
  readonly reasoning: string;
  
  /** Whether freshness is critical for this query */
  readonly freshnessCritical: boolean;
  
  /** Whether numeric precision is required */
  readonly requiresNumericPrecision: boolean;
  
  /** Whether this was a fallback result */
  readonly isFallback: boolean;
}

/**
 * Entity extracted by LLM.
 */
export interface LLMExtractedEntity {
  readonly text: string;
  readonly category: LiveCategory | 'general';
  readonly canonicalForm?: string;
}

/**
 * Raw LLM response structure.
 */
interface LLMRawResponse {
  truthMode: string;
  primaryCategory: string;
  liveCategories: string[];
  authoritativeCategories: string[];
  entities: Array<{
    text: string;
    category: string;
    canonicalForm?: string;
  }>;
  confidence: number;
  reasoning: string;
  freshnessCritical: boolean;
  requiresNumericPrecision: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────
// OPENAI CLIENT SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let openaiClient: OpenAI | null = null;

/**
 * Get or create OpenAI client singleton.
 */
function getOpenAIClient(): OpenAI | null {
  if (!openaiClient && process.env.OPENAI_API_KEY) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

/**
 * Check if OpenAI client is available.
 */
export function isLLMAvailable(): boolean {
  return getOpenAIClient() !== null;
}

// ─────────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────────────────────

const DATA_NEED_CLASSIFIER_PROMPT = `You are a data need classifier for a constitutional AI system. Your job is to determine what kind of data source is needed to answer a user's question correctly.

Return JSON only, no markdown, no code blocks:

{
  "truthMode": "local|live_feed|authoritative_verify|web_research|mixed",
  "primaryCategory": "market|crypto|fx|weather|time|legal|medical|government|academic|general",
  "liveCategories": [],
  "authoritativeCategories": [],
  "entities": [{"text": "...", "category": "...", "canonicalForm": "..."}],
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation",
  "freshnessCritical": boolean,
  "requiresNumericPrecision": boolean
}

═══════════════════════════════════════════════════════════════
TRUTH MODES
═══════════════════════════════════════════════════════════════

local → Answer from model knowledge, no external data needed
- Creative writing, brainstorming, coding help
- Timeless concepts, math, logic
- Personal advice, opinions
- Historical facts (pre-2020)

live_feed → Fetch from real-time provider APIs
- Stock prices, crypto prices, FX rates
- Current weather conditions
- Current time in a timezone
- ANY query asking for current numeric data

authoritative_verify → Verify against authoritative sources
- Legal questions, regulations
- Medical/drug information
- Government policies, officials
- Scientific claims requiring verification

web_research → General web search for current info
- Recent news, events
- Current status of companies/people
- Product information, releases
- Anything that changes but isn't real-time data

mixed → Combination of sources needed
- Comparing live data with historical
- Questions spanning multiple domains
- Complex queries needing both live and web

═══════════════════════════════════════════════════════════════
LIVE CATEGORIES (require provider APIs)
═══════════════════════════════════════════════════════════════

market → Stock prices, indices, equity data
- Tickers: AAPL, MSFT, GOOGL, etc.
- "What's Apple stock at?"
- "S&P 500 today"

crypto → Cryptocurrency prices
- BTC, ETH, SOL, etc.
- "Bitcoin price"
- "How much is Ethereum?"

fx → Foreign exchange rates
- USD/EUR, GBP/JPY, etc.
- "Dollar to euro rate"
- "Convert 100 USD to GBP"

weather → Weather conditions
- Temperature, humidity, conditions
- "Weather in New York"
- "Is it raining in London?"

time → Current time/timezone
- "What time is it in Tokyo?"
- "Current time EST"
- CRITICAL: Time has NO fallback - must be accurate

═══════════════════════════════════════════════════════════════
AUTHORITATIVE CATEGORIES (require verified sources)
═══════════════════════════════════════════════════════════════

legal → Laws, regulations, legal questions
- "Is it legal to..."
- "What does the law say about..."

medical → Health, drugs, treatments
- Drug interactions (CRITICAL - safety)
- Dosages, side effects
- Medical conditions

government → Government info, officials
- "Who is the president of..."
- Tax rates, policies

academic → Scientific, research
- "According to research..."
- Scientific consensus

═══════════════════════════════════════════════════════════════
ENTITY EXTRACTION
═══════════════════════════════════════════════════════════════

Extract entities relevant to the data need:
- Stock tickers: "AAPL", "MSFT" (canonicalForm: uppercase ticker)
- Crypto: "Bitcoin" → canonicalForm: "BTC"
- Currency pairs: "dollar to euro" → canonicalForm: "USD/EUR"
- Locations: "New York" → canonicalForm: "New York, NY"
- Timezones: "Tokyo" → canonicalForm: "Asia/Tokyo"

═══════════════════════════════════════════════════════════════
EXAMPLES
═══════════════════════════════════════════════════════════════

"What's AAPL trading at?"
{"truthMode":"live_feed","primaryCategory":"market","liveCategories":["market"],"authoritativeCategories":[],"entities":[{"text":"AAPL","category":"market","canonicalForm":"AAPL"}],"confidence":0.98,"reasoning":"Stock price query for specific ticker","freshnessCritical":true,"requiresNumericPrecision":true}

"What time is it in London?"
{"truthMode":"live_feed","primaryCategory":"time","liveCategories":["time"],"authoritativeCategories":[],"entities":[{"text":"London","category":"time","canonicalForm":"Europe/London"}],"confidence":0.98,"reasoning":"Current time query for specific timezone","freshnessCritical":true,"requiresNumericPrecision":true}

"Is it safe to take ibuprofen with aspirin?"
{"truthMode":"authoritative_verify","primaryCategory":"medical","liveCategories":[],"authoritativeCategories":["medical"],"entities":[{"text":"ibuprofen","category":"general"},{"text":"aspirin","category":"general"}],"confidence":0.95,"reasoning":"Drug interaction safety question","freshnessCritical":false,"requiresNumericPrecision":false}

"Write a poem about the ocean"
{"truthMode":"local","primaryCategory":"general","liveCategories":[],"authoritativeCategories":[],"entities":[],"confidence":0.99,"reasoning":"Creative writing task - no external data needed","freshnessCritical":false,"requiresNumericPrecision":false}

"What's the weather like in Paris and how much is EUR/USD?"
{"truthMode":"mixed","primaryCategory":"weather","liveCategories":["weather","fx"],"authoritativeCategories":[],"entities":[{"text":"Paris","category":"weather","canonicalForm":"Paris, France"},{"text":"EUR/USD","category":"fx","canonicalForm":"EUR/USD"}],"confidence":0.95,"reasoning":"Multiple live data categories needed","freshnessCritical":true,"requiresNumericPrecision":true}

"How much is 100 dollars in euros?"
{"truthMode":"live_feed","primaryCategory":"fx","liveCategories":["fx"],"authoritativeCategories":[],"entities":[{"text":"dollars to euros","category":"fx","canonicalForm":"USD/EUR"}],"confidence":0.95,"reasoning":"Currency conversion requires current FX rate","freshnessCritical":true,"requiresNumericPrecision":true}

"Who is the current CEO of Apple?"
{"truthMode":"web_research","primaryCategory":"general","liveCategories":[],"authoritativeCategories":[],"entities":[{"text":"Apple","category":"general","canonicalForm":"Apple Inc."}],"confidence":0.85,"reasoning":"Current corporate leadership - web search needed","freshnessCritical":false,"requiresNumericPrecision":false}

═══════════════════════════════════════════════════════════════
CRITICAL RULES
═══════════════════════════════════════════════════════════════

1. TIME CATEGORY ALWAYS REQUIRES live_feed - there is NO qualitative answer to "what time is it"
2. Stock/crypto/FX prices ALWAYS require live_feed - never guess numbers
3. Drug interactions ALWAYS require authoritative_verify - safety critical
4. freshnessCritical=true for ANY query where stale data would be harmful
5. requiresNumericPrecision=true if the answer needs specific numbers

═══════════════════════════════════════════════════════════════
Now classify the following message. Return only valid JSON:
═══════════════════════════════════════════════════════════════`;

// ─────────────────────────────────────────────────────────────────────────────────
// LLM CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Default timeout for LLM requests in milliseconds.
 */
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Classify a message using LLM.
 * 
 * @param message - The user message to classify
 * @param timeoutMs - Timeout in milliseconds (default: 5000)
 * @returns LLM classification result
 */
export async function classifyWithLLM(
  message: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<LLMClassificationResult> {
  const client = getOpenAIClient();
  
  if (!client) {
    console.warn('[LLM-ASSIST] OpenAI client not available - using fallback');
    return createFallbackResult(message, 'OpenAI client not available');
  }
  
  try {
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: DATA_NEED_CLASSIFIER_PROMPT },
        { role: 'user', content: message },
      ],
      max_tokens: 400,
      temperature: 0, // Deterministic classification
    }, {
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    const content = response.choices[0]?.message?.content?.trim() ?? '';
    return parseAndValidateResponse(content, message);
    
  } catch (error) {
    // Handle timeout
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn('[LLM-ASSIST] Request timed out');
      return createFallbackResult(message, 'Request timed out');
    }
    
    console.error('[LLM-ASSIST] Classification error:', error);
    return createFallbackResult(message, 'Classification error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// RESPONSE PARSING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Parse and validate LLM response.
 */
function parseAndValidateResponse(
  content: string,
  originalMessage: string
): LLMClassificationResult {
  try {
    // Strip markdown code blocks if present
    let jsonStr = content;
    if (content.includes('```')) {
      const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      jsonStr = match?.[1]?.trim() ?? content;
    }
    
    const parsed: LLMRawResponse = JSON.parse(jsonStr.trim());
    
    // Validate and normalize
    return normalizeResponse(parsed);
    
  } catch (error) {
    console.warn('[LLM-ASSIST] Failed to parse response:', content);
    return createFallbackResult(originalMessage, 'Parse error');
  }
}

/**
 * Normalize and validate parsed response.
 */
function normalizeResponse(raw: LLMRawResponse): LLMClassificationResult {
  // Normalize truth mode
  const truthMode = normalizeTruthMode(raw.truthMode);
  
  // Normalize categories
  const liveCategories = normalizeLiveCategories(raw.liveCategories);
  const authoritativeCategories = normalizeAuthoritativeCategories(raw.authoritativeCategories);
  
  // Determine primary category
  const primaryCategory = normalizePrimaryCategory(
    raw.primaryCategory,
    liveCategories,
    authoritativeCategories
  );
  
  // Normalize entities
  const entities = normalizeEntities(raw.entities, liveCategories);
  
  // Normalize confidence
  const confidence = normalizeConfidence(raw.confidence);
  
  // Validate consistency
  const validated = validateConsistency({
    truthMode,
    primaryCategory,
    liveCategories,
    authoritativeCategories,
    entities,
    confidence,
    reasoning: String(raw.reasoning || 'LLM classification'),
    freshnessCritical: Boolean(raw.freshnessCritical),
    requiresNumericPrecision: Boolean(raw.requiresNumericPrecision),
    isFallback: false,
  });
  
  return validated;
}

// ─────────────────────────────────────────────────────────────────────────────────
// NORMALIZATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Normalize truth mode string to valid TruthMode.
 */
function normalizeTruthMode(mode: unknown): TruthMode {
  const str = String(mode).toLowerCase().trim();
  
  const modeMap: Record<string, TruthMode> = {
    'local': 'local',
    'live_feed': 'live_feed',
    'livefeed': 'live_feed',
    'live': 'live_feed',
    'authoritative_verify': 'authoritative_verify',
    'authoritative': 'authoritative_verify',
    'verify': 'authoritative_verify',
    'web_research': 'web_research',
    'web': 'web_research',
    'research': 'web_research',
    'mixed': 'mixed',
  };
  
  return modeMap[str] ?? 'local';
}

/**
 * Normalize live categories array.
 */
function normalizeLiveCategories(categories: unknown): LiveCategory[] {
  if (!Array.isArray(categories)) return [];
  
  return categories
    .map(c => String(c).toLowerCase().trim())
    .filter(isLiveCategory) as LiveCategory[];
}

/**
 * Normalize authoritative categories array.
 */
function normalizeAuthoritativeCategories(categories: unknown): AuthoritativeCategory[] {
  if (!Array.isArray(categories)) return [];
  
  return categories
    .map(c => String(c).toLowerCase().trim())
    .filter(isAuthoritativeCategory) as AuthoritativeCategory[];
}

/**
 * Normalize primary category.
 */
function normalizePrimaryCategory(
  category: unknown,
  liveCategories: readonly LiveCategory[],
  authoritativeCategories: readonly AuthoritativeCategory[]
): DataCategory {
  const str = String(category).toLowerCase().trim();
  
  // Check if it's a valid live category
  if (isLiveCategory(str)) return str;
  
  // Check if it's a valid authoritative category
  if (isAuthoritativeCategory(str)) return str;
  
  // Default to first live or authoritative category if available
  if (liveCategories.length > 0) return liveCategories[0]!;
  if (authoritativeCategories.length > 0) return authoritativeCategories[0]!;
  
  return 'general';
}

/**
 * Normalize entities.
 */
function normalizeEntities(
  entities: unknown,
  liveCategories: readonly LiveCategory[]
): LLMExtractedEntity[] {
  if (!Array.isArray(entities)) return [];
  
  return entities
    .filter((e): e is { text: string; category?: string; canonicalForm?: string } => 
      typeof e === 'object' && e !== null && typeof (e as any).text === 'string'
    )
    .map(e => {
      const category = String(e.category || 'general').toLowerCase();
      return {
        text: e.text,
        category: isLiveCategory(category) ? category : 'general',
        canonicalForm: e.canonicalForm,
      };
    });
}

/**
 * Normalize confidence score.
 */
function normalizeConfidence(confidence: unknown): number {
  const num = Number(confidence);
  if (isNaN(num)) return 0.5;
  return Math.max(0, Math.min(1, num));
}

/**
 * Validate consistency of classification result.
 */
function validateConsistency(result: LLMClassificationResult): LLMClassificationResult {
  let { truthMode, liveCategories, freshnessCritical, requiresNumericPrecision } = result;
  
  // RULE: If live categories present, truthMode should be live_feed or mixed
  if (liveCategories.length > 0 && truthMode === 'local') {
    truthMode = liveCategories.length > 1 ? 'mixed' : 'live_feed';
  }
  
  // RULE: Time category → freshnessCritical = true
  if (liveCategories.includes('time')) {
    freshnessCritical = true;
    requiresNumericPrecision = true;
  }
  
  // RULE: Market/crypto/fx → requiresNumericPrecision = true
  if (liveCategories.some(c => ['market', 'crypto', 'fx'].includes(c))) {
    requiresNumericPrecision = true;
    freshnessCritical = true;
  }
  
  // RULE: Weather → freshnessCritical = true (but can have qualitative fallback)
  if (liveCategories.includes('weather')) {
    freshnessCritical = true;
  }
  
  return {
    ...result,
    truthMode,
    freshnessCritical,
    requiresNumericPrecision,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// FALLBACK CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create a fallback result when LLM is unavailable or fails.
 * Uses conservative classification to avoid false positives.
 */
function createFallbackResult(
  message: string,
  reason: string
): LLMClassificationResult {
  const lower = message.toLowerCase();
  
  // Check for time patterns (critical - no fallback allowed)
  if (/\b(?:what\s+time|current\s+time|time\s+in|time\s+now)\b/i.test(message)) {
    return {
      truthMode: 'live_feed',
      primaryCategory: 'time',
      liveCategories: ['time'],
      authoritativeCategories: [],
      entities: [],
      confidence: 0.7,
      reasoning: `Fallback: Time query detected (${reason})`,
      freshnessCritical: true,
      requiresNumericPrecision: true,
      isFallback: true,
    };
  }
  
  // Check for price/trading patterns (live feed)
  if (/\b(?:stock|price|trading|worth|crypto|bitcoin|ethereum|forex|exchange\s+rate)\b/i.test(message)) {
    return {
      truthMode: 'live_feed',
      primaryCategory: 'general',
      liveCategories: [],
      authoritativeCategories: [],
      entities: [],
      confidence: 0.6,
      reasoning: `Fallback: Price/trading query detected (${reason})`,
      freshnessCritical: true,
      requiresNumericPrecision: true,
      isFallback: true,
    };
  }
  
  // Check for medical patterns (authoritative)
  if (/\b(?:safe\s+to\s+take|drug\s+interaction|medication|dosage|side\s+effect)\b/i.test(message)) {
    return {
      truthMode: 'authoritative_verify',
      primaryCategory: 'medical',
      liveCategories: [],
      authoritativeCategories: ['medical'],
      entities: [],
      confidence: 0.7,
      reasoning: `Fallback: Medical query detected (${reason})`,
      freshnessCritical: false,
      requiresNumericPrecision: false,
      isFallback: true,
    };
  }
  
  // Check for legal patterns (authoritative)
  if (/\b(?:is\s+it\s+legal|can\s+I\s+legally|law|regulation|court)\b/i.test(message)) {
    return {
      truthMode: 'authoritative_verify',
      primaryCategory: 'legal',
      liveCategories: [],
      authoritativeCategories: ['legal'],
      entities: [],
      confidence: 0.7,
      reasoning: `Fallback: Legal query detected (${reason})`,
      freshnessCritical: false,
      requiresNumericPrecision: false,
      isFallback: true,
    };
  }
  
  // Check for weather patterns
  if (/\b(?:weather|temperature|forecast|raining|sunny)\b/i.test(message)) {
    return {
      truthMode: 'live_feed',
      primaryCategory: 'weather',
      liveCategories: ['weather'],
      authoritativeCategories: [],
      entities: [],
      confidence: 0.7,
      reasoning: `Fallback: Weather query detected (${reason})`,
      freshnessCritical: true,
      requiresNumericPrecision: true,
      isFallback: true,
    };
  }
  
  // Default: local (conservative - don't claim live data when unsure)
  return {
    truthMode: 'local',
    primaryCategory: 'general',
    liveCategories: [],
    authoritativeCategories: [],
    entities: [],
    confidence: 0.5,
    reasoning: `Fallback: No specific category detected (${reason})`,
    freshnessCritical: false,
    requiresNumericPrecision: false,
    isFallback: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Check if result indicates live data is needed.
 */
export function requiresLiveData(result: LLMClassificationResult): boolean {
  return result.truthMode === 'live_feed' || 
         result.truthMode === 'mixed' ||
         result.liveCategories.length > 0;
}

/**
 * Check if result indicates authoritative verification is needed.
 */
export function requiresAuthoritative(result: LLMClassificationResult): boolean {
  return result.truthMode === 'authoritative_verify' ||
         result.truthMode === 'mixed' ||
         result.authoritativeCategories.length > 0;
}

/**
 * Check if result is high confidence.
 */
export function isHighConfidence(result: LLMClassificationResult): boolean {
  return result.confidence >= 0.85 && !result.isFallback;
}

/**
 * Merge pattern result with LLM result, preferring higher confidence.
 */
export function mergeWithPatternResult(
  llmResult: LLMClassificationResult,
  patternEntities: readonly string[],
  patternCategory: DataCategory | null,
  patternConfidence: number
): LLMClassificationResult {
  // If pattern has higher confidence for entities, use those
  if (patternConfidence > llmResult.confidence && patternEntities.length > 0) {
    const category = patternCategory ?? llmResult.primaryCategory;
    const isLive = isLiveCategory(category);
    
    return {
      ...llmResult,
      entities: patternEntities.map(text => ({
        text,
        category: isLive ? (category as LiveCategory) : 'general',
        canonicalForm: text,
      })),
      confidence: Math.max(llmResult.confidence, patternConfidence * 0.9),
    };
  }
  
  return llmResult;
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export {
  createFallbackResult,
  normalizeConfidence,
  normalizeTruthMode,
  DEFAULT_TIMEOUT_MS,
};
