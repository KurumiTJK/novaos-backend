// ═══════════════════════════════════════════════════════════════════════════════
// CLARITY DETECTOR — Goal Clarity Assessment
// NovaOS Gates — Phase 14A: SwordGate Explore Module
// ═══════════════════════════════════════════════════════════════════════════════
//
// Assesses whether a user's learning goal is clear enough to proceed.
//
// Uses a tiered approach:
//   1. Pattern-based detection for clear/vague indicators
//   2. LLM-based analysis for nuanced assessment
//   3. Combined scoring with weighted signals
//
// A "clear" goal has:
//   - Specific topic or skill
//   - Optional but helpful: purpose/motivation
//   - Optional but helpful: scope/depth indication
//
// ═══════════════════════════════════════════════════════════════════════════════

import OpenAI from 'openai';

import type {
  ExploreState,
  ExploreConfig,
  ClarityDetectionResult,
  ClaritySignal,
} from './types.js';
import { DEFAULT_EXPLORE_CONFIG } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// PATTERN DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Patterns indicating a CLEAR goal statement.
 * Higher weight = stronger signal.
 */
const CLARITY_PATTERNS: Array<{
  pattern: RegExp;
  weight: number;
  signal: string;
}> = [
  // Specific technology/language + action
  {
    pattern: /\b(learn|master|understand|study)\s+(rust|python|javascript|typescript|go|java|c\+\+|react|vue|angular|node|sql|docker|kubernetes|terraform|aws|azure|gcp)\b/i,
    weight: 0.3,
    signal: 'specific_technology',
  },
  // Purpose statement
  {
    pattern: /\b(to|for|so that|because|in order to)\s+\w+/i,
    weight: 0.2,
    signal: 'has_purpose',
  },
  // Timeline/deadline
  {
    pattern: /\b(by|before|within|in\s+\d+\s+(weeks?|months?|days?))\b/i,
    weight: 0.15,
    signal: 'has_timeline',
  },
  // Specific outcome
  {
    pattern: /\b(build|create|develop|make|pass|get certified|become)\b/i,
    weight: 0.15,
    signal: 'specific_outcome',
  },
  // Level indication
  {
    pattern: /\b(beginner|intermediate|advanced|basics?|fundamentals?|deep dive|expert)\b/i,
    weight: 0.1,
    signal: 'level_indicated',
  },
  // Career context
  {
    pattern: /\b(job|career|interview|promotion|switch|transition|role|position)\b/i,
    weight: 0.1,
    signal: 'career_context',
  },
];

/**
 * Patterns indicating a VAGUE goal statement.
 * These reduce the clarity score.
 */
