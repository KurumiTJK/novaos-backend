// ═══════════════════════════════════════════════════════════════════════════════
// ANALYTICS TYPES — Metrics, Events, and Aggregations
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// TIME PERIODS
// ─────────────────────────────────────────────────────────────────────────────────

export type TimePeriod = 'hour' | 'day' | 'week' | 'month' | 'year';

export type TimeGranularity = '5min' | 'hour' | 'day' | 'week' | 'month';

export interface TimeRange {
  start: Date;
  end: Date;
}

// ─────────────────────────────────────────────────────────────────────────────────
// ANALYTICS EVENTS
// ─────────────────────────────────────────────────────────────────────────────────

export type AnalyticsEventType =
  // Session events
  | 'session.start'
  | 'session.end'
  | 'session.heartbeat'
  
  // Chat events
  | 'chat.message_sent'
  | 'chat.message_received'
  | 'chat.conversation_start'
  | 'chat.conversation_end'
  
  // Goal events
  | 'goal.view'
  | 'goal.create'
  | 'goal.update'
  | 'goal.complete'
  | 'goal.abandon'
  
  // Quest events
  | 'quest.view'
  | 'quest.start'
  | 'quest.complete'
  | 'quest.block'
  
  // Step events
  | 'step.complete'
  | 'step.skip'
  
  // Spark events
  | 'spark.suggest'
  | 'spark.accept'
  | 'spark.complete'
  | 'spark.decline'
  | 'spark.expire'
  
  // Shield events
  | 'shield.trigger'
  | 'shield.veto'
  | 'shield.override'
  
  // Feature usage
  | 'feature.use'
  
  // Navigation
  | 'navigation.page_view';

export interface AnalyticsEvent {
  id: string;
  type: AnalyticsEventType;
  userId: string;
  timestamp: string;
  
  // Event properties
  properties: Record<string, unknown>;
  
  // Context
  sessionId?: string;
  deviceType?: 'desktop' | 'mobile' | 'tablet';
  platform?: string;
  version?: string;
  
  // Location (optional, privacy-respecting)
  country?: string;
  timezone?: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// METRIC TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export type MetricType = 
  | 'counter'      // Cumulative count
  | 'gauge'        // Point-in-time value
  | 'histogram'    // Distribution of values
  | 'rate';        // Events per time unit

export interface MetricDefinition {
  name: string;
  type: MetricType;
  description: string;
  unit?: string;
  tags?: string[];
}

export interface MetricValue {
  name: string;
  value: number;
  timestamp: string;
  tags?: Record<string, string>;
}

export interface MetricSnapshot {
  name: string;
  type: MetricType;
  value: number;
  min?: number;
  max?: number;
  avg?: number;
  count?: number;
  timestamp: string;
  period: TimeGranularity;
  tags?: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────────
// USER ACTIVITY METRICS
// ─────────────────────────────────────────────────────────────────────────────────

export interface UserActivityMetrics {
  userId: string;
  period: TimePeriod;
  periodStart: string;
  
  // Session metrics
  sessions: number;
  totalSessionDurationMs: number;
  avgSessionDurationMs: number;
  
  // Chat metrics
  messagesSent: number;
  messagesReceived: number;
  conversationsStarted: number;
  
  // Goal metrics
  goalsCreated: number;
  goalsCompleted: number;
  goalsAbandoned: number;
  goalCompletionRate: number;
  
  // Quest metrics
  questsStarted: number;
  questsCompleted: number;
  questCompletionRate: number;
  
  // Step metrics
  stepsCompleted: number;
  stepsSkipped: number;
  
  // Spark metrics
  sparksSuggested: number;
  sparksAccepted: number;
  sparksCompleted: number;
  sparksDeclined: number;
  sparksExpired: number;
  sparkAcceptRate: number;
  sparkCompletionRate: number;
  
  // Shield metrics
  shieldTriggers: number;
  shieldVetos: number;
  shieldOverrides: number;
  
  // Engagement score (0-100)
  engagementScore: number;
  
  // Timestamps
  firstActivityAt: string;
  lastActivityAt: string;
}

export interface UserActivitySummary {
  userId: string;
  
  // Lifetime stats
  totalSessions: number;
  totalSessionDurationMs: number;
  totalGoalsCreated: number;
  totalGoalsCompleted: number;
  totalSparksCompleted: number;
  
  // Streaks
  currentStreak: number;     // Days active in a row
  longestStreak: number;
  
  // Averages
  avgSessionsPerWeek: number;
  avgGoalsPerMonth: number;
  avgSparksPerDay: number;
  
  // Last activity
  lastActiveAt: string;
  
