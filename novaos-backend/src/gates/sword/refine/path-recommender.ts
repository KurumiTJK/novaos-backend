// ═══════════════════════════════════════════════════════════════════════════════
// PATH RECOMMENDER — Learning Path Selection
// NovaOS Gates — Phase 14C: SwordGate Refine Expansion
// ═══════════════════════════════════════════════════════════════════════════════
//
// Recommends optimal learning paths based on:
//   - User's explore context (interests, constraints, background)
//   - Topic landscape (available paths, prerequisites)
//   - User preferences (time commitment, learning style)
//
// Uses LLM for nuanced matching when simple heuristics aren't sufficient.
//
// ═══════════════════════════════════════════════════════════════════════════════

import OpenAI from 'openai';
import { createTimestamp } from '../../../types/branded.js';
import type { Timestamp } from '../../../types/branded.js';
import type { AsyncAppResult } from '../../../types/result.js';
import { ok, err, appError } from '../../../types/result.js';

import type { ExploreContext } from '../explore/types.js';

import type {
  TopicLandscape,
  LearningPath,
  Prerequisite,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Path recommendation result.
 */
export interface PathRecommendation {
  /** Recommended learning path */
  readonly recommendedPath: LearningPath;

  /** Confidence in the recommendation (0-1) */
  readonly confidence: number;

  /** Reasons for this recommendation */
  readonly reasons: readonly string[];

  /** Signals from user context that matched this path */
  readonly matchedSignals: readonly string[];

  /** Alternative paths if user wants different options */
  readonly alternatives: readonly LearningPath[];

  /** Adjusted duration based on user constraints */
  readonly adjustedWeeks?: number;

  /** Prerequisites the user may need to address */
  readonly prerequisiteGaps?: readonly Prerequisite[];

  /** Recommendation method */
  readonly method: 'heuristic' | 'llm' | 'hybrid';
}

/**
 * User context for path matching.
 */
export interface PathMatchContext {
  /** From explore phase */
  readonly exploreContext?: ExploreContext;

  /** User's stated level */
  readonly userLevel?: 'beginner' | 'intermediate' | 'advanced';

  /** Daily time commitment in minutes */
  readonly dailyTimeCommitment?: number;

  /** Total duration in weeks */
  readonly totalWeeks?: number;

  /** Preferred learning style */
  readonly learningStyle?: 'reading' | 'video' | 'hands-on' | 'mixed';

  /** Specific goals or outcomes */
  readonly targetOutcome?: string;
}

/**
 * Configuration for path recommender.
 */
export interface PathRecommenderConfig {
  /** Use LLM for nuanced matching (default: true) */
  readonly useLlm: boolean;

  /** LLM model to use */
  readonly llmModel: string;

  /** Confidence threshold for heuristic-only recommendation */
  readonly heuristicConfidenceThreshold: number;
}

/**
 * Default recommender configuration.
 */
export const DEFAULT_RECOMMENDER_CONFIG: PathRecommenderConfig = {
  useLlm: true,
  llmModel: 'gpt-4o-mini',
  heuristicConfidenceThreshold: 0.75,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// LLM PROMPT
// ═══════════════════════════════════════════════════════════════════════════════

const PATH_RECOMMENDATION_PROMPT = `You are recommending the best learning path for a user based on their context and available options.

AVAILABLE PATHS:
{paths}

USER CONTEXT:
- Interests: {interests}
- Constraints: {constraints}
- Background: {background}
- Motivations: {motivations}
- Goal: {goal}
- Level: {level}
- Daily time: {dailyTime} minutes
- Target duration: {totalWeeks} weeks
- Learning style: {learningStyle}
- Target outcome: {targetOutcome}

OUTPUT FORMAT (JSON only, no markdown):
{
  "recommendedPathId": "path-id",
  "confidence": 0.0-1.0,
  "reasons": ["reason 1", "reason 2", "reason 3"],
  "matchedSignals": ["signal from context that matched"],
  "adjustedWeeks": null or number,
  "alternativePathIds": ["alt-path-1", "alt-path-2"]
}

RECOMMENDATION GUIDELINES:
1. Match path difficulty to user level and constraints
2. Consider time commitment vs path intensity
3. Align path focus with user interests and motivations
4. Account for background knowledge
5. Adjust duration if user's time differs from path default
6. Provide 1-2 alternatives for different approaches

CONFIDENCE SCORING:
- 0.9+: Strong match on multiple factors
- 0.7-0.9: Good match with minor gaps
- 0.5-0.7: Moderate match, some trade-offs
- <0.5: Weak match, user may need different options

Now recommend the best path:`;

// ═══════════════════════════════════════════════════════════════════════════════
// PATH RECOMMENDER CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Recommends optimal learning paths for users.
 */
export class PathRecommender {
  private openai: OpenAI | null = null;
  private readonly config: PathRecommenderConfig;

  constructor(
    openaiApiKey?: string,
    config?: Partial<PathRecommenderConfig>
  ) {
    this.config = { ...DEFAULT_RECOMMENDER_CONFIG, ...config };

    const key = openaiApiKey ?? process.env.OPENAI_API_KEY;
    if (key && this.config.useLlm) {
      this.openai = new OpenAI({ apiKey: key });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN RECOMMENDATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Recommend the best learning path for a user.
   */
  async recommend(
    landscape: TopicLandscape,
    context: PathMatchContext
  ): AsyncAppResult<PathRecommendation> {
    // Check if we have paths to recommend
    if (landscape.learningPaths.length === 0) {
      return err(appError('NO_PATHS', 'No learning paths available in landscape'));
    }

    // If only one path, recommend it
    if (landscape.learningPaths.length === 1) {
      return ok(this.buildSinglePathRecommendation(landscape.learningPaths[0]!, context, landscape.prerequisites));
    }

    try {
      // Try heuristic matching first
      const heuristicResult = this.matchWithHeuristics(landscape, context);

      // If high confidence, use heuristic result
      if (heuristicResult.confidence >= this.config.heuristicConfidenceThreshold) {
        return ok(heuristicResult);
      }

      // Use LLM for more nuanced matching
      if (this.openai && this.config.useLlm) {
        const llmResult = await this.matchWithLlm(landscape, context);
        if (llmResult) {
          return ok(llmResult);
        }
      }

      // Fall back to heuristic result
      return ok(heuristicResult);
    } catch (error) {
      console.error('[PATH_RECOMMENDER] Recommendation failed:', error);
      
      // Fall back to first path
      return ok(this.buildSinglePathRecommendation(landscape.learningPaths[0]!, context, landscape.prerequisites));
    }
  }

  /**
   * Quick synchronous recommendation using heuristics only.
   */
  recommendSync(
    landscape: TopicLandscape,
    context: PathMatchContext
  ): PathRecommendation | null {
    if (landscape.learningPaths.length === 0) {
      return null;
    }

    if (landscape.learningPaths.length === 1) {
      return this.buildSinglePathRecommendation(landscape.learningPaths[0]!, context, landscape.prerequisites);
    }

    return this.matchWithHeuristics(landscape, context);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HEURISTIC MATCHING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Match paths using heuristic rules.
   */
  private matchWithHeuristics(
    landscape: TopicLandscape,
    context: PathMatchContext
  ): PathRecommendation {
    const scores: { path: LearningPath; score: number; reasons: string[]; signals: string[] }[] = [];

    for (const path of landscape.learningPaths) {
      const { score, reasons, signals } = this.scorePath(path, context);
      scores.push({ path, score, reasons, signals });
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    const best = scores[0]!;
    const alternatives = scores.slice(1, 3).map(s => s.path);

    // Calculate adjusted duration
    const adjustedWeeks = this.calculateAdjustedDuration(best.path, context);

    // Identify prerequisite gaps
    const prerequisiteGaps = this.identifyPrerequisiteGaps(landscape.prerequisites, context);

    return {
      recommendedPath: best.path,
      confidence: Math.min(1, best.score),
      reasons: best.reasons,
      matchedSignals: best.signals,
      alternatives,
      adjustedWeeks,
      prerequisiteGaps: prerequisiteGaps.length > 0 ? prerequisiteGaps : undefined,
      method: 'heuristic',
    };
  }

  /**
   * Score a path against user context.
   */
  private scorePath(
    path: LearningPath,
    context: PathMatchContext
  ): { score: number; reasons: string[]; signals: string[] } {
    let score = 0.5; // Base score
    const reasons: string[] = [];
    const signals: string[] = [];

    // ─────────────────────────────────────────────────────────────────────────
    // Difficulty matching
    // ─────────────────────────────────────────────────────────────────────────
    const level = context.userLevel ?? (context.exploreContext?.background?.length ? 'intermediate' : 'beginner');

    if (path.difficulty === 'gradual' && level === 'beginner') {
      score += 0.25;
      reasons.push('Gradual pace suits beginners');
      signals.push('beginner level');
    } else if (path.difficulty === 'intensive' && level === 'beginner') {
      score -= 0.15;
      reasons.push('Intensive pace may be challenging for beginners');
    } else if (path.difficulty === 'intensive' && (level === 'intermediate' || level === 'advanced')) {
      score += 0.15;
      reasons.push('Intensive pace matches experience level');
      signals.push(`${level} level`);
    } else if (path.difficulty === 'self-paced') {
      score += 0.1;
      reasons.push('Self-paced allows flexibility');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Time commitment matching
    // ─────────────────────────────────────────────────────────────────────────
    if (context.dailyTimeCommitment) {
      if (context.dailyTimeCommitment < 30 && path.difficulty === 'gradual') {
        score += 0.1;
        reasons.push('Path pacing fits limited daily time');
        signals.push(`${context.dailyTimeCommitment}min/day`);
      } else if (context.dailyTimeCommitment >= 60 && path.difficulty === 'intensive') {
        score += 0.1;
        reasons.push('Sufficient time for intensive pace');
        signals.push(`${context.dailyTimeCommitment}min/day`);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Duration matching
    // ─────────────────────────────────────────────────────────────────────────
    if (context.totalWeeks) {
      const durationRatio = context.totalWeeks / path.estimatedWeeks;
      if (durationRatio >= 0.8 && durationRatio <= 1.5) {
        score += 0.1;
        reasons.push('Duration aligns with timeline');
        signals.push(`${context.totalWeeks} weeks target`);
      } else if (durationRatio < 0.5) {
        score -= 0.1;
        reasons.push('Timeline may be too short for this path');
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Interest matching (from explore context)
    // ─────────────────────────────────────────────────────────────────────────
    if (context.exploreContext?.interests) {
      for (const interest of context.exploreContext.interests) {
        const interestLower = interest.toLowerCase();
        
        // Check path description and bestFor
        if (path.description.toLowerCase().includes(interestLower) ||
            path.bestFor.some(b => b.toLowerCase().includes(interestLower))) {
          score += 0.1;
          reasons.push(`Aligns with interest: ${interest}`);
          signals.push(interest);
        }

        // Check target role
        if (path.targetRole?.toLowerCase().includes(interestLower)) {
          score += 0.15;
          reasons.push(`Targets role aligned with interest: ${interest}`);
          signals.push(interest);
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Motivation matching
    // ─────────────────────────────────────────────────────────────────────────
    if (context.exploreContext?.motivations) {
      for (const motivation of context.exploreContext.motivations) {
        const motivationLower = motivation.toLowerCase();

        if (motivationLower.includes('career') && path.targetRole) {
          score += 0.1;
          reasons.push('Path has clear career outcome');
          signals.push('career-focused');
        }

        if (motivationLower.includes('fast') && path.difficulty === 'intensive') {
          score += 0.1;
          reasons.push('Intensive pace for quick progress');
          signals.push('fast learning');
        }

        if ((motivationLower.includes('thorough') || motivationLower.includes('deep')) && 
            path.difficulty === 'gradual') {
          score += 0.1;
          reasons.push('Gradual pace for thorough understanding');
          signals.push('deep learning');
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Constraint matching
    // ─────────────────────────────────────────────────────────────────────────
    if (context.exploreContext?.constraints) {
      for (const constraint of context.exploreContext.constraints) {
        const constraintLower = constraint.toLowerCase();

        if (constraintLower.includes('flexible') && path.difficulty === 'self-paced') {
          score += 0.15;
          reasons.push('Self-paced accommodates flexibility needs');
          signals.push('flexibility needed');
        }

        if (constraintLower.includes('limited time') && path.difficulty === 'gradual') {
          score += 0.1;
          reasons.push('Gradual pace works with limited time');
          signals.push('limited time');
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BestFor matching
    // ─────────────────────────────────────────────────────────────────────────
    const background = context.exploreContext?.background ?? [];
    for (const bestFor of path.bestFor) {
      const bestForLower = bestFor.toLowerCase();
      
      if (background.some(b => bestForLower.includes(b.toLowerCase()))) {
        score += 0.1;
        reasons.push(`Path is suited for your background`);
        signals.push(...background.filter(b => bestForLower.includes(b.toLowerCase())));
      }

      if (bestForLower.includes('beginner') && level === 'beginner') {
        score += 0.1;
        reasons.push('Path designed for beginners');
      }
    }

    // Normalize score
    score = Math.max(0, Math.min(1, score));

    // Deduplicate reasons and signals
    return {
      score,
      reasons: [...new Set(reasons)].slice(0, 5),
      signals: [...new Set(signals)].slice(0, 5),
    };
  }

  /**
   * Calculate adjusted duration based on user's time commitment.
   */
  private calculateAdjustedDuration(
    path: LearningPath,
    context: PathMatchContext
  ): number | undefined {
    if (!context.dailyTimeCommitment) {
      return undefined;
    }

    // Assume path was designed for 60 min/day
    const baseMinutesPerDay = 60;
    const ratio = baseMinutesPerDay / context.dailyTimeCommitment;

    const adjustedWeeks = Math.ceil(path.estimatedWeeks * ratio);

    // Only return if significantly different
    if (Math.abs(adjustedWeeks - path.estimatedWeeks) >= 1) {
      return adjustedWeeks;
    }

    return undefined;
  }

  /**
   * Identify prerequisites the user may be missing.
   */
  private identifyPrerequisiteGaps(
    prerequisites: readonly Prerequisite[],
    context: PathMatchContext
  ): Prerequisite[] {
    const gaps: Prerequisite[] = [];
    const background = context.exploreContext?.background ?? [];

    // If no background specified, assume all required prereqs are gaps
    if (background.length === 0) {
      return prerequisites.filter(p => p.importance === 'required');
    }

    const backgroundLower = background.map(b => b.toLowerCase());

    for (const prereq of prerequisites) {
      if (prereq.importance === 'required') {
        // Check if user's background covers this
        const covered = backgroundLower.some(b => 
          prereq.topic.toLowerCase().includes(b) ||
          b.includes(prereq.topic.toLowerCase())
        );

        if (!covered) {
          gaps.push(prereq);
        }
      }
    }

    return gaps;
  }

  /**
   * Build recommendation for a single path.
   */
  private buildSinglePathRecommendation(
    path: LearningPath,
    context: PathMatchContext,
    prerequisites: readonly Prerequisite[] = []
  ): PathRecommendation {
    const prerequisiteGaps = this.identifyPrerequisiteGaps(prerequisites, context);
    
    return {
      recommendedPath: path,
      confidence: 0.8,
      reasons: ['Only available path for this topic'],
      matchedSignals: [],
      alternatives: [],
      adjustedWeeks: this.calculateAdjustedDuration(path, context),
      prerequisiteGaps: prerequisiteGaps.length > 0 ? prerequisiteGaps : undefined,
      method: 'heuristic',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LLM MATCHING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Match paths using LLM for nuanced understanding.
   */
  private async matchWithLlm(
    landscape: TopicLandscape,
    context: PathMatchContext
  ): Promise<PathRecommendation | null> {
    if (!this.openai) {
      return null;
    }

    try {
      // Build paths description
      const pathsDescription = landscape.learningPaths.map(p => 
        `- ID: ${p.id}
  Name: ${p.name}
  Description: ${p.description}
  Target Role: ${p.targetRole || 'General'}
  Difficulty: ${p.difficulty}
  Duration: ${p.estimatedWeeks} weeks
  Best For: ${p.bestFor.join(', ')}`
      ).join('\n\n');

      // Build prompt
      const prompt = PATH_RECOMMENDATION_PROMPT
        .replace('{paths}', pathsDescription)
        .replace('{interests}', (context.exploreContext?.interests ?? []).join(', ') || 'not specified')
        .replace('{constraints}', (context.exploreContext?.constraints ?? []).join(', ') || 'not specified')
        .replace('{background}', (context.exploreContext?.background ?? []).join(', ') || 'not specified')
        .replace('{motivations}', (context.exploreContext?.motivations ?? []).join(', ') || 'not specified')
        .replace('{goal}', context.exploreContext?.crystallizedGoal || 'not specified')
        .replace('{level}', context.userLevel || 'not specified')
        .replace('{dailyTime}', String(context.dailyTimeCommitment || 'not specified'))
        .replace('{totalWeeks}', String(context.totalWeeks || 'not specified'))
        .replace('{learningStyle}', context.learningStyle || 'not specified')
        .replace('{targetOutcome}', context.targetOutcome || 'not specified');

      const response = await this.openai.chat.completions.create({
        model: this.config.llmModel,
        messages: [
          { role: 'system', content: prompt },
        ],
        max_tokens: 500,
        temperature: 0.2,
      });

      const content = response.choices[0]?.message?.content?.trim() ?? '';
      return this.parseLlmRecommendation(content, landscape, context);
    } catch (error) {
      console.error('[PATH_RECOMMENDER] LLM matching failed:', error);
      return null;
    }
  }

  /**
   * Parse LLM recommendation response.
   */
  private parseLlmRecommendation(
    content: string,
    landscape: TopicLandscape,
    context: PathMatchContext
  ): PathRecommendation | null {
    try {
      // Handle potential markdown code blocks
      let jsonStr = content;
      if (content.includes('```')) {
        const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        jsonStr = match?.[1]?.trim() ?? content;
      }

      const parsed = JSON.parse(jsonStr.trim());

      // Find recommended path
      const recommendedPath = landscape.learningPaths.find(p => p.id === parsed.recommendedPathId);
      if (!recommendedPath) {
        return null;
      }

      // Find alternatives
      const alternativeIds = parsed.alternativePathIds ?? [];
      const alternatives = landscape.learningPaths.filter(p => 
        alternativeIds.includes(p.id) && p.id !== recommendedPath.id
      );

      // Identify prerequisite gaps
      const prerequisiteGaps = this.identifyPrerequisiteGaps(landscape.prerequisites, context);

      return {
        recommendedPath,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.7)),
        reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String) : [],
        matchedSignals: Array.isArray(parsed.matchedSignals) ? parsed.matchedSignals.map(String) : [],
        alternatives,
        adjustedWeeks: parsed.adjustedWeeks ? Number(parsed.adjustedWeeks) : undefined,
        prerequisiteGaps: prerequisiteGaps.length > 0 ? prerequisiteGaps : undefined,
        method: 'llm',
      };
    } catch {
      console.warn('[PATH_RECOMMENDER] Failed to parse LLM response:', content);
      return null;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a PathRecommender instance.
 */
export function createPathRecommender(
  openaiApiKey?: string,
  config?: Partial<PathRecommenderConfig>
): PathRecommender {
  return new PathRecommender(openaiApiKey, config);
}
