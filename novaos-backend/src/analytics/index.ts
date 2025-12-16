// ═══════════════════════════════════════════════════════════════════════════════
// ANALYTICS MODULE — Event Tracking, Metrics, and Dashboards
// ═══════════════════════════════════════════════════════════════════════════════

// Types
export type {
  TimePeriod,
  TimeGranularity,
  TimeRange,
  AnalyticsEventType,
  AnalyticsEvent,
  MetricType,
  MetricDefinition,
  MetricValue,
  MetricSnapshot,
  UserActivityMetrics,
  UserActivitySummary,
  SystemMetrics,
  CompletionMetrics,
  FunnelStep,
  FunnelAnalysis,
  TimeSeriesPoint,
  TimeSeries,
  LeaderboardEntry,
  Leaderboard,
  InsightType,
  UserInsight,
  DashboardMetrics,
} from './types.js';

export {
  METRIC_DEFINITIONS,
  PERIOD_MS,
  GRANULARITY_MS,
} from './types.js';

// Event Collector
export {
  EventCollector,
  getEventCollector,
  getTimeBucket,
  getDateString,
} from './collector.js';

// Metrics Aggregator
export {
  MetricsAggregator,
  getMetricsAggregator,
} from './aggregator.js';

// Dashboard Service
export {
  DashboardService,
  getDashboardService,
} from './dashboard.js';
