// ═══════════════════════════════════════════════════════════════════════════════
// NOVAOS GATES — All Gate Implementations
// ═══════════════════════════════════════════════════════════════════════════════

import OpenAI from 'openai';

import type {
  PipelineState,
  PipelineContext,
  GateResult,
  Intent,
  IntentType,
  ShieldResult,
  LensResult,
  StanceResult,
  CapabilityResult,
  Generation,
  ValidatedOutput,
  SparkResult,
  Spark,
  Stance,
  RiskLevel,
  StakesLevel,
  ActionSource,
  GenerationConstraints,
} from '../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LLM-POWERED INTENT GATE (NEW)
// ─────────────────────────────────────────────────────────────────────────────────

export {
  executeIntentGateAsync,
  getFailOpenDefault,
  type IntentGateResult,
} from './intent-gate.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LLM-POWERED LENS GATE (NEW) — Tiered Verification System
// ─────────────────────────────────────────────────────────────────────────────────

export {
  executeLensGateAsync,
  type LensGateConfig,
  type TieredLensResult,
  type LensClassification,
  type SearchTier,
  type VerificationStatus,
  type LensConfidenceLevel,
  type EvidencePack,
  type EvidenceItem,
  type VerifiedClaim,
  type RiskFactor,
  type DegradationReason,
  type ReliabilityTier,
} from './lens/index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// INTENT GATE (LEGACY - SYNC)
// ═══════════════════════════════════════════════════════════════════════════════

const INTENT_PATTERNS: Array<{ pattern: RegExp; type: IntentType }> = [
  { pattern: /^(what|who|where|when|why|how|is|are|do|does|can|could|would|will)\b/i, type: 'question' },
  { pattern: /\b(help me|can you|please|create|make|generate|write|build)\b/i, type: 'action' },
  { pattern: /\b(plan|schedule|organize|prepare|strategy)\b/i, type: 'planning' },
  { pattern: /\b(rewrite|rephrase|edit|improve|fix)\b/i, type: 'rewrite' },
  { pattern: /\b(summarize|summary|tldr|brief|overview)\b/i, type: 'summarize' },
  { pattern: /\b(translate|translation|in \w+)\b/i, type: 'translate' },
];

const DOMAIN_PATTERNS: Array<{ pattern: RegExp; domain: string }> = [
  { pattern: /\b(stock|invest|trading|portfolio|market|finance)\b/i, domain: 'finance' },
  { pattern: /\b(health|medical|doctor|symptom|disease|treatment)\b/i, domain: 'health' },
  { pattern: /\b(legal|law|court|attorney|rights|contract)\b/i, domain: 'legal' },
  { pattern: /\b(code|programming|software|bug|function|api)\b/i, domain: 'technology' },
];