  // Account age
  createdAt: string;
  daysActive: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// SYSTEM METRICS
// ─────────────────────────────────────────────────────────────────────────────────

export interface SystemMetrics {
  timestamp: string;
  period: TimeGranularity;
  
  // Request metrics
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  errorRate: number;
  
  // Latency (ms)
  avgLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  
  // Throughput
  requestsPerSecond: number;
  
  // Active users
  activeUsers: number;
  activeSessions: number;
  
  // Resource usage
  cpuUsage?: number;
  memoryUsageMb?: number;
  
  // Queue depths
  pendingWebhooks?: number;
  pendingJobs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// COMPLETION METRICS
// ─────────────────────────────────────────────────────────────────────────────────

export interface CompletionMetrics {
  period: TimePeriod;
  periodStart: string;
  
  // Goal completion
  goals: {
    created: number;
    completed: number;
    abandoned: number;
    active: number;
    completionRate: number;
    avgCompletionTimeMs: number;
  };
  
  // Quest completion
  quests: {
    started: number;
    completed: number;
    blocked: number;
    completionRate: number;
    avgCompletionTimeMs: number;
  };
  
  // Spark completion
  sparks: {
    suggested: number;
    accepted: number;
    completed: number;
    declined: number;
    expired: number;
    acceptRate: number;
    completionRate: number;
    avgCompletionTimeMs: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// FUNNEL ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────────

export interface FunnelStep {
  name: string;
  count: number;
  conversionRate: number;    // % from previous step
  dropoffRate: number;       // % lost from previous step
}

export interface FunnelAnalysis {
  name: string;
  period: TimeRange;
  steps: FunnelStep[];
  overallConversionRate: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// TIME SERIES
// ─────────────────────────────────────────────────────────────────────────────────

export interface TimeSeriesPoint {
  timestamp: string;
  value: number;
}

export interface TimeSeries {
  name: string;
  granularity: TimeGranularity;
  points: TimeSeriesPoint[];
  
  // Aggregates
  total?: number;
  min?: number;
  max?: number;
  avg?: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// LEADERBOARDS / RANKINGS
// ─────────────────────────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  score: number;
  change?: number;           // Change from previous period
}

export interface Leaderboard {
  name: string;
  period: TimePeriod;
  entries: LeaderboardEntry[];
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// INSIGHTS
// ─────────────────────────────────────────────────────────────────────────────────

export type InsightType = 
  | 'achievement'
  | 'streak'
  | 'improvement'
  | 'suggestion'
  | 'warning';

export interface UserInsight {
  id: string;
  userId: string;
  type: InsightType;
  title: string;
  description: string;
  metric?: string;
  value?: number;
  comparison?: number;       // Comparison value (e.g., previous period)
  createdAt: string;
  expiresAt?: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────────

export interface DashboardMetrics {
  period: TimePeriod;
  periodStart: string;
  periodEnd: string;
  
  // Summary
  summary: {
    activeUsers: number;
    newUsers: number;
    totalSessions: number;
    totalGoalsCompleted: number;
    totalSparksCompleted: number;
  };
  
  // Trends
  trends: {
    activeUsers: TimeSeries;
    sessions: TimeSeries;
    goalsCompleted: TimeSeries;
    sparksCompleted: TimeSeries;
  };
  
  // Completion rates
  completionRates: CompletionMetrics;
  
  // System health
  system: SystemMetrics;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  { name: 'requests.total', type: 'counter', description: 'Total HTTP requests' },
  { name: 'requests.errors', type: 'counter', description: 'Failed HTTP requests' },
  { name: 'requests.latency', type: 'histogram', description: 'Request latency', unit: 'ms' },
  { name: 'sessions.active', type: 'gauge', description: 'Currently active sessions' },
  { name: 'users.active', type: 'gauge', description: 'Currently active users' },
  { name: 'goals.created', type: 'counter', description: 'Goals created' },
  { name: 'goals.completed', type: 'counter', description: 'Goals completed' },
  { name: 'sparks.suggested', type: 'counter', description: 'Sparks suggested' },
  { name: 'sparks.completed', type: 'counter', description: 'Sparks completed' },
  { name: 'shield.triggers', type: 'counter', description: 'Shield activations' },
  { name: 'webhooks.delivered', type: 'counter', description: 'Webhooks delivered' },
  { name: 'webhooks.failed', type: 'counter', description: 'Webhook failures' },
];

export const PERIOD_MS: Record<TimePeriod, number> = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
};

export const GRANULARITY_MS: Record<TimeGranularity, number> = {
  '5min': 5 * 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};
