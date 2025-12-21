// ═══════════════════════════════════════════════════════════════════════════════
// STEP GENERATOR — Main Step Generation Pipeline
// NovaOS Spark Engine — Phase 9: Step Generation
// ═══════════════════════════════════════════════════════════════════════════════
//
// Orchestrates the full step generation pipeline:
//   1. Acquire distributed lock
//   2. Check if steps already exist
//   3. Discover resources (Phase 6)
//   4. Generate curriculum (Phase 7)
//   5. Create Step entities
//   6. Validate day sequence
//   7. Remediate gaps
//   8. Release lock
//
// Implements IStepGenerator interface from Phase 8.
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { Redis } from 'ioredis';

import type { AsyncAppResult } from '../../../types/result.js';
import { ok, err, appError } from '../../../types/result.js';
import {
  createStepId,
  createTimestamp,
  createResourceId,
} from '../../../types/branded.js';
import type { ResourceId } from '../../../types/branded.js';
import { getLogger } from '../../../observability/logging/index.js';
import { incCounter, observeHistogram } from '../../../observability/metrics/index.js';

// Phase 8 types
import type { IStepGenerator, ISparkEngineStore } from '../interfaces.js';
import type {
  Goal,
  Quest,
  Step,
  Activity,
  StepResource,
  DayOfWeek,
} from '../types.js';
import { ALL_DAYS } from '../types.js';

// Phase 7 curriculum
import type {
  ResolvedCurriculum,
  ResolvedCurriculumDay,
  ResolvedResourceAssignment,
  CurriculumGenerationRequest,
} from '../curriculum/types.js';
import { generateCurriculum } from '../curriculum/structurer.js';

// Phase 6 resource discovery
import type { VerifiedResource, TopicId } from '../resource-discovery/types.js';
import { createTopicId } from '../resource-discovery/types.js';
import {
  ResourceDiscoveryOrchestrator,
  type DiscoveryRequest,
} from '../resource-discovery/orchestrator.js';

// Local types
import type {
  StepGenerationConfig,
  StepGenerationResult,
  StepGenerationDiagnostics,
  StepGenerationErrorCode,
  ValidationIssue,
  TopicGap,
  GapRemediation,
  LockConfig,
} from './types.js';
import {
  DEFAULT_STEP_GENERATION_CONFIG,
  DEFAULT_LOCK_CONFIG,
  buildLockKey,
  STEP_GENERATION_CONSTRAINTS,
} from './types.js';

// Local modules
import { DistributedLock, createDistributedLock } from './locking.js';
import {
  validateDaySequence,
  validateStepSequence,
  hasBlockingIssues,
  generateSchedule,
  getDayOfWeek,
} from './day-sequence.js';
import {
  detectGaps,
  detectGapsFromResources,
  planGapRemediations,
  applyFallbackRemediations,
  areGapsAcceptable,
  summarizeRemediations,
  type ITopicTaxonomy,
} from './gap-remediation.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'step-generator' });

// ─────────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * StepGenerator configuration.
 */
export interface StepGeneratorConfig {
  /** Lock configuration */
  readonly lock: LockConfig;

  /** Whether to skip locking (for testing) */
  readonly skipLocking: boolean;

  /** Whether to allow steps to be regenerated */
  readonly allowRegeneration: boolean;

  /** Maximum resources to discover */
  readonly maxResources: number;

  /** Maximum curriculum generation retries */
  readonly maxCurriculumRetries: number;
}

/**
 * Default StepGenerator configuration.
 */
export const DEFAULT_STEP_GENERATOR_CONFIG: StepGeneratorConfig = {
  lock: DEFAULT_LOCK_CONFIG,
  skipLocking: false,
  allowRegeneration: false,
  maxResources: 20,
  maxCurriculumRetries: 2,
};

// ─────────────────────────────────────────────────────────────────────────────────
// STEP GENERATOR
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * StepGenerator — Generates steps for a quest from verified resources.
 *
 * Implements IStepGenerator interface.
 */
export class StepGenerator implements IStepGenerator {
  private readonly store: ISparkEngineStore;
  private readonly discoverer: ResourceDiscoveryOrchestrator;
  private readonly lock: DistributedLock | null;
  private readonly taxonomy: ITopicTaxonomy;
  private readonly config: StepGeneratorConfig;