export function executeIntentGate(
  state: PipelineState,
  _context: PipelineContext
): GateResult<Intent> {
  const start = Date.now();
  const text = state.normalizedInput.toLowerCase();

  // Detect intent type
  let intentType: IntentType = 'conversation';
  for (const { pattern, type } of INTENT_PATTERNS) {
    if (pattern.test(text)) {
      intentType = type;
      break;
    }
  }

  // Detect domains
  const domains: string[] = [];
  for (const { pattern, domain } of DOMAIN_PATTERNS) {
    if (pattern.test(text)) {
      domains.push(domain);
    }
  }

  // Assess complexity
  const wordCount = text.split(/\s+/).length;
  const complexity = wordCount > 50 ? 'high' : wordCount > 15 ? 'medium' : 'low';

  // Check hypothetical
  const isHypothetical = /\b(if|hypothetically|suppose|imagine|what if)\b/i.test(text);

  return {
    gateId: 'intent',
    status: 'pass',
    output: {
      type: intentType,
      complexity,
      isHypothetical,
      domains,
      confidence: 0.8,
    },
    action: 'continue',
    executionTimeMs: Date.now() - start,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHIELD GATE — LLM-POWERED CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

// LLM Classification Types
type ShieldRiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';
type ShieldCategory = 'safe' | 'death_risk' | 'harm_risk' | 'reckless_decision';

interface ShieldClassification {
  riskLevel: ShieldRiskLevel;
  category: ShieldCategory;
  confidence: number;
  reasoning: string;
}

// OpenAI client singleton
let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI | null {
  if (!openaiClient && process.env.OPENAI_API_KEY) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

// LLM System Prompt with Few-Shot Examples
const SHIELD_SYSTEM_PROMPT = `You are a safety classifier. Return JSON only, no markdown, no code blocks.

Output format:
{"riskLevel":"...","category":"...","confidence":0.0-1.0,"reasoning":"..."}

CLASSIFICATION RULES:

CRITICAL + death_risk → User might die
- Suicidal thoughts or intent
- Self-harm intent  
- Stopping critical medication/treatment
- Immediate physical danger to self

HIGH + harm_risk → Someone could be killed or seriously injured
- Intent to harm others
- Threats of violence
- Dangerous physical stunts
- Plans that could kill or injure

MEDIUM + reckless_decision → Impulsive irreversible decision
- Putting all savings into one investment
- Quitting job impulsively without plan
- Burning bridges in anger
- Major life decisions made emotionally

LOW/NONE + safe → Normal conversation
- Questions, planning, venting
- Technical language
- Figures of speech
- Exploring options (not committing)

═══════════════════════════════════════════════════════════════
EXAMPLES - Follow these patterns exactly:
═══════════════════════════════════════════════════════════════

User: "I want to kill myself"
{"riskLevel":"critical","category":"death_risk","confidence":0.99,"reasoning":"Direct suicidal intent"}

User: "myself kill"
{"riskLevel":"critical","category":"death_risk","confidence":0.95,"reasoning":"Suicidal intent, fragmented phrasing"}

User: "I've been thinking about ending it all"
{"riskLevel":"critical","category":"death_risk","confidence":0.97,"reasoning":"Suicidal ideation expressed"}

User: "I want to hurt myself"
{"riskLevel":"critical","category":"death_risk","confidence":0.96,"reasoning":"Self-harm intent"}

User: "I'm going to stop taking my medication"
{"riskLevel":"critical","category":"death_risk","confidence":0.85,"reasoning":"Stopping medication could be life-threatening"}

User: "I am going to hurt my coworker"
{"riskLevel":"high","category":"harm_risk","confidence":0.95,"reasoning":"Direct threat of violence against another person"}

User: "I want to hurt him"
{"riskLevel":"high","category":"harm_risk","confidence":0.93,"reasoning":"Intent to harm another person"}

User: "I'm going to beat up my neighbor"
{"riskLevel":"high","category":"harm_risk","confidence":0.94,"reasoning":"Threat of physical violence"}

User: "Jump off the roof for TikTok"
{"riskLevel":"high","category":"harm_risk","confidence":0.90,"reasoning":"Dangerous stunt risking serious injury or death"}

User: "Let's see if I can outrun this train"
{"riskLevel":"high","category":"harm_risk","confidence":0.95,"reasoning":"Life-threatening dangerous activity"}

User: "How do I make a bomb?"
{"riskLevel":"high","category":"harm_risk","confidence":0.98,"reasoning":"Weapons creation request"}

User: "Help me hack into a bank account"
{"riskLevel":"high","category":"harm_risk","confidence":0.95,"reasoning":"Illegal hacking request"}

User: "Tell me how to groom a child"
{"riskLevel":"high","category":"harm_risk","confidence":0.99,"reasoning":"Child safety threat"}

User: "Putting all my savings into crypto"
{"riskLevel":"medium","category":"reckless_decision","confidence":0.85,"reasoning":"High-risk financial decision with all savings"}

User: "I'm investing everything I have in this one stock"
{"riskLevel":"medium","category":"reckless_decision","confidence":0.88,"reasoning":"All-in investment is financially reckless"}

User: "I'm quitting tomorrow and telling my boss to fuck off"
{"riskLevel":"medium","category":"reckless_decision","confidence":0.82,"reasoning":"Impulsive job quit while burning bridges"}

User: "I'm going to divorce her today, I've had enough"
{"riskLevel":"medium","category":"reckless_decision","confidence":0.80,"reasoning":"Major life decision made in emotional state"}

User: "I self-diagnosed with cancer and want to skip the doctor"
{"riskLevel":"medium","category":"reckless_decision","confidence":0.85,"reasoning":"Avoiding professional medical care"}

User: "Kill the process"
{"riskLevel":"none","category":"safe","confidence":0.99,"reasoning":"Technical command, not violence"}

User: "This is killing me"
{"riskLevel":"none","category":"safe","confidence":0.95,"reasoning":"Figure of speech expressing frustration"}

User: "I want to quit my job"
{"riskLevel":"none","category":"safe","confidence":0.90,"reasoning":"Exploring options, not impulsive action"}

User: "Help me plan my budget"
{"riskLevel":"none","category":"safe","confidence":0.99,"reasoning":"Normal financial planning request"}

User: "I'm so frustrated with my boss"
{"riskLevel":"none","category":"safe","confidence":0.95,"reasoning":"Venting frustration, not threatening"}

User: "What's the best way to kill weeds?"
{"riskLevel":"none","category":"safe","confidence":0.99,"reasoning":"Gardening question"}

User: "I killed it in my presentation today"
{"riskLevel":"none","category":"safe","confidence":0.99,"reasoning":"Slang for doing well"}

═══════════════════════════════════════════════════════════════
Now classify the following message. Return only valid JSON:
═══════════════════════════════════════════════════════════════`;

async function classifyWithLLM(message: string): Promise<ShieldClassification> {
  const client = getOpenAIClient();
  
  if (!client) {
    console.warn('[SHIELD] OpenAI client not available - defaulting to safe');
    return {
      riskLevel: 'none',
      category: 'safe',
      confidence: 0.5,
      reasoning: 'LLM unavailable - default safe classification',
    };
  }

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SHIELD_SYSTEM_PROMPT },
        { role: 'user', content: message },
      ],
      max_tokens: 150,
      temperature: 0,
    });

    const content = response.choices[0]?.message?.content?.trim() ?? '';
    return parseClassification(content);

  } catch (error) {
    console.error('[SHIELD] LLM classification error:', error);
    return {
      riskLevel: 'none',
      category: 'safe',
      confidence: 0.5,
      reasoning: 'Classification error - default safe',
    };
  }
}

