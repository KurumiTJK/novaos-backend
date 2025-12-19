// ═══════════════════════════════════════════════════════════════════════════════
// CLAIMS PROCESSOR — Claim Freezing for HIGH Tier
// Extracts requirements, identifies what MUST be verified
// ═══════════════════════════════════════════════════════════════════════════════

import OpenAI from 'openai';

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
// CLAIM REQUIREMENTS
// ─────────────────────────────────────────────────────────────────────────────────

export interface ClaimRequirement {
  claim: string;
  type: 'factual' | 'numeric' | 'temporal' | 'existence';
  criticality: 'required' | 'important' | 'optional';
  searchTerms: string[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT FOR CLAIM EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────────

const CLAIM_EXTRACTION_PROMPT = `You are a claim extraction system. Given a user query, identify the factual claims that MUST be verified before providing an answer.

Return JSON only, no markdown:

{
  "requirements": [
    {
      "claim": "The specific factual claim that needs verification",
      "type": "factual|numeric|temporal|existence",
      "criticality": "required|important|optional",
      "searchTerms": ["key", "search", "terms"]
    }
  ]
}

RULES:
1. Focus on claims where being WRONG would cause harm
2. Ignore subjective questions or opinion requests
3. For numeric claims, capture the specific data point needed
4. For temporal claims, capture what needs to be current
5. For existence claims, capture what needs to exist
6. "required" = answer would be dangerous if wrong
7. "important" = answer would be misleading if wrong
8. "optional" = nice to verify but not critical

EXAMPLES:

Query: "Is ibuprofen safe to take with warfarin?"
{
  "requirements": [
    {
      "claim": "Drug interaction between ibuprofen and warfarin",
      "type": "factual",
      "criticality": "required",
      "searchTerms": ["ibuprofen", "warfarin", "interaction", "contraindication"]
    }
  ]
}

Query: "What's Apple's current stock price?"
{
  "requirements": [
    {
      "claim": "Current Apple stock price",
      "type": "numeric",
      "criticality": "required",
      "searchTerms": ["AAPL", "stock", "price"]
    }
  ]
}

Query: "Did the CEO of Twitter resign?"
{
  "requirements": [
    {
      "claim": "Current Twitter/X CEO status",
      "type": "temporal",
      "criticality": "required",
      "searchTerms": ["Twitter", "X", "CEO", "resignation"]
    },
    {
      "claim": "Identity of current Twitter/X CEO",
      "type": "existence",
      "criticality": "important",
      "searchTerms": ["Twitter", "X", "CEO", "current"]
    }
  ]
}

Query: "Write a poem about the ocean"
{
  "requirements": []
}`;

// ─────────────────────────────────────────────────────────────────────────────────
// EXTRACT CLAIM REQUIREMENTS
// ─────────────────────────────────────────────────────────────────────────────────

export async function extractClaimRequirements(message: string): Promise<ClaimRequirement[]> {
  const client = getOpenAIClient();

  if (!client) {
    console.warn('[CLAIMS] OpenAI client not available - using fallback extraction');
    return fallbackExtractClaims(message);
  }

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: CLAIM_EXTRACTION_PROMPT },
        { role: 'user', content: message },
      ],
      max_tokens: 400,
      temperature: 0,
    });

    const content = response.choices[0]?.message?.content?.trim() ?? '';
    return parseClaimRequirements(content);

  } catch (error) {
    console.error('[CLAIMS] LLM extraction error:', error);
    return fallbackExtractClaims(message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// PARSE CLAIM REQUIREMENTS
// ─────────────────────────────────────────────────────────────────────────────────

function parseClaimRequirements(content: string): ClaimRequirement[] {
  try {
    // Strip markdown code blocks if present
    let jsonStr = content;
    if (content.includes('```')) {
      const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      jsonStr = match?.[1]?.trim() ?? content;
    }

    const parsed = JSON.parse(jsonStr.trim());

    if (!Array.isArray(parsed.requirements)) {
      return [];
    }

    return parsed.requirements.map((r: any) => ({
      claim: String(r.claim || ''),
      type: normalizeType(r.type),
      criticality: normalizeCriticality(r.criticality),
      searchTerms: Array.isArray(r.searchTerms) ? r.searchTerms.map(String) : [],
    }));

  } catch (error) {
    console.warn('[CLAIMS] Failed to parse requirements:', content);
    return [];
  }
}

function normalizeType(type: unknown): ClaimRequirement['type'] {
  const valid = ['factual', 'numeric', 'temporal', 'existence'];
  const str = String(type).toLowerCase();
  return valid.includes(str) ? str as ClaimRequirement['type'] : 'factual';
}

function normalizeCriticality(criticality: unknown): ClaimRequirement['criticality'] {
  const valid = ['required', 'important', 'optional'];
  const str = String(criticality).toLowerCase();
  return valid.includes(str) ? str as ClaimRequirement['criticality'] : 'important';
}

// ─────────────────────────────────────────────────────────────────────────────────
// FALLBACK CLAIM EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────────

function fallbackExtractClaims(message: string): ClaimRequirement[] {
  const claims: ClaimRequirement[] = [];
  const lower = message.toLowerCase();

  // Numeric patterns
  if (/\b(price|cost|worth|value|rate|percentage|number|how much|how many)\b/i.test(message)) {
    const searchTerms = extractKeyTerms(message);
    claims.push({
      claim: `Numeric data: ${searchTerms.join(' ')}`,
      type: 'numeric',
      criticality: 'required',
      searchTerms,
    });
  }

  // Temporal patterns
  if (/\b(current|latest|today|now|recent|still|anymore)\b/i.test(message)) {
    const searchTerms = extractKeyTerms(message);
    claims.push({
      claim: `Current status: ${searchTerms.join(' ')}`,
      type: 'temporal',
      criticality: 'required',
      searchTerms,
    });
  }

  // Safety/health patterns
  if (/\b(safe|dangerous|interaction|side effect|contraindicated)\b/i.test(message)) {
    const searchTerms = extractKeyTerms(message);
    claims.push({
      claim: `Safety information: ${searchTerms.join(' ')}`,
      type: 'factual',
      criticality: 'required',
      searchTerms,
    });
  }

  // Who/what patterns
  if (/\b(who is|what is|where is)\b/i.test(message)) {
    const searchTerms = extractKeyTerms(message);
    claims.push({
      claim: `Entity information: ${searchTerms.join(' ')}`,
      type: 'existence',
      criticality: 'important',
      searchTerms,
    });
  }

  // If no patterns matched but seems factual, add generic claim
  if (claims.length === 0 && /\?$/.test(message.trim())) {
    const searchTerms = extractKeyTerms(message);
    if (searchTerms.length > 0) {
      claims.push({
        claim: `Information request: ${searchTerms.join(' ')}`,
        type: 'factual',
        criticality: 'important',
        searchTerms,
      });
    }
  }

  return claims;
}

function extractKeyTerms(message: string): string[] {
  const stopWords = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'to', 'of', 'in', 'for', 'on', 'with',
    'what', 'who', 'where', 'when', 'why', 'how', 'which',
    'tell', 'me', 'please', 'help', 'want', 'know', 'need',
    'you', 'i', 'we', 'they', 'my', 'your', 'our',
  ]);

  return message
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
    .slice(0, 5);
}

// ─────────────────────────────────────────────────────────────────────────────────
// GET REQUIRED CLAIMS ONLY
// ─────────────────────────────────────────────────────────────────────────────────

export function getRequiredClaims(requirements: ClaimRequirement[]): string[] {
  return requirements
    .filter(r => r.criticality === 'required')
    .map(r => r.claim);
}

// ─────────────────────────────────────────────────────────────────────────────────
// BUILD SEARCH QUERIES FROM REQUIREMENTS
// ─────────────────────────────────────────────────────────────────────────────────

export function buildSearchQueriesFromRequirements(requirements: ClaimRequirement[]): string[] {
  const queries: string[] = [];

  for (const req of requirements) {
    if (req.searchTerms.length > 0) {
      queries.push(req.searchTerms.join(' '));
    }
  }

  // Dedupe while preserving order
  return [...new Set(queries)];
}
