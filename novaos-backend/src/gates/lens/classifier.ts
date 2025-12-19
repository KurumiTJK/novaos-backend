// ═══════════════════════════════════════════════════════════════════════════════
// LENS CLASSIFIER — LLM-Powered Epistemic Risk Assessment
// Uses gpt-4o-mini to determine if external verification is needed
// ═══════════════════════════════════════════════════════════════════════════════

import OpenAI from 'openai';
import type { LensClassification, RiskFactor } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// OPENAI CLIENT SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI | null {
  if (!openaiClient && process.env.OPENAI_API_KEY) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

// ─────────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────────────────────

const LENS_CLASSIFIER_SYSTEM_PROMPT = `You are an epistemic risk assessor. Determine whether external verification would help answer a question, and how risky it would be to answer without checking.

Return JSON only, no markdown, no code blocks:

{
  "webHelpful": boolean,
  "riskScore": 0.0-1.0,
  "riskFactors": [],
  "reasoning": "brief explanation",
  "searchQuery": "optimized search query if webHelpful=true",
  "forceHigh": boolean,
  "hasRecencyRequest": boolean,
  "isEvolvingDomain": boolean,
  "isTimelessTopic": boolean
}

═══════════════════════════════════════════════════════════════
DECISION 1: webHelpful
═══════════════════════════════════════════════════════════════

Would looking something up MATERIALLY improve correctness?

webHelpful = FALSE for:
- Pure writing/creative tasks
- Personal advice, recommendations
- Reasoning, logic, analysis
- Code/programming (unless about specific current APIs/docs)
- Brainstorming, ideation
- Opinions, preferences
- Hypotheticals, thought experiments
- Math, calculations
- Explanations of timeless concepts

webHelpful = TRUE for:
- Factual claims about the world
- Current events, news, prices, scores
- Specific people, places, organizations
- "Who is X", "What happened to Y"
- Statistics, exact numbers, dates
- Anything that could be outdated
- Niche/obscure proper nouns
- Recent releases, announcements
- ANY question with recency indicators (2024, 2025, "latest", "current")

═══════════════════════════════════════════════════════════════
DECISION 2: riskScore (only meaningful if webHelpful=true)
═══════════════════════════════════════════════════════════════

How likely am I to be WRONG or OUTDATED if I don't verify?

HIGH RISK (0.7-1.0):
- Post-cutoff events (2024+, recent events)
- Exact numbers that change (prices, stats, scores)
- Obscure entities (small companies, indie creators)
- Volatile data (stocks, crypto, weather, politics)
- High stakes (financial, health, legal decisions)

MEDIUM RISK (0.3-0.7):
- Moderately known entities
- Facts that change slowly
- Claims with some uncertainty

LOW RISK (0.0-0.3):
- Well-known, stable facts
- Historical events (pre-2020)
- Major entities (Fortune 500, A-list celebrities)
- Scientific principles

═══════════════════════════════════════════════════════════════
forceHigh FLAGS
═══════════════════════════════════════════════════════════════

Set forceHigh=true when:
- Domain is health, legal, financial, safety
- Decision pressure detected ("should I", "is it safe", "can I")
- Breaking news or live events
- Time-sensitive claim ("today", "just now", "breaking")
- Volatile data that could cause harm if wrong

═══════════════════════════════════════════════════════════════
SEARCH QUERY GENERATION
═══════════════════════════════════════════════════════════════

When webHelpful=true, generate an OPTIMIZED search query:
- Extract proper nouns and key entities
- Remove filler words
- Add context if ambiguous
- Add year if asking about current state

BAD: "Can you tell me what the current stock price of Apple is?"
GOOD: "AAPL stock price"

BAD: "I was wondering who is the president of the United States"
GOOD: "US president 2024"

═══════════════════════════════════════════════════════════════
EXAMPLES
═══════════════════════════════════════════════════════════════

"Write a poem about loss"
{"webHelpful":false,"riskScore":0,"riskFactors":[],"reasoning":"Pure creative task","forceHigh":false,"hasRecencyRequest":false,"isEvolvingDomain":false,"isTimelessTopic":true}

"How does photosynthesis work?"
{"webHelpful":false,"riskScore":0,"riskFactors":[],"reasoning":"Timeless scientific concept","forceHigh":false,"hasRecencyRequest":false,"isEvolvingDomain":false,"isTimelessTopic":true}

"Who is the CEO of Apple?"
{"webHelpful":true,"riskScore":0.3,"riskFactors":["verifiable_claim"],"reasoning":"Stable position but verifiable","searchQuery":"Apple CEO 2024","forceHigh":false,"hasRecencyRequest":false,"isEvolvingDomain":false,"isTimelessTopic":false}

"What's AAPL trading at?"
{"webHelpful":true,"riskScore":0.95,"riskFactors":["volatile_data","specific_numbers"],"reasoning":"Stock prices change by the second","searchQuery":"AAPL stock price","forceHigh":true,"hasRecencyRequest":true,"isEvolvingDomain":true,"isTimelessTopic":false}

"Is it safe to take ibuprofen with X?"
{"webHelpful":true,"riskScore":0.9,"riskFactors":["high_stakes"],"reasoning":"Health/drug interaction question","searchQuery":"ibuprofen X interaction","forceHigh":true,"hasRecencyRequest":false,"isEvolvingDomain":false,"isTimelessTopic":false}

"Did the CEO resign today?"
{"webHelpful":true,"riskScore":0.95,"riskFactors":["time_sensitive_claim","recent_events"],"reasoning":"Breaking news question","searchQuery":"[company] CEO resignation","forceHigh":true,"hasRecencyRequest":true,"isEvolvingDomain":true,"isTimelessTopic":false}

"What's new in Elden Ring DLC?"
{"webHelpful":true,"riskScore":0.6,"riskFactors":["post_cutoff","recent_events"],"reasoning":"Gaming content updates frequently","searchQuery":"Elden Ring DLC updates 2024","forceHigh":false,"hasRecencyRequest":true,"isEvolvingDomain":true,"isTimelessTopic":false}

"Who is Nefer?"
{"webHelpful":true,"riskScore":0.7,"riskFactors":["obscure_entity"],"reasoning":"Unknown/obscure entity needs lookup","searchQuery":"Nefer person","forceHigh":false,"hasRecencyRequest":false,"isEvolvingDomain":false,"isTimelessTopic":false}

"Help me plan my budget"
{"webHelpful":false,"riskScore":0,"riskFactors":[],"reasoning":"Personal planning assistance","forceHigh":false,"hasRecencyRequest":false,"isEvolvingDomain":false,"isTimelessTopic":true}

"What happened in the 2024 election?"
{"webHelpful":true,"riskScore":0.85,"riskFactors":["post_cutoff","recent_events","verifiable_claim"],"reasoning":"Recent political event","searchQuery":"2024 US election results","forceHigh":false,"hasRecencyRequest":true,"isEvolvingDomain":true,"isTimelessTopic":false}

═══════════════════════════════════════════════════════════════
Now classify the following message. Return only valid JSON:
═══════════════════════════════════════════════════════════════`;