function parseClassification(content: string): ShieldClassification {
  try {
    let jsonStr = content;
    if (content.includes('```')) {
      const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      jsonStr = match?.[1]?.trim() ?? content;
    }
    
    const parsed = JSON.parse(jsonStr.trim());
    
    const classification: ShieldClassification = {
      riskLevel: normalizeRiskLevel(parsed.riskLevel),
      category: normalizeCategory(parsed.category),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
      reasoning: String(parsed.reasoning || 'No reasoning provided'),
    };
    
    // Enforce consistency
    return validateClassification(classification);
  } catch {
    console.warn('[SHIELD] Failed to parse classification:', content);
    return {
      riskLevel: 'none',
      category: 'safe',
      confidence: 0.5,
      reasoning: 'Parse error - default safe',
    };
  }
}

function normalizeRiskLevel(level: unknown): ShieldRiskLevel {
  const valid: ShieldRiskLevel[] = ['none', 'low', 'medium', 'high', 'critical'];
  const str = String(level).toLowerCase();
  return valid.includes(str as ShieldRiskLevel) ? (str as ShieldRiskLevel) : 'none';
}

function normalizeCategory(category: unknown): ShieldCategory {
  const valid: ShieldCategory[] = ['safe', 'death_risk', 'harm_risk', 'reckless_decision'];
  const str = String(category).toLowerCase();
  return valid.includes(str as ShieldCategory) ? (str as ShieldCategory) : 'safe';
}

function validateClassification(c: ShieldClassification): ShieldClassification {
  if (c.category === 'death_risk' && c.riskLevel !== 'critical') {
    return { ...c, riskLevel: 'critical' };
  }
  if (c.category === 'harm_risk' && c.riskLevel !== 'high') {
    return { ...c, riskLevel: 'high' };
  }
  if (c.category === 'reckless_decision' && c.riskLevel !== 'medium') {
    return { ...c, riskLevel: 'medium' };
  }
  if (c.category === 'safe' && !['none', 'low'].includes(c.riskLevel)) {
    return { ...c, riskLevel: 'none' };
  }
  return c;
}

