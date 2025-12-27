// ═══════════════════════════════════════════════════════════════════════════════
// VIEW FLOW — SwordGate View Mode Handler
// NovaOS Gates — Phase 14B: View Mode Extension
// ═══════════════════════════════════════════════════════════════════════════════
//
// Handles retrieval and formatting of existing goals, lessons, and progress.
// Uses SparkEngine's existing retrieval APIs:
//   - getTodayForUser(): Today's step and spark
//   - getGoalsForUser(): All user goals
//   - getPathProgress(): Progress metrics
//   - getQuestsForGoal(): Quest details
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { UserId, GoalId, QuestId, StepId } from '../../types/branded.js';
import type { AsyncAppResult } from '../../types/result.js';
import { ok, err, appError } from '../../types/result.js';

import type { ISparkEngine } from '../../services/spark-engine/interfaces.js';
import type {
  Goal,
  Quest,
  Step,
  Spark,
  TodayResult,
  PathProgress,
  StepResource,
  GoalStatus,
} from '../../services/spark-engine/types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Specifies what content the user wants to view.
 */
export type ViewTarget =
  | 'today'       // Today's lesson and spark
  | 'goals'       // List all user goals
  | 'progress'    // Progress for specific goal
  | 'plan'        // Full learning plan/curriculum
  | 'upcoming';   // Next N days of lessons

/**
 * Type guard for ViewTarget.
 */
export function isViewTarget(value: unknown): value is ViewTarget {
  return (
    typeof value === 'string' &&
    ['today', 'goals', 'progress', 'plan', 'upcoming'].includes(value)
  );
}

/**
 * Parsed view request with target and optional identifiers.
 */
export interface ViewRequest {
  /** What to view */
  readonly target: ViewTarget;

  /** Optional goal ID for goal-specific views */
  readonly goalId?: GoalId;

  /** Optional quest ID for quest-specific views */
  readonly questId?: QuestId;

  /** Number of items to return (for 'upcoming') */
  readonly count?: number;

  /** Whether to include detailed information */
  readonly detailed?: boolean;
}

/**
 * ViewFlow configuration.
 */
export interface ViewFlowConfig {
  /** Default number of upcoming days to show */
  readonly defaultUpcomingDays: number;

  /** Maximum goals to return in list */
  readonly maxGoalsToList: number;

  /** Whether to include detailed progress in goal list */
  readonly includeProgressInList: boolean;
}

/**
 * Default configuration.
 */
export const DEFAULT_VIEW_FLOW_CONFIG: ViewFlowConfig = {
  defaultUpcomingDays: 7,
  maxGoalsToList: 20,
  includeProgressInList: true,
};

/**
 * Formatted view result for display.
 */
export interface FormattedViewResult {
  /** Formatted message for user */
  readonly message: string;

  /** Whether content was found */
  readonly hasContent: boolean;

  /** Suggested follow-up actions */
  readonly suggestedActions?: readonly string[];

  /** Goal ID if applicable */
  readonly goalId?: GoalId;

  /** Quest ID if applicable */
  readonly questId?: QuestId;

