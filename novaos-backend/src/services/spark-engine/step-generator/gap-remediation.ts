// ═══════════════════════════════════════════════════════════════════════════════
// GAP REMEDIATION — Topic Coverage Gap Handling
// NovaOS Spark Engine — Phase 9: Step Generation
// ═══════════════════════════════════════════════════════════════════════════════
//
// Handles gaps in topic coverage when resources don't fully cover the curriculum:
//   - Identify uncovered topics
//   - Apply remediation strategies (fallback, defer, skip, combine)
//   - Generate fallback content patterns
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { TopicId, VerifiedResource } from '../resource-discovery/types.js';
import type { ResolvedCurriculum, ResolvedCurriculumDay } from '../curriculum/types.js';
import type { Step, Activity, StepResource, UserLevel } from '../types.js';
import type {
  TopicGap,
  GapRemediation,
  GapRemediationStrategy,
  StepGenerationConfig,
} from './types.js';
import { STEP_GENERATION_CONSTRAINTS } from './types.js';
import { getLogger } from '../../../observability/logging/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'gap-remediation' });

// ─────────────────────────────────────────────────────────────────────────────────
// TOPIC TAXONOMY (Simplified)
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Topic metadata for gap analysis.
 */
export interface TopicMetadata {
  readonly id: TopicId;
  readonly name: string;
  readonly priority: number; // 1 = highest
  readonly estimatedMinutes: number;
  readonly prerequisites: readonly TopicId[];
  readonly officialDocsUrl?: string;
}

/**
 * Topic taxonomy interface.
 */
