// ═══════════════════════════════════════════════════════════════════════════════
// METRICS AGGREGATOR — Compute User Activity and Completion Metrics
// ═══════════════════════════════════════════════════════════════════════════════

import { getStore, type KeyValueStore } from '../storage/index.js';
import { getLogger } from '../logging/index.js';
import { getTimeBucket, getDateString } from './collector.js';
import type {
  TimePeriod,
  TimeGranularity,
  TimeRange,
  UserActivityMetrics,
  UserActivitySummary,
  CompletionMetrics,
  SystemMetrics,
  TimeSeries,
  TimeSeriesPoint,
  FunnelAnalysis,
  FunnelStep,
  UserInsight,
  InsightType,
} from './types.js';
import { PERIOD_MS, GRANULARITY_MS } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

const METRICS_TTL = 90 * 24 * 60 * 60;        // 90 days
const SUMMARY_TTL = 365 * 24 * 60 * 60;       // 1 year
const INSIGHT_TTL = 7 * 24 * 60 * 60;         // 7 days

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'metrics-aggregator' });

// ─────────────────────────────────────────────────────────────────────────────────
// KEY GENERATION
// ─────────────────────────────────────────────────────────────────────────────────

function userMetricsKey(userId: string, period: TimePeriod, bucket: string): string {
  return `analytics:metrics:user:${userId}:${period}:${bucket}`;
}

function userSummaryKey(userId: string): string {
  return `analytics:summary:user:${userId}`;
}

function completionMetricsKey(period: TimePeriod, bucket: string): string {
  return `analytics:metrics:completion:${period}:${bucket}`;
}

function systemMetricsKey(granularity: TimeGranularity, bucket: string): string {
  return `analytics:metrics:system:${granularity}:${bucket}`;
}

function userCounterKey(userId: string, metric: string, bucket: string): string {
  return `analytics:user:${userId}:counter:${metric}:${bucket}`;
}

function globalCounterKey(metric: string, bucket: string): string {
  return `analytics:global:counter:${metric}:${bucket}`;
}

function insightKey(id: string): string {
  return `analytics:insight:${id}`;
}

function userInsightsKey(userId: string): string {
  return `analytics:user:${userId}:insights`;
}

