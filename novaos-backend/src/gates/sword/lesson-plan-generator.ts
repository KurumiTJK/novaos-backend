// ═══════════════════════════════════════════════════════════════════════════════
// LESSON PLAN GENERATOR — Goal → Curriculum Pipeline
// NovaOS Gates — Phase 13: SwordGate Integration
// ═══════════════════════════════════════════════════════════════════════════════
//
// Generates lesson plan proposals from refined user inputs:
//   1. Extract topics from goal statement
//   2. Discover resources (Phase 6)
//   3. Generate curriculum structure (Phase 7)
//   4. Build LessonPlanProposal for user confirmation
//
// Integrates:
//   - Phase 6: Resource Discovery (verified resources)
//   - Phase 7: Curriculum Structuring (LLM-based organization)
//
// ═══════════════════════════════════════════════════════════════════════════════

import { createTimestamp } from '../../types/branded.js';
import type { Timestamp } from '../../types/branded.js';
import type { AsyncAppResult, AppError } from '../../types/result.js';
import { ok, err, appError } from '../../types/result.js';

import type { LearningConfig, UserLevel, DayOfWeek } from '../../services/spark-engine/types.js';

import type {
  SwordRefinementInputs,
  SwordGateConfig,
  LessonPlanProposal,
  ProposedQuest,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 6 & 7 INTEGRATION TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Verified resource from Phase 6.
 * Simplified interface for our needs.
 */
export interface VerifiedResource {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly canonicalUrl: string;
  readonly provider: string;
  readonly contentType: string;
  readonly topics: readonly string[];
  readonly estimatedMinutes?: number;
  readonly difficulty?: string;
  readonly quality?: {
    readonly score: number;
  };
}

/**
 * Resource discovery request.
 */
export interface ResourceDiscoveryRequest {
  readonly topics: readonly string[];
  readonly maxResults?: number;
  readonly contentTypes?: readonly string[];
  readonly difficulty?: string;
}

/**
 * Resource discovery result.
 */
export interface ResourceDiscoveryResult {
  readonly resources: readonly VerifiedResource[];
  readonly topicsCovered: readonly string[];
  readonly gaps: readonly string[];
}

/**
 * Curriculum generation request.
 */
export interface CurriculumRequest {
  readonly goal: string;
  readonly resources: readonly VerifiedResource[];
  readonly days: number;
  readonly minutesPerDay: number;
  readonly targetDifficulty: string;
  readonly topics: readonly string[];
  readonly userId?: string;
  readonly preferences?: {
    readonly includeExercises?: boolean;
    readonly progression?: 'gradual' | 'intensive' | 'relaxed';
  };
}

/**
 * Generated curriculum structure.
 */
export interface GeneratedCurriculum {
  readonly days: readonly CurriculumDay[];
  readonly summary: string;
  readonly totalMinutes: number;
  readonly topicsCovered: readonly string[];
}

/**
 * Single day in the curriculum.
 */
export interface CurriculumDay {
  readonly day: number;
  readonly theme: string;
  readonly objectives: readonly string[];
  readonly resources: readonly {
    readonly resourceId: string;
    readonly title: string;
    readonly minutes: number;
    readonly focus?: string;
  }[];
  readonly exercises: readonly {
    readonly type: string;
    readonly description: string;
    readonly minutes: number;
  }[];
  readonly totalMinutes: number;
}

/**
 * Interface for resource discovery service.
 */
export interface IResourceDiscoveryService {
  discover(request: ResourceDiscoveryRequest): AsyncAppResult<ResourceDiscoveryResult>;
}

/**
 * Interface for curriculum generation service.
 */
export interface ICurriculumService {
  generate(request: CurriculumRequest): AsyncAppResult<GeneratedCurriculum>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOPIC EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Common topic mappings for learning goals.
 */
const TOPIC_MAPPINGS: Record<string, readonly string[]> = {
  // Programming languages
  'rust': ['language:rust', 'language:rust:basics', 'language:rust:ownership'],
  'python': ['language:python', 'language:python:basics', 'language:python:stdlib'],
  'javascript': ['language:javascript', 'language:javascript:basics', 'language:javascript:es6'],
  'typescript': ['language:typescript', 'language:typescript:basics', 'language:typescript:types'],
  'go': ['language:go', 'language:go:basics', 'language:go:concurrency'],
  'java': ['language:java', 'language:java:basics', 'language:java:oop'],

  // Web development
  'react': ['framework:react', 'framework:react:basics', 'framework:react:hooks'],
  'vue': ['framework:vue', 'framework:vue:basics', 'framework:vue:composition'],
  'node': ['runtime:node', 'runtime:node:basics', 'runtime:node:express'],
  'web': ['topic:web-development', 'topic:html', 'topic:css', 'topic:javascript'],

  // Data & AI
  'machine learning': ['topic:machine-learning', 'topic:ml:supervised', 'topic:ml:unsupervised'],
  'ml': ['topic:machine-learning', 'topic:ml:basics'],
  'ai': ['topic:artificial-intelligence', 'topic:ml:basics'],
  'data science': ['topic:data-science', 'topic:python', 'topic:statistics'],

  // Other
  'sql': ['topic:sql', 'topic:databases', 'topic:sql:queries'],
  'git': ['tool:git', 'tool:git:basics', 'tool:git:branching'],
  'docker': ['tool:docker', 'tool:docker:basics', 'tool:containers'],
  'kubernetes': ['tool:kubernetes', 'tool:k8s:basics', 'tool:containers'],
};

/**
 * Extract topic IDs from a goal statement.
 */
function extractTopicIds(goalStatement: string, extractedTopic?: string): string[] {
  const text = (extractedTopic ?? goalStatement).toLowerCase();
  const topics: string[] = [];

  // Check against known mappings
  for (const [keyword, topicIds] of Object.entries(TOPIC_MAPPINGS)) {
    if (text.includes(keyword)) {
      topics.push(...topicIds);
    }
  }

  // If no mappings found, create a generic topic
  if (topics.length === 0) {
    const cleanTopic = text
      .replace(/^(learn|study|master|understand)\s+/i, '')
      .replace(/\s+/g, '-')
      .substring(0, 50);
    topics.push(`topic:${cleanTopic}`);
  }

  // Deduplicate
  return [...new Set(topics)];
}

// ═══════════════════════════════════════════════════════════════════════════════
// LESSON PLAN GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generates lesson plan proposals from refinement inputs.
 */
export class LessonPlanGenerator {
  private readonly config: SwordGateConfig;
  private readonly resourceService?: IResourceDiscoveryService;
  private readonly curriculumService?: ICurriculumService;

  constructor(
    config: SwordGateConfig,
    resourceService?: IResourceDiscoveryService,
    curriculumService?: ICurriculumService
  ) {
    this.config = config;
    this.resourceService = resourceService;
    this.curriculumService = curriculumService;
  }

  /**
   * Generate a lesson plan proposal from refined inputs.
   */
  async generate(inputs: SwordRefinementInputs): AsyncAppResult<LessonPlanProposal> {
    // ─────────────────────────────────────────────────────────────────────────
    // Step 1: Validate required inputs
    // ─────────────────────────────────────────────────────────────────────────
    if (!inputs.goalStatement) {
      return err(appError('VALIDATION_ERROR', 'Goal statement is required'));
    }

    if (!inputs.userLevel) {
      return err(appError('VALIDATION_ERROR', 'User level is required'));
    }

    if (typeof inputs.dailyTimeCommitment !== 'number') {
      return err(appError('VALIDATION_ERROR', 'Daily time commitment is required'));
    }

    if (!inputs.totalDuration || typeof inputs.totalDays !== 'number') {
      return err(appError('VALIDATION_ERROR', 'Total duration is required'));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 2: Extract topics
    // ─────────────────────────────────────────────────────────────────────────
    const topicIds = extractTopicIds(inputs.goalStatement, inputs.extractedTopic);

    // ─────────────────────────────────────────────────────────────────────────
    // Step 3: Discover resources (if service available)
    // ─────────────────────────────────────────────────────────────────────────
    let resources: readonly VerifiedResource[] = [];
    let topicsCovered: readonly string[] = topicIds;
    let gaps: readonly string[] = [];

    if (this.resourceService) {
      const discoveryResult = await this.resourceService.discover({
        topics: topicIds,
        maxResults: 50,
        difficulty: inputs.userLevel,
      });

      if (discoveryResult.ok) {
        resources = discoveryResult.value.resources;
        topicsCovered = discoveryResult.value.topicsCovered;
        gaps = discoveryResult.value.gaps;
      } else {
        console.warn('[LESSON_PLAN] Resource discovery failed:', discoveryResult.error);
        // Continue with fallback
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 4: Generate curriculum structure (if service available)
    // ─────────────────────────────────────────────────────────────────────────
    let curriculum: GeneratedCurriculum | null = null;

    if (this.curriculumService && resources.length > 0) {
      const curriculumResult = await this.curriculumService.generate({
        goal: inputs.goalStatement,
        resources,
        days: inputs.totalDays,
        minutesPerDay: inputs.dailyTimeCommitment,
        targetDifficulty: inputs.userLevel,
        topics: topicIds,
        preferences: {
          includeExercises: true,
          progression: 'gradual',
        },
      });

      if (curriculumResult.ok) {
        curriculum = curriculumResult.value;
      } else {
        console.warn('[LESSON_PLAN] Curriculum generation failed:', curriculumResult.error);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 5: Build proposal (with or without full curriculum)
    // ─────────────────────────────────────────────────────────────────────────
    if (curriculum) {
      return ok(this.buildProposalFromCurriculum(inputs, curriculum, resources, gaps));
    } else {
      return ok(this.buildFallbackProposal(inputs, topicIds, resources.length, gaps));
    }
  }

  /**
   * Build a full proposal from generated curriculum.
   */
  private buildProposalFromCurriculum(
    inputs: SwordRefinementInputs,
    curriculum: GeneratedCurriculum,
    resources: readonly VerifiedResource[],
    gaps: readonly string[]
  ): LessonPlanProposal {
    // Group days into quests (weeks)
    const quests = this.groupDaysIntoQuests(curriculum.days, inputs.totalDays!);

    return {
      title: this.generateTitle(inputs),
      description: this.generateDescription(inputs),
      learningConfig: this.buildLearningConfig(inputs),
      quests,
      totalDuration: inputs.totalDuration!,
      totalDays: inputs.totalDays!,
      topicsCovered: curriculum.topicsCovered,
      gaps: gaps.length > 0 ? gaps : undefined,
      resourcesFound: resources.length,
      confidence: this.calculateConfidence(resources.length, gaps.length, curriculum.days.length),
      generatedAt: createTimestamp(),
    };
  }

  /**
   * Build a fallback proposal when curriculum generation isn't available.
   */
  private buildFallbackProposal(
    inputs: SwordRefinementInputs,
    topicIds: readonly string[],
    resourceCount: number,
    gaps: readonly string[]
  ): LessonPlanProposal {
    const totalDays = inputs.totalDays!;
    const weeksCount = Math.ceil(totalDays / 7);

    // Generate simple quest structure
    const quests: ProposedQuest[] = [];
    let daysCovered = 0;

    for (let week = 1; week <= weeksCount; week++) {
      const daysInWeek = Math.min(7, totalDays - daysCovered);
      if (daysInWeek <= 0) break;

      quests.push({
        title: this.generateQuestTitle(week, weeksCount, inputs.extractedTopic),
        description: this.generateQuestDescription(week, weeksCount, inputs.userLevel!),
        topics: topicIds.slice(0, 3),
        estimatedDays: daysInWeek,
        order: week,
      });

      daysCovered += daysInWeek;
    }

    return {
      title: this.generateTitle(inputs),
      description: this.generateDescription(inputs),
      learningConfig: this.buildLearningConfig(inputs),
      quests,
      totalDuration: inputs.totalDuration!,
      totalDays,
      topicsCovered: topicIds,
      gaps: gaps.length > 0 ? gaps : undefined,
      resourcesFound: resourceCount,
      confidence: resourceCount > 0 ? 'medium' : 'low',
      generatedAt: createTimestamp(),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Group curriculum days into weekly quests.
   */
  private groupDaysIntoQuests(
    days: readonly CurriculumDay[],
    totalDays: number
  ): ProposedQuest[] {
    const quests: ProposedQuest[] = [];
    const daysPerQuest = 7;
    let currentQuestDays: CurriculumDay[] = [];
    let questOrder = 1;

    for (const day of days) {
      currentQuestDays.push(day);

      if (currentQuestDays.length >= daysPerQuest || day.day === days.length) {
        quests.push(this.buildQuestFromDays(currentQuestDays, questOrder));
        currentQuestDays = [];
        questOrder++;
      }
    }

    // Handle remaining days
    if (currentQuestDays.length > 0) {
      quests.push(this.buildQuestFromDays(currentQuestDays, questOrder));
    }

    return quests;
  }

  /**
   * Build a quest from a group of days.
   */
  private buildQuestFromDays(days: CurriculumDay[], order: number): ProposedQuest {
    const themes = days.map((d) => d.theme);
    const allTopics = days.flatMap((d) =>
      d.resources.map((r) => r.title.split(':')[0])
    );
    const uniqueTopics = [...new Set(allTopics)].slice(0, 5);

    return {
      title: `Week ${order}: ${this.summarizeThemes(themes)}`,
      description: days[0]?.objectives[0] ?? `Days ${days[0]?.day}-${days[days.length - 1]?.day}`,
      topics: uniqueTopics,
      estimatedDays: days.length,
      order,
    };
  }

  /**
   * Summarize multiple day themes into a quest title.
   */
  private summarizeThemes(themes: readonly string[]): string {
    if (themes.length === 0) return 'Learning';
    if (themes.length === 1) return themes[0];

    // Find common words
    const words = themes.flatMap((t) => t.toLowerCase().split(/\s+/));
    const wordCounts = new Map<string, number>();
    for (const word of words) {
      if (word.length > 3) {
        wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
      }
    }

    // Get most common meaningful words
    const sorted = [...wordCounts.entries()]
      .filter(([_, count]) => count > 1)
      .sort((a, b) => b[1] - a[1]);

    if (sorted.length > 0) {
      return sorted
        .slice(0, 2)
        .map(([word]) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' & ');
    }

    return themes[0].split(' ').slice(0, 3).join(' ');
  }

  /**
   * Generate a goal title from inputs.
   */
  private generateTitle(inputs: SwordRefinementInputs): string {
    const topic = inputs.extractedTopic ?? 'your topic';
    const level = inputs.userLevel ?? 'beginner';

    const levelPrefix = {
      beginner: 'Learn',
      intermediate: 'Master',
      advanced: 'Expert',
    }[level] ?? 'Learn';

    return `${levelPrefix} ${this.capitalize(topic)}`;
  }

  /**
   * Generate a goal description from inputs.
   */
  private generateDescription(inputs: SwordRefinementInputs): string {
    const topic = inputs.extractedTopic ?? 'this topic';
    const duration = inputs.totalDuration ?? 'the planned period';
    const daily = inputs.dailyTimeCommitment ?? 30;

    return `A structured learning path to ${inputs.userLevel === 'advanced' ? 'master' : 'learn'} ${topic} over ${duration}, with ${daily} minutes of daily practice.`;
  }

  /**
   * Generate a quest title for fallback proposals.
   */
  private generateQuestTitle(week: number, totalWeeks: number, topic?: string): string {
    if (week === 1) {
      return `Week 1: ${topic ? `${this.capitalize(topic)} ` : ''}Fundamentals`;
    }
    if (week === totalWeeks) {
      return `Week ${week}: Review & Practice`;
    }
    if (week === totalWeeks - 1 && totalWeeks > 3) {
      return `Week ${week}: Applied Projects`;
    }
    return `Week ${week}: Building Skills`;
  }

  /**
   * Generate a quest description for fallback proposals.
   */
  private generateQuestDescription(
    week: number,
    totalWeeks: number,
    level: UserLevel
  ): string {
    if (week === 1) {
      return level === 'beginner'
        ? 'Get started with the basics and build your foundation.'
        : 'Review fundamentals and establish your baseline.';
    }
    if (week === totalWeeks) {
      return 'Consolidate your learning and practice what you\'ve learned.';
    }
    return 'Continue building your knowledge and skills.';
  }

  /**
   * Build LearningConfig from inputs.
   */
  private buildLearningConfig(inputs: SwordRefinementInputs): LearningConfig {
    return {
      userLevel: inputs.userLevel,
      dailyTimeCommitment: inputs.dailyTimeCommitment,
      learningStyle: inputs.learningStyle ?? 'mixed',
      totalDuration: inputs.totalDuration,
      startDate: inputs.startDate ?? this.getDefaultStartDate(),
      activeDays: inputs.activeDays ?? this.getDefaultActiveDays(),
    };
  }

  /**
   * Get default start date (tomorrow).
   */
  private getDefaultStartDate(): string {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  }

  /**
   * Get default active days (weekdays).
   */
  private getDefaultActiveDays(): readonly DayOfWeek[] {
    return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  }

  /**
   * Calculate confidence level based on available data.
   */
  private calculateConfidence(
    resourceCount: number,
    gapCount: number,
    dayCount: number
  ): 'high' | 'medium' | 'low' {
    if (resourceCount >= 20 && gapCount === 0 && dayCount > 0) {
      return 'high';
    }
    if (resourceCount >= 5 && gapCount <= 2) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Capitalize first letter of each word.
   */
  private capitalize(text: string): string {
    return text
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a LessonPlanGenerator instance.
 */
export function createLessonPlanGenerator(
  config: SwordGateConfig,
  resourceService?: IResourceDiscoveryService,
  curriculumService?: ICurriculumService
): LessonPlanGenerator {
  return new LessonPlanGenerator(config, resourceService, curriculumService);
}
