// ═══════════════════════════════════════════════════════════════════════════════
// ANALYTICS API ROUTES — Metrics and Dashboard Endpoints
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, type Request, type Response } from 'express';
import { getEventCollector } from '../analytics/collector.js';
import { getMetricsAggregator } from '../analytics/aggregator.js';
import { getDashboardService } from '../analytics/dashboard.js';
import type {
  TimePeriod,
  TimeGranularity,
  AnalyticsEventType,
} from '../analytics/types.js';
import { getLogger } from '../logging/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'analytics-api' });

interface AuthenticatedRequest extends Request {
  userId?: string;
}

function getUserId(req: AuthenticatedRequest): string {
  const userId = req.userId;
  if (!userId) {
    throw new Error('Authentication required');
  }
  return userId;
}

// ─────────────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────────────

const VALID_PERIODS: TimePeriod[] = ['hour', 'day', 'week', 'month', 'year'];
const VALID_GRANULARITIES: TimeGranularity[] = ['5min', 'hour', 'day', 'week', 'month'];

function validatePeriod(period: string): TimePeriod {
  if (!VALID_PERIODS.includes(period as TimePeriod)) {
    throw new Error(`Invalid period: ${period}. Valid values: ${VALID_PERIODS.join(', ')}`);
  }
  return period as TimePeriod;
}

function validateGranularity(granularity: string): TimeGranularity {
  if (!VALID_GRANULARITIES.includes(granularity as TimeGranularity)) {
    throw new Error(`Invalid granularity: ${granularity}. Valid values: ${VALID_GRANULARITIES.join(', ')}`);
  }
  return granularity as TimeGranularity;
}

// ─────────────────────────────────────────────────────────────────────────────────
// ROUTER
// ─────────────────────────────────────────────────────────────────────────────────

