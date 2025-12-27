// ═══════════════════════════════════════════════════════════════════════════════
// PREREQUISITE ASSESSOR — Multi-Turn Knowledge Evaluation
// NovaOS Gates — Phase 14D: SwordGate Refine Expansion
// ═══════════════════════════════════════════════════════════════════════════════
//
// Assesses user's prerequisite knowledge through:
//   - Question generation from prerequisite definitions
//   - Response parsing to determine proficiency level
//   - Summary generation with adjusted duration recommendations
//
// Supports both quick self-assessment and detailed evaluation.
//
// ═══════════════════════════════════════════════════════════════════════════════

import OpenAI from 'openai';
import { createTimestamp } from '../../../types/branded.js';
import type { Timestamp } from '../../../types/branded.js';
import type { UserId } from '../../../types/branded.js';
import type { AsyncAppResult } from '../../../types/result.js';
import { ok, err, appError } from '../../../types/result.js';

import type {
  Prerequisite,
  PrerequisiteAssessmentResult,
  PrerequisiteStatus,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Proficiency levels for prerequisites.
 */
export type ProficiencyLevel = 'proficient' | 'familiar' | 'needs_review' | 'needs_learning' | 'skipped';

/**
 * Assessment question for a prerequisite.
 */
export interface AssessmentQuestion {
  /** The prerequisite being assessed */
  readonly prerequisite: Prerequisite;

  /** The question to ask */
  readonly question: string;

  /** Index in the assessment sequence */
  readonly index: number;

  /** Total questions in assessment */
  readonly total: number;
}

/**
 * State of an ongoing assessment.
 */
export interface AssessmentState {
  /** User ID */
  readonly userId: UserId;

  /** Prerequisites being assessed */
  readonly prerequisites: readonly Prerequisite[];

  /** Assessment results so far */
  readonly assessments: readonly PrerequisiteStatus[];

  /** Current prerequisite index */
  readonly currentIndex: number;

  /** Whether assessment is complete */
  readonly isComplete: boolean;

  /** Timestamp when started */
  readonly startedAt: Timestamp;

  /** Timestamp when completed */
  readonly completedAt?: Timestamp;
}

/**
 * Configuration for prerequisite assessor.
 */
export interface PrerequisiteAssessorConfig {
  /** Use LLM for response parsing (default: true) */
  readonly useLlm: boolean;

  /** LLM model to use */
  readonly llmModel: string;

  /** Default weeks for needs_learning (when not specified in prerequisite) */
  readonly defaultLearningWeeks: number;

  /** Default weeks for needs_review */
  readonly defaultReviewWeeks: number;

  /** Enable quick self-assessment mode */
  readonly enableQuickMode: boolean;
}

/**
 * Default assessor configuration.
 */
export const DEFAULT_ASSESSOR_CONFIG: PrerequisiteAssessorConfig = {
  useLlm: true,
  llmModel: 'gpt-4o-mini',
  defaultLearningWeeks: 2,
  defaultReviewWeeks: 0.5,
  enableQuickMode: true,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// PROFICIENCY PATTERNS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Patterns for detecting proficiency levels from user responses.
 */
const PROFICIENCY_PATTERNS: Record<ProficiencyLevel, readonly RegExp[]> = {
  proficient: [
    /\b(expert|proficient|advanced|master|fluent|years? of experience)\b/i,
    /\b(very (familiar|comfortable|experienced)|know (it )?(very )?(well|thoroughly))\b/i,
    /\buse\b.{0,15}\bdaily\b/i,
    /\bwork with\b.{0,15}\b(all the time|regularly)\b/i,
    /\bprofessional\b/i,
    /\b(yes|yep|yeah|definitely|absolutely|of course)[,.]?\s*(i know|i can|i do)/i,
    /\b(been (using|doing|working)|i('ve| have) (used|worked|done))\s+.{0,20}\s*(for )?\d+\s*(years?|months?)/i,
  ],
  familiar: [
    /\b(familiar|comfortable|know (the )?basics|some experience)\b/i,
    /\b(i('ve| have) (used|done|worked|learned)|used before)\b/i,
    /\b(pretty good|decent|okay|reasonable)\b/i,
    /\b(understand (the )?(basics|fundamentals|concepts))\b/i,
    /\b(took a (course|class)|learned (it )?in (school|college))\b/i,
  ],
  needs_review: [
    /\b(rusty|forgot|need(s)? (a )?(refresher|review)|been a while)\b/i,
    /\b(used to know|knew (it )?before|out of practice)\b/i,
    /\b(vaguely remember|some memory of|not recently)\b/i,
    /\b(could use (a )?review|might need to brush up)\b/i,
    /\b(learned (it )?long ago|years ago)\b/i,
  ],
  needs_learning: [
    /\b(no|nope|not really|never|don't know)\b/i,
    /\b(new to (me|this)|unfamiliar|no experience)\b/i,
    /\b(haven't (learned|used|done)|never (used|learned|done))\b/i,
    /\b(complete(ly)? new|total(ly)? new|brand new)\b/i,
    /\b(what('s| is) (that|this)|don't understand)\b/i,
    /\b(first time|starting from (scratch|zero))\b/i,
  ],
  skipped: [
    /\b(skip|pass|later|not now|move on)\b/i,
    /\b(don't (want to )?answer|prefer not to)\b/i,
    /\b(next|continue|go ahead)\b/i,
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// LLM PROMPT
// ═══════════════════════════════════════════════════════════════════════════════

const PROFICIENCY_ASSESSMENT_PROMPT = `You are assessing a user's proficiency level with a prerequisite skill based on their response.

PREREQUISITE: {prerequisite}
QUESTION ASKED: {question}
USER'S RESPONSE: "{response}"

Determine the user's proficiency level:
- proficient: Expert level, uses regularly, years of experience
- familiar: Knows the basics, has used it before, comfortable
- needs_review: Learned before but rusty, needs a refresher
- needs_learning: New to this, no experience, needs to learn from scratch
- skipped: User chose to skip this question

OUTPUT FORMAT (JSON only, no markdown):
{
  "level": "proficient|familiar|needs_review|needs_learning|skipped",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}

Be generous in interpretation - if the user expresses any familiarity, lean toward "familiar" rather than "needs_learning".`;

// ═══════════════════════════════════════════════════════════════════════════════
// PREREQUISITE ASSESSOR CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Assesses user's prerequisite knowledge.
 */
export class PrerequisiteAssessor {
  private openai: OpenAI | null = null;
  private readonly config: PrerequisiteAssessorConfig;

  // In-memory state storage (could be extended to use Redis)
  private readonly states: Map<string, AssessmentState> = new Map();

  constructor(
    openaiApiKey?: string,
    config?: Partial<PrerequisiteAssessorConfig>
  ) {
    this.config = { ...DEFAULT_ASSESSOR_CONFIG, ...config };

    const key = openaiApiKey ?? process.env.OPENAI_API_KEY;
    if (key && this.config.useLlm) {
      this.openai = new OpenAI({ apiKey: key });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ASSESSMENT FLOW
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start a new prerequisite assessment.
   */
  startAssessment(
    userId: UserId,
    prerequisites: readonly Prerequisite[]
  ): AssessmentQuestion | null {
    // Filter to only required and recommended prerequisites
    const toAssess = prerequisites.filter(p => 
      p.importance === 'required' || p.importance === 'recommended'
    );

    if (toAssess.length === 0) {
      return null;
    }

    // Create initial state
    const state: AssessmentState = {
      userId,
      prerequisites: toAssess,
      assessments: [],
      currentIndex: 0,
      isComplete: false,
      startedAt: createTimestamp(),
    };

    this.states.set(userId, state);

    return this.buildQuestion(toAssess[0]!, 0, toAssess.length);
  }

  /**
   * Process user response and get next question or results.
   */
  async processResponse(
    userId: UserId,
    response: string
  ): AsyncAppResult<{
    nextQuestion: AssessmentQuestion | null;
    result: PrerequisiteAssessmentResult | null;
  }> {
    const state = this.states.get(userId);
    if (!state) {
      return err(appError('NOT_FOUND', 'No active assessment found'));
    }

    if (state.isComplete) {
      return ok({
        nextQuestion: null,
        result: this.buildResult(state),
      });
    }

    // Assess the response
    const currentPrereq = state.prerequisites[state.currentIndex]!;
    const assessment = await this.assessResponse(currentPrereq, response);

    // Update state
    const updatedAssessments = [...state.assessments, assessment];
    const nextIndex = state.currentIndex + 1;
    const isComplete = nextIndex >= state.prerequisites.length;

    const updatedState: AssessmentState = {
      ...state,
      assessments: updatedAssessments,
      currentIndex: nextIndex,
      isComplete,
      completedAt: isComplete ? createTimestamp() : undefined,
    };

    this.states.set(userId, updatedState);

    if (isComplete) {
      return ok({
        nextQuestion: null,
        result: this.buildResult(updatedState),
      });
    }

    const nextPrereq = state.prerequisites[nextIndex]!;
    return ok({
      nextQuestion: this.buildQuestion(nextPrereq, nextIndex, state.prerequisites.length),
      result: null,
    });
  }

  /**
   * Get current assessment state.
   */
  getState(userId: UserId): AssessmentState | null {
    return this.states.get(userId) ?? null;
  }

  /**
   * Skip remaining assessments and use defaults.
   */
  skipRemaining(userId: UserId): PrerequisiteAssessmentResult | null {
    const state = this.states.get(userId);
    if (!state) {
      return null;
    }

    // Mark remaining as skipped
    const skippedAssessments: PrerequisiteStatus[] = [];
    for (let i = state.currentIndex; i < state.prerequisites.length; i++) {
      skippedAssessments.push({
        prerequisite: state.prerequisites[i]!,
        status: 'skipped',
        confidence: 1,
      });
    }

    const updatedState: AssessmentState = {
      ...state,
      assessments: [...state.assessments, ...skippedAssessments],
      isComplete: true,
      completedAt: createTimestamp(),
    };

    this.states.set(userId, updatedState);
    return this.buildResult(updatedState);
  }

  /**
   * Quick assessment - user self-reports for all prerequisites at once.
   */
  quickAssess(
    prerequisites: readonly Prerequisite[],
    selfReport: Record<string, ProficiencyLevel>
  ): PrerequisiteAssessmentResult {
    const assessments: PrerequisiteStatus[] = prerequisites.map(prereq => ({
      prerequisite: prereq,
      status: selfReport[prereq.topic] ?? 'needs_learning',
      confidence: 0.7, // Lower confidence for self-report
    }));

    return this.calculateResult(assessments);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RESPONSE ASSESSMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Assess a user's response to determine proficiency.
   */
  private async assessResponse(
    prerequisite: Prerequisite,
    response: string
  ): Promise<PrerequisiteStatus> {
    // Try pattern matching first
    const patternResult = this.assessWithPatterns(response);
    if (patternResult.confidence >= 0.8) {
      return {
        prerequisite,
        status: patternResult.level,
        userResponse: response,
        confidence: patternResult.confidence,
      };
    }

    // Use LLM for ambiguous responses
    if (this.openai && this.config.useLlm) {
      const llmResult = await this.assessWithLlm(prerequisite, response);
      if (llmResult) {
        return {
          prerequisite,
          status: llmResult.level,
          userResponse: response,
          confidence: llmResult.confidence,
        };
      }
    }

    // Fall back to pattern result
    return {
      prerequisite,
      status: patternResult.level,
      userResponse: response,
      confidence: patternResult.confidence,
    };
  }

  /**
   * Assess using pattern matching.
   */
  private assessWithPatterns(
    response: string
  ): { level: ProficiencyLevel; confidence: number } {
    const normalizedResponse = response.toLowerCase().trim();

    // Check each level's patterns
    for (const [level, patterns] of Object.entries(PROFICIENCY_PATTERNS) as [ProficiencyLevel, readonly RegExp[]][]) {
      for (const pattern of patterns) {
        if (pattern.test(normalizedResponse)) {
          // Stronger patterns get higher confidence
          const isStrongPattern = pattern.toString().includes('years?') ||
            pattern.toString().includes('expert') ||
            pattern.toString().includes('never');
          
          return {
            level,
            confidence: isStrongPattern ? 0.9 : 0.75,
          };
        }
      }
    }

    // No strong match - default to needs_review (safer middle ground)
    return { level: 'needs_review', confidence: 0.5 };
  }

  /**
   * Assess using LLM.
   */
  private async assessWithLlm(
    prerequisite: Prerequisite,
    response: string
  ): Promise<{ level: ProficiencyLevel; confidence: number } | null> {
    if (!this.openai) {
      return null;
    }

    try {
      const prompt = PROFICIENCY_ASSESSMENT_PROMPT
        .replace('{prerequisite}', prerequisite.topic)
        .replace('{question}', prerequisite.assessmentQuestion ?? `Do you have experience with ${prerequisite.topic}?`)
        .replace('{response}', response);

      const completion = await this.openai.chat.completions.create({
        model: this.config.llmModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 150,
        temperature: 0.1,
      });

      const content = completion.choices[0]?.message?.content?.trim() ?? '';
      return this.parseLlmAssessment(content);
    } catch (error) {
      console.error('[PREREQ_ASSESSOR] LLM assessment failed:', error);
      return null;
    }
  }

  /**
   * Parse LLM assessment response.
   */
  private parseLlmAssessment(
    content: string
  ): { level: ProficiencyLevel; confidence: number } | null {
    try {
      let jsonStr = content;
      if (content.includes('```')) {
        const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        jsonStr = match?.[1]?.trim() ?? content;
      }

      const parsed = JSON.parse(jsonStr.trim());
      const validLevels: ProficiencyLevel[] = ['proficient', 'familiar', 'needs_review', 'needs_learning', 'skipped'];

      if (!validLevels.includes(parsed.level)) {
        return null;
      }

      return {
        level: parsed.level,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.7)),
      };
    } catch {
      console.warn('[PREREQ_ASSESSOR] Failed to parse LLM response:', content);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RESULT BUILDING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Build assessment result from state.
   */
  private buildResult(state: AssessmentState): PrerequisiteAssessmentResult {
    return this.calculateResult(state.assessments);
  }

  /**
   * Calculate assessment result from assessments.
   */
  private calculateResult(
    assessments: readonly PrerequisiteStatus[]
  ): PrerequisiteAssessmentResult {
    // Calculate additional weeks needed
    let additionalWeeks = 0;
    const gaps: PrerequisiteStatus[] = [];

    for (const assessment of assessments) {
      const prereq = assessment.prerequisite;

      switch (assessment.status) {
        case 'needs_learning':
          additionalWeeks += prereq.estimatedWeeks ?? this.config.defaultLearningWeeks;
          gaps.push(assessment);
          break;
        case 'needs_review':
          additionalWeeks += this.config.defaultReviewWeeks;
          gaps.push(assessment);
          break;
        case 'skipped':
          // Assume needs learning if skipped and required
          if (prereq.importance === 'required') {
            additionalWeeks += prereq.estimatedWeeks ?? this.config.defaultLearningWeeks;
            gaps.push(assessment);
          }
          break;
      }
    }

    // Determine if ready to start
    const hasRequiredGaps = gaps.some(g => 
      g.prerequisite.importance === 'required' && 
      (g.status === 'needs_learning' || g.status === 'skipped')
    );

    // Build summary
    const summary = this.buildSummary(assessments, additionalWeeks, hasRequiredGaps);

    return {
      assessments,
      additionalWeeksNeeded: Math.round(additionalWeeks * 10) / 10, // Round to 1 decimal
      summary,
      readyToStart: !hasRequiredGaps,
    };
  }

  /**
   * Build human-readable summary.
   */
  private buildSummary(
    assessments: readonly PrerequisiteStatus[],
    additionalWeeks: number,
    hasRequiredGaps: boolean
  ): string {
    const proficientCount = assessments.filter(a => a.status === 'proficient').length;
    const familiarCount = assessments.filter(a => a.status === 'familiar').length;
    const needsReviewCount = assessments.filter(a => a.status === 'needs_review').length;
    const needsLearningCount = assessments.filter(a => a.status === 'needs_learning').length;

    const parts: string[] = [];

    if (proficientCount > 0) {
      parts.push(`Proficient in ${proficientCount} prerequisite${proficientCount > 1 ? 's' : ''}`);
    }
    if (familiarCount > 0) {
      parts.push(`familiar with ${familiarCount}`);
    }
    if (needsReviewCount > 0) {
      parts.push(`${needsReviewCount} need${needsReviewCount > 1 ? '' : 's'} review`);
    }
    if (needsLearningCount > 0) {
      parts.push(`${needsLearningCount} need${needsLearningCount > 1 ? '' : 's'} learning`);
    }

    let summary = parts.join(', ') + '.';

    if (additionalWeeks > 0) {
      summary += ` Estimated ${additionalWeeks} additional week${additionalWeeks !== 1 ? 's' : ''} for preparation.`;
    }

    if (hasRequiredGaps) {
      summary += ' Some required prerequisites need attention before starting.';
    } else {
      summary += ' Ready to begin the learning path.';
    }

    return summary;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Build a question for a prerequisite.
   */
  private buildQuestion(
    prerequisite: Prerequisite,
    index: number,
    total: number
  ): AssessmentQuestion {
    const question = prerequisite.assessmentQuestion ??
      `How familiar are you with ${prerequisite.topic}? ${prerequisite.reason}`;

    return {
      prerequisite,
      question,
      index: index + 1,
      total,
    };
  }

  /**
   * Generate questions for all prerequisites.
   */
  generateQuestions(prerequisites: readonly Prerequisite[]): AssessmentQuestion[] {
    return prerequisites.map((prereq, index) => 
      this.buildQuestion(prereq, index, prerequisites.length)
    );
  }

  /**
   * Get a quick self-assessment prompt.
   */
  getQuickAssessmentPrompt(prerequisites: readonly Prerequisite[]): string {
    const lines = [
      "Let's quickly check your background knowledge. Rate yourself on each:",
      "",
    ];

    for (const prereq of prerequisites) {
      lines.push(`• ${prereq.topic} - ${prereq.reason}`);
    }

    lines.push("");
    lines.push("Options: proficient / familiar / need review / new to this");

    return lines.join('\n');
  }

  /**
   * Parse quick assessment response.
   */
  parseQuickAssessment(
    prerequisites: readonly Prerequisite[],
    response: string
  ): Record<string, ProficiencyLevel> {
    const result: Record<string, ProficiencyLevel> = {};
    const responseLower = response.toLowerCase();

    for (const prereq of prerequisites) {
      const topicLower = prereq.topic.toLowerCase();

      // Try to find the topic mentioned with a level
      const topicIndex = responseLower.indexOf(topicLower);
      if (topicIndex !== -1) {
        // Find clause boundaries (delimiters that separate topic discussions)
        const beforeTopic = responseLower.substring(0, topicIndex);
        const afterTopic = responseLower.substring(topicIndex + topicLower.length);
        
        // Find the start of this clause (after last delimiter before topic)
        const lastDelimiterBefore = Math.max(
          beforeTopic.lastIndexOf(','),
          beforeTopic.lastIndexOf(';'),
          beforeTopic.lastIndexOf('.'),
          beforeTopic.lastIndexOf(' but '),
          beforeTopic.lastIndexOf(' and ')
        );
        const clauseStart = lastDelimiterBefore >= 0 ? lastDelimiterBefore : 0;
        
        // Find the end of this clause (next delimiter after topic)
        const delimiterMatch = afterTopic.match(/[,;.]|\s+but\s+|\s+and\s+/);
        const clauseEndOffset = delimiterMatch ? delimiterMatch.index! : afterTopic.length;
        
        // Extract the clause containing this topic
        const clauseText = beforeTopic.substring(clauseStart) + afterTopic.substring(0, clauseEndOffset);

        // Check patterns in order of specificity
        if (clauseText.match(/\b(proficient|expert|advanced)\b/)) {
          result[prereq.topic] = 'proficient';
        } else if (clauseText.match(/\b(familiar|basics?|some)\b/)) {
          result[prereq.topic] = 'familiar';
        } else if (clauseText.match(/\b(rusty|review|refresh|forgot)\b/)) {
          result[prereq.topic] = 'needs_review';
        } else if (clauseText.match(/\b(new|never|don't|no|none)\b/)) {
          result[prereq.topic] = 'needs_learning';
        }
      }

      // Default if not found
      if (!result[prereq.topic]) {
        result[prereq.topic] = 'needs_review'; // Safe default
      }
    }

    return result;
  }

  /**
   * Clear assessment state for a user.
   */
  clearState(userId: UserId): void {
    this.states.delete(userId);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a PrerequisiteAssessor instance.
 */
export function createPrerequisiteAssessor(
  openaiApiKey?: string,
  config?: Partial<PrerequisiteAssessorConfig>
): PrerequisiteAssessor {
  return new PrerequisiteAssessor(openaiApiKey, config);
}