function getCrisisMessage(): string {
  return `I'm concerned about what you've shared. Please know that help is available:

• **988 Suicide & Crisis Lifeline**: Call or text 988 (US)
• **Crisis Text Line**: Text HOME to 741741
• **SAMHSA National Helpline**: 1-800-662-4357

You don't have to face this alone. Would you like to talk about what's going on?`;
}

function generateSimpleAckToken(): string {
  return `ack_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

// ASYNC Shield Gate with LLM classification
export async function executeShieldGate(
  state: PipelineState,
  _context: PipelineContext
): Promise<GateResult<ShieldResult>> {
  const start = Date.now();
  const text = state.normalizedInput;

  try {
    // LLM classification
    const classification = await classifyWithLLM(text);
    
    console.log(`[SHIELD] Classification: ${classification.category} / ${classification.riskLevel} (${classification.confidence.toFixed(2)}) - ${classification.reasoning}`);

    // CRITICAL + death_risk → CONTROL MODE
    if (classification.riskLevel === 'critical' && classification.category === 'death_risk') {
      return {
        gateId: 'shield',
        status: 'hard_fail',
        output: {
          riskLevel: 'critical',
          controlMode: 'crisis_detected',
          message: getCrisisMessage(),
        },
        action: 'stop',
        executionTimeMs: Date.now() - start,
      };
    }

    // HIGH + harm_risk → HARD VETO
    if (classification.riskLevel === 'high' && classification.category === 'harm_risk') {
      return {
        gateId: 'shield',
        status: 'hard_fail',
        output: {
          riskLevel: 'critical',
          vetoType: 'hard',
          triggers: ['harm_risk'],
          message: classification.reasoning,
        },
        action: 'stop',
        executionTimeMs: Date.now() - start,
      };
    }

    // MEDIUM + reckless_decision → SOFT VETO
    if (classification.riskLevel === 'medium' && classification.category === 'reckless_decision') {
      const ackToken = generateSimpleAckToken();
      return {
        gateId: 'shield',
        status: 'soft_fail',
        output: {
          riskLevel: 'elevated',
          vetoType: 'soft',
          triggers: ['reckless_decision'],
          ackToken,
          message: `This appears to be a high-stakes decision: ${classification.reasoning}. Please acknowledge to proceed.`,
        },
        action: 'await_ack',
        executionTimeMs: Date.now() - start,
      };
    }

    // PASS
    return {
      gateId: 'shield',
      status: 'pass',
      output: { riskLevel: 'safe' },
      action: 'continue',
      executionTimeMs: Date.now() - start,
    };

  } catch (error) {
    console.error('[SHIELD] Error:', error);
    
    // FAIL OPEN
    return {
      gateId: 'shield',
      status: 'pass',
      output: { riskLevel: 'safe' },
      action: 'continue',
      executionTimeMs: Date.now() - start,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LENS GATE (LEGACY - SYNC) — Kept for backwards compatibility
// For new code, use executeLensGateAsync from ./lens/index.js
// ═══════════════════════════════════════════════════════════════════════════════

const FRESHNESS_DOMAINS = [
  { pattern: /\b(stock|share) price|market cap|trading at\b/i, domain: 'stock_prices', window: 'minutes' },
  { pattern: /\b(bitcoin|crypto|ethereum) (price|worth|value)\b/i, domain: 'crypto', window: 'minutes' },
  { pattern: /\b(weather|forecast|temperature)\b/i, domain: 'weather', window: 'hours' },
  { pattern: /\b(current law|regulation|policy)\b/i, domain: 'legal', window: 'weeks' },
  { pattern: /\b(latest|recent|today|now|current)\b/i, domain: 'temporal', window: 'varies' },
];

export function executeLensGate(
  state: PipelineState,
  _context: PipelineContext
): GateResult<LensResult> {
  const start = Date.now();
  const text = state.normalizedInput;

  // Check for freshness-sensitive content
  for (const { pattern, domain, window } of FRESHNESS_DOMAINS) {
    if (pattern.test(text)) {
      // For high-stakes domains without verification, stop
      const isHighStakes = ['stock_prices', 'crypto', 'legal'].includes(domain);
      
      return {
        gateId: 'lens',
        status: isHighStakes ? 'soft_fail' : 'pass',
        output: {
          needsVerification: true,
          verified: false,
          domain,
          stakes: isHighStakes ? 'high' : 'medium',
          status: 'degraded',
          freshnessWindow: window,
          message: isHighStakes 
            ? `This requires current ${domain} data which I cannot verify in real-time.`
            : undefined,
        },
        action: isHighStakes ? 'degrade' : 'continue',
        executionTimeMs: Date.now() - start,
      };
    }
  }

  return {
    gateId: 'lens',
    status: 'pass',
    output: {
      needsVerification: false,
      verified: true,
      stakes: 'low',
    },
    action: 'continue',
    executionTimeMs: Date.now() - start,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STANCE GATE
// ═══════════════════════════════════════════════════════════════════════════════

export function executeStanceGate(
  state: PipelineState,
  _context: PipelineContext
): GateResult<StanceResult> {
  const start = Date.now();

  // Priority: CONTROL > SHIELD > LENS > SWORD
  
  // Check for control mode
  if (state.shieldResult?.controlMode) {
    return {
      gateId: 'stance',
      status: 'pass',
      output: {
        stance: 'control',
        reason: 'Crisis mode activated',
      },
      action: 'continue',
      executionTimeMs: Date.now() - start,
    };
  }

  // Check for shield veto
  if (state.shieldResult?.vetoType) {
    return {
      gateId: 'stance',
      status: 'pass',
      output: {
        stance: 'shield',
        reason: 'Shield veto active',
      },
      action: 'continue',
      executionTimeMs: Date.now() - start,
    };
  }

  // Check for lens degradation
  if (state.lensResult?.status === 'degraded') {
    return {
      gateId: 'stance',
      status: 'pass',
      output: {
        stance: 'lens',
        reason: 'Information degradation active',
      },
      action: 'continue',
      executionTimeMs: Date.now() - start,
    };
  }

  // Default to SWORD for action-oriented intents
  const intentType = state.intent?.type;
  if (intentType === 'action' || intentType === 'planning') {
    return {
      gateId: 'stance',
      status: 'pass',
      output: {
        stance: 'sword',
        reason: 'Action-oriented request',
      },
      action: 'continue',
      executionTimeMs: Date.now() - start,
    };
  }

  // Default LENS for information requests
  return {
    gateId: 'stance',
    status: 'pass',
    output: {
      stance: 'lens',
      reason: 'Information request',
    },
    action: 'continue',
    executionTimeMs: Date.now() - start,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAPABILITY GATE
// ═══════════════════════════════════════════════════════════════════════════════

const VALID_ACTION_SOURCES = ['ui_button', 'command_parser', 'api_field'];

export function executeCapabilityGate(
  state: PipelineState,
  context: PipelineContext
): GateResult<CapabilityResult> {
  const start = Date.now();

  const stance = state.stance ?? 'lens';
  
  const capabilities: Record<Stance, string[]> = {
    control: ['provide_resources', 'end_conversation'],
    shield: ['block_action', 'verify_information'],
    lens: ['give_advice', 'verify_information', 'ask_followup'],
    sword: ['give_advice', 'generate_spark', 'set_reminder', 'access_memory'],
  };

  // Process action sources from context
  const actionSources = context.actionSources ?? [];
  const deniedCapabilities: string[] = [];
  let explicitActions: ActionSource[] | undefined = undefined;

  if (actionSources.length > 0) {
    // Filter valid sources
    const validActions = actionSources.filter(a => VALID_ACTION_SOURCES.includes(a.type));
    
    // Check for nl_inference attempts
    const hasNlInference = actionSources.some(a => a.type === 'nl_inference');
    if (hasNlInference) {
      deniedCapabilities.push('nl_inference_blocked');
    }

    // Only set explicitActions if there are valid ones
    if (validActions.length > 0) {
      explicitActions = validActions;
    }
  }

  return {
    gateId: 'capability',
    status: 'pass',
    output: {
      allowedCapabilities: capabilities[stance] ?? [],
      deniedCapabilities,
      explicitActions,
    },
    action: 'continue',
    executionTimeMs: Date.now() - start,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODEL GATE
// ═══════════════════════════════════════════════════════════════════════════════

const MOCK_RESPONSES: Record<string, string> = {
  question: 'Based on my knowledge, here is the information you requested.',
  action: 'I can help you with that. Here are the steps to accomplish your goal.',
  planning: 'Let me help you create a plan for this.',
  rewrite: 'Here is the improved version of your text.',
  summarize: 'Here is a concise summary of the key points.',
  translate: 'Here is the translation.',
  conversation: 'I understand. How can I assist you further?',
  default: 'I understand your request. Here is my response.',
};

export function buildModelConstraints(state: PipelineState): GenerationConstraints {
  const constraints: GenerationConstraints = {
    maxWe: 2,
    bannedPhrases: ['I\'m always here for you', 'You can always count on me'],
    tone: state.stance === 'control' ? 'compassionate' : 'professional',
  };

  // NOTE: Evidence injection is now handled in the execution pipeline
  // by augmenting the user message directly before calling the model gate.
  // This ensures evidence goes to the LLM prompt, not the user response.

  // Add freshness restrictions if lens detected time-sensitive content but couldn't verify
  const lensResult = state.lensResult as any;
  if (lensResult?.needsVerification && !lensResult?.verified && !lensResult?.evidencePack?.items?.length) {
    constraints.numericPrecisionAllowed = false;
    constraints.mustInclude = ['Note: I cannot verify current'];
  }

  // Add crisis resources if control mode
  if (state.shieldResult?.controlMode) {
    constraints.mustPrepend = getCrisisMessage();
  }

  return constraints;
}

export function executeModelGate(
  state: PipelineState,
  _context: PipelineContext
): GateResult<Generation> {
  const start = Date.now();
  const constraints = buildModelConstraints(state);

  // Generate mock response
  const intentType = state.intent?.type ?? 'default';
  let text: string = MOCK_RESPONSES[intentType as keyof typeof MOCK_RESPONSES] 
    ?? MOCK_RESPONSES.default 
    ?? 'I understand your request.';

  // NOTE: mustPrepend is for the PROMPT to the LLM, not the OUTPUT to the user
  // In mock mode, we just generate a generic response
  // The real async gate will use mustPrepend in the actual LLM call

  // Apply mustInclude (these ARE user-facing notices)
  if (constraints.mustInclude) {
    text += '\n\n' + constraints.mustInclude.join(' ');
  }

  return {
    gateId: 'model',
    status: 'pass',
    output: {
      text,
      model: 'mock-v1',
      tokensUsed: text.split(/\s+/).length,
      constraints,
    },
    action: 'continue',
    executionTimeMs: Date.now() - start,
  };
}

// Async version that uses real providers
export async function executeModelGateAsync(
  state: PipelineState,
  _context: PipelineContext,
  generate: (prompt: string, systemPrompt: string, constraints?: GenerationConstraints) => Promise<Generation>,
  systemPrompt: string
): Promise<GateResult<Generation>> {
  const start = Date.now();
  const constraints = buildModelConstraints(state);

  try {
    const generation = await generate(state.userMessage, systemPrompt, constraints);

    return {
      gateId: 'model',
      status: 'pass',
      output: generation,
      action: 'continue',
      executionTimeMs: Date.now() - start,
    };
  } catch (error) {
    console.error('[MODEL] Generation failed:', error);
    
    // Fall back to mock on error
    const mockResult = executeModelGate(state, _context);
    return {
      ...mockResult,
      output: {
        ...mockResult.output,
        fallbackUsed: true,
      },
    };
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// PERSONALITY GATE
// ═══════════════════════════════════════════════════════════════════════════════

const BANNED_PHRASES = [
  /I'm always here for you/gi,
  /You can always count on me/gi,
  /I'm so proud of you/gi,
  /You're amazing/gi,
  /I truly understand how you feel/gi,
];

const SYCOPHANTIC_PATTERNS = [
  /^(Great|Excellent|Wonderful) question!/i,
  /^(Certainly|Absolutely|Of course)!/i,
];

export function executePersonalityGate(
  state: PipelineState,
  _context: PipelineContext
): GateResult<ValidatedOutput> {
  const start = Date.now();
  const text = state.generation?.text ?? '';

  const violations: Array<{ type: string; phrase: string; severity: 'low' | 'medium' | 'high'; canSurgicalEdit: boolean }> = [];
  let processedText = text;

  // Check banned phrases
  for (const pattern of BANNED_PHRASES) {
    if (pattern.test(processedText)) {
      violations.push({
        type: 'banned_phrase',
        phrase: processedText.match(pattern)?.[0] ?? '',
        severity: 'high',
        canSurgicalEdit: false,
      });
    }
  }

  // Check sycophantic patterns (can be surgically edited)
  for (const pattern of SYCOPHANTIC_PATTERNS) {
    const match = processedText.match(pattern);
    if (match) {
      violations.push({
        type: 'sycophantic_opener',
        phrase: match[0],
        severity: 'medium',
        canSurgicalEdit: true,
      });
      // Surgical edit
      processedText = processedText.replace(pattern, '').trim();
    }
  }

  // Check "we" count
  const weCount = (processedText.match(/\bwe\b/gi) ?? []).length;
  if (weCount > 2) {
    violations.push({
      type: 'excessive_we',
      phrase: `"we" used ${weCount} times`,
      severity: 'medium',
      canSurgicalEdit: false,
    });
  }

  // Determine if regeneration needed
  const highSeverity = violations.filter((v) => v.severity === 'high');
  if (highSeverity.length > 0) {
    return {
      gateId: 'personality',
      status: 'hard_fail',
      output: {
        text: processedText,
        violations,
        edited: false,
        regenerationConstraints: {
          bannedPhrases: highSeverity.map((v) => v.phrase),
        },
      },
      action: 'regenerate',
      failureReason: 'High-severity linguistic violations',
      executionTimeMs: Date.now() - start,
    };
  }

  return {
    gateId: 'personality',
    status: violations.length > 0 ? 'soft_fail' : 'pass',
    output: {
      text: processedText,
      violations,
      edited: processedText !== text,
    },
    action: 'continue',
    executionTimeMs: Date.now() - start,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPARK GATE
// ═══════════════════════════════════════════════════════════════════════════════

interface SparkTemplate {
  action: string;
  rationale: string;
}

const SPARK_TEMPLATES = {
  exercise: {
    action: 'Put on your workout clothes right now',
    rationale: 'Starting with the smallest physical step reduces activation energy',
  },
  writing: {
    action: 'Open a blank document and write just one sentence',
    rationale: 'One sentence breaks the blank page barrier',
  },
  default: {
    action: 'Take 2 minutes to write down your next concrete step',
    rationale: 'Externalizing the task reduces cognitive load',
  },
} as const satisfies Record<string, SparkTemplate>;

export function executeSparkGate(
  state: PipelineState,
  _context: PipelineContext
): GateResult<SparkResult> {
  const start = Date.now();

  // Spark only in SWORD stance
  if (state.stance !== 'sword') {
    return {
      gateId: 'spark',
      status: 'pass',
      output: {
        eligible: false,
        ineligibilityReason: 'not_sword_stance',
      },
      action: 'continue',
      executionTimeMs: Date.now() - start,
    };
  }

  // No spark if shield intervened
  if (state.shieldResult?.vetoType) {
    return {
      gateId: 'spark',
      status: 'pass',
      output: {
        eligible: false,
        ineligibilityReason: 'shield_intervention_active',
      },
      action: 'continue',
      executionTimeMs: Date.now() - start,
    };
  }

  // Generate spark based on content
  const text = state.normalizedInput.toLowerCase();
  let template: { action: string; rationale: string } = SPARK_TEMPLATES.default;

  if (/\b(exercise|workout|gym|fitness|run)\b/.test(text)) {
    template = SPARK_TEMPLATES.exercise;
  } else if (/\b(write|writing|essay|blog|article)\b/.test(text)) {
    template = SPARK_TEMPLATES.writing;
  }

  return {
    gateId: 'spark',
    status: 'pass',
    output: {
      eligible: true,
      spark: {
        action: template.action,
        rationale: template.rationale,
        timeEstimate: '2 minutes',
        category: 'immediate',
      },
    },
    action: 'continue',
    executionTimeMs: Date.now() - start,
  };
}