  constructor(
    store: ISparkEngineStore,
    discoverer: ResourceDiscoveryOrchestrator,
    redis: Redis | null,
    taxonomy: ITopicTaxonomy,
    config?: Partial<StepGeneratorConfig>
  ) {
    this.store = store;
    this.discoverer = discoverer;
    this.taxonomy = taxonomy;
    this.config = { ...DEFAULT_STEP_GENERATOR_CONFIG, ...config };

    // Create lock if Redis provided and not skipping
    if (redis && !this.config.skipLocking) {
      this.lock = createDistributedLock(redis, this.config.lock);
    } else {
      this.lock = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // IStepGenerator Implementation
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Generate steps for a quest.
   */
  async generateSteps(quest: Quest, goal: Goal): AsyncAppResult<readonly Step[]> {
    const startTime = Date.now();
    const diagnostics: Partial<StepGenerationDiagnostics> = {
      resourceCacheHit: false,
      llmTokensUsed: 0,
    };

    logger.info('Starting step generation', {
      questId: quest.id,
      goalId: goal.id,
      questTitle: quest.title,
    });

    try {
      // Build generation config from goal
      const genConfig = this.buildConfig(goal);

      // Execute with or without lock
      let result: StepGenerationResult;

      if (this.lock) {
        const lockResult = await this.lock.withLock(quest.id, async () => {
          return this.executeGeneration(quest, goal, genConfig, diagnostics);
        });

        if (!lockResult.ok) {
          return err(appError(
            'LOCK_FAILED',
            lockResult.error.message,
            { context: { questId: quest.id, errorCode: lockResult.error.code } }
          ));
        }

        result = lockResult.value;
      } else {
        result = await this.executeGeneration(quest, goal, genConfig, diagnostics);
      }

      // Record metrics
      const totalDurationMs = Date.now() - startTime;
      observeHistogram('step_generation_duration_ms', totalDurationMs);
      incCounter('step_generation_total', {
        result: result.success ? 'success' : 'error',
      });

      if (!result.success) {
        return err(appError(
          result.errorCode ?? 'GENERATION_FAILED',
          result.error ?? 'Step generation failed',
          { context: { questId: quest.id, diagnostics: result.diagnostics } }
        ));
      }

      logger.info('Step generation completed', {
        questId: quest.id,
        stepCount: result.steps.length,
        gapCount: result.gaps.length,
        warningCount: result.warnings.length,
        durationMs: totalDurationMs,
      });

      return ok(result.steps);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logger.error('Step generation failed with exception', {
        questId: quest.id,
        error,
        durationMs,
      });

      incCounter('step_generation_total', { result: 'exception' });

      return err(appError(
        'INTERNAL_ERROR',
        error instanceof Error ? error.message : 'Unknown error',
        { cause: error instanceof Error ? error : undefined }
      ));
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Pipeline Execution
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Execute the full generation pipeline.
   */
  private async executeGeneration(
    quest: Quest,
    goal: Goal,
    config: StepGenerationConfig,
    diagnostics: Partial<StepGenerationDiagnostics>
  ): Promise<StepGenerationResult> {
    const pipelineStart = Date.now();

    // Step 1: Check if steps already exist
    const existingCheck = await this.checkExistingSteps(quest);
    if (!existingCheck.ok) {
      return this.errorResult('STORE_ERROR', existingCheck.error.message, diagnostics);
    }

    if (existingCheck.value.length > 0 && !this.config.allowRegeneration) {
      logger.info('Steps already exist for quest', {
        questId: quest.id,
        stepCount: existingCheck.value.length,
      });
      return {
        success: true,
        steps: existingCheck.value,
        gaps: [],
        remediations: [],
        warnings: [{
          type: 'gap_in_day_sequence',
          severity: 'info',
          message: 'Using existing steps (already generated)',
        }],
        diagnostics: this.finalizeDiagnostics(diagnostics, pipelineStart),
      };
    }

    // Step 2: Extract topics from quest
    const topics = this.extractTopics(quest);
    if (topics.length === 0) {
      return this.errorResult('NO_RESOURCES', 'Quest has no topics defined', diagnostics);
    }

    diagnostics.topicsRequested = topics.length;

    // Step 3: Discover resources
    const discoveryStart = Date.now();
    const discoveryResult = await this.discoverResources(topics, config);
    diagnostics.discoveryDurationMs = Date.now() - discoveryStart;

    if (!discoveryResult.ok) {
      return this.errorResult('DISCOVERY_FAILED', discoveryResult.error, diagnostics);
    }

    const resources = discoveryResult.value;
    diagnostics.resourcesDiscovered = resources.length;

    if (resources.length === 0) {
      return this.errorResult('NO_RESOURCES', 'No resources found for topics', diagnostics);
    }

    // Step 4: Detect gaps before curriculum generation
    const preGaps = detectGapsFromResources(topics, resources, this.taxonomy);

    // Step 5: Generate curriculum
    const curriculumStart = Date.now();
    const curriculumResult = await this.generateCurriculumFromResources(
      quest,
      goal,
      resources,
      topics,
      config
    );
    diagnostics.curriculumDurationMs = Date.now() - curriculumStart;

    if (!curriculumResult.ok) {
      return this.errorResult('CURRICULUM_FAILED', curriculumResult.error, diagnostics);
    }

    const curriculum = curriculumResult.value.curriculum;
    diagnostics.llmTokensUsed = curriculumResult.value.tokensUsed;
    diagnostics.resourcesUsed = curriculum.resourceCount;

    // Step 6: Validate curriculum days
    const dayValidationIssues = validateDaySequence(curriculum.days, config);

    // Step 7: Detect post-curriculum gaps
    const postGaps = detectGaps(topics, curriculum, this.taxonomy);
    diagnostics.topicsCovered = topics.length - postGaps.length;

    // Step 8: Plan gap remediations
    const remediations = planGapRemediations(
      postGaps,
      this.taxonomy,
      config,
      curriculum.days.length
    );

    // Step 9: Create step entities
    const stepCreationStart = Date.now();
    const steps = this.createStepEntities(curriculum, quest, config);
    diagnostics.stepCreationDurationMs = Date.now() - stepCreationStart;

    // Step 10: Apply fallback remediations
    const { steps: finalSteps, appliedRemediations } = applyFallbackRemediations(
      steps,
      remediations,
      (dayNumber, theme, activities, stepResources) =>
        this.createFallbackStep(quest, dayNumber, theme, activities, stepResources, config)
    );

    // Step 11: Validate final step sequence
    const stepValidationIssues = validateStepSequence(finalSteps, config);
    const allWarnings = [...dayValidationIssues, ...stepValidationIssues];

    // Step 12: Check if gaps are acceptable
    if (!areGapsAcceptable(postGaps)) {
      logger.warn('Unacceptable topic gaps', {
        questId: quest.id,
        gapCount: postGaps.length,
      });
      // Continue anyway but log warning
    }

    // Finalize
    const finalDiagnostics = this.finalizeDiagnostics(diagnostics, pipelineStart);

    return {
      success: true,
      steps: finalSteps,
      gaps: postGaps,
      remediations: [...remediations.filter(r => !appliedRemediations.includes(r)), ...appliedRemediations],
      warnings: allWarnings.filter(w => w.severity !== 'error'),
      diagnostics: finalDiagnostics,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Pipeline Steps
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Check if steps already exist for this quest.
   */
  private async checkExistingSteps(quest: Quest): AsyncAppResult<readonly Step[]> {
    return this.store.getStepsByQuest(quest.id);
  }

  /**
   * Extract topics from quest.
   */
  private extractTopics(quest: Quest): TopicId[] {
    if (quest.topicIds && quest.topicIds.length > 0) {
      return quest.topicIds.map(id => createTopicId(id));
    }

    // Fallback: parse from title/description
    // In production, this would use NLP or taxonomy matching
    logger.warn('Quest has no topicIds, using fallback extraction', {
      questId: quest.id,
    });

    return [createTopicId(`topic:${quest.title.toLowerCase().replace(/\s+/g, '-')}`)];
  }

  /**
   * Discover resources for topics.
   */
  private async discoverResources(
    topics: readonly TopicId[],
    config: StepGenerationConfig
  ): Promise<{ ok: true; value: VerifiedResource[] } | { ok: false; error: string }> {
    const request: DiscoveryRequest = {
      topics,
      maxResults: this.config.maxResources,
      criteria: {
        topicIds: topics,
        maxResources: this.config.maxResources,
        preferredDifficulties: [config.userLevel],
      },
    };

    const result = await this.discoverer.discover(request);

    if (!result.ok) {
      return { ok: false, error: result.error.message };
    }

    return { ok: true, value: [...result.value.resources] };
  }

  /**
   * Generate curriculum from resources.
   */
  private async generateCurriculumFromResources(
    quest: Quest,
    goal: Goal,
    resources: readonly VerifiedResource[],
    topics: readonly TopicId[],
    config: StepGenerationConfig
  ): Promise<
    | { ok: true; value: { curriculum: ResolvedCurriculum; tokensUsed: number } }
    | { ok: false; error: string }
  > {
    const request: CurriculumGenerationRequest = {
      goal: `${goal.title}: ${quest.title}`,
      resources,
      days: quest.estimatedDays ?? 7,
      minutesPerDay: config.dailyMinutes,
      targetDifficulty: config.userLevel,
      topics,
      userId: goal.userId,
      preferences: {
        includeExercises: true,
        progression: 'gradual',
      },
    };

    const result = await generateCurriculum(request, {
      maxRetries: this.config.maxCurriculumRetries,
    });

    if (!result.success || !result.curriculum) {
      return { ok: false, error: result.error ?? 'Curriculum generation failed' };
    }

    return {
      ok: true,
      value: {
        curriculum: result.curriculum,
        tokensUsed: result.metrics.tokensUsed,
      },
    };
  }

  /**
   * Create Step entities from curriculum days.
   */
  private createStepEntities(
    curriculum: ResolvedCurriculum,
    quest: Quest,
    config: StepGenerationConfig
  ): Step[] {
    const schedule = generateSchedule(
      config.startDate,
      curriculum.days.length,
      config.activeDays
    );

    const steps: Step[] = [];

    for (const day of curriculum.days) {
      const scheduledDay = schedule.find(s => s.dayNumber === day.day);
      const scheduledDate = scheduledDay?.date ?? config.startDate;

      const step = this.createStepFromDay(
        day,
        quest,
        scheduledDate,
        config
      );

      steps.push(step);
    }

    return steps;
  }

  /**
   * Create a Step from a curriculum day.
   */
  private createStepFromDay(
    day: ResolvedCurriculumDay,
    quest: Quest,
    scheduledDate: string,
    config: StepGenerationConfig
  ): Step {
    const now = createTimestamp();

    // Convert resources
    const resources: StepResource[] = day.resources.map(r =>
      this.convertToStepResource(r)
    );

    // Convert activities
    const activities: Activity[] = [
      // Resource-based activities
      ...day.resources.map(r => ({
        type: this.getActivityType(r.resource),
        resourceId: createResourceId(r.resource.id),
        section: r.focus,
        task: r.notes ?? `Study: ${r.title}`,
        minutes: r.minutes,
      })),
      // Exercise activities
      ...day.exercises.map(e => ({
        type: e.type as Activity['type'],
        task: e.description,
        minutes: e.minutes,
      })),
    ];

    // Primary objective
    const objective = day.objectives[0]?.description ?? day.theme;

    return {
      id: createStepId(),
      questId: quest.id,
      title: day.theme,
      description: day.notes ?? `Day ${day.day}: ${day.theme}`,
      status: 'pending',
      order: day.day,
      createdAt: now,
      updatedAt: now,
      scheduledDate,
      dayNumber: day.day,
      objective,
      theme: day.theme,
      activities,
      resources,
      estimatedMinutes: day.totalMinutes,
      needsRepair: false,
      repairIssues: [],
    };
  }

  /**
   * Create a fallback step for gap remediation.
   */
  private createFallbackStep(
    quest: Quest,
    dayNumber: number,
    theme: string,
    activities: readonly Activity[],
    resources: readonly StepResource[],
    config: StepGenerationConfig
  ): Step {
    const now = createTimestamp();
    const schedule = generateSchedule(config.startDate, dayNumber, config.activeDays);
    const scheduledDate = schedule[dayNumber - 1]?.date ?? config.startDate;

    const totalMinutes = activities.reduce((sum, a) => sum + a.minutes, 0);

    return {
      id: createStepId(),
      questId: quest.id,
      title: theme,
      description: `Fallback content: ${theme}`,
      status: 'pending',
      order: dayNumber,
      createdAt: now,
      updatedAt: now,
      scheduledDate,
      dayNumber,
      objective: `Complete ${theme}`,
      theme,
      activities: [...activities],
      resources: [...resources],
      estimatedMinutes: totalMinutes,
      needsRepair: true, // Mark as needing attention
      repairIssues: ['Generated from fallback pattern - verify content quality'],
    };
  }

  /**
   * Convert a resolved resource assignment to StepResource.
   */
  private convertToStepResource(assignment: ResolvedResourceAssignment): StepResource {
    const resource = assignment.resource;

    return {
      id: createResourceId(resource.id),
      providerId: resource.providerId ?? resource.id,
      title: assignment.title,
      type: resource.contentType,
      url: assignment.url,
      verificationLevel: this.mapVerificationLevel(resource),
    };
  }

  /**
   * Get activity type from resource.
   */
  private getActivityType(resource: VerifiedResource): Activity['type'] {
    switch (resource.contentType) {
      case 'video':
        return 'watch';
      case 'tutorial':
      case 'documentation':
      case 'article':
        return 'read';
      case 'repository':
      case 'interactive':
        return 'code';
      default:
        return 'read';
    }
  }

  /**
   * Map verification level.
   */
  private mapVerificationLevel(
    resource: VerifiedResource
  ): 'strong' | 'standard' | 'weak' {
    // Based on resource quality signals and verification evidence
    const quality = resource.qualitySignals?.composite ?? 0.5;
    
    if (quality >= 0.8) return 'strong';
    if (quality >= 0.5) return 'standard';
    return 'weak';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Build generation config from goal.
   */
  private buildConfig(goal: Goal): StepGenerationConfig {
    const lc = goal.learningConfig;
    const rc = goal.reminderConfig;

    return {
      dailyMinutes: lc?.dailyTimeCommitment ?? DEFAULT_STEP_GENERATION_CONFIG.dailyMinutes,
      userLevel: lc?.userLevel ?? DEFAULT_STEP_GENERATION_CONFIG.userLevel,
      learningStyle: lc?.learningStyle ?? DEFAULT_STEP_GENERATION_CONFIG.learningStyle,
      startDate: lc?.startDate ?? DEFAULT_STEP_GENERATION_CONFIG.startDate,
      activeDays: lc?.activeDays ?? DEFAULT_STEP_GENERATION_CONFIG.activeDays,
      timezone: rc?.timezone ?? DEFAULT_STEP_GENERATION_CONFIG.timezone,
    };
  }

  /**
   * Create error result.
   */
  private errorResult(
    errorCode: StepGenerationErrorCode,
    error: string,
    diagnostics: Partial<StepGenerationDiagnostics>
  ): StepGenerationResult {
    return {
      success: false,
      steps: [],
      gaps: [],
      remediations: [],
      warnings: [],
      error,
      errorCode,
      diagnostics: this.finalizeDiagnostics(diagnostics, Date.now()),
    };
  }

  /**
   * Finalize diagnostics with timing.
   */
  private finalizeDiagnostics(
    partial: Partial<StepGenerationDiagnostics>,
    startTime: number
  ): StepGenerationDiagnostics {
    return {
      discoveryDurationMs: partial.discoveryDurationMs ?? 0,
      curriculumDurationMs: partial.curriculumDurationMs ?? 0,
      stepCreationDurationMs: partial.stepCreationDurationMs ?? 0,
      totalDurationMs: Date.now() - startTime,
      resourcesDiscovered: partial.resourcesDiscovered ?? 0,
      resourcesUsed: partial.resourcesUsed ?? 0,
      topicsRequested: partial.topicsRequested ?? 0,
      topicsCovered: partial.topicsCovered ?? 0,
      resourceCacheHit: partial.resourceCacheHit ?? false,
      llmTokensUsed: partial.llmTokensUsed ?? 0,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// FACTORY
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create a StepGenerator instance.
 */
export function createStepGenerator(
  store: ISparkEngineStore,
  discoverer: ResourceDiscoveryOrchestrator,
  redis: Redis | null,
  taxonomy: ITopicTaxonomy,
  config?: Partial<StepGeneratorConfig>
): StepGenerator {
  return new StepGenerator(store, discoverer, redis, taxonomy, config);
}

/**
 * Create a StepGenerator for testing (no Redis, no locking).
 */
export function createTestStepGenerator(
  store: ISparkEngineStore,
  discoverer: ResourceDiscoveryOrchestrator,
  taxonomy: ITopicTaxonomy,
  config?: Partial<StepGeneratorConfig>
): StepGenerator {
  return new StepGenerator(store, discoverer, null, taxonomy, {
    ...config,
    skipLocking: true,
  });
}
