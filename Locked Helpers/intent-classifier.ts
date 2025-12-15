// ═══════════════════════════════════════════════════════════════════════════════
// INTENT CLASSIFIER — Fix D-2
// Implements IntentGate.classifyIntent with pattern-based classification
// ═══════════════════════════════════════════════════════════════════════════════

import { Intent, UserInput } from './types';

// ─────────────────────────────────────────────────────────────────────────────────
// PATTERN DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Command patterns (explicit actions).
 */
const COMMAND_PATTERNS: Array<{ pattern: RegExp; type: Intent['type'] }> = [
  { pattern: /^\/remind\b/i, type: 'action' },
  { pattern: /^\/path\b/i, type: 'planning' },
  { pattern: /^\/spark\b/i, type: 'action' },
  { pattern: /^\/search\b/i, type: 'action' },
  { pattern: /^remind me\b/i, type: 'action' },
  { pattern: /^set (?:a )?reminder\b/i, type: 'action' },
  { pattern: /^create (?:a )?(?:plan|path|roadmap)\b/i, type: 'planning' },
];

/**
 * Question patterns.
 */
const QUESTION_PATTERNS = [
  /^(?:who|what|when|where|why|how|which|whose|whom)\b/i,
  /\?$/,
  /^(?:is|are|was|were|do|does|did|can|could|will|would|should|may|might)\s+/i,
  /^tell me (?:about|what|how|why|when|where)/i,
  /^explain\b/i,
  /^what(?:'s| is) (?:the|a)\b/i,
];

/**
 * Action request patterns.
 */
const ACTION_PATTERNS = [
  /^(?:please )?(?:help me|assist me|can you help)\b/i,
  /^(?:please )?(?:create|make|build|generate|write|draft)\b/i,
  /^(?:please )?(?:do|perform|execute|run)\b/i,
  /^(?:please )?(?:send|email|message|notify)\b/i,
  /^(?:please )?(?:calculate|compute|figure out)\b/i,
  /^i (?:want|need|would like) (?:you )?to\b/i,
];

/**
 * Planning/strategy patterns.
 */
const PLANNING_PATTERNS = [
  /\b(?:plan|strategy|roadmap|timeline|milestones?)\b/i,
  /\bhow (?:should|can|do) i (?:approach|tackle|start|begin)\b/i,
  /\bstep(?:s| by step)\b/i,
  /\blong[- ]term\b/i,
  /\bgoals?\b.*\b(?:achieve|reach|accomplish)\b/i,
];

/**
 * Content processing patterns.
 */
const REWRITE_PATTERNS = [
  /^(?:please )?(?:rewrite|rephrase|paraphrase|edit)\b/i,
  /^(?:please )?(?:improve|polish|refine)\b/i,
  /^make (?:this|it) (?:more|less|better)\b/i,
];

const SUMMARIZE_PATTERNS = [
  /^(?:please )?(?:summarize|sum up|give me (?:a )?(?:summary|overview|gist))\b/i,
  /^(?:please )?(?:tldr|tl;dr)\b/i,
  /^what(?:'s| is) the (?:main|key) (?:point|takeaway|idea)/i,
];

const TRANSLATE_PATTERNS = [
  /^(?:please )?translate\b/i,
  /\btranslate (?:this|it) (?:to|into)\b/i,
  /\bin (?:spanish|french|german|chinese|japanese|korean|portuguese|italian|russian|arabic)\b/i,
];

/**
 * Hypothetical/example indicators.
 */
const HYPOTHETICAL_PATTERNS = [
  /\b(?:hypothetically|theoretically|in theory)\b/i,
  /\b(?:what if|suppose|imagine|let(?:'s| us) say)\b/i,
  /\bfor example\b/i,
  /\bjust (?:curious|wondering|asking)\b/i,
];

/**
 * Domain detection patterns.
 */
const DOMAIN_PATTERNS: Array<{ pattern: RegExp; domain: string }> = [
  // Finance
  { pattern: /\b(?:stock|share|invest|portfolio|dividend|etf|bond|market)\b/i, domain: 'finance' },
  { pattern: /\b(?:bitcoin|ethereum|crypto|cryptocurrency|token)\b/i, domain: 'crypto' },
  { pattern: /\b(?:budget|expense|income|savings|retire|401k|ira)\b/i, domain: 'personal_finance' },
  
  // Health
  { pattern: /\b(?:symptom|diagnosis|treatment|medication|doctor|hospital)\b/i, domain: 'health' },
  { pattern: /\b(?:exercise|workout|diet|nutrition|calories)\b/i, domain: 'fitness' },
  { pattern: /\b(?:anxiety|depression|therapy|mental health|stress)\b/i, domain: 'mental_health' },
  
  // Legal
  { pattern: /\b(?:law|legal|attorney|lawyer|court|sue|lawsuit)\b/i, domain: 'legal' },
  { pattern: /\b(?:contract|agreement|liability|terms|copyright)\b/i, domain: 'legal' },
  
  // Technology
  { pattern: /\b(?:code|programming|software|developer|api|database)\b/i, domain: 'technology' },
  { pattern: /\b(?:python|javascript|typescript|react|node|sql)\b/i, domain: 'programming' },
  
  // Career
  { pattern: /\b(?:job|career|resume|interview|salary|promotion)\b/i, domain: 'career' },
  { pattern: /\b(?:business|startup|entrepreneur|marketing|sales)\b/i, domain: 'business' },
];

// ─────────────────────────────────────────────────────────────────────────────────
// INTENT CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Classify the intent of a user message.
 * 
 * @param input - User input to classify
 * @returns Classified intent
 */
export function classifyIntent(input: UserInput): Intent {
  const message = input.message.trim();
  
  // Default intent
  const intent: Intent = {
    type: 'conversation',
    complexity: 'low',
    isHypothetical: false,
    domains: [],
  };

  // Empty message
  if (!message) {
    return intent;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Check for explicit commands (highest priority)
  // ─────────────────────────────────────────────────────────────────────────
  
  for (const { pattern, type } of COMMAND_PATTERNS) {
    if (pattern.test(message)) {
      intent.type = type;
      break;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Check for content processing requests
  // ─────────────────────────────────────────────────────────────────────────
  
  if (intent.type === 'conversation') {
    if (REWRITE_PATTERNS.some(p => p.test(message))) {
      intent.type = 'rewrite';
    } else if (SUMMARIZE_PATTERNS.some(p => p.test(message))) {
      intent.type = 'summarize';
    } else if (TRANSLATE_PATTERNS.some(p => p.test(message))) {
      intent.type = 'translate';
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Check for questions
  // ─────────────────────────────────────────────────────────────────────────
  
  if (intent.type === 'conversation') {
    if (QUESTION_PATTERNS.some(p => p.test(message))) {
      intent.type = 'question';
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Check for action requests
  // ─────────────────────────────────────────────────────────────────────────
  
  if (intent.type === 'conversation') {
    if (ACTION_PATTERNS.some(p => p.test(message))) {
      intent.type = 'action';
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Check for planning requests
  // ─────────────────────────────────────────────────────────────────────────
  
  if (intent.type === 'conversation' || intent.type === 'question') {
    if (PLANNING_PATTERNS.some(p => p.test(message))) {
      intent.type = 'planning';
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Check for hypothetical framing
  // ─────────────────────────────────────────────────────────────────────────
  
  intent.isHypothetical = HYPOTHETICAL_PATTERNS.some(p => p.test(message));

  // ─────────────────────────────────────────────────────────────────────────
  // 7. Detect domains
  // ─────────────────────────────────────────────────────────────────────────
  
  for (const { pattern, domain } of DOMAIN_PATTERNS) {
    if (pattern.test(message)) {
      if (!intent.domains.includes(domain)) {
        intent.domains.push(domain);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 8. Estimate complexity
  // ─────────────────────────────────────────────────────────────────────────
  
  intent.complexity = estimateComplexity(message, intent.domains, intent.type);

  return intent;
}

/**
 * Estimate the complexity of a request.
 */
function estimateComplexity(
  message: string,
  domains: string[],
  type: Intent['type']
): Intent['complexity'] {
  let score = 0;

  // Length factor
  const wordCount = message.split(/\s+/).length;
  if (wordCount > 100) score += 2;
  else if (wordCount > 50) score += 1;

  // Domain factor
  if (domains.length > 2) score += 2;
  else if (domains.length > 0) score += 1;

  // High-stakes domains
  const highStakesDomains = ['health', 'legal', 'finance', 'mental_health'];
  if (domains.some(d => highStakesDomains.includes(d))) {
    score += 1;
  }

  // Type factor
  if (type === 'planning') score += 1;
  if (type === 'action') score += 1;

  // Multiple questions
  const questionCount = (message.match(/\?/g) || []).length;
  if (questionCount > 2) score += 1;

  // Classify
  if (score >= 4) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}

// ─────────────────────────────────────────────────────────────────────────────────
// INTENT GATE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────────

import { GateResult, GateId, PipelineState, PipelineContext } from './types';

export class IntentGate {
  readonly gateId: GateId = 'intent';

  async execute(
    state: PipelineState,
    context: PipelineContext
  ): Promise<GateResult<Intent>> {
    const start = Date.now();

    try {
      const intent = classifyIntent(state.input);

      return {
        gateId: this.gateId,
        status: 'pass',
        output: intent,
        action: 'continue',
        executionTimeMs: Date.now() - start,
      };
    } catch (error) {
      // Classification failed — return safe default, don't crash
      console.error('[IntentGate] Classification error:', error);
      
      return {
        gateId: this.gateId,
        status: 'soft_fail',
        output: {
          type: 'conversation',
          complexity: 'low',
          isHypothetical: false,
          domains: [],
        },
        action: 'continue',
        failureReason: 'Intent classification failed, using default',
        executionTimeMs: Date.now() - start,
      };
    }
  }
}
