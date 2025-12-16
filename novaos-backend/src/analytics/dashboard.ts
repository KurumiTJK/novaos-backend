// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD SERVICE — Comprehensive Metrics Views
// ═══════════════════════════════════════════════════════════════════════════════

import { getStore, type KeyValueStore } from '../storage/index.js';
import { getLogger } from '../logging/index.js';
import { MetricsAggregator, getMetricsAggregator } from './aggregator.js';
import { getTimeBucket } from './collector.js';
import type {
  TimePeriod,
  TimeGranularity,
  TimeRange,
  DashboardMetrics,
  UserActivityMetrics,
  UserActivitySummary,
  CompletionMetrics,
  SystemMetrics,
  TimeSeries,
  Leaderboard,
  LeaderboardEntry,
  UserInsight,
} from './types.js';
import { PERIOD_MS, GRANULARITY_MS } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

const LEADERBOARD_TTL = 60 * 60;              // 1 hour
const DASHBOARD_CACHE_TTL = 5 * 60;           // 5 minutes

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'dashboard-service' });

// ─────────────────────────────────────────────────────────────────────────────────
// KEY GENERATION
// ─────────────────────────────────────────────────────────────────────────────────

function dashboardCacheKey(period: TimePeriod): string {
  return `analytics:dashboard:cache:${period}`;
}

function leaderboardKey(name: string, period: TimePeriod): string {
  return `analytics:leaderboard:${name}:${period}`;
}

function activeUsersKey(bucket: string): string {
  return `analytics:active_users:${bucket}`;
}

// ─────────────────────────────────────────────────────────────────────────────────
// DASHBOARD SERVICE CLASS
// ─────────────────────────────────────────────────────────────────────────────────

export class DashboardService {
  private store: KeyValueStore;
  private aggregator: MetricsAggregator;
  
