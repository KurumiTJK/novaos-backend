// ═══════════════════════════════════════════════════════════════════════════════
// ANALYTICS TESTS — Comprehensive Test Suite
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  PERIOD_MS,
  GRANULARITY_MS,
  METRIC_DEFINITIONS,
  type TimePeriod,
  type TimeGranularity,
  type AnalyticsEventType,
} from '../analytics/types.js';
import { EventCollector, getTimeBucket, getDateString } from '../analytics/collector.js';
import { MetricsAggregator } from '../analytics/aggregator.js';
import { DashboardService } from '../analytics/dashboard.js';
import { MemoryStore } from '../storage/memory.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────────────────────────────────────────

const TEST_USER_ID = 'test-user-123';

function createTestCollector(): EventCollector {
  const memoryStore = new MemoryStore();
  return new EventCollector(memoryStore as any);
}

function createTestAggregator(): MetricsAggregator {
  const memoryStore = new MemoryStore();
  return new MetricsAggregator(memoryStore as any);
}

function createTestDashboard(): DashboardService {
  const memoryStore = new MemoryStore();
  const aggregator = new MetricsAggregator(memoryStore as any);
  return new DashboardService(memoryStore as any, aggregator);
}

// ─────────────────────────────────────────────────────────────────────────────────
// TYPE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Analytics Types', () => {
  describe('PERIOD_MS', () => {
    it('should have correct period durations', () => {
      expect(PERIOD_MS.hour).toBe(60 * 60 * 1000);
      expect(PERIOD_MS.day).toBe(24 * 60 * 60 * 1000);
      expect(PERIOD_MS.week).toBe(7 * 24 * 60 * 60 * 1000);
      expect(PERIOD_MS.month).toBe(30 * 24 * 60 * 60 * 1000);
      expect(PERIOD_MS.year).toBe(365 * 24 * 60 * 60 * 1000);
    });
  });
  
  describe('GRANULARITY_MS', () => {
    it('should have correct granularity durations', () => {
      expect(GRANULARITY_MS['5min']).toBe(5 * 60 * 1000);
      expect(GRANULARITY_MS.hour).toBe(60 * 60 * 1000);
      expect(GRANULARITY_MS.day).toBe(24 * 60 * 60 * 1000);
    });
  });
  
  describe('METRIC_DEFINITIONS', () => {
    it('should define core metrics', () => {
      const names = METRIC_DEFINITIONS.map(m => m.name);
      
      expect(names).toContain('requests.total');
      expect(names).toContain('goals.created');
      expect(names).toContain('sparks.completed');
      expect(names).toContain('shield.triggers');
    });
    
    it('should have valid metric types', () => {
      const validTypes = ['counter', 'gauge', 'histogram', 'rate'];
      
      for (const metric of METRIC_DEFINITIONS) {
        expect(validTypes).toContain(metric.type);
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// TIME BUCKET TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Time Bucket Helpers', () => {
  describe('getTimeBucket', () => {
    const testDate = new Date('2024-03-15T14:32:45Z');
    
    it('should create 5min buckets', () => {
      const bucket = getTimeBucket(testDate, '5min');
      expect(bucket).toBe('2024-03-15T14:30');
    });
    
    it('should create hour buckets', () => {
      const bucket = getTimeBucket(testDate, 'hour');
      expect(bucket).toBe('2024-03-15T14');
    });
    
    it('should create day buckets', () => {
      const bucket = getTimeBucket(testDate, 'day');
      expect(bucket).toBe('2024-03-15');
    });
    
    it('should create month buckets', () => {
      const bucket = getTimeBucket(testDate, 'month');
      expect(bucket).toBe('2024-03');
    });
    
    it('should create week buckets (Monday start)', () => {
      const bucket = getTimeBucket(testDate, 'week');
      expect(bucket).toBe('2024-03-11W'); // Monday of that week
    });
  });
  
  describe('getDateString', () => {
    it('should return YYYY-MM-DD format', () => {
      const date = new Date('2024-03-15T14:32:45Z');
      expect(getDateString(date)).toBe('2024-03-15');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// EVENT COLLECTOR TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('EventCollector', () => {
  let collector: EventCollector;
  
  beforeEach(() => {
    collector = createTestCollector();
  });
  
  afterEach(() => {
    collector.stop();
  });
  
  describe('lifecycle', () => {
    it('should start and stop', () => {
      expect(collector.isRunning()).toBe(false);
      
      collector.start();
      expect(collector.isRunning()).toBe(true);
      
      collector.stop();
      expect(collector.isRunning()).toBe(false);
    });
  });
  
  describe('track', () => {
    it('should track an event', () => {
      const event = collector.track(TEST_USER_ID, 'goal.create', { goalId: '123' });
      
      expect(event.id).toMatch(/^evt_/);
      expect(event.type).toBe('goal.create');
      expect(event.userId).toBe(TEST_USER_ID);
      expect(event.properties.goalId).toBe('123');
      expect(event.timestamp).toBeDefined();
    });
    
    it('should include context when provided', () => {
      const event = collector.track(TEST_USER_ID, 'goal.create', {}, {
        sessionId: 'session-123',
        deviceType: 'desktop',
        platform: 'web',
      });
      
      expect(event.sessionId).toBe('session-123');
      expect(event.deviceType).toBe('desktop');
      expect(event.platform).toBe('web');
    });
    
    it('should buffer events', () => {
      expect(collector.getBufferSize()).toBe(0);
      
      collector.track(TEST_USER_ID, 'goal.create', {});
      collector.track(TEST_USER_ID, 'goal.complete', {});
      
      expect(collector.getBufferSize()).toBe(2);
    });
  });
  
  describe('trackImmediate', () => {
    it('should persist event immediately', async () => {
      const event = await collector.trackImmediate(TEST_USER_ID, 'goal.create', { goalId: '123' });
      
      expect(event.id).toBeDefined();
      
      // Event should be retrievable
      const retrieved = await collector.getEvent(event.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.type).toBe('goal.create');
    });
  });
  
  describe('convenience trackers', () => {
    it('should track session start', () => {
      const event = collector.trackSessionStart(TEST_USER_ID, 'session-123', { deviceType: 'mobile' });
      
      expect(event.type).toBe('session.start');
      expect(event.sessionId).toBe('session-123');
      expect(event.deviceType).toBe('mobile');
    });
    
    it('should track session end', () => {
      const event = collector.trackSessionEnd(TEST_USER_ID, 'session-123', 60000);
      
      expect(event.type).toBe('session.end');
      expect(event.properties.durationMs).toBe(60000);
    });
    
    it('should track goal create', () => {
      const event = collector.trackGoalCreate(TEST_USER_ID, 'goal-123', 'Learn TypeScript');
      
      expect(event.type).toBe('goal.create');
      expect(event.properties.goalId).toBe('goal-123');
      expect(event.properties.title).toBe('Learn TypeScript');
    });
    
    it('should track goal complete', () => {
      const event = collector.trackGoalComplete(TEST_USER_ID, 'goal-123', 86400000);
      
      expect(event.type).toBe('goal.complete');
      expect(event.properties.durationMs).toBe(86400000);
    });
    
    it('should track spark suggest', () => {
      const event = collector.trackSparkSuggest(TEST_USER_ID, 'spark-123', 'Write tests');
      
      expect(event.type).toBe('spark.suggest');
      expect(event.properties.action).toBe('Write tests');
    });
    
    it('should track spark accept', () => {
      const event = collector.trackSparkAccept(TEST_USER_ID, 'spark-123');
      
      expect(event.type).toBe('spark.accept');
    });
    
    it('should track spark complete', () => {
      const event = collector.trackSparkComplete(TEST_USER_ID, 'spark-123', 300000);
      
      expect(event.type).toBe('spark.complete');
      expect(event.properties.durationMs).toBe(300000);
    });
    
    it('should track feature use', () => {
      const event = collector.trackFeatureUse(TEST_USER_ID, 'dark_mode', { enabled: true });
      
      expect(event.type).toBe('feature.use');
      expect(event.properties.feature).toBe('dark_mode');
      expect(event.properties.enabled).toBe(true);
    });
    
    it('should track page view', () => {
      const event = collector.trackPageView(TEST_USER_ID, '/goals', '/dashboard');
      
      expect(event.type).toBe('navigation.page_view');
      expect(event.properties.page).toBe('/goals');
      expect(event.properties.referrer).toBe('/dashboard');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// METRICS AGGREGATOR TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('MetricsAggregator', () => {
  let aggregator: MetricsAggregator;
  
  beforeEach(() => {
    aggregator = createTestAggregator();
  });
  
  describe('computeUserActivityMetrics', () => {
    it('should return user activity metrics', async () => {
      const metrics = await aggregator.computeUserActivityMetrics(TEST_USER_ID, 'day');
      
      expect(metrics.userId).toBe(TEST_USER_ID);
      expect(metrics.period).toBe('day');
      expect(metrics.periodStart).toBeDefined();
      
      // Should have all expected fields
      expect(metrics).toHaveProperty('sessions');
      expect(metrics).toHaveProperty('messagesSent');
      expect(metrics).toHaveProperty('goalsCreated');
      expect(metrics).toHaveProperty('goalsCompleted');
      expect(metrics).toHaveProperty('sparksSuggested');
      expect(metrics).toHaveProperty('sparksCompleted');
      expect(metrics).toHaveProperty('engagementScore');
    });
    
    it('should compute rates correctly', async () => {
      const metrics = await aggregator.computeUserActivityMetrics(TEST_USER_ID, 'day');
      
      // Rates should be 0-100
      expect(metrics.goalCompletionRate).toBeGreaterThanOrEqual(0);
      expect(metrics.goalCompletionRate).toBeLessThanOrEqual(100);
      expect(metrics.sparkAcceptRate).toBeGreaterThanOrEqual(0);
      expect(metrics.sparkAcceptRate).toBeLessThanOrEqual(100);
    });
  });
  
  describe('computeUserActivitySummary', () => {
    it('should return user activity summary', async () => {
      const summary = await aggregator.computeUserActivitySummary(TEST_USER_ID);
      
      expect(summary.userId).toBe(TEST_USER_ID);
      expect(summary).toHaveProperty('totalSessions');
      expect(summary).toHaveProperty('totalGoalsCompleted');
      expect(summary).toHaveProperty('currentStreak');
      expect(summary).toHaveProperty('longestStreak');
    });
  });
  
  describe('computeCompletionMetrics', () => {
    it('should return completion metrics', async () => {
      const metrics = await aggregator.computeCompletionMetrics('day');
      
      expect(metrics.period).toBe('day');
      expect(metrics).toHaveProperty('goals');
      expect(metrics).toHaveProperty('quests');
      expect(metrics).toHaveProperty('sparks');
      
      // Goal metrics
      expect(metrics.goals).toHaveProperty('created');
      expect(metrics.goals).toHaveProperty('completed');
      expect(metrics.goals).toHaveProperty('completionRate');
      
      // Spark metrics
      expect(metrics.sparks).toHaveProperty('suggested');
      expect(metrics.sparks).toHaveProperty('accepted');
      expect(metrics.sparks).toHaveProperty('acceptRate');
      expect(metrics.sparks).toHaveProperty('completionRate');
    });
  });
  
  describe('getTimeSeries', () => {
    it('should return time series data', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      const series = await aggregator.getTimeSeries(
        'goals.completed',
        'hour',
        { start: yesterday, end: now }
      );
      
      expect(series.name).toBe('goals.completed');
      expect(series.granularity).toBe('hour');
      expect(series.points).toBeDefined();
      expect(Array.isArray(series.points)).toBe(true);
    });
    
    it('should include aggregates', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      const series = await aggregator.getTimeSeries(
        'goals.completed',
        'hour',
        { start: yesterday, end: now }
      );
      
      expect(series).toHaveProperty('total');
      expect(series).toHaveProperty('min');
      expect(series).toHaveProperty('max');
      expect(series).toHaveProperty('avg');
    });
  });
  
  describe('computeSparkFunnel', () => {
    it('should return spark funnel analysis', async () => {
      const now = new Date();
      const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      
      const funnel = await aggregator.computeSparkFunnel({ start: lastWeek, end: now });
      
      expect(funnel.name).toContain('Spark');
      expect(funnel.steps).toHaveLength(3);
      expect(funnel.steps[0].name).toBe('Suggested');
      expect(funnel.steps[1].name).toBe('Accepted');
      expect(funnel.steps[2].name).toBe('Completed');
      expect(funnel.overallConversionRate).toBeDefined();
    });
  });
  
  describe('computeGoalFunnel', () => {
    it('should return goal funnel analysis', async () => {
      const now = new Date();
      const lastMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      const funnel = await aggregator.computeGoalFunnel({ start: lastMonth, end: now });
      
      expect(funnel.name).toContain('Goal');
      expect(funnel.steps).toHaveLength(4);
      expect(funnel.steps[0].name).toBe('Goal Created');
      expect(funnel.steps[3].name).toBe('Goal Completed');
    });
  });
  
  describe('generateUserInsights', () => {
    it('should generate insights', async () => {
      const insights = await aggregator.generateUserInsights(TEST_USER_ID);
      
      expect(Array.isArray(insights)).toBe(true);
      
      // Each insight should have required fields
      for (const insight of insights) {
        expect(insight.id).toMatch(/^ins_/);
        expect(insight.userId).toBe(TEST_USER_ID);
        expect(insight.type).toBeDefined();
        expect(insight.title).toBeDefined();
        expect(insight.description).toBeDefined();
        expect(insight.createdAt).toBeDefined();
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// DASHBOARD SERVICE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('DashboardService', () => {
  let dashboard: DashboardService;
  
  beforeEach(() => {
    dashboard = createTestDashboard();
  });
  
  describe('getDashboardMetrics', () => {
    it('should return comprehensive dashboard metrics', async () => {
      const metrics = await dashboard.getDashboardMetrics('day');
      
      expect(metrics.period).toBe('day');
      expect(metrics.periodStart).toBeDefined();
      expect(metrics.periodEnd).toBeDefined();
      
      // Summary
      expect(metrics.summary).toHaveProperty('activeUsers');
      expect(metrics.summary).toHaveProperty('newUsers');
      expect(metrics.summary).toHaveProperty('totalSessions');
      expect(metrics.summary).toHaveProperty('totalGoalsCompleted');
      expect(metrics.summary).toHaveProperty('totalSparksCompleted');
      
      // Trends
      expect(metrics.trends).toHaveProperty('activeUsers');
      expect(metrics.trends).toHaveProperty('sessions');
      expect(metrics.trends).toHaveProperty('goalsCompleted');
      expect(metrics.trends).toHaveProperty('sparksCompleted');
      
      // Completion rates
      expect(metrics.completionRates).toBeDefined();
      
      // System metrics
      expect(metrics.system).toBeDefined();
    });
  });
  
  describe('getUserDashboard', () => {
    it('should return personalized user dashboard', async () => {
      const result = await dashboard.getUserDashboard(TEST_USER_ID, 'day');
      
      expect(result.activity).toBeDefined();
      expect(result.activity.userId).toBe(TEST_USER_ID);
      expect(result.insights).toBeDefined();
      expect(Array.isArray(result.insights)).toBe(true);
    });
  });
  
  describe('trackActiveUser', () => {
    it('should track user as active', async () => {
      await dashboard.trackActiveUser(TEST_USER_ID);
      
      const count = await dashboard.getActiveUsersCount();
      expect(count).toBeGreaterThanOrEqual(1);
    });
  });
  
  describe('getLeaderboard', () => {
    it('should return leaderboard', async () => {
      const leaderboard = await dashboard.getLeaderboard('engagement', 'week');
      
      expect(leaderboard.name).toBe('engagement');
      expect(leaderboard.period).toBe('week');
      expect(leaderboard.entries).toBeDefined();
      expect(Array.isArray(leaderboard.entries)).toBe(true);
    });
  });
  
  describe('updateLeaderboardScore', () => {
    it('should update user score on leaderboard', async () => {
      await dashboard.updateLeaderboardScore('engagement', 'week', TEST_USER_ID, 100);
      
      const rank = await dashboard.getUserRank(TEST_USER_ID, 'engagement', 'week');
      
      expect(rank).not.toBeNull();
      expect(rank?.userId).toBe(TEST_USER_ID);
      expect(rank?.score).toBe(100);
      expect(rank?.rank).toBe(1);
    });
    
    it('should sort leaderboard by score', async () => {
      await dashboard.updateLeaderboardScore('engagement', 'week', 'user-1', 100);
      await dashboard.updateLeaderboardScore('engagement', 'week', 'user-2', 200);
      await dashboard.updateLeaderboardScore('engagement', 'week', 'user-3', 150);
      
      const leaderboard = await dashboard.getLeaderboard('engagement', 'week');
      
      expect(leaderboard.entries[0].userId).toBe('user-2');
      expect(leaderboard.entries[0].rank).toBe(1);
      expect(leaderboard.entries[1].userId).toBe('user-3');
      expect(leaderboard.entries[1].rank).toBe(2);
      expect(leaderboard.entries[2].userId).toBe('user-1');
      expect(leaderboard.entries[2].rank).toBe(3);
    });
  });
  
  describe('compareMetrics', () => {
    it('should compare current and previous periods', async () => {
      const comparison = await dashboard.compareMetrics(TEST_USER_ID, 'week');
      
      expect(comparison.current).toBeDefined();
      expect(comparison.changes).toBeDefined();
      expect(comparison.changes).toHaveProperty('sessions');
      expect(comparison.changes).toHaveProperty('goalsCompleted');
      expect(comparison.changes).toHaveProperty('sparksCompleted');
      expect(comparison.changes).toHaveProperty('engagementScore');
    });
  });
  
  describe('exportMetricsCSV', () => {
    it('should export metrics as CSV', async () => {
      const now = new Date();
      const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      
      const csv = await dashboard.exportMetricsCSV(
        TEST_USER_ID,
        'week',
        { start: lastWeek, end: now }
      );
      
      expect(csv).toContain('timestamp');
      expect(csv).toContain('sessions');
      expect(csv).toContain('goals_completed');
      expect(csv).toContain('sparks_completed');
      expect(csv.split('\n').length).toBeGreaterThan(1);
    });
  });
});
