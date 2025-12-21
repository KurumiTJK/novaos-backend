// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH CHECK — Periodic Availability Checking for Known Sources
// NovaOS Spark Engine — Phase 6: Resource Discovery
// ═══════════════════════════════════════════════════════════════════════════════
//
// Periodically checks known sources for:
//   - Availability (HTTP status)
//   - Response time
//   - Content validity (optional)
//
// Features:
//   - Configurable check intervals per source
//   - Exponential backoff on failures
//   - Health status tracking
//   - Metrics integration
//
// ═══════════════════════════════════════════════════════════════════════════════

import { getLogger } from '../../../../observability/logging/index.js';
import { incCounter, observeHistogram } from '../../../../observability/metrics/index.js';
import { ssrfSafeFetch, type SSRFSafeFetchOptions } from '../../../../security/ssrf/index.js';
import type { KnownSource, HealthStatus } from './registry.js';
import { getKnownSourcesRegistry } from './registry.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'health-check' });

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Health check result.
 */
export interface HealthCheckResult {
  readonly sourceId: string;
  readonly status: HealthStatus;
  readonly httpStatus?: number;
  readonly responseTimeMs: number;
  readonly error?: string;
  readonly checkedAt: Date;
}

/**
 * Health checker configuration.
 */
export interface HealthCheckerConfig {
  /** Default check interval in seconds */
  readonly defaultIntervalSeconds: number;
  
  /** Default timeout in seconds */
  readonly defaultTimeoutSeconds: number;
  
  /** Maximum concurrent checks */
  readonly maxConcurrent: number;
  
  /** Backoff multiplier for failed checks */
  readonly backoffMultiplier: number;
  
  /** Maximum backoff interval in seconds */
  readonly maxBackoffSeconds: number;
  
  /** Number of failures before marking unhealthy */
  readonly unhealthyThreshold: number;
  
  /** Whether to use SSRF-safe client */
  readonly useSSRFClient: boolean;
}

/**
 * Default health checker configuration.
 */
export const DEFAULT_HEALTH_CHECKER_CONFIG: HealthCheckerConfig = {
  defaultIntervalSeconds: 3600,
  defaultTimeoutSeconds: 10,
  maxConcurrent: 5,
  backoffMultiplier: 2,
  maxBackoffSeconds: 86400,
  unhealthyThreshold: 3,
  useSSRFClient: true,
};

// ─────────────────────────────────────────────────────────────────────────────────
// HEALTH CHECKER
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Health checker for known sources.
 */
export class HealthChecker {
  private readonly config: HealthCheckerConfig;
  private readonly lastCheckTimes: Map<string, Date>;
  private readonly nextCheckTimes: Map<string, Date>;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private running: boolean = false;
  private activeChecks: number = 0;
  
  constructor(config?: Partial<HealthCheckerConfig>) {
    this.config = { ...DEFAULT_HEALTH_CHECKER_CONFIG, ...config };
    this.lastCheckTimes = new Map();
    this.nextCheckTimes = new Map();
  }
  
  /**
   * Start the health checker.
   */
  start(intervalMs: number = 60000): void {
    if (this.running) {
      logger.warn('Health checker already running');
      return;
    }
    
    this.running = true;
    logger.info('Starting health checker', { intervalMs });
    
    // Run immediately
    this.runChecks().catch(error => {
      logger.error('Health check run failed', { error });
    });
    
    // Schedule periodic runs
    this.checkInterval = setInterval(() => {
      this.runChecks().catch(error => {
        logger.error('Health check run failed', { error });
      });
    }, intervalMs);
  }
  
  /**
   * Stop the health checker.
   */
  stop(): void {
    if (!this.running) {
      return;
    }
    
    this.running = false;
    
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    
    logger.info('Health checker stopped');
  }
  
