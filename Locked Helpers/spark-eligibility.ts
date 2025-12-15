// ═══════════════════════════════════════════════════════════════════════════════
// SPARK ELIGIBILITY — Fix D-4
// Implements SparkGate with proper eligibility checks and metrics
// ═══════════════════════════════════════════════════════════════════════════════

import {
  PipelineState,
  PipelineContext,
  GateResult,
  GateId,
  Spark,
  SparkDecision,
  SparkIneligibilityReason,
  Intent,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────────
// SPARK METRICS
// ─────────────────────────────────────────────────────────────────────────────────

export interface SparkMetrics {
  userId: string;
  sparksToday: number;
  recentIgnoreRate: number; // Ignored / Total for last 10 sparks
  lastSparkAt: Date | null;
  completionRate: number; // Completed / Total all-time
  totalSparks: number;
  totalCompleted: number;
  totalIgnored: number;
}

/**
 * Spark metrics store interface.
 * Implement with Redis, Postgres, etc.
 */
export interface SparkMetricsStore {
  getMetrics(userId: string): Promise<SparkMetrics>;
  recordSparkGenerated(userId: string): Promise<void>;
  recordSparkCompleted(userId: string): Promise<void>;
  recordSparkIgnored(userId: string): Promise<void>;
  recordSparkDeclined(userId: string): Promise<void>;
}

/**
 * In-memory metrics store for development.
 * DO NOT USE IN PRODUCTION.
 */
export class InMemorySparkMetricsStore implements SparkMetricsStore {
  private metrics: Map<string, SparkMetrics> = new Map();

  async getMetrics(userId: string): Promise<SparkMetrics> {
    const existing = this.metrics.get(userId);
    if (existing) {
      // Check if day rolled over
      const today = new Date().toDateString();
      const lastSpark = existing.lastSparkAt?.toDateString();
      if (lastSpark !== today) {
        existing.sparksToday = 0;
      }
      return existing;
    }
    
    return {
      userId,
      sparksToday: 0,
      recentIgnoreRate: 0,
      lastSparkAt: null,
      completionRate: 0,
      totalSparks: 0,
      totalCompleted: 0,
      totalIgnored: 0,
    };
  }

  async recordSparkGenerated(userId: string): Promise<void> {
    const metrics = await this.getMetrics(userId);
    metrics.sparksToday++;
    metrics.lastSparkAt = new Date();
    metrics.totalSparks++;
    this.metrics.set(userId, metrics);
  }

  async recordSparkCompleted(userId: string): Promise<void> {
    const metrics = await this.getMetrics(userId);
    metrics.totalCompleted++;
    metrics.completionRate = metrics.totalCompleted / metrics.totalSparks;
    // Update recent ignore rate (improve on completion)
    metrics.recentIgnoreRate = Math.max(0, metrics.recentIgnoreRate - 0.1);
    this.metrics.set(userId, metrics);
  }

  async recordSparkIgnored(userId: string): Promise<void> {
    const metrics = await this.getMetrics(userId);
    metrics.totalIgnored++;
    // Update recent ignore rate using exponential moving average
    metrics.recentIgnoreRate = metrics.recentIgnoreRate * 0.9 + 0.1;
    this.metrics.set(userId, metrics);
  }

  async recordSparkDeclined(userId: string): Promise<void> {
    // Decline is different from ignore — user explicitly said no
    // This is less negative than ignore (user at least engaged)
    const metrics = await this.getMetrics(userId);
    // Don't heavily penalize declines
    this.metrics.set(userId, metrics);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// ELIGIBILITY RULES
// ─────────────────────────────────────────────────────────────────────────────────

const SPARK_DAILY_LIMIT = 5;
const SPARK_IGNORE_THRESHOLD = 0.7;
const SPARK_MIN_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes between sparks

export interface EligibilityResult {
  eligible: boolean;
  reason: SparkIneligibilityReason | null;
}

/**
 * Check if Spark generation is eligible.
 */
export function checkSparkEligibility(
  state: PipelineState,
  metrics: SparkMetrics
): EligibilityResult {
  // ─────────────────────────────────────────────────────────────────────────
  // Rule 1: Must be in Sword stance
  // ─────────────────────────────────────────────────────────────────────────
  if (state.stance !== 'sword') {
    return { eligible: false, reason: 'not_sword_stance' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rule 2: No active intervention
  // ─────────────────────────────────────────────────────────────────────────
  if (state.risk?.interventionLevel === 'veto' || state.risk?.interventionLevel === 'friction') {
    return { eligible: false, reason: 'shield_intervention_active' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rule 3: Not in control mode
  // ─────────────────────────────────────────────────────────────────────────
  if (state.risk?.controlTrigger) {
    return { eligible: false, reason: 'control_mode_active' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rule 4: Not high stakes
  // ─────────────────────────────────────────────────────────────────────────
  if (state.risk?.stakesLevel === 'high' || state.risk?.stakesLevel === 'critical') {
    return { eligible: false, reason: 'high_stakes_decision' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rule 5: Daily limit
  // ─────────────────────────────────────────────────────────────────────────
  if (metrics.sparksToday >= SPARK_DAILY_LIMIT) {
    return { eligible: false, reason: 'rate_limit_reached' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rule 6: Recent ignore rate
  // ─────────────────────────────────────────────────────────────────────────
  if (metrics.recentIgnoreRate > SPARK_IGNORE_THRESHOLD) {
    return { eligible: false, reason: 'recent_spark_ignored' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rule 7: Minimum interval
  // ─────────────────────────────────────────────────────────────────────────
  if (metrics.lastSparkAt) {
    const timeSinceLastSpark = Date.now() - metrics.lastSparkAt.getTime();
    if (timeSinceLastSpark < SPARK_MIN_INTERVAL_MS) {
      return { eligible: false, reason: 'rate_limit_reached' };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rule 8: Information must be complete
  // ─────────────────────────────────────────────────────────────────────────
  if (state.verification?.required && 
      state.verification?.plan?.verificationStatus !== 'complete') {
    return { eligible: false, reason: 'information_incomplete' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rule 9: Intent should be action-oriented
  // ─────────────────────────────────────────────────────────────────────────
  const actionOrientedTypes: Intent['type'][] = ['action', 'planning'];
  if (!actionOrientedTypes.includes(state.intent?.type ?? 'conversation')) {
    // Not strictly ineligible, but less likely to be useful
    // Continue but may generate simpler spark
  }

  return { eligible: true, reason: null };
}

// ─────────────────────────────────────────────────────────────────────────────────
// SPARK GENERATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Generate a Spark action based on context.
 * This is a simple implementation — production would be more sophisticated.
 */
export function generateSpark(
  state: PipelineState,
  context: PipelineContext
): Spark {
  // Extract action from intent/message
  const message = state.input.message.toLowerCase();
  
  // Default spark
  let action = 'Take the smallest possible step forward';
  let duration = '5 minutes';

  // Planning intent
  if (state.intent?.type === 'planning') {
    action = 'Open a blank document and write down just your first milestone';
    duration = '3 minutes';
  }
  
  // Writing-related
  if (message.includes('write') || message.includes('draft') || message.includes('essay')) {
    action = 'Open a blank document and write just the first sentence';
    duration = '2 minutes';
  }
  
  // Project-related
  if (message.includes('project') || message.includes('start')) {
    action = 'Create a new folder and name it for your project';
    duration = '1 minute';
  }
  
  // Exercise-related
  if (message.includes('exercise') || message.includes('workout') || message.includes('gym')) {
    action = 'Put on your workout clothes — nothing else required';
    duration = '2 minutes';
  }
  
  // Study-related
  if (message.includes('study') || message.includes('learn')) {
    action = 'Open your materials and read just one paragraph';
    duration = '3 minutes';
  }
  
  // Email/communication
  if (message.includes('email') || message.includes('message') || message.includes('reach out')) {
    action = 'Open a new email and write just the subject line';
    duration = '1 minute';
  }

  return {
    action,
    duration,
    frictionLevel: 1, // Minimal friction
    prerequisites: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// SPARK GATE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────────

export class SparkGate {
  readonly gateId: GateId = 'spark';
  
  constructor(private metricsStore: SparkMetricsStore) {}

  async execute(
    state: PipelineState,
    context: PipelineContext
  ): Promise<GateResult<SparkDecision>> {
    const start = Date.now();

    // Get user metrics
    const metrics = await this.metricsStore.getMetrics(state.input.userId);

    // Check eligibility
    const eligibility = checkSparkEligibility(state, metrics);

    if (!eligibility.eligible) {
      return {
        gateId: this.gateId,
        status: 'pass', // Not a failure, just ineligible
        output: {
          spark: null,
          reason: eligibility.reason,
        },
        action: 'continue',
        executionTimeMs: Date.now() - start,
      };
    }

    // Generate spark
    const spark = generateSpark(state, context);

    // Record that we generated a spark
    await this.metricsStore.recordSparkGenerated(state.input.userId);

    return {
      gateId: this.gateId,
      status: 'pass',
      output: {
        spark,
        reason: null,
      },
      action: 'continue',
      executionTimeMs: Date.now() - start,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SPARK FEEDBACK HANDLERS
// Call these when user interacts with spark
// ─────────────────────────────────────────────────────────────────────────────────

export async function handleSparkCompleted(
  userId: string,
  metricsStore: SparkMetricsStore
): Promise<void> {
  await metricsStore.recordSparkCompleted(userId);
}

export async function handleSparkIgnored(
  userId: string,
  metricsStore: SparkMetricsStore
): Promise<void> {
  await metricsStore.recordSparkIgnored(userId);
}

export async function handleSparkDeclined(
  userId: string,
  metricsStore: SparkMetricsStore
): Promise<void> {
  await metricsStore.recordSparkDeclined(userId);
}