const VAGUENESS_PATTERNS: Array<{
  pattern: RegExp;
  weight: number;
  signal: string;
}> = [
  // Very broad/vague terms
  {
    pattern: /^(something|anything|stuff|things?)\s+(with|about|related)/i,
    weight: -0.3,
    signal: 'vague_something',
  },
  // Uncertainty language
  {
    pattern: /\b(maybe|perhaps|not sure|don'?t know|might|could be)\b/i,
    weight: -0.15,
    signal: 'uncertainty_language',
  },
  // Very short (less than 4 words)
  {
    pattern: /^(\S+\s+){0,3}\S+$/,
    weight: -0.1,
    signal: 'very_short',
  },
  // Just a topic without action
  {
    pattern: /^(ai|ml|machine learning|programming|coding|tech|technology|computers?)$/i,
    weight: -0.25,
    signal: 'bare_topic_only',
  },
  // Exploration language (wants to explore, not learn specific thing)
  {
    pattern: /\b(explore|try out|look into|get into|dabble|tinker)\b/i,
    weight: -0.1,
    signal: 'exploration_intent',
  },
];

/**
 * Patterns that indicate user is confirming a proposed goal.
 */
const CONFIRMATION_PATTERNS: RegExp[] = [
  /^(yes|yeah|yep|yup|exactly|correct|right|perfect|that'?s (it|right|correct)|bingo|spot on)[.!?]?$/i,
  /^that('?s| is) (what i want|it|correct|right|perfect|exactly what)/i,
  /^(sounds? good|looks? good|works? for me|i('?m| am) good with that)[.!?]?$/i,
  /^(let'?s (go|do it|proceed)|ready|i'?m ready)[.!?]?$/i,
  /^sure[.!?]?$/i,
  /^ok(ay)?[.!?]?$/i,
  /^absolutely[.!?]?$/i,
  /^definitely[.!?]?$/i,
];

/**
 * Patterns that indicate user wants to skip exploration.
 */
const SKIP_PATTERNS: RegExp[] = [
  /^(just )?(build|create|make|start)( me)?( a| the)? (plan|learning plan|curriculum)/i,
  /^skip( this| exploration| the questions)?\.?$/i,
  /^(i know what i want|i'?m? (clear|sure|certain))/i,
  /^(no need|don'?t need) (to )?(explore|ask|questions)/i,
  /^(let'?s )?(just )?(start|begin|go|proceed|get started)/i,
];

// ═══════════════════════════════════════════════════════════════════════════════
// LLM CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

const CLARITY_DETECTION_PROMPT = `You are assessing whether a user's learning goal is clear enough to create a structured learning plan.

Analyze the goal statement and conversation context to determine:
1. How clear and specific is the goal? (0.0 to 1.0)
2. What specific goal can be extracted?
3. What aspects are still unclear?
4. What question would help clarify further?

A CLEAR goal (0.8+) has:
- A specific topic, technology, or skill to learn
- Ideally: a purpose or motivation
- Ideally: an indication of desired depth/level

A VAGUE goal (< 0.5) lacks:
- A specific subject matter
- Any indication of what they want to achieve
- Context about their situation

Return JSON only, no markdown:
{"score":0.0-1.0,"extractedGoal":"...or null","unclearAspects":["..."],"suggestedQuestion":"...or null","reasoning":"..."}

Examples:

Goal: "I want to learn React to build a portfolio website"
{"score":0.9,"extractedGoal":"Learn React for building a portfolio website","unclearAspects":[],"suggestedQuestion":null,"reasoning":"Specific technology (React) with clear purpose (portfolio). Very clear."}

Goal: "something with AI"
{"score":0.2,"extractedGoal":null,"unclearAspects":["specific AI subfield","purpose","current background"],"suggestedQuestion":"What aspect of AI interests you most - are you thinking about building AI applications, understanding how AI works, or something else?","reasoning":"Too vague - AI is a huge field. Need to narrow down."}

Goal: "I'm a backend dev and want to learn Kubernetes for my job"
{"score":0.95,"extractedGoal":"Learn Kubernetes for backend development job","unclearAspects":[],"suggestedQuestion":null,"reasoning":"Specific technology, clear purpose, background context provided."}

Now assess:`;

// ═══════════════════════════════════════════════════════════════════════════════
// CLARITY DETECTOR CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detects goal clarity using pattern matching and LLM analysis.
 */
export class ClarityDetector {
  private openai: OpenAI | null = null;
  private readonly config: ExploreConfig;

  constructor(config: Partial<ExploreConfig> = {}, openaiApiKey?: string) {
    this.config = { ...DEFAULT_EXPLORE_CONFIG, ...config };
    
    const key = openaiApiKey ?? process.env.OPENAI_API_KEY;
    if (key && this.config.useLlmClarityDetection) {
      this.openai = new OpenAI({ apiKey: key });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MAIN DETECTION
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Assess the clarity of a goal statement.
   */
  async assess(
    goalStatement: string,
    state?: ExploreState
  ): Promise<ClarityDetectionResult> {
    // First, check for confirmation or skip patterns
    if (this.isConfirmation(goalStatement)) {
      return this.buildConfirmationResult(state);
    }

    if (this.isSkipRequest(goalStatement)) {
      return this.buildSkipResult(goalStatement);
    }

    // Try pattern-based detection first
    const patternResult = this.assessWithPatterns(goalStatement);

    // If high confidence from patterns, use that
    if (patternResult.score >= 0.85 || patternResult.score <= 0.2) {
      return {
        ...patternResult,
        method: 'pattern',
      };
    }

    // For medium confidence, use LLM if available
    if (this.openai && this.config.useLlmClarityDetection) {
      const llmResult = await this.assessWithLlm(goalStatement, state);
      if (llmResult) {
        // Combine pattern and LLM results
        return this.combineResults(patternResult, llmResult);
      }
    }

    // Fall back to pattern result
    return {
      ...patternResult,
      method: 'pattern',
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PATTERN-BASED DETECTION
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Assess clarity using regex patterns.
   */
  private assessWithPatterns(goalStatement: string): ClarityDetectionResult {
    const signals: ClaritySignal[] = [];
    let score = 0.5; // Start at neutral

    // Check clarity patterns
    for (const { pattern, weight, signal } of CLARITY_PATTERNS) {
      const present = pattern.test(goalStatement);
      signals.push({
        signal,
        weight,
        present,
        evidence: present ? goalStatement.match(pattern)?.[0] : undefined,
      });
      if (present) {
        score += weight;
      }
    }

    // Check vagueness patterns
    for (const { pattern, weight, signal } of VAGUENESS_PATTERNS) {
      const present = pattern.test(goalStatement);
      signals.push({
        signal,
        weight,
        present,
        evidence: present ? goalStatement.match(pattern)?.[0] : undefined,
      });
      if (present) {
        score += weight; // weight is negative
      }
    }

    // Clamp score to [0, 1]
    score = Math.max(0, Math.min(1, score));

    const isClear = score >= this.config.clarityThreshold;
    const unclearAspects = this.identifyUnclearAspects(signals, goalStatement);

    return {
      score,
      isClear,
      extractedGoal: isClear ? this.extractGoal(goalStatement) : undefined,
      unclearAspects,
      suggestedQuestion: this.suggestQuestion(unclearAspects, goalStatement),
      method: 'pattern',
    };
  }

  /**
   * Identify what's still unclear based on missing signals.
   */
  private identifyUnclearAspects(
    signals: ClaritySignal[],
    goalStatement: string
  ): string[] {
    const unclear: string[] = [];

    // Check which clarity signals are missing
    const hasSpecificTech = signals.some(s => s.signal === 'specific_technology' && s.present);
    const hasPurpose = signals.some(s => s.signal === 'has_purpose' && s.present);
    const hasLevel = signals.some(s => s.signal === 'level_indicated' && s.present);
    const hasOutcome = signals.some(s => s.signal === 'specific_outcome' && s.present);

    if (!hasSpecificTech && !hasOutcome) {
      unclear.push('specific topic or skill');
    }
    if (!hasPurpose) {
      unclear.push('purpose or motivation');
    }
    if (!hasLevel) {
      unclear.push('current experience level');
    }

    // Check for vagueness signals
    const hasVagueness = signals.some(s => s.weight < 0 && s.present);
    if (hasVagueness) {
      unclear.push('more specificity needed');
    }

    return unclear;
  }

  /**
   * Suggest a clarifying question based on what's unclear.
   */
  private suggestQuestion(
    unclearAspects: string[],
    goalStatement: string
  ): string | undefined {
    if (unclearAspects.length === 0) {
      return undefined;
    }

    // Priority order for questions
    if (unclearAspects.includes('specific topic or skill')) {
      if (/\b(ai|ml|machine learning)\b/i.test(goalStatement)) {
        return "AI is a vast field! Are you more interested in building AI applications, understanding how models work, or applying AI in a specific domain?";
      }
      if (/\b(programming|coding|development)\b/i.test(goalStatement)) {
        return "What kind of programming interests you - web development, mobile apps, data analysis, or something else?";
      }
      return "What specific skill or topic would you like to focus on?";
    }

    if (unclearAspects.includes('purpose or motivation')) {
      return "What's driving your interest in this? Is it for a project, career growth, or personal curiosity?";
    }

    if (unclearAspects.includes('current experience level')) {
      return "What's your current experience with this topic - are you starting fresh or building on existing knowledge?";
    }

    return "Could you tell me more about what you're hoping to achieve?";
  }

  /**
   * Extract a clean goal statement.
   */
  private extractGoal(goalStatement: string): string {
    // Remove common filler phrases
    let goal = goalStatement
      .replace(/^(i want to|i'd like to|i need to|help me|teach me|can you help me)\s+/i, '')
      .replace(/^(learn|study|understand|master)\s+/i, 'Learn ')
      .trim();

    // Capitalize first letter
    goal = goal.charAt(0).toUpperCase() + goal.slice(1);

    return goal;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // LLM-BASED DETECTION
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Assess clarity using LLM.
   */
  private async assessWithLlm(
    goalStatement: string,
    state?: ExploreState
  ): Promise<ClarityDetectionResult | null> {
    if (!this.openai) {
      return null;
    }

    try {
      // Build context from state if available
      let context = `Goal statement: "${goalStatement}"`;
      if (state && state.conversationHistory.length > 0) {
        context += `\n\nConversation context:`;
        // Include last few exchanges
        const recent = state.conversationHistory.slice(-4);
        for (const msg of recent) {
          context += `\n${msg.role}: ${msg.content}`;
        }
      }
      if (state?.interests.length) {
        context += `\nExpressed interests: ${state.interests.join(', ')}`;
      }
      if (state?.motivations.length) {
        context += `\nMotivations: ${state.motivations.join(', ')}`;
      }

      const response = await this.openai.chat.completions.create({
        model: this.config.llmModel,
        messages: [
          { role: 'system', content: CLARITY_DETECTION_PROMPT },
          { role: 'user', content: context },
        ],
        max_tokens: 300,
        temperature: 0,
      });

      const content = response.choices[0]?.message?.content?.trim() ?? '';
      return this.parseLlmResult(content);
    } catch (error) {
      console.error('[CLARITY_DETECTOR] LLM assessment error:', error);
      return null;
    }
  }

  /**
   * Parse LLM response.
   */
  private parseLlmResult(content: string): ClarityDetectionResult | null {
    try {
      // Handle markdown code blocks
      let jsonStr = content;
      if (content.includes('```')) {
        const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        jsonStr = match?.[1]?.trim() ?? content;
      }

      const parsed = JSON.parse(jsonStr);

      const score = Math.max(0, Math.min(1, Number(parsed.score) || 0.5));

      return {
        score,
        isClear: score >= this.config.clarityThreshold,
        extractedGoal: parsed.extractedGoal || undefined,
        unclearAspects: Array.isArray(parsed.unclearAspects) ? parsed.unclearAspects : [],
        suggestedQuestion: parsed.suggestedQuestion || undefined,
        method: 'llm',
        reasoning: parsed.reasoning,
      };
    } catch {
      console.warn('[CLARITY_DETECTOR] Failed to parse LLM response:', content);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RESULT COMBINATION
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Combine pattern and LLM results.
   */
  private combineResults(
    pattern: ClarityDetectionResult,
    llm: ClarityDetectionResult
  ): ClarityDetectionResult {
    // Weight LLM more heavily for nuanced cases
    const combinedScore = pattern.score * 0.3 + llm.score * 0.7;
    const isClear = combinedScore >= this.config.clarityThreshold;

    return {
      score: combinedScore,
      isClear,
      extractedGoal: llm.extractedGoal ?? pattern.extractedGoal,
      unclearAspects: llm.unclearAspects.length > 0 ? llm.unclearAspects : pattern.unclearAspects,
      suggestedQuestion: llm.suggestedQuestion ?? pattern.suggestedQuestion,
      method: 'hybrid',
      reasoning: llm.reasoning,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SPECIAL CASES
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Check if message is confirming a proposed goal.
   */
  isConfirmation(message: string): boolean {
    return CONFIRMATION_PATTERNS.some(p => p.test(message.trim()));
  }

  /**
   * Check if message is requesting to skip exploration.
   */
  isSkipRequest(message: string): boolean {
    return SKIP_PATTERNS.some(p => p.test(message.trim()));
  }

  /**
   * Build result for confirmation.
   */
  private buildConfirmationResult(state?: ExploreState): ClarityDetectionResult {
    const lastCandidate = state?.candidateGoals[state.candidateGoals.length - 1];
    
    return {
      score: 1.0,
      isClear: true,
      extractedGoal: lastCandidate ?? state?.initialStatement,
      unclearAspects: [],
      suggestedQuestion: undefined,
      method: 'pattern',
      reasoning: 'User confirmed proposed goal',
    };
  }

  /**
   * Build result for skip request.
   */
  private buildSkipResult(goalStatement: string): ClarityDetectionResult {
    return {
      score: 0.7, // Treat as moderately clear - user wants to proceed
      isClear: true,
      extractedGoal: this.extractGoal(goalStatement),
      unclearAspects: [],
      suggestedQuestion: undefined,
      method: 'pattern',
      reasoning: 'User requested to skip exploration',
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a ClarityDetector instance.
 */
export function createClarityDetector(
  config?: Partial<ExploreConfig>,
  openaiApiKey?: string
): ClarityDetector {
  return new ClarityDetector(config, openaiApiKey);
}