  constructor(store?: KeyValueStore, aggregator?: MetricsAggregator) {
    this.store = store ?? getStore();
    this.aggregator = aggregator ?? getMetricsAggregator();
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // DASHBOARD METRICS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Get comprehensive dashboard metrics.
   */
  async getDashboardMetrics(period: TimePeriod = 'day'): Promise<DashboardMetrics> {
    // Check cache
    const cached = await this.store.get(dashboardCacheKey(period));
    if (cached) {
      return JSON.parse(cached);
    }
    
    const now = new Date();
    const periodStart = new Date(now.getTime() - PERIOD_MS[period]);
    
    // Build time range
    const range: TimeRange = {
      start: periodStart,
      end: now,
    };
    
    // Determine granularity based on period
    const granularity = this.getGranularityForPeriod(period);
    
    // Fetch all metrics in parallel
    const [
      activeUsers,
      newUsers,
      totalSessions,
      totalGoalsCompleted,
      totalSparksCompleted,
      activeUsersTrend,
      sessionsTrend,
      goalsCompletedTrend,
      sparksCompletedTrend,
      completionRates,
      systemMetrics,
    ] = await Promise.all([
      this.getActiveUsersCount(now),
      this.getNewUsersCount(range),
      this.getTotalSessions(range),
      this.getTotalGoalsCompleted(range),
      this.getTotalSparksCompleted(range),
      this.aggregator.getTimeSeries('users.active', granularity, range),
      this.aggregator.getTimeSeries('sessions.started', granularity, range),
      this.aggregator.getTimeSeries('goals.completed', granularity, range),
      this.aggregator.getTimeSeries('sparks.completed', granularity, range),
      this.aggregator.computeCompletionMetrics(period),
      this.getLatestSystemMetrics(granularity),
    ]);
    
    const dashboard: DashboardMetrics = {
      period,
      periodStart: periodStart.toISOString(),
      periodEnd: now.toISOString(),
      
      summary: {
        activeUsers,
        newUsers,
        totalSessions,
        totalGoalsCompleted,
        totalSparksCompleted,
      },
      
      trends: {
        activeUsers: activeUsersTrend,
        sessions: sessionsTrend,
        goalsCompleted: goalsCompletedTrend,
        sparksCompleted: sparksCompletedTrend,
      },
      
      completionRates,
      system: systemMetrics,
    };
    
    // Cache the dashboard
    await this.store.set(
      dashboardCacheKey(period),
      JSON.stringify(dashboard),
      DASHBOARD_CACHE_TTL
    );
    
    return dashboard;
  }
  
  private getGranularityForPeriod(period: TimePeriod): TimeGranularity {
    switch (period) {
      case 'hour':
        return '5min';
      case 'day':
        return 'hour';
      case 'week':
        return 'day';
      case 'month':
        return 'day';
      case 'year':
        return 'month';
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // USER DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Get personalized dashboard for a user.
   */
  async getUserDashboard(userId: string, period: TimePeriod = 'day'): Promise<{
    activity: UserActivityMetrics;
    summary: UserActivitySummary | null;
    insights: UserInsight[];
    rank?: LeaderboardEntry;
  }> {
    const [activity, summary, insights, rank] = await Promise.all([
      this.aggregator.computeUserActivityMetrics(userId, period),
      this.aggregator.getUserActivitySummary(userId),
      this.aggregator.getUserInsights(userId),
      this.getUserRank(userId, 'engagement', period),
    ]);
    
    return {
      activity,
      summary,
      insights,
      rank: rank ?? undefined,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // LEADERBOARDS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Get or compute a leaderboard.
   */
  async getLeaderboard(
    name: string,
    period: TimePeriod,
    limit: number = 10
  ): Promise<Leaderboard> {
    // Check cache
    const cached = await this.store.get(leaderboardKey(name, period));
    if (cached) {
      const leaderboard: Leaderboard = JSON.parse(cached);
      return {
        ...leaderboard,
        entries: leaderboard.entries.slice(0, limit),
      };
    }
    
    // Would need to compute from all users
    // For now, return empty leaderboard
    const leaderboard: Leaderboard = {
      name,
      period,
      entries: [],
      updatedAt: new Date().toISOString(),
    };
    
    return leaderboard;
  }
  
  /**
   * Update a user's score on a leaderboard.
   */
  async updateLeaderboardScore(
    name: string,
    period: TimePeriod,
    userId: string,
    score: number
  ): Promise<void> {
    const key = leaderboardKey(name, period);
    const data = await this.store.get(key);
    
    let leaderboard: Leaderboard;
    if (data) {
      leaderboard = JSON.parse(data);
    } else {
      leaderboard = {
        name,
        period,
        entries: [],
        updatedAt: new Date().toISOString(),
      };
    }
    
    // Update or add entry
    const existingIndex = leaderboard.entries.findIndex(e => e.userId === userId);
    if (existingIndex >= 0) {
      const existing = leaderboard.entries[existingIndex];
      leaderboard.entries[existingIndex] = {
        ...existing,
        change: score - existing.score,
        score,
        rank: 0, // Will be recalculated
      };
    } else {
      leaderboard.entries.push({
        rank: 0,
        userId,
        score,
      });
    }
    
    // Sort and rank
    leaderboard.entries.sort((a, b) => b.score - a.score);
    leaderboard.entries.forEach((entry, index) => {
      entry.rank = index + 1;
    });
    
    // Keep top 100
    leaderboard.entries = leaderboard.entries.slice(0, 100);
    leaderboard.updatedAt = new Date().toISOString();
    
    await this.store.set(key, JSON.stringify(leaderboard), LEADERBOARD_TTL);
  }
  
  /**
   * Get a user's rank on a leaderboard.
   */
  async getUserRank(
    userId: string,
    name: string,
    period: TimePeriod
  ): Promise<LeaderboardEntry | null> {
    const leaderboard = await this.getLeaderboard(name, period, 100);
    return leaderboard.entries.find(e => e.userId === userId) ?? null;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // ACTIVE USERS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Track user as active.
   */
  async trackActiveUser(userId: string): Promise<void> {
    const now = new Date();
    const buckets = [
      getTimeBucket(now, '5min'),
      getTimeBucket(now, 'hour'),
      getTimeBucket(now, 'day'),
    ];
    
    for (const bucket of buckets) {
      await this.store.sadd(activeUsersKey(bucket), userId);
      // Expire after period + buffer
      await this.store.expire(activeUsersKey(bucket), 2 * 24 * 60 * 60);
    }
  }
  
  /**
   * Get count of active users.
   */
  async getActiveUsersCount(date: Date = new Date()): Promise<number> {
    const bucket = getTimeBucket(date, 'day');
    return this.store.scard(activeUsersKey(bucket));
  }
  
  /**
   * Get active user IDs.
   */
  async getActiveUserIds(date: Date = new Date()): Promise<string[]> {
    const bucket = getTimeBucket(date, 'day');
    return this.store.smembers(activeUsersKey(bucket));
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  private async getNewUsersCount(_range: TimeRange): Promise<number> {
    // Would query user registration data
    return 0;
  }
  
  private async getTotalSessions(range: TimeRange): Promise<number> {
    const series = await this.aggregator.getTimeSeries(
      'sessions.started',
      this.getGranularityForPeriod('day'),
      range
    );
    return series.total ?? 0;
  }
  
  private async getTotalGoalsCompleted(range: TimeRange): Promise<number> {
    const series = await this.aggregator.getTimeSeries(
      'goals.completed',
      this.getGranularityForPeriod('day'),
      range
    );
    return series.total ?? 0;
  }
  
  private async getTotalSparksCompleted(range: TimeRange): Promise<number> {
    const series = await this.aggregator.getTimeSeries(
      'sparks.completed',
      this.getGranularityForPeriod('day'),
      range
    );
    return series.total ?? 0;
  }
  
  private async getLatestSystemMetrics(granularity: TimeGranularity): Promise<SystemMetrics> {
    const now = new Date();
    const range: TimeRange = {
      start: new Date(now.getTime() - GRANULARITY_MS[granularity]),
      end: now,
    };
    
    const metrics = await this.aggregator.getSystemMetrics(granularity, range);
    
    if (metrics.length > 0) {
      return metrics[metrics.length - 1];
    }
    
    // Return default metrics
    return {
      timestamp: now.toISOString(),
      period: granularity,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      errorRate: 0,
      avgLatency: 0,
      p50Latency: 0,
      p95Latency: 0,
      p99Latency: 0,
      requestsPerSecond: 0,
      activeUsers: 0,
      activeSessions: 0,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // COMPARISONS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Compare metrics between two periods.
   */
  async compareMetrics(
    userId: string,
    currentPeriod: TimePeriod,
    currentDate: Date = new Date()
  ): Promise<{
    current: UserActivityMetrics;
    previous: UserActivityMetrics | null;
    changes: {
      sessions: number;
      goalsCompleted: number;
      sparksCompleted: number;
      engagementScore: number;
    };
  }> {
    const previousDate = new Date(currentDate.getTime() - PERIOD_MS[currentPeriod]);
    
    const [current, previous] = await Promise.all([
      this.aggregator.computeUserActivityMetrics(userId, currentPeriod, currentDate),
      this.aggregator.getUserActivityMetrics(userId, currentPeriod, previousDate),
    ]);
    
    const changes = {
      sessions: current.sessions - (previous?.sessions ?? 0),
      goalsCompleted: current.goalsCompleted - (previous?.goalsCompleted ?? 0),
      sparksCompleted: current.sparksCompleted - (previous?.sparksCompleted ?? 0),
      engagementScore: current.engagementScore - (previous?.engagementScore ?? 0),
    };
    
    return { current, previous, changes };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // EXPORTS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Export metrics as CSV.
   */
  async exportMetricsCSV(
    userId: string,
    period: TimePeriod,
    range: TimeRange
  ): Promise<string> {
    const granularity = this.getGranularityForPeriod(period);
    
    // Get time series data
    const [sessions, goals, sparks] = await Promise.all([
      this.aggregator.getTimeSeries('sessions.started', granularity, range, userId),
      this.aggregator.getTimeSeries('goals.completed', granularity, range, userId),
      this.aggregator.getTimeSeries('sparks.completed', granularity, range, userId),
    ]);
    
    // Build CSV
    const headers = ['timestamp', 'sessions', 'goals_completed', 'sparks_completed'];
    const rows = [headers.join(',')];
    
    for (let i = 0; i < sessions.points.length; i++) {
      const row = [
        sessions.points[i].timestamp,
        sessions.points[i]?.value ?? 0,
        goals.points[i]?.value ?? 0,
        sparks.points[i]?.value ?? 0,
      ];
      rows.push(row.join(','));
    }
    
    return rows.join('\n');
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let dashboardService: DashboardService | null = null;

export function getDashboardService(): DashboardService {
  if (!dashboardService) {
    dashboardService = new DashboardService();
  }
  return dashboardService;
}