// ─────────────────────────────────────────────────────────────────────────────────
// CLASSIFICATION FUNCTION
// ─────────────────────────────────────────────────────────────────────────────────

export async function classifyWithLLM(message: string): Promise<LensClassification> {
  const client = getOpenAIClient();

  if (!client) {
    console.warn('[LENS] OpenAI client not available - using fail-safe');
    return getFailSafeClassification(message);
  }

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: LENS_CLASSIFIER_SYSTEM_PROMPT },
        { role: 'user', content: message },
      ],
      max_tokens: 300,
      temperature: 0,
    });

    const content = response.choices[0]?.message?.content?.trim() ?? '';
    return parseClassification(content, message);

  } catch (error) {
    console.error('[LENS] LLM classification error:', error);
    return getFailSafeClassification(message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// PARSE CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────────────

function parseClassification(content: string, originalMessage: string): LensClassification {
  try {
    // Strip markdown code blocks if present
    let jsonStr = content;
    if (content.includes('```')) {
      const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      jsonStr = match?.[1]?.trim() ?? content;
    }

    const parsed = JSON.parse(jsonStr.trim());

    // Validate and normalize
    const classification: LensClassification = {
      webHelpful: Boolean(parsed.webHelpful),
      riskScore: normalizeRiskScore(parsed.riskScore),
      riskFactors: normalizeRiskFactors(parsed.riskFactors),
      reasoning: String(parsed.reasoning || 'No reasoning provided'),
      searchQuery: parsed.searchQuery ? String(parsed.searchQuery) : undefined,
      forceHigh: Boolean(parsed.forceHigh),
      hasRecencyRequest: Boolean(parsed.hasRecencyRequest),
      isEvolvingDomain: Boolean(parsed.isEvolvingDomain),
      isTimelessTopic: Boolean(parsed.isTimelessTopic),
    };

    // Generate search query if missing but webHelpful
    if (classification.webHelpful && !classification.searchQuery) {
      classification.searchQuery = extractKeywords(originalMessage);
    }

    return classification;

  } catch (error) {
    console.warn('[LENS] Failed to parse classification:', content);
    return getFailSafeClassification(originalMessage);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// NORMALIZATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

function normalizeRiskScore(score: unknown): number {
  const num = Number(score);
  if (isNaN(num)) return 0.5;
  return Math.max(0, Math.min(1, num));
}

const VALID_RISK_FACTORS: RiskFactor[] = [
  'post_cutoff',
  'specific_numbers',
  'obscure_entity',
  'volatile_data',
  'recent_events',
  'verifiable_claim',
  'high_stakes',
  'time_sensitive_claim',
  'breaking_news',
];

function normalizeRiskFactors(factors: unknown): RiskFactor[] {
  if (!Array.isArray(factors)) return [];
  return factors.filter(f => VALID_RISK_FACTORS.includes(f as RiskFactor)) as RiskFactor[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// KEYWORD EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────────

export function extractKeywords(message: string): string {
  // Remove common filler words
  const stopWords = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'to', 'of', 'in', 'for', 'on', 'with',
    'at', 'by', 'from', 'up', 'about', 'into', 'over', 'after', 'beneath',
    'under', 'above', 'between', 'through', 'during', 'before', 'after',
    'what', 'who', 'where', 'when', 'why', 'how', 'which', 'whom',
    'tell', 'me', 'please', 'help', 'want', 'know', 'need', 'find',
    'you', 'i', 'we', 'they', 'he', 'she', 'it', 'my', 'your', 'our',
    'their', 'his', 'her', 'its', 'this', 'that', 'these', 'those',
  ]);

  const words = message
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  // Take first 5-6 meaningful words
  return words.slice(0, 6).join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────────
// FAIL-SAFE CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────────────

export function getFailSafeClassification(message: string): LensClassification {
  const lower = message.toLowerCase().trim();

  // ─── SIMPLE GREETINGS / CONVERSATIONAL → No web needed ───
  const simpleGreetings = [
    /^(hi|hello|hey|yo|sup|howdy|greetings)[\s!.,?]*$/i,
    /^(hi|hello|hey)\s+(there|claude|assistant)[\s!.,?]*$/i,
    /^(good\s+)?(morning|afternoon|evening|night)[\s!.,?]*$/i,
    /^how\s+(are|r)\s+(you|u)(\s+doing)?[\s!?.,]*$/i,
    /^what('s|\s+is)\s+up[\s!?.,]*$/i,
    /^(thanks|thank\s+you|thx|ty)[\s!.,?]*$/i,
    /^(bye|goodbye|see\s+you|later|cya)[\s!.,?]*$/i,
  ];

  if (simpleGreetings.some(p => p.test(lower))) {
    return {
      webHelpful: false,
      riskScore: 0,
      riskFactors: [],
      reasoning: 'Simple greeting/conversational - no external info needed',
      forceHigh: false,
      hasRecencyRequest: false,
      isEvolvingDomain: false,
      isTimelessTopic: true,
    };
  }

  // ─── VERY SHORT MESSAGES (< 4 words, no question words) → Likely conversational ───
  const wordCount = lower.split(/\s+/).filter(w => w.length > 0).length;
  const hasQuestionIndicator = /\b(what|who|where|when|why|how|is|are|does|did|can|will)\b/i.test(lower);
  
  if (wordCount <= 3 && !hasQuestionIndicator) {
    return {
      webHelpful: false,
      riskScore: 0,
      riskFactors: [],
      reasoning: 'Short conversational message - no external info needed',
      forceHigh: false,
      hasRecencyRequest: false,
      isEvolvingDomain: false,
      isTimelessTopic: true,
    };
  }

  // Strong indicators NO web needed
  const definitelyNoWeb = [
    /^(write|draft|compose|create)\s+(me\s+)?(a\s+)?(poem|story|song|haiku|essay|article)/i,
    /^(what('s| is)|calculate|compute|solve)\s+\d/i,
    /^(explain|what is|how does)\s+(the concept|the theory|the principle)/i,
    /^(help me|can you help)\s+(plan|organize|think|brainstorm)/i,
    /^(how do I|how can I)\s+(code|program|implement|build|create)/i,
    // General conversational / opinion
    /^(what do you think|tell me about yourself|who are you)/i,
    /^(can you help|please help|i need help)/i,
  ];

  if (definitelyNoWeb.some(p => p.test(message))) {
    return {
      webHelpful: false,
      riskScore: 0,
      riskFactors: [],
      reasoning: 'High-confidence pattern: no external info needed',
      forceHigh: false,
      hasRecencyRequest: false,
      isEvolvingDomain: false,
      isTimelessTopic: true,
    };
  }

  // Force HIGH triggers
  const forceHighPatterns = [
    /\b(should I|is it safe|can I take|drug interaction|medication)\b/i,
    /\b(legal|illegal|lawsuit|court|regulation)\b.*\b(in|for|about)\b/i,
    /\b(invest|put all|savings|401k|retirement)\b.*\b(in|into)\b/i,
    /\b(breaking|just now|this morning|happening now|live)\b/i,
    // Volatile data patterns - stocks and crypto
    /\b(stock|share)\s+(price|worth|value)\b/i,
    /\b(bitcoin|crypto|ethereum|btc|eth)\b.*\b(price|worth|value|trading)\b/i,
    /\b(what('s| is)|how much)\b.*\b(worth|trading|price)\b.*\b(now|today|right now)\b/i,
  ];

  if (forceHighPatterns.some(p => p.test(lower))) {
    return {
      webHelpful: true,
      riskScore: 0.9,
      riskFactors: ['high_stakes', 'volatile_data'],
      reasoning: 'FAIL-SAFE: High-stakes/volatile domain detected',
      searchQuery: extractKeywords(message),
      forceHigh: true,
      hasRecencyRequest: false,
      isEvolvingDomain: true,
      isTimelessTopic: false,
    };
  }

  // Recency indicators → verify
  const recencyIndicators = /\b(2024|2025|latest|current|recent|new version|just released|today|yesterday|now|right now)\b/i;
  if (recencyIndicators.test(lower)) {
    return {
      webHelpful: true,
      riskScore: 0.85,
      riskFactors: ['recent_events', 'post_cutoff'],
      reasoning: 'FAIL-SAFE: Recency indicator detected',
      searchQuery: extractKeywords(message),
      forceHigh: false,
      hasRecencyRequest: true,
      isEvolvingDomain: true,
      isTimelessTopic: false,
    };
  }

  // Question words about entities
  const entityQuestion = /\b(who|what|where|when)\s+(is|are|was|were)\s+[A-Z]/;
  if (entityQuestion.test(message)) {
    return {
      webHelpful: true,
      riskScore: 0.6,
      riskFactors: ['verifiable_claim'],
      reasoning: 'FAIL-SAFE: Entity question detected',
      searchQuery: extractKeywords(message),
      forceHigh: false,
      hasRecencyRequest: false,
      isEvolvingDomain: false,
      isTimelessTopic: false,
    };
  }

  // DEFAULT: For general questions without specific triggers, stay LOW
  // Only upgrade to verification if there are specific risk indicators
  return {
    webHelpful: true,
    riskScore: 0.4,  // Below MEDIUM threshold (0.5) - stays in LOW unless upgraded
    riskFactors: [],
    reasoning: 'FAIL-SAFE: General query, defaulting to LOW tier',
    searchQuery: extractKeywords(message),
    forceHigh: false,
    hasRecencyRequest: false,
    isEvolvingDomain: false,
    isTimelessTopic: false,
  };
}