export function createAnalyticsRouter(): Router {
  const router = Router();
  const collector = getEventCollector();
  const aggregator = getMetricsAggregator();
  const dashboard = getDashboardService();
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // EVENT TRACKING
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Track an analytics event.
   */
  router.post('/events', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = getUserId(req);
      const { type, properties, sessionId, deviceType, platform, version } = req.body;
      
      if (!type) {
        return res.status(400).json({ error: 'type is required' });
      }
      
      const event = collector.track(
        userId,
        type as AnalyticsEventType,
        properties ?? {},
        { sessionId, deviceType, platform, version }
      );
      
      res.status(201).json({ event });
    } catch (error) {
      logger.error('Failed to track event', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to track event' });
    }
  });
  
  /**
   * Track multiple events (batch).
   */
  router.post('/events/batch', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = getUserId(req);
      const { events } = req.body;
      
      if (!Array.isArray(events)) {
        return res.status(400).json({ error: 'events must be an array' });
      }
      
      const tracked = events.map(evt => 
        collector.track(
          userId,
          evt.type as AnalyticsEventType,
          evt.properties ?? {},
          evt.context
        )
      );
      
      res.status(201).json({ 
        events: tracked,
        count: tracked.length,
      });
    } catch (error) {
      logger.error('Failed to track batch events', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to track events' });
    }
  });
  
  /**
   * Get user events for a date.
   */
  router.get('/events', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = getUserId(req);
      const date = req.query.date as string || new Date().toISOString().slice(0, 10);
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
      
      const events = await collector.getUserEvents(userId, date, limit);
      
      res.json({
        events,
        count: events.length,
        date,
      });
    } catch (error) {
      logger.error('Failed to get events', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to get events' });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // USER METRICS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Get user activity metrics.
   */
  router.get('/me/activity', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = getUserId(req);
      const period = validatePeriod(req.query.period as string || 'day');
      
      const metrics = await aggregator.computeUserActivityMetrics(userId, period);
      
      res.json({ metrics });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get metrics';
      logger.error('Failed to get user metrics', error instanceof Error ? error : new Error(message));
      res.status(400).json({ error: message });
    }
  });
  
  /**
   * Get user activity summary (lifetime).
   */
  router.get('/me/summary', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = getUserId(req);
      
      let summary = await aggregator.getUserActivitySummary(userId);
      if (!summary) {
        summary = await aggregator.computeUserActivitySummary(userId);
      }
      
      res.json({ summary });
    } catch (error) {
      logger.error('Failed to get summary', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to get summary' });
    }
  });
  
  /**
   * Get user insights.
   */
  router.get('/me/insights', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = getUserId(req);
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
      
      const insights = await aggregator.getUserInsights(userId, limit);
      
      res.json({
        insights,
        count: insights.length,
      });
    } catch (error) {
      logger.error('Failed to get insights', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to get insights' });
    }
  });
  
  /**
   * Generate fresh insights for user.
   */
  router.post('/me/insights/generate', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = getUserId(req);
      
      const insights = await aggregator.generateUserInsights(userId);
      
      res.json({
        insights,
        count: insights.length,
      });
    } catch (error) {
      logger.error('Failed to generate insights', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to generate insights' });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // USER DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Get user's personalized dashboard.
   */
  router.get('/me/dashboard', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = getUserId(req);
      const period = validatePeriod(req.query.period as string || 'day');
      
      const result = await dashboard.getUserDashboard(userId, period);
      
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get dashboard';
      logger.error('Failed to get user dashboard', error instanceof Error ? error : new Error(message));
      res.status(400).json({ error: message });
    }
  });
  
  /**
   * Compare current period with previous.
   */
  router.get('/me/compare', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = getUserId(req);
      const period = validatePeriod(req.query.period as string || 'week');
      
      const comparison = await dashboard.compareMetrics(userId, period);
      
      res.json(comparison);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to compare';
      logger.error('Failed to compare metrics', error instanceof Error ? error : new Error(message));
      res.status(400).json({ error: message });
    }
  });
  
  /**
   * Export metrics as CSV.
   */
  router.get('/me/export', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = getUserId(req);
      const period = validatePeriod(req.query.period as string || 'month');
      
      const now = new Date();
      const start = new Date(now);
      
      // Set start based on period
      switch (period) {
        case 'hour':
          start.setHours(start.getHours() - 1);
          break;
        case 'day':
          start.setDate(start.getDate() - 1);
          break;
        case 'week':
          start.setDate(start.getDate() - 7);
          break;
        case 'month':
          start.setMonth(start.getMonth() - 1);
          break;
        case 'year':
          start.setFullYear(start.getFullYear() - 1);
          break;
      }
      
      const csv = await dashboard.exportMetricsCSV(userId, period, { start, end: now });
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="metrics-${period}.csv"`);
      res.send(csv);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to export';
      logger.error('Failed to export metrics', error instanceof Error ? error : new Error(message));
      res.status(400).json({ error: message });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // TIME SERIES
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Get time series data for a metric.
   */
  router.get('/timeseries/:metric', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = getUserId(req);
      const { metric } = req.params;
      const granularity = validateGranularity(req.query.granularity as string || 'hour');
      const days = Math.min(parseInt(req.query.days as string) || 7, 90);
      
      const end = new Date();
      const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
      
      const series = await aggregator.getTimeSeries(
        metric,
        granularity,
        { start, end },
        userId
      );
      
      res.json({ series });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get time series';
      logger.error('Failed to get time series', error instanceof Error ? error : new Error(message));
      res.status(400).json({ error: message });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // FUNNELS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Get spark completion funnel.
   */
  router.get('/funnels/spark', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const days = Math.min(parseInt(req.query.days as string) || 7, 90);
      
      const end = new Date();
      const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
      
      const funnel = await aggregator.computeSparkFunnel({ start, end });
      
      res.json({ funnel });
    } catch (error) {
      logger.error('Failed to get spark funnel', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to get funnel' });
    }
  });
  
  /**
   * Get goal achievement funnel.
   */
  router.get('/funnels/goal', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const days = Math.min(parseInt(req.query.days as string) || 30, 365);
      
      const end = new Date();
      const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
      
      const funnel = await aggregator.computeGoalFunnel({ start, end });
      
      res.json({ funnel });
    } catch (error) {
      logger.error('Failed to get goal funnel', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to get funnel' });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // GLOBAL METRICS (Admin)
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Get global dashboard metrics.
   */
  router.get('/dashboard', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const period = validatePeriod(req.query.period as string || 'day');
      
      const metrics = await dashboard.getDashboardMetrics(period);
      
      res.json({ metrics });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get dashboard';
      logger.error('Failed to get dashboard', error instanceof Error ? error : new Error(message));
      res.status(400).json({ error: message });
    }
  });
  
  /**
   * Get completion metrics.
   */
  router.get('/completion', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const period = validatePeriod(req.query.period as string || 'day');
      
      const metrics = await aggregator.computeCompletionMetrics(period);
      
      res.json({ metrics });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get completion metrics';
      logger.error('Failed to get completion metrics', error instanceof Error ? error : new Error(message));
      res.status(400).json({ error: message });
    }
  });
  
  /**
   * Get active users count.
   */
  router.get('/active-users', async (_req: Request, res: Response) => {
    try {
      const count = await dashboard.getActiveUsersCount();
      
      res.json({ activeUsers: count });
    } catch (error) {
      logger.error('Failed to get active users', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to get active users' });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // LEADERBOARDS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Get leaderboard.
   */
  router.get('/leaderboards/:name', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name } = req.params;
      const period = validatePeriod(req.query.period as string || 'week');
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
      
      const leaderboard = await dashboard.getLeaderboard(name, period, limit);
      
      res.json({ leaderboard });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get leaderboard';
      logger.error('Failed to get leaderboard', error instanceof Error ? error : new Error(message));
      res.status(400).json({ error: message });
    }
  });
  
  /**
   * Get user's rank on leaderboard.
   */
  router.get('/leaderboards/:name/me', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = getUserId(req);
      const { name } = req.params;
      const period = validatePeriod(req.query.period as string || 'week');
      
      const rank = await dashboard.getUserRank(userId, name, period);
      
      res.json({ rank });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get rank';
      logger.error('Failed to get rank', error instanceof Error ? error : new Error(message));
      res.status(400).json({ error: message });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // STATUS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Get analytics system status.
   */
  router.get('/status', (_req: Request, res: Response) => {
    res.json({
      collector: {
        running: collector.isRunning(),
        bufferSize: collector.getBufferSize(),
      },
    });
  });
  
  return router;
}