  /**
   * Run health checks for all due sources.
   */
  async runChecks(): Promise<HealthCheckResult[]> {
    const registry = getKnownSourcesRegistry();
    const sources = registry.getActive();
    const now = new Date();
    const results: HealthCheckResult[] = [];
    
    // Find sources due for checking
    const dueForCheck: KnownSource[] = [];
    
    for (const source of sources) {
      const nextCheck = this.nextCheckTimes.get(source.id);
      
      if (!nextCheck || now >= nextCheck) {
        dueForCheck.push(source);
      }
    }
    
    if (dueForCheck.length === 0) {
      return results;
    }
    
    logger.debug('Running health checks', { 
      dueCount: dueForCheck.length,
      totalSources: sources.length,
    });
    
    // Check sources with concurrency limit
    const batches = this.batchSources(dueForCheck, this.config.maxConcurrent);
    
    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map(source => this.checkSource(source))
      );
      results.push(...batchResults);
    }
    
    return results;
  }
  
  /**
   * Check a single source.
   */
  async checkSource(source: KnownSource): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const registry = getKnownSourcesRegistry();
    
    this.activeChecks++;
    
    try {
      const result = await this.performCheck(source);
      
      // Update registry
      registry.updateHealth(source.id, result.status, result.responseTimeMs);
      
      // Update check times
      this.lastCheckTimes.set(source.id, result.checkedAt);
      this.scheduleNextCheck(source, result.status);
      
      // Record metrics
      this.recordMetrics(source, result);
      
      return result;
    } finally {
      this.activeChecks--;
    }
  }
  
  /**
   * Perform the actual health check.
   */
  private async performCheck(source: KnownSource): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const checkedAt = new Date();
    const timeoutMs = (source.healthCheck.timeoutSeconds || this.config.defaultTimeoutSeconds) * 1000;
    
    try {
      // Use SSRF-safe client for health checks
      const fetchOptions: SSRFSafeFetchOptions = {
        method: 'HEAD',
        timeoutMs,
        headers: {
          'User-Agent': 'NovaOS-HealthChecker/1.0',
        },
        // Health checks are for known, pre-verified sources
        allowPrivateIPs: false,
        maxRedirects: 3,
      };
      
      const result = await ssrfSafeFetch(source.healthCheck.url, fetchOptions);
      const responseTimeMs = Date.now() - startTime;
      
      if (!result.ok) {
        // SSRF client returned an error (blocked, timeout, etc.)
        return {
          sourceId: source.id,
          status: 'unhealthy',
          responseTimeMs,
          error: result.error.message,
          checkedAt,
        };
      }
      
      const response = result.value;
      
      // Determine status based on HTTP code and response time
      let status: HealthStatus;
      if (response.ok) {
        // Consider degraded if response time is high
        if (responseTimeMs > timeoutMs * 0.8) {
          status = 'degraded';
        } else {
          status = 'healthy';
        }
      } else if (response.status >= 500) {
        status = 'unhealthy';
      } else if (response.status === 429) {
        status = 'degraded'; // Rate limited
      } else {
        status = 'unhealthy';
      }
      
      return {
        sourceId: source.id,
        status,
        httpStatus: response.status,
        responseTimeMs,
        checkedAt,
      };
    } catch (error) {
      const responseTimeMs = Date.now() - startTime;
      
      let errorMessage: string;
      if (error instanceof Error) {
        errorMessage = error.message;
      } else {
        errorMessage = 'Unknown error';
      }
      
      return {
        sourceId: source.id,
        status: 'unhealthy',
        responseTimeMs,
        error: errorMessage,
        checkedAt,
      };
    }
  }
  
  /**
   * Schedule the next check for a source.
   */
  private scheduleNextCheck(source: KnownSource, status: HealthStatus): void {
    const baseInterval = source.healthCheck.intervalSeconds || this.config.defaultIntervalSeconds;
    
    let intervalSeconds: number;
    
    if (status === 'healthy') {
      // Normal interval for healthy sources
      intervalSeconds = baseInterval;
    } else {
      // Exponential backoff for unhealthy sources
      const failures = source.health.consecutiveFailures;
      intervalSeconds = Math.min(
        baseInterval * Math.pow(this.config.backoffMultiplier, failures),
        this.config.maxBackoffSeconds
      );
    }
    
    const nextCheck = new Date(Date.now() + intervalSeconds * 1000);
    this.nextCheckTimes.set(source.id, nextCheck);
    
    logger.debug('Scheduled next health check', {
      sourceId: source.id,
      status,
      nextCheckIn: intervalSeconds,
    });
  }
  
  /**
   * Record metrics for a health check.
   */
  private recordMetrics(source: KnownSource, result: HealthCheckResult): void {
    // Count check
    incCounter('health_checks_total', {
      source_id: source.id,
      status: result.status,
    });
    
    // Record response time
    if (result.responseTimeMs) {
      observeHistogram('health_check_duration_ms', result.responseTimeMs, {
        source_id: source.id,
      });
    }
    
    // Count failures
    if (result.status === 'unhealthy') {
      incCounter('health_check_failures_total', {
        source_id: source.id,
        error: result.error ?? 'unknown',
      });
    }
  }
  
  /**
   * Batch sources for concurrent checking.
   */
  private batchSources(sources: KnownSource[], batchSize: number): KnownSource[][] {
    const batches: KnownSource[][] = [];
    
    for (let i = 0; i < sources.length; i += batchSize) {
      batches.push(sources.slice(i, i + batchSize));
    }
    
    return batches;
  }
  
  /**
   * Force check a specific source.
   */
  async forceCheck(sourceId: string): Promise<HealthCheckResult | null> {
    const registry = getKnownSourcesRegistry();
    const source = registry.get(sourceId);
    
    if (!source) {
      return null;
    }
    
    return this.checkSource(source);
  }
  
  /**
   * Get the next scheduled check time for a source.
   */
  getNextCheckTime(sourceId: string): Date | undefined {
    return this.nextCheckTimes.get(sourceId);
  }
  
  /**
   * Get the last check time for a source.
   */
  getLastCheckTime(sourceId: string): Date | undefined {
    return this.lastCheckTimes.get(sourceId);
  }
  
  /**
   * Check if the health checker is running.
   */
  get isRunning(): boolean {
    return this.running;
  }
  
  /**
   * Get the number of active checks.
   */
  get activeCheckCount(): number {
    return this.activeChecks;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let healthCheckerInstance: HealthChecker | null = null;

/**
 * Get the health checker singleton.
 */
export function getHealthChecker(): HealthChecker {
  if (!healthCheckerInstance) {
    healthCheckerInstance = new HealthChecker();
  }
  return healthCheckerInstance;
}

/**
 * Create a health checker with custom config.
 */
export function createHealthChecker(config?: Partial<HealthCheckerConfig>): HealthChecker {
  healthCheckerInstance = new HealthChecker(config);
  return healthCheckerInstance;
}

/**
 * Reset the health checker (for testing).
 */
export function resetHealthChecker(): void {
  if (healthCheckerInstance) {
    healthCheckerInstance.stop();
  }
  healthCheckerInstance = null;
}

/**
 * Start health checking.
 */
export function startHealthChecking(intervalMs?: number): void {
  getHealthChecker().start(intervalMs);
}

/**
 * Stop health checking.
 */
export function stopHealthChecking(): void {
  getHealthChecker().stop();
}