function generateInsightId(): string {
  return `ins_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// ─────────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

function getPeriodBucket(date: Date, period: TimePeriod): string {
  switch (period) {
    case 'hour':
      return date.toISOString().slice(0, 13);
    case 'day':
      return date.toISOString().slice(0, 10);
    case 'week': {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - d.getDay() + 1);
      return d.toISOString().slice(0, 10) + 'W';
    }
    case 'month':
      return date.toISOString().slice(0, 7);
    case 'year':
      return date.toISOString().slice(0, 4);
  }
}

function safeRate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 100; // 2 decimal places
}

// ─────────────────────────────────────────────────────────────────────────────────
// METRICS AGGREGATOR CLASS
// ─────────────────────────────────────────────────────────────────────────────────

export class MetricsAggregator {
  private store: KeyValueStore;
  
  constructor(store?: KeyValueStore) {
    this.store = store ?? getStore();
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // USER ACTIVITY METRICS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Compute user activity metrics for a period.
   */
  async computeUserActivityMetrics(
    userId: string,
    period: TimePeriod,
    date: Date = new Date()
  ): Promise<UserActivityMetrics> {
    const bucket = getPeriodBucket(date, period);
    const dayBucket = getTimeBucket(date, 'day');
    
    // Fetch counters
    const [
      sessions,
      messagesSent,
      messagesReceived,
      conversationsStarted,
      goalsCreated,
      goalsCompleted,
      goalsAbandoned,
      questsStarted,
      questsCompleted,
      stepsCompleted,
      stepsSkipped,
      sparksSuggested,
      sparksAccepted,
      sparksCompleted,
      sparksDeclined,
      sparksExpired,
      shieldTriggers,
      shieldVetos,
      shieldOverrides,
    ] = await Promise.all([
      this.getUserCounter(userId, 'sessions.started', dayBucket),
      this.getUserCounter(userId, 'chat.message_sent', dayBucket),
      this.getUserCounter(userId, 'chat.message_received', dayBucket),
      this.getUserCounter(userId, 'chat.conversation_start', dayBucket),
      this.getUserCounter(userId, 'goals.created', dayBucket),
      this.getUserCounter(userId, 'goals.completed', dayBucket),
      this.getUserCounter(userId, 'goals.abandoned', dayBucket),
      this.getUserCounter(userId, 'quests.started', dayBucket),
      this.getUserCounter(userId, 'quests.completed', dayBucket),
      this.getUserCounter(userId, 'step.complete', dayBucket),
      this.getUserCounter(userId, 'step.skip', dayBucket),
      this.getUserCounter(userId, 'sparks.suggested', dayBucket),
      this.getUserCounter(userId, 'sparks.accepted', dayBucket),
      this.getUserCounter(userId, 'sparks.completed', dayBucket),
      this.getUserCounter(userId, 'sparks.declined', dayBucket),
      this.getUserCounter(userId, 'sparks.expired', dayBucket),
      this.getUserCounter(userId, 'shield.triggers', dayBucket),
      this.getUserCounter(userId, 'shield.vetos', dayBucket),
      this.getUserCounter(userId, 'shield.override', dayBucket),
    ]);
    
    // Compute rates
    const totalGoals = goalsCreated || 1;
    const goalCompletionRate = safeRate(goalsCompleted, totalGoals);
    
    const totalQuests = questsStarted || 1;
    const questCompletionRate = safeRate(questsCompleted, totalQuests);
    
    const sparkAcceptRate = safeRate(sparksAccepted, sparksSuggested);
    const sparkCompletionRate = safeRate(sparksCompleted, sparksAccepted);
    
    // Compute engagement score (0-100)
    const engagementScore = this.computeEngagementScore({
      sessions,
      messagesSent,
      goalsCompleted,
      sparksCompleted,
      sparkAcceptRate,
    });
    
    const now = new Date().toISOString();
    
    const metrics: UserActivityMetrics = {
      userId,
      period,
      periodStart: bucket,
      
      sessions,
      totalSessionDurationMs: 0, // Would need to aggregate from session events
      avgSessionDurationMs: 0,
      
      messagesSent,
      messagesReceived,
      conversationsStarted,
      
      goalsCreated,
      goalsCompleted,
      goalsAbandoned,
      goalCompletionRate,
      
      questsStarted,
      questsCompleted,
      questCompletionRate,
      
      stepsCompleted,
      stepsSkipped,
      
      sparksSuggested,
      sparksAccepted,
      sparksCompleted,
      sparksDeclined,
      sparksExpired,
      sparkAcceptRate,
      sparkCompletionRate,
      
      shieldTriggers,
      shieldVetos,
      shieldOverrides,
      
      engagementScore,
      
      firstActivityAt: now,
      lastActivityAt: now,
    };
    
    // Cache the metrics
    await this.store.set(
      userMetricsKey(userId, period, bucket),
      JSON.stringify(metrics),
      METRICS_TTL
    );
    
    return metrics;
  }
  
  /**
   * Get cached user activity metrics.
   */
  async getUserActivityMetrics(
    userId: string,
    period: TimePeriod,
    date: Date = new Date()
  ): Promise<UserActivityMetrics | null> {
    const bucket = getPeriodBucket(date, period);
    const data = await this.store.get(userMetricsKey(userId, period, bucket));
    return data ? JSON.parse(data) : null;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // USER ACTIVITY SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Compute lifetime summary for a user.
   */
  async computeUserActivitySummary(userId: string): Promise<UserActivitySummary> {
    // This would aggregate across all periods
    // For now, return a template
    const now = new Date().toISOString();
    
    const summary: UserActivitySummary = {
      userId,
      totalSessions: 0,
      totalSessionDurationMs: 0,
      totalGoalsCreated: 0,
      totalGoalsCompleted: 0,
      totalSparksCompleted: 0,
      currentStreak: 0,
      longestStreak: 0,
      avgSessionsPerWeek: 0,
      avgGoalsPerMonth: 0,
      avgSparksPerDay: 0,
      lastActiveAt: now,
      createdAt: now,
      daysActive: 0,
    };
    
    await this.store.set(userSummaryKey(userId), JSON.stringify(summary), SUMMARY_TTL);
    
    return summary;
  }
  
  /**
   * Get user activity summary.
   */
  async getUserActivitySummary(userId: string): Promise<UserActivitySummary | null> {
    const data = await this.store.get(userSummaryKey(userId));
    return data ? JSON.parse(data) : null;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // COMPLETION METRICS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Compute global completion metrics.
   */
  async computeCompletionMetrics(
    period: TimePeriod,
    date: Date = new Date()
  ): Promise<CompletionMetrics> {
    const bucket = getPeriodBucket(date, period);
    const dayBucket = getTimeBucket(date, 'day');
    
    // Fetch global counters
    const [
      goalsCreated,
      goalsCompleted,
      goalsAbandoned,
      questsStarted,
      questsCompleted,
      sparksSuggested,
      sparksAccepted,
      sparksCompleted,
      sparksDeclined,
      sparksExpired,
    ] = await Promise.all([
      this.getGlobalCounter('goals.created', dayBucket),
      this.getGlobalCounter('goals.completed', dayBucket),
      this.getGlobalCounter('goals.abandoned', dayBucket),
      this.getGlobalCounter('quests.started', dayBucket),
      this.getGlobalCounter('quests.completed', dayBucket),
      this.getGlobalCounter('sparks.suggested', dayBucket),
      this.getGlobalCounter('sparks.accepted', dayBucket),
      this.getGlobalCounter('sparks.completed', dayBucket),
      this.getGlobalCounter('sparks.declined', dayBucket),
      this.getGlobalCounter('sparks.expired', dayBucket),
    ]);
    
    const metrics: CompletionMetrics = {
      period,
      periodStart: bucket,
      
      goals: {
        created: goalsCreated,
        completed: goalsCompleted,
        abandoned: goalsAbandoned,
        active: goalsCreated - goalsCompleted - goalsAbandoned,
        completionRate: safeRate(goalsCompleted, goalsCreated),
        avgCompletionTimeMs: 0, // Would need to compute from events
      },
      
      quests: {
        started: questsStarted,
        completed: questsCompleted,
        blocked: 0,
        completionRate: safeRate(questsCompleted, questsStarted),
        avgCompletionTimeMs: 0,
      },
      
      sparks: {
        suggested: sparksSuggested,
        accepted: sparksAccepted,
        completed: sparksCompleted,
        declined: sparksDeclined,
        expired: sparksExpired,
        acceptRate: safeRate(sparksAccepted, sparksSuggested),
        completionRate: safeRate(sparksCompleted, sparksAccepted),
        avgCompletionTimeMs: 0,
      },
    };
    
    await this.store.set(
      completionMetricsKey(period, bucket),
      JSON.stringify(metrics),
      METRICS_TTL
    );
    
    return metrics;
  }
  
  /**
   * Get cached completion metrics.
   */
  async getCompletionMetrics(
    period: TimePeriod,
    date: Date = new Date()
  ): Promise<CompletionMetrics | null> {
    const bucket = getPeriodBucket(date, period);
    const data = await this.store.get(completionMetricsKey(period, bucket));
    return data ? JSON.parse(data) : null;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // SYSTEM METRICS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Record system metrics snapshot.
   */
  async recordSystemMetrics(metrics: Omit<SystemMetrics, 'timestamp'>): Promise<void> {
    const now = new Date();
    const fullMetrics: SystemMetrics = {
      ...metrics,
      timestamp: now.toISOString(),
    };
    
    const bucket = getTimeBucket(now, metrics.period);
    await this.store.set(
      systemMetricsKey(metrics.period, bucket),
      JSON.stringify(fullMetrics),
      METRICS_TTL
    );
  }
  
  /**
   * Get system metrics for a time range.
   */
  async getSystemMetrics(
    granularity: TimeGranularity,
    range: TimeRange
  ): Promise<SystemMetrics[]> {
    const metrics: SystemMetrics[] = [];
    const step = GRANULARITY_MS[granularity];
    
    let current = range.start.getTime();
    while (current <= range.end.getTime()) {
      const bucket = getTimeBucket(new Date(current), granularity);
      const data = await this.store.get(systemMetricsKey(granularity, bucket));
      if (data) {
        metrics.push(JSON.parse(data));
      }
      current += step;
    }
    
    return metrics;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // TIME SERIES
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Get time series data for a metric.
   */
  async getTimeSeries(
    metric: string,
    granularity: TimeGranularity,
    range: TimeRange,
    userId?: string
  ): Promise<TimeSeries> {
    const points: TimeSeriesPoint[] = [];
    const step = GRANULARITY_MS[granularity];
    
    let current = range.start.getTime();
    let total = 0;
    let min = Infinity;
    let max = -Infinity;
    
    while (current <= range.end.getTime()) {
      const bucket = getTimeBucket(new Date(current), granularity);
      const value = userId
        ? await this.getUserCounter(userId, metric, bucket)
        : await this.getGlobalCounter(metric, bucket);
      
      points.push({
        timestamp: new Date(current).toISOString(),
        value,
      });
      
      total += value;
      min = Math.min(min, value);
      max = Math.max(max, value);
      
      current += step;
    }
    
    return {
      name: metric,
      granularity,
      points,
      total,
      min: min === Infinity ? 0 : min,
      max: max === -Infinity ? 0 : max,
      avg: points.length > 0 ? total / points.length : 0,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // FUNNEL ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Compute funnel analysis for spark flow.
   */
  async computeSparkFunnel(range: TimeRange): Promise<FunnelAnalysis> {
    const dayBucket = getTimeBucket(range.start, 'day');
    
    const [suggested, accepted, completed] = await Promise.all([
      this.getGlobalCounter('sparks.suggested', dayBucket),
      this.getGlobalCounter('sparks.accepted', dayBucket),
      this.getGlobalCounter('sparks.completed', dayBucket),
    ]);
    
    const steps: FunnelStep[] = [
      {
        name: 'Suggested',
        count: suggested,
        conversionRate: 100,
        dropoffRate: 0,
      },
      {
        name: 'Accepted',
        count: accepted,
        conversionRate: safeRate(accepted, suggested),
        dropoffRate: safeRate(suggested - accepted, suggested),
      },
      {
        name: 'Completed',
        count: completed,
        conversionRate: safeRate(completed, accepted),
        dropoffRate: safeRate(accepted - completed, accepted),
      },
    ];
    
    return {
      name: 'Spark Completion Funnel',
      period: range,
      steps,
      overallConversionRate: safeRate(completed, suggested),
    };
  }
  
  /**
   * Compute funnel for goal achievement.
   */
  async computeGoalFunnel(range: TimeRange): Promise<FunnelAnalysis> {
    const dayBucket = getTimeBucket(range.start, 'day');
    
    const [created, questsStarted, questsCompleted, completed] = await Promise.all([
      this.getGlobalCounter('goals.created', dayBucket),
      this.getGlobalCounter('quests.started', dayBucket),
      this.getGlobalCounter('quests.completed', dayBucket),
      this.getGlobalCounter('goals.completed', dayBucket),
    ]);
    
    const steps: FunnelStep[] = [
      {
        name: 'Goal Created',
        count: created,
        conversionRate: 100,
        dropoffRate: 0,
      },
      {
        name: 'Quest Started',
        count: questsStarted,
        conversionRate: safeRate(questsStarted, created),
        dropoffRate: safeRate(created - questsStarted, created),
      },
      {
        name: 'Quest Completed',
        count: questsCompleted,
        conversionRate: safeRate(questsCompleted, questsStarted),
        dropoffRate: safeRate(questsStarted - questsCompleted, questsStarted),
      },
      {
        name: 'Goal Completed',
        count: completed,
        conversionRate: safeRate(completed, questsCompleted),
        dropoffRate: safeRate(questsCompleted - completed, questsCompleted),
      },
    ];
    
    return {
      name: 'Goal Achievement Funnel',
      period: range,
      steps,
      overallConversionRate: safeRate(completed, created),
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // INSIGHTS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Generate insights for a user.
   */
  async generateUserInsights(userId: string): Promise<UserInsight[]> {
    const insights: UserInsight[] = [];
    const now = new Date();
    const dayBucket = getTimeBucket(now, 'day');
    
    // Check for achievements
    const sparksCompleted = await this.getUserCounter(userId, 'sparks.completed', dayBucket);
    if (sparksCompleted >= 5) {
      insights.push(this.createInsight(userId, 'achievement', 
        'Spark Master!',
        `You completed ${sparksCompleted} sparks today. Great momentum!`,
        'sparks.completed',
        sparksCompleted
      ));
    }
    
    const goalsCompleted = await this.getUserCounter(userId, 'goals.completed', dayBucket);
    if (goalsCompleted > 0) {
      insights.push(this.createInsight(userId, 'achievement',
        'Goal Achieved!',
        `You completed ${goalsCompleted} goal${goalsCompleted > 1 ? 's' : ''} today!`,
        'goals.completed',
        goalsCompleted
      ));
    }
    
    // Check for improvement opportunities
    const sparksSuggested = await this.getUserCounter(userId, 'sparks.suggested', dayBucket);
    const sparksAccepted = await this.getUserCounter(userId, 'sparks.accepted', dayBucket);
    const acceptRate = safeRate(sparksAccepted, sparksSuggested);
    
    if (sparksSuggested > 5 && acceptRate < 30) {
      insights.push(this.createInsight(userId, 'suggestion',
        'Spark Alignment',
        'Consider adjusting your goals or spark preferences - many sparks aren\'t resonating.',
        'spark.accept_rate',
        acceptRate
      ));
    }
    
    // Store insights
    for (const insight of insights) {
      await this.store.set(insightKey(insight.id), JSON.stringify(insight), INSIGHT_TTL);
      await this.store.lpush(userInsightsKey(userId), insight.id);
      await this.store.ltrim(userInsightsKey(userId), 0, 49); // Keep last 50
    }
    
    return insights;
  }
  
  private createInsight(
    userId: string,
    type: InsightType,
    title: string,
    description: string,
    metric?: string,
    value?: number,
    comparison?: number
  ): UserInsight {
    return {
      id: generateInsightId(),
      userId,
      type,
      title,
      description,
      metric,
      value,
      comparison,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + INSIGHT_TTL * 1000).toISOString(),
    };
  }
  
  /**
   * Get user insights.
   */
  async getUserInsights(userId: string, limit: number = 10): Promise<UserInsight[]> {
    const ids = await this.store.lrange(userInsightsKey(userId), 0, limit - 1);
    const insights: UserInsight[] = [];
    
    for (const id of ids) {
      const data = await this.store.get(insightKey(id));
      if (data) {
        insights.push(JSON.parse(data));
      }
    }
    
    return insights;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // ENGAGEMENT SCORE
  // ═══════════════════════════════════════════════════════════════════════════════
  
  private computeEngagementScore(factors: {
    sessions: number;
    messagesSent: number;
    goalsCompleted: number;
    sparksCompleted: number;
    sparkAcceptRate: number;
  }): number {
    // Weighted engagement score (0-100)
    const weights = {
      sessions: 10,
      messagesSent: 5,
      goalsCompleted: 30,
      sparksCompleted: 20,
      sparkAcceptRate: 0.35, // Already 0-100
    };
    
    let score = 0;
    
    // Sessions contribution (max 10 points)
    score += Math.min(factors.sessions * 2, weights.sessions);
    
    // Messages contribution (max 5 points)
    score += Math.min(factors.messagesSent * 0.5, weights.messagesSent);
    
    // Goals contribution (max 30 points)
    score += Math.min(factors.goalsCompleted * 15, weights.goalsCompleted);
    
    // Sparks contribution (max 20 points)
    score += Math.min(factors.sparksCompleted * 4, weights.sparksCompleted);
    
    // Accept rate contribution (max 35 points)
    score += factors.sparkAcceptRate * weights.sparkAcceptRate;
    
    return Math.round(Math.min(score, 100));
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // COUNTER HELPERS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  private async getUserCounter(userId: string, metric: string, bucket: string): Promise<number> {
    const value = await this.store.get(userCounterKey(userId, metric, bucket));
    return value ? parseInt(value, 10) : 0;
  }
  
  private async getGlobalCounter(metric: string, bucket: string): Promise<number> {
    const value = await this.store.get(globalCounterKey(metric, bucket));
    return value ? parseInt(value, 10) : 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let aggregator: MetricsAggregator | null = null;

export function getMetricsAggregator(): MetricsAggregator {
  if (!aggregator) {
    aggregator = new MetricsAggregator();
  }
  return aggregator;
}