  /** Step ID if applicable */
  readonly stepId?: StepId;
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIEW FLOW CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Handles view mode operations.
 */
export class ViewFlow {
  constructor(
    private readonly sparkEngine: ISparkEngine,
    private readonly config: ViewFlowConfig = DEFAULT_VIEW_FLOW_CONFIG
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // MAIN ENTRY POINT
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Process a view request.
   */
  async process(
    userId: UserId,
    request: ViewRequest
  ): AsyncAppResult<FormattedViewResult> {
    switch (request.target) {
      case 'today':
        return this.viewToday(userId);

      case 'goals':
        return this.viewGoals(userId);

      case 'progress':
        return this.viewProgress(userId, request.goalId);

      case 'plan':
        return this.viewPlan(userId, request.goalId);

      case 'upcoming':
        return this.viewUpcoming(userId, request.goalId, request.count);

      default:
        // Safe default: show today
        return this.viewToday(userId);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // VIEW TODAY
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * View today's lesson and spark.
   */
  private async viewToday(userId: UserId): AsyncAppResult<FormattedViewResult> {
    const result = await this.sparkEngine.getTodayForUser(userId);
    if (!result.ok) {
      return err(result.error);
    }

    const today = result.value;

    if (!today.hasContent) {
      return ok({
        message: this.formatNoContentToday(),
        hasContent: false,
        suggestedActions: ['Create a new learning goal'],
      });
    }

    // Get goal title for context
    let goalTitle: string | undefined;
    if (today.goalId) {
      const goalsResult = await this.sparkEngine.getGoalsForUser(userId);
      if (goalsResult.ok) {
        const goal = goalsResult.value.find((g) => g.id === today.goalId);
        goalTitle = goal?.title;
      }
    }

    return ok({
      message: this.formatTodayLesson(today, goalTitle),
      hasContent: true,
      suggestedActions: ['Mark as done', 'Skip this lesson', 'View full plan'],
      goalId: today.goalId ?? undefined,
      questId: today.questId ?? undefined,
      stepId: today.step?.id,
    });
  }

  /**
   * Format message when no content is scheduled for today.
   */
  private formatNoContentToday(): string {
    const lines: string[] = [
      '📅 **No lesson scheduled for today**',
      '',
      "You're all caught up! Here are your options:",
      '',
      '• Create a new learning goal',
      '• View your existing goals',
      '• Check your progress',
    ];
    return lines.join('\n');
  }

  /**
   * Format today's lesson for display.
   */
  private formatTodayLesson(today: TodayResult, goalTitle?: string): string {
    const { step, spark } = today;

    if (!step) {
      return this.formatNoContentToday();
    }

    const lines: string[] = [];

    // Header with goal context
    if (goalTitle) {
      lines.push(`📚 **${goalTitle}**`);
      lines.push('');
    }

    // Step title and day
    lines.push(`📍 **${step.title}**`);
    if (step.dayNumber) {
      lines.push(`Day ${step.dayNumber} of your learning plan`);
    }
    lines.push('');

    // Objective
    if (step.objective) {
      lines.push(`**Today's Goal:** ${step.objective}`);
      lines.push('');
    }

    // Spark (the minimal action)
    if (spark) {
      lines.push(`⚡ **Your Spark:** ${spark.action}`);
      if (spark.estimatedMinutes) {
        lines.push(`⏱️ About ${spark.estimatedMinutes} minutes`);
      }
      lines.push('');
    }

    // Resources
    if (step.resources && step.resources.length > 0) {
      lines.push('📚 **Resources:**');
      const topResources = step.resources.slice(0, 3);
      for (const resource of topResources) {
        const emoji = this.getResourceEmoji(resource.type);
        lines.push(`${emoji} [${resource.title}](${resource.url})`);
      }
      if (step.resources.length > 3) {
        lines.push(`_...and ${step.resources.length - 3} more_`);
      }
      lines.push('');
    }

    // Call to action
    lines.push('---');
    lines.push('Say **"done"** when finished, or **"skip"** to move on.');

    return lines.join('\n');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // VIEW GOALS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * View all goals for the user.
   */
  private async viewGoals(userId: UserId): AsyncAppResult<FormattedViewResult> {
    const result = await this.sparkEngine.getGoalsForUser(userId);
    if (!result.ok) {
      return err(result.error);
    }

    const goals = result.value;

    if (goals.length === 0) {
      return ok({
        message: this.formatNoGoals(),
        hasContent: false,
        suggestedActions: ['Create your first learning goal'],
      });
    }

    // Get progress for each goal if configured
    const goalsWithProgress: Array<{ goal: Goal; progress: PathProgress | null }> = [];

    if (this.config.includeProgressInList) {
      for (const goal of goals.slice(0, this.config.maxGoalsToList)) {
        const progressResult = await this.sparkEngine.getPathProgress(goal.id);
        goalsWithProgress.push({
          goal,
          progress: progressResult.ok ? progressResult.value : null,
        });
      }
    } else {
      for (const goal of goals.slice(0, this.config.maxGoalsToList)) {
        goalsWithProgress.push({ goal, progress: null });
      }
    }

    return ok({
      message: this.formatGoalsList(goalsWithProgress),
      hasContent: true,
      suggestedActions: [
        'View progress for a goal',
        "See today's lesson",
        'Create a new goal',
      ],
    });
  }

  /**
   * Format message when no goals exist.
   */
  private formatNoGoals(): string {
    const lines: string[] = [
      "📭 **You don't have any learning goals yet**",
      '',
      "Ready to start learning? Tell me what you'd like to learn!",
      '',
      'Examples:',
      '• "I want to learn Python"',
      '• "Teach me web development"',
      '• "Help me master TypeScript"',
    ];
    return lines.join('\n');
  }

  /**
   * Format goals list for display.
   */
  private formatGoalsList(
    goalsWithProgress: Array<{ goal: Goal; progress: PathProgress | null }>
  ): string {
    const lines: string[] = ['📋 **Your Learning Goals**', ''];

    // Group by status
    const active = goalsWithProgress.filter((g) => g.goal.status === 'active');
    const paused = goalsWithProgress.filter((g) => g.goal.status === 'paused');
    const completed = goalsWithProgress.filter((g) => g.goal.status === 'completed');

    if (active.length > 0) {
      lines.push('**Active:**');
      for (const { goal, progress } of active) {
        lines.push(this.formatGoalLine(goal, progress));
      }
      lines.push('');
    }

    if (paused.length > 0) {
      lines.push('**Paused:**');
      for (const { goal, progress } of paused) {
        lines.push(this.formatGoalLine(goal, progress));
      }
      lines.push('');
    }

    if (completed.length > 0) {
      lines.push('**Completed:**');
      for (const { goal } of completed) {
        lines.push(`✅ ${goal.title}`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('Say **"show progress for [goal]"** for details.');

    return lines.join('\n');
  }

  /**
   * Format a single goal line with optional progress.
   */
  private formatGoalLine(goal: Goal, progress: PathProgress | null): string {
    const statusEmoji = this.getStatusEmoji(goal.status);

    if (progress) {
      const progressBar = this.createProgressBar(progress.overallProgress);
      const daysInfo = `Day ${progress.daysCompleted}/${progress.totalDays}`;
      return `${statusEmoji} **${goal.title}** ${progressBar} ${daysInfo}`;
    }

    return `${statusEmoji} **${goal.title}**`;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // VIEW PROGRESS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * View progress for a specific goal.
   */
  private async viewProgress(
    userId: UserId,
    goalId?: GoalId
  ): AsyncAppResult<FormattedViewResult> {
    // If no goalId provided, try to find the active goal
    let targetGoalId = goalId;

    if (!targetGoalId) {
      const goalsResult = await this.sparkEngine.getGoalsForUser(userId);
      if (!goalsResult.ok) {
        return err(goalsResult.error);
      }

      const activeGoal = goalsResult.value.find((g) => g.status === 'active');
      if (!activeGoal) {
        return ok({
          message: this.formatNoActiveGoal(),
          hasContent: false,
          suggestedActions: ['View all goals', 'Create a new goal'],
        });
      }
      targetGoalId = activeGoal.id;
    }

    // Get progress
    const progressResult = await this.sparkEngine.getPathProgress(targetGoalId);
    if (!progressResult.ok) {
      return err(progressResult.error);
    }

    const progress = progressResult.value;

    // Get goal details
    const goalsResult = await this.sparkEngine.getGoalsForUser(userId);
    const goal = goalsResult.ok
      ? goalsResult.value.find((g) => g.id === targetGoalId)
      : null;

    return ok({
      message: this.formatProgress(progress, goal?.title ?? 'Your Goal'),
      hasContent: true,
      suggestedActions: [
        "See today's lesson",
        'View full plan',
        'View upcoming lessons',
      ],
      goalId: targetGoalId,
    });
  }

  /**
   * Format message when no active goal exists.
   */
  private formatNoActiveGoal(): string {
    const lines: string[] = [
      "📊 **No active goal to show progress for**",
      '',
      'You can:',
      '• View all your goals',
      '• Resume a paused goal',
      '• Create a new learning goal',
    ];
    return lines.join('\n');
  }

  /**
   * Format progress display.
   */
  private formatProgress(progress: PathProgress, goalTitle: string): string {
    const lines: string[] = [];

    // Header
    lines.push(`📊 **Progress: ${goalTitle}**`);
    lines.push('');

    // Overall progress bar
    const progressBar = this.createProgressBar(progress.overallProgress, 20);
    lines.push(`${progressBar} **${Math.round(progress.overallProgress)}%**`);
    lines.push('');

    // Stats
    lines.push('**Stats:**');
    lines.push(`• Days completed: ${progress.daysCompleted} / ${progress.totalDays}`);
    lines.push(`• Steps completed: ${progress.completedSteps} / ${progress.totalSteps}`);
    lines.push(`• Quests completed: ${progress.completedQuests} / ${progress.totalQuests}`);
    lines.push('');

    // Current position
    if (progress.currentQuest) {
      lines.push('**Currently on:**');
      lines.push(`📦 ${progress.currentQuest.title}`);
      if (progress.currentStep) {
        lines.push(`📍 ${progress.currentStep.title}`);
      }
      lines.push('');
    }

    // Schedule status
    if (progress.onTrack) {
      lines.push('✅ **On track!**');
    } else if (progress.daysBehind > 0) {
      lines.push(`⚠️ **${progress.daysBehind} day${progress.daysBehind > 1 ? 's' : ''} behind schedule**`);
    }

    // Estimated completion
    if (progress.estimatedCompletionDate) {
      lines.push(`📅 Estimated completion: ${this.formatDate(progress.estimatedCompletionDate)}`);
    }

    return lines.join('\n');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // VIEW PLAN
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * View the full learning plan for a goal.
   */
  private async viewPlan(
    userId: UserId,
    goalId?: GoalId
  ): AsyncAppResult<FormattedViewResult> {
    // If no goalId provided, try to find the active goal
    let targetGoalId = goalId;

    if (!targetGoalId) {
      const goalsResult = await this.sparkEngine.getGoalsForUser(userId);
      if (!goalsResult.ok) {
        return err(goalsResult.error);
      }

      const activeGoal = goalsResult.value.find((g) => g.status === 'active');
      if (!activeGoal) {
        return ok({
          message: this.formatNoActiveGoal(),
          hasContent: false,
          suggestedActions: ['View all goals', 'Create a new goal'],
        });
      }
      targetGoalId = activeGoal.id;
    }

    // Get goal details
    const goalsResult = await this.sparkEngine.getGoalsForUser(userId);
    const goal = goalsResult.ok
      ? goalsResult.value.find((g) => g.id === targetGoalId)
      : null;

    // Get quests
    const questsResult = await this.sparkEngine.getQuestsForGoal(targetGoalId);
    if (!questsResult.ok) {
      return err(questsResult.error);
    }

    const quests = questsResult.value;

    if (quests.length === 0) {
      return ok({
        message: '📋 **No learning plan found for this goal.**',
        hasContent: false,
        suggestedActions: ['View all goals'],
        goalId: targetGoalId,
      });
    }

    return ok({
      message: this.formatPlan(quests, goal?.title ?? 'Your Learning Plan'),
      hasContent: true,
      suggestedActions: [
        "See today's lesson",
        'View progress',
        'View upcoming lessons',
      ],
      goalId: targetGoalId,
    });
  }

  /**
   * Format full plan display.
   */
  private formatPlan(quests: readonly Quest[], goalTitle: string): string {
    const lines: string[] = [];

    // Header
    lines.push(`📋 **${goalTitle}**`);
    lines.push('');

    // Sort quests by order
    const sortedQuests = [...quests].sort((a, b) => a.order - b.order);

    for (const quest of sortedQuests) {
      const statusEmoji = this.getQuestStatusEmoji(quest.status);
      lines.push(`${statusEmoji} **${quest.title}**`);

      if (quest.description) {
        lines.push(`   ${quest.description}`);
      }

      // Show topics if available
      if (quest.topics && quest.topics.length > 0) {
        const topicsList = quest.topics.slice(0, 4).join(', ');
        const more = quest.topics.length > 4 ? ` +${quest.topics.length - 4} more` : '';
        lines.push(`   Topics: ${topicsList}${more}`);
      }

      lines.push('');
    }

    lines.push('---');
    lines.push(`Total: ${sortedQuests.length} quest${sortedQuests.length > 1 ? 's' : ''}`);

    return lines.join('\n');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // VIEW UPCOMING
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * View upcoming lessons.
   */
  private async viewUpcoming(
    userId: UserId,
    goalId?: GoalId,
    count?: number
  ): AsyncAppResult<FormattedViewResult> {
    const daysToShow = count ?? this.config.defaultUpcomingDays;

    // Get today's content first
    const todayResult = await this.sparkEngine.getTodayForUser(userId);
    if (!todayResult.ok) {
      return err(todayResult.error);
    }

    const today = todayResult.value;

    if (!today.hasContent) {
      return ok({
        message: this.formatNoUpcoming(),
        hasContent: false,
        suggestedActions: ['Create a new learning goal'],
      });
    }

    // For now, show today + summary
    // Full upcoming would require additional store methods
    const lines: string[] = [];

    lines.push(`📅 **Upcoming Lessons** (Next ${daysToShow} days)`);
    lines.push('');

    if (today.step) {
      lines.push(`**Today:** ${today.step.title}`);
      if (today.step.dayNumber) {
        lines.push(`   Day ${today.step.dayNumber}`);
      }
    }

    lines.push('');
    lines.push('_More detailed upcoming view coming soon!_');
    lines.push('');
    lines.push('---');
    lines.push("Say **\"today's lesson\"** for full details.");

    return ok({
      message: lines.join('\n'),
      hasContent: true,
      suggestedActions: ["See today's lesson", 'View progress', 'View full plan'],
      goalId: today.goalId ?? undefined,
    });
  }

  /**
   * Format message when no upcoming lessons.
   */
  private formatNoUpcoming(): string {
    const lines: string[] = [
      '📅 **No upcoming lessons scheduled**',
      '',
      "You don't have any active learning goals.",
      '',
      "Create a new goal to get started!",
    ];
    return lines.join('\n');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // FORMATTING HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get emoji for resource type.
   */
  private getResourceEmoji(type: string): string {
    const emojiMap: Record<string, string> = {
      video: '🎬',
      article: '📄',
      tutorial: '📖',
      documentation: '📚',
      repository: '💻',
      course: '🎓',
      book: '📕',
      podcast: '🎙️',
      interactive: '🎮',
    };
    return emojiMap[type] ?? '📎';
  }

  /**
   * Get emoji for goal status.
   */
  private getStatusEmoji(status: GoalStatus): string {
    const emojiMap: Record<GoalStatus, string> = {
      active: '🟢',
      paused: '⏸️',
      completed: '✅',
      abandoned: '❌',
    };
    return emojiMap[status] ?? '⚪';
  }

  /**
   * Get emoji for quest status.
   */
  private getQuestStatusEmoji(status: string): string {
    const emojiMap: Record<string, string> = {
      pending: '⚪',
      active: '🔵',
      completed: '✅',
    };
    return emojiMap[status] ?? '⚪';
  }

  /**
   * Create a visual progress bar.
   */
  private createProgressBar(percent: number, width: number = 10): string {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
  }

  /**
   * Format a date string for display.
   */
  private formatDate(dateStr: string): string {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a ViewFlow instance.
 */
export function createViewFlow(
  sparkEngine: ISparkEngine,
  config?: Partial<ViewFlowConfig>
): ViewFlow {
  const mergedConfig: ViewFlowConfig = {
    ...DEFAULT_VIEW_FLOW_CONFIG,
    ...config,
  };
  return new ViewFlow(sparkEngine, mergedConfig);
}
