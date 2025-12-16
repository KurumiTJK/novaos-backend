// ═══════════════════════════════════════════════════════════════════════════════
// EVENT COLLECTOR — Ingestion and Storage of Analytics Events
// ═══════════════════════════════════════════════════════════════════════════════

import { getStore, type KeyValueStore } from '../storage/index.js';
import { getLogger } from '../logging/index.js';
import type {
  AnalyticsEvent,
  AnalyticsEventType,
  TimeGranularity,
} from './types.js';
import { GRANULARITY_MS } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

const EVENT_TTL = 90 * 24 * 60 * 60;           // 90 days
const COUNTER_TTL = 365 * 24 * 60 * 60;       // 1 year
const BUFFER_FLUSH_INTERVAL = 5000;           // 5 seconds
const BUFFER_MAX_SIZE = 100;                  // Flush when buffer reaches this size

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'event-collector' });

// ─────────────────────────────────────────────────────────────────────────────────
// KEY GENERATION
// ─────────────────────────────────────────────────────────────────────────────────

function eventKey(id: string): string {
  return `analytics:event:${id}`;
}

function userEventsKey(userId: string, date: string): string {
  return `analytics:user:${userId}:events:${date}`;
}

function eventTypeCounterKey(eventType: string, bucket: string): string {
  return `analytics:counter:${eventType}:${bucket}`;
}

function userCounterKey(userId: string, metric: string, bucket: string): string {
  return `analytics:user:${userId}:counter:${metric}:${bucket}`;
}

function globalCounterKey(metric: string, bucket: string): string {
  return `analytics:global:counter:${metric}:${bucket}`;
}

function generateEventId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ─────────────────────────────────────────────────────────────────────────────────
// TIME BUCKET HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

export function getTimeBucket(date: Date, granularity: TimeGranularity): string {
  // For month, use calendar month directly (not ms-based bucketing)
  if (granularity === 'month') {
    return date.toISOString().slice(0, 7); // YYYY-MM
  }
  
  // For week, calculate Monday of the week
  if (granularity === 'week') {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    const day = d.getUTCDay();
    const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
    d.setUTCDate(diff);
    return d.toISOString().slice(0, 10) + 'W';
  }
  
  // For 5min, hour, day - use ms-based bucketing
  const ms = GRANULARITY_MS[granularity];
  const bucketTime = Math.floor(date.getTime() / ms) * ms;
  const bucketDate = new Date(bucketTime);
  
  switch (granularity) {
    case '5min':
      return bucketDate.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
    case 'hour':
      return bucketDate.toISOString().slice(0, 13); // YYYY-MM-DDTHH
    case 'day':
      return bucketDate.toISOString().slice(0, 10); // YYYY-MM-DD
    default:
      return bucketDate.toISOString().slice(0, 10); // Fallback to day
  }
}

export function getDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────────
// EVENT COLLECTOR CLASS
// ─────────────────────────────────────────────────────────────────────────────────