export interface ITopicTaxonomy {
  getTopic(id: TopicId): TopicMetadata | undefined;
  getTopicName(id: TopicId): string;
  getPrerequisites(id: TopicId): readonly TopicId[];
  getOfficialDocsUrl(id: TopicId): string | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────────
// GAP DETECTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Detect uncovered topics in a curriculum.
 *
 * @param requestedTopics - Topics that should be covered
 * @param curriculum - Generated curriculum
 * @param taxonomy - Topic taxonomy for metadata
 * @returns Array of topic gaps
 */
export function detectGaps(
  requestedTopics: readonly TopicId[],
  curriculum: ResolvedCurriculum,
  taxonomy: ITopicTaxonomy
): TopicGap[] {
  const gaps: TopicGap[] = [];

  // Collect all topics covered by the curriculum
  const coveredTopics = new Set<TopicId>();
  
  for (const day of curriculum.days) {
    for (const resource of day.resources) {
      if (resource.resource.topicIds) {
        for (const topicId of resource.resource.topicIds) {
          coveredTopics.add(topicId as TopicId);
        }
      }
    }
  }

  // Find gaps
  for (const topicId of requestedTopics) {
    if (!coveredTopics.has(topicId)) {
      const topicMeta = taxonomy.getTopic(topicId);
      const prerequisites = taxonomy.getPrerequisites(topicId);
      
      // Check which prerequisites are covered
      const coveredPrerequisites = prerequisites.filter(p => coveredTopics.has(p));
      const missingPrerequisites = prerequisites.filter(p => !coveredTopics.has(p));

      gaps.push({
        topicId,
        topicName: topicMeta?.name ?? taxonomy.getTopicName(topicId),
        reason: 'No resources found covering this topic',
        priority: topicMeta?.priority ?? 5,
        estimatedMinutes: topicMeta?.estimatedMinutes ?? 30,
        coveredPrerequisites,
        missingPrerequisites,
      });
    }
  }

  // Sort by priority (highest first)
  return gaps.sort((a, b) => a.priority - b.priority);
}

/**
 * Detect gaps from resources vs requested topics.
 */
export function detectGapsFromResources(
  requestedTopics: readonly TopicId[],
  resources: readonly VerifiedResource[],
  taxonomy: ITopicTaxonomy
): TopicGap[] {
  // Collect covered topics from resources
  const coveredTopics = new Set<TopicId>();
  
  for (const resource of resources) {
    if (resource.topicIds) {
      for (const topicId of resource.topicIds) {
        coveredTopics.add(topicId as TopicId);
      }
    }
  }

  const gaps: TopicGap[] = [];

  for (const topicId of requestedTopics) {
    if (!coveredTopics.has(topicId)) {
      const topicMeta = taxonomy.getTopic(topicId);
      const prerequisites = taxonomy.getPrerequisites(topicId);
      
      const coveredPrerequisites = prerequisites.filter(p => coveredTopics.has(p));
      const missingPrerequisites = prerequisites.filter(p => !coveredTopics.has(p));

      gaps.push({
        topicId,
        topicName: topicMeta?.name ?? taxonomy.getTopicName(topicId),
        reason: 'No verified resources found for this topic',
        priority: topicMeta?.priority ?? 5,
        estimatedMinutes: topicMeta?.estimatedMinutes ?? 30,
        coveredPrerequisites,
        missingPrerequisites,
      });
    }
  }

  return gaps.sort((a, b) => a.priority - b.priority);
}

// ─────────────────────────────────────────────────────────────────────────────────
// STRATEGY SELECTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Select remediation strategy for a gap.
 */
export function selectStrategy(
  gap: TopicGap,
  taxonomy: ITopicTaxonomy,
  config: StepGenerationConfig
): GapRemediationStrategy {
  // If missing prerequisites, defer
  if (gap.missingPrerequisites.length > 0) {
    logger.debug('Deferring gap due to missing prerequisites', {
      topicId: gap.topicId,
      missingPrerequisites: gap.missingPrerequisites,
    });
    return 'defer';
  }

  // If official docs available, use fallback
  const officialDocs = taxonomy.getOfficialDocsUrl(gap.topicId);
  if (officialDocs) {
    return 'use_fallback';
  }

  // Low priority topics can be skipped
  if (gap.priority >= 4) {
    logger.debug('Skipping low priority gap', {
      topicId: gap.topicId,
      priority: gap.priority,
    });
    return 'skip';
  }

  // Check if can be combined with adjacent topic
  // (simplified: if estimated time is small)
  if (gap.estimatedMinutes <= 15) {
    return 'combine';
  }

  // Default: require manual search
  return 'manual_search';
}

// ─────────────────────────────────────────────────────────────────────────────────
// FALLBACK PATTERNS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Fallback resource types.
 */
export type FallbackType = 'official_docs' | 'curated_tutorial' | 'exercise_only';

/**
 * Fallback resource template.
 */
export interface FallbackTemplate {
  readonly type: FallbackType;
  readonly title: string;
  readonly url?: string;
  readonly estimatedMinutes: number;
  readonly activities: readonly Activity[];
}

/**
 * Generate fallback template for a topic.
 */
export function generateFallbackTemplate(
  gap: TopicGap,
  taxonomy: ITopicTaxonomy,
  userLevel: UserLevel
): FallbackTemplate {
  const officialDocs = taxonomy.getOfficialDocsUrl(gap.topicId);

  if (officialDocs) {
    return {
      type: 'official_docs',
      title: `${gap.topicName} - Official Documentation`,
      url: officialDocs,
      estimatedMinutes: gap.estimatedMinutes,
      activities: generateDocsActivities(gap, userLevel),
    };
  }

  // Exercise-only fallback
  return {
    type: 'exercise_only',
    title: `${gap.topicName} - Practice Exercises`,
    estimatedMinutes: Math.min(gap.estimatedMinutes, 30),
    activities: generateExerciseActivities(gap, userLevel),
  };
}

/**
 * Generate activities for docs-based learning.
 */
function generateDocsActivities(gap: TopicGap, userLevel: UserLevel): Activity[] {
  const activities: Activity[] = [];
  const totalMinutes = gap.estimatedMinutes;

  // Reading time (60% of total)
  const readMinutes = Math.round(totalMinutes * 0.6);
  activities.push({
    type: 'read',
    task: `Read the official documentation for ${gap.topicName}`,
    minutes: readMinutes,
  });

  // Practice time (40% of total)
  const practiceMinutes = totalMinutes - readMinutes;
  if (practiceMinutes >= 10) {
    activities.push({
      type: 'exercise',
      task: generatePracticeTask(gap.topicName, userLevel),
      minutes: practiceMinutes,
    });
  }

  return activities;
}

/**
 * Generate exercise-only activities.
 */
function generateExerciseActivities(gap: TopicGap, userLevel: UserLevel): Activity[] {
  return [
    {
      type: 'exercise',
      task: generatePracticeTask(gap.topicName, userLevel),
      minutes: gap.estimatedMinutes,
    },
  ];
}

/**
 * Generate a practice task description based on topic and level.
 */
function generatePracticeTask(topicName: string, userLevel: UserLevel): string {
  switch (userLevel) {
    case 'beginner':
      return `Practice the basics of ${topicName} with simple examples`;
    case 'intermediate':
      return `Apply ${topicName} concepts to solve practice problems`;
    case 'advanced':
      return `Build a mini-project demonstrating mastery of ${topicName}`;
    default:
      return `Practice ${topicName} concepts`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// REMEDIATION PLANNING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Plan remediation for a single gap.
 */
export function planRemediation(
  gap: TopicGap,
  taxonomy: ITopicTaxonomy,
  config: StepGenerationConfig,
  existingDayCount: number
): GapRemediation {
  const strategy = selectStrategy(gap, taxonomy, config);

  switch (strategy) {
    case 'use_fallback': {
      const template = generateFallbackTemplate(gap, taxonomy, config.userLevel);
      return {
        gap,
        strategy,
        fallbackResource: {
          type: template.type,
          url: template.url,
          title: template.title,
          estimatedMinutes: template.estimatedMinutes,
        },
        insertAtDay: findInsertionDay(gap, existingDayCount),
        applied: false,
        message: `Will use fallback: ${template.title}`,
      };
    }

    case 'defer':
      return {
        gap,
        strategy,
        applied: false,
        message: `Deferred: requires prerequisites ${gap.missingPrerequisites.join(', ')}`,
      };

    case 'skip':
      return {
        gap,
        strategy,
        applied: true, // Skipping is "applied" - we intentionally skip
        message: `Skipped: low priority topic (priority ${gap.priority})`,
      };

    case 'combine':
      return {
        gap,
        strategy,
        applied: false,
        message: `Will combine with adjacent topic (${gap.estimatedMinutes}min)`,
      };

    case 'manual_search':
    default:
      return {
        gap,
        strategy: 'manual_search',
        applied: false,
        message: `Requires manual resource search for ${gap.topicName}`,
      };
  }
}

/**
 * Find the best day to insert fallback content.
 */
function findInsertionDay(gap: TopicGap, existingDayCount: number): number {
  // If prerequisites are covered, insert after the last prerequisite
  if (gap.coveredPrerequisites.length > 0) {
    // For now, insert at the end
    // In a full implementation, we'd track which days cover which topics
    return existingDayCount + 1;
  }

  // Default: insert at the end
  return existingDayCount + 1;
}

/**
 * Plan remediations for all gaps.
 */
export function planGapRemediations(
  gaps: readonly TopicGap[],
  taxonomy: ITopicTaxonomy,
  config: StepGenerationConfig,
  existingDayCount: number
): GapRemediation[] {
  const remediations: GapRemediation[] = [];

  for (const gap of gaps) {
    const remediation = planRemediation(gap, taxonomy, config, existingDayCount);
    remediations.push(remediation);
  }

  logger.info('Gap remediation plan created', {
    totalGaps: gaps.length,
    byStrategy: countByStrategy(remediations),
  });

  return remediations;
}

/**
 * Count remediations by strategy.
 */
function countByStrategy(
  remediations: readonly GapRemediation[]
): Record<GapRemediationStrategy, number> {
  const counts: Record<GapRemediationStrategy, number> = {
    use_fallback: 0,
    manual_search: 0,
    skip: 0,
    defer: 0,
    combine: 0,
  };

  for (const r of remediations) {
    counts[r.strategy]++;
  }

  return counts;
}

// ─────────────────────────────────────────────────────────────────────────────────
// REMEDIATION APPLICATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Apply fallback remediations to step list.
 * Creates new steps for fallback content.
 */
export function applyFallbackRemediations(
  existingSteps: readonly Step[],
  remediations: readonly GapRemediation[],
  createStep: (
    dayNumber: number,
    theme: string,
    activities: readonly Activity[],
    resources: readonly StepResource[]
  ) => Step
): { steps: Step[]; appliedRemediations: GapRemediation[] } {
  const steps = [...existingSteps];
  const appliedRemediations: GapRemediation[] = [];

  // Filter to only fallback remediations
  const fallbackRemediations = remediations.filter(
    r => r.strategy === 'use_fallback' && r.fallbackResource && !r.applied
  );

  for (const remediation of fallbackRemediations) {
    if (!remediation.fallbackResource || !remediation.insertAtDay) {
      continue;
    }

    const fallback = remediation.fallbackResource;
    const template = generateFallbackTemplate(
      remediation.gap,
      createSimpleTaxonomy(remediation.gap),
      'beginner' // Default level
    );

    // Create fallback step
    const resources: StepResource[] = fallback.url
      ? [
          {
            id: `fallback-${remediation.gap.topicId}` as any,
            providerId: 'fallback',
            title: fallback.title,
            type: 'documentation',
            url: fallback.url,
            verificationLevel: 'weak',
          },
        ]
      : [];

    const step = createStep(
      remediation.insertAtDay,
      `${remediation.gap.topicName} (Fallback)`,
      template.activities,
      resources
    );

    steps.push(step);
    appliedRemediations.push({
      ...remediation,
      applied: true,
      message: `Applied fallback: ${fallback.title}`,
    });
  }

  // Re-sort steps by day number
  steps.sort((a, b) => a.dayNumber - b.dayNumber);

  return { steps, appliedRemediations };
}

/**
 * Create a simple taxonomy for a single gap (for fallback generation).
 */
function createSimpleTaxonomy(gap: TopicGap): ITopicTaxonomy {
  return {
    getTopic: (id) =>
      id === gap.topicId
        ? {
            id: gap.topicId,
            name: gap.topicName,
            priority: gap.priority,
            estimatedMinutes: gap.estimatedMinutes,
            prerequisites: gap.missingPrerequisites,
          }
        : undefined,
    getTopicName: (id) => (id === gap.topicId ? gap.topicName : String(id)),
    getPrerequisites: (id) =>
      id === gap.topicId ? gap.missingPrerequisites : [],
    getOfficialDocsUrl: () => undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Check if gaps are within acceptable limits.
 */
export function areGapsAcceptable(gaps: readonly TopicGap[]): boolean {
  // Count high-priority gaps (priority 1-2)
  const highPriorityGaps = gaps.filter(g => g.priority <= 2);
  
  if (highPriorityGaps.length > 0) {
    logger.warn('High priority topic gaps detected', {
      count: highPriorityGaps.length,
      topics: highPriorityGaps.map(g => g.topicName),
    });
    return false;
  }

  // Check total gap count
  if (gaps.length > STEP_GENERATION_CONSTRAINTS.MAX_GAPS_BEFORE_FAILURE) {
    logger.warn('Too many topic gaps', {
      count: gaps.length,
      max: STEP_GENERATION_CONSTRAINTS.MAX_GAPS_BEFORE_FAILURE,
    });
    return false;
  }

  return true;
}

/**
 * Get gaps that require manual intervention.
 */
export function getManualInterventionRequired(
  remediations: readonly GapRemediation[]
): GapRemediation[] {
  return remediations.filter(
    r => r.strategy === 'manual_search' || (r.strategy === 'defer' && !r.applied)
  );
}

/**
 * Summarize gap remediation results.
 */
export function summarizeRemediations(
  remediations: readonly GapRemediation[]
): {
  total: number;
  applied: number;
  pending: number;
  byStrategy: Record<GapRemediationStrategy, number>;
  requiresManualIntervention: boolean;
} {
  const byStrategy = countByStrategy(remediations);
  const applied = remediations.filter(r => r.applied).length;
  const manualRequired = getManualInterventionRequired(remediations);

  return {
    total: remediations.length,
    applied,
    pending: remediations.length - applied,
    byStrategy,
    requiresManualIntervention: manualRequired.length > 0,
  };
}