export class EventCollector {
  private store: KeyValueStore;
  private buffer: AnalyticsEvent[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private running: boolean = false;
  
  constructor(store?: KeyValueStore) {
    this.store = store ?? getStore();
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════════
  
  start(): void {
    if (this.running) return;
    
    this.running = true;
    this.flushInterval = setInterval(() => this.flush(), BUFFER_FLUSH_INTERVAL);
    
    logger.info('Event collector started');
  }
  
  stop(): void {
    if (!this.running) return;
    
    this.running = false;
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    
    // Final flush
    this.flush();
    
    logger.info('Event collector stopped');
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // EVENT COLLECTION
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Track an analytics event.
   */
  track(
    userId: string,
    eventType: AnalyticsEventType,
    properties: Record<string, unknown> = {},
    context?: {
      sessionId?: string;
      deviceType?: 'desktop' | 'mobile' | 'tablet';
      platform?: string;
      version?: string;
      country?: string;
      timezone?: string;
    }
  ): AnalyticsEvent {
    const event: AnalyticsEvent = {
      id: generateEventId(),
      type: eventType,
      userId,
      timestamp: new Date().toISOString(),
      properties,
      ...context,
    };
    
    this.buffer.push(event);
    
    // Flush if buffer is full
    if (this.buffer.length >= BUFFER_MAX_SIZE) {
      this.flush();
    }
    
    return event;
  }
  
  /**
   * Track event immediately (bypass buffer).
   */
  async trackImmediate(
    userId: string,
    eventType: AnalyticsEventType,
    properties: Record<string, unknown> = {},
    context?: {
      sessionId?: string;
      deviceType?: 'desktop' | 'mobile' | 'tablet';
      platform?: string;
      version?: string;
    }
  ): Promise<AnalyticsEvent> {
    const event = this.track(userId, eventType, properties, context);
    await this.persistEvent(event);
    return event;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // CONVENIENCE TRACKERS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  // Session events
  trackSessionStart(userId: string, sessionId: string, context?: { deviceType?: 'desktop' | 'mobile' | 'tablet' }): AnalyticsEvent {
    return this.track(userId, 'session.start', {}, { sessionId, ...context });
  }
  
  trackSessionEnd(userId: string, sessionId: string, durationMs: number): AnalyticsEvent {
    return this.track(userId, 'session.end', { durationMs }, { sessionId });
  }
  
  // Chat events
  trackMessageSent(userId: string, conversationId: string, messageLength: number): AnalyticsEvent {
    return this.track(userId, 'chat.message_sent', { conversationId, messageLength });
  }
  
  trackMessageReceived(userId: string, conversationId: string, messageLength: number): AnalyticsEvent {
    return this.track(userId, 'chat.message_received', { conversationId, messageLength });
  }
  
  // Goal events
  trackGoalCreate(userId: string, goalId: string, title: string): AnalyticsEvent {
    return this.track(userId, 'goal.create', { goalId, title });
  }
  
  trackGoalComplete(userId: string, goalId: string, durationMs: number): AnalyticsEvent {
    return this.track(userId, 'goal.complete', { goalId, durationMs });
  }
  
  trackGoalAbandon(userId: string, goalId: string, reason?: string): AnalyticsEvent {
    return this.track(userId, 'goal.abandon', { goalId, reason });
  }
  
  // Quest events
  trackQuestStart(userId: string, questId: string, goalId: string): AnalyticsEvent {
    return this.track(userId, 'quest.start', { questId, goalId });
  }
  
  trackQuestComplete(userId: string, questId: string, durationMs: number): AnalyticsEvent {
    return this.track(userId, 'quest.complete', { questId, durationMs });
  }
  
  // Spark events
  trackSparkSuggest(userId: string, sparkId: string, action: string): AnalyticsEvent {
    return this.track(userId, 'spark.suggest', { sparkId, action });
  }
  
  trackSparkAccept(userId: string, sparkId: string): AnalyticsEvent {
    return this.track(userId, 'spark.accept', { sparkId });
  }
  
  trackSparkComplete(userId: string, sparkId: string, durationMs: number): AnalyticsEvent {
    return this.track(userId, 'spark.complete', { sparkId, durationMs });
  }
  
  trackSparkDecline(userId: string, sparkId: string, reason?: string): AnalyticsEvent {
    return this.track(userId, 'spark.decline', { sparkId, reason });
  }
  
  trackSparkExpire(userId: string, sparkId: string): AnalyticsEvent {
    return this.track(userId, 'spark.expire', { sparkId });
  }
  
  // Shield events
  trackShieldTrigger(userId: string, riskLevel: string, triggers: string[]): AnalyticsEvent {
    return this.track(userId, 'shield.trigger', { riskLevel, triggers });
  }
  
  trackShieldVeto(userId: string, type: 'soft' | 'hard', reason: string): AnalyticsEvent {
    return this.track(userId, 'shield.veto', { type, reason });
  }
  
  // Feature usage
  trackFeatureUse(userId: string, feature: string, details?: Record<string, unknown>): AnalyticsEvent {
    return this.track(userId, 'feature.use', { feature, ...details });
  }
  
  // Navigation
  trackPageView(userId: string, page: string, referrer?: string): AnalyticsEvent {
    return this.track(userId, 'navigation.page_view', { page, referrer });
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // FLUSHING
  // ═══════════════════════════════════════════════════════════════════════════════
  
  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    
    const events = [...this.buffer];
    this.buffer = [];
    
    logger.debug('Flushing analytics events', { count: events.length });
    
    const startTime = Date.now();
    let success = 0;
    let failed = 0;
    
    for (const event of events) {
      try {
        await this.persistEvent(event);
        success++;
      } catch (error) {
        failed++;
        logger.error(
          'Failed to persist analytics event',
          error instanceof Error ? error : new Error(String(error)),
          { eventId: event.id, type: event.type }
        );
      }
    }
    
    const duration = Date.now() - startTime;
    logger.debug('Analytics flush complete', { success, failed, durationMs: duration });
  }
  
  private async persistEvent(event: AnalyticsEvent): Promise<void> {
    const timestamp = new Date(event.timestamp);
    const dateStr = getDateString(timestamp);
    
    // Store the event
    await this.store.set(eventKey(event.id), JSON.stringify(event), EVENT_TTL);
    
    // Add to user's daily event list
    await this.store.lpush(userEventsKey(event.userId, dateStr), event.id);
    await this.store.expire(userEventsKey(event.userId, dateStr), EVENT_TTL);
    
    // Update counters
    await this.updateCounters(event);
  }
  
  private async updateCounters(event: AnalyticsEvent): Promise<void> {
    const timestamp = new Date(event.timestamp);
    
    // Update counters at different granularities
    const granularities: TimeGranularity[] = ['5min', 'hour', 'day', 'month'];
    
    for (const granularity of granularities) {
      const bucket = getTimeBucket(timestamp, granularity);
      
      // Event type counter
      await this.store.incr(eventTypeCounterKey(event.type, bucket));
      await this.store.expire(eventTypeCounterKey(event.type, bucket), COUNTER_TTL);
      
      // User counter for this event type
      await this.store.incr(userCounterKey(event.userId, event.type, bucket));
      await this.store.expire(userCounterKey(event.userId, event.type, bucket), COUNTER_TTL);
      
      // Global counter
      await this.store.incr(globalCounterKey('events.total', bucket));
      await this.store.expire(globalCounterKey('events.total', bucket), COUNTER_TTL);
    }
    
    // Update specific metric counters based on event type
    await this.updateMetricCounters(event);
  }
  
  private async updateMetricCounters(event: AnalyticsEvent): Promise<void> {
    const timestamp = new Date(event.timestamp);
    const dayBucket = getTimeBucket(timestamp, 'day');
    
    // Map event types to metrics
    const metricsMap: Partial<Record<AnalyticsEventType, string>> = {
      'goal.create': 'goals.created',
      'goal.complete': 'goals.completed',
      'goal.abandon': 'goals.abandoned',
      'quest.start': 'quests.started',
      'quest.complete': 'quests.completed',
      'spark.suggest': 'sparks.suggested',
      'spark.accept': 'sparks.accepted',
      'spark.complete': 'sparks.completed',
      'spark.decline': 'sparks.declined',
      'spark.expire': 'sparks.expired',
      'shield.trigger': 'shield.triggers',
      'shield.veto': 'shield.vetos',
      'session.start': 'sessions.started',
    };
    
    const metricName = metricsMap[event.type];
    if (metricName) {
      // User metric
      await this.store.incr(userCounterKey(event.userId, metricName, dayBucket));
      await this.store.expire(userCounterKey(event.userId, metricName, dayBucket), COUNTER_TTL);
      
      // Global metric
      await this.store.incr(globalCounterKey(metricName, dayBucket));
      await this.store.expire(globalCounterKey(metricName, dayBucket), COUNTER_TTL);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // QUERIES
  // ═══════════════════════════════════════════════════════════════════════════════
  
  async getEvent(eventId: string): Promise<AnalyticsEvent | null> {
    const data = await this.store.get(eventKey(eventId));
    return data ? JSON.parse(data) : null;
  }
  
  async getUserEvents(userId: string, date: string, limit: number = 100): Promise<AnalyticsEvent[]> {
    const ids = await this.store.lrange(userEventsKey(userId, date), 0, limit - 1);
    const events: AnalyticsEvent[] = [];
    
    for (const id of ids) {
      const event = await this.getEvent(id);
      if (event) events.push(event);
    }
    
    return events;
  }
  
  async getCounter(key: string): Promise<number> {
    const value = await this.store.get(key);
    return value ? parseInt(value, 10) : 0;
  }
  
  async getEventTypeCount(eventType: AnalyticsEventType, bucket: string): Promise<number> {
    return this.getCounter(eventTypeCounterKey(eventType, bucket));
  }
  
  async getUserMetric(userId: string, metric: string, bucket: string): Promise<number> {
    return this.getCounter(userCounterKey(userId, metric, bucket));
  }
  
  async getGlobalMetric(metric: string, bucket: string): Promise<number> {
    return this.getCounter(globalCounterKey(metric, bucket));
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // STATS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  getBufferSize(): number {
    return this.buffer.length;
  }
  
  isRunning(): boolean {
    return this.running;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let collector: EventCollector | null = null;

export function getEventCollector(): EventCollector {
  if (!collector) {
    collector = new EventCollector();
  }
  return collector;
}
