// ═══════════════════════════════════════════════════════════════════════════════
// CIRCUIT BREAKER — Implementation
// NovaOS Infrastructure — Phase 4
// ═══════════════════════════════════════════════════════════════════════════════
//
// Circuit breaker pattern implementation:
// - State machine: CLOSED → OPEN → HALF_OPEN → CLOSED
// - Sliding window failure tracking
// - Configurable thresholds and timeouts
// - Metrics emission for observability
//
// ═══════════════════════════════════════════════════════════════════════════════

import {
  type CircuitState,
  type CircuitBreakerConfig,
  type CircuitMetrics,
  type CircuitBreaker,
  type CircuitBreakerRegistry,
  type StateChangeEvent,
  type RequestEvent,
  type RejectEvent,
  CircuitOpenError,
  CircuitTimeoutError,
  DEFAULT_CIRCUIT_CONFIG,
} from './types.js';
import { getServiceConfig } from './config.js';
import { getLogger } from '../../observability/logging/index.js';
import { incCounter, setGauge } from '../../observability/metrics/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// FAILURE WINDOW
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Sliding window for tracking failures within a time period.
 */
class SlidingWindow {
  private readonly timestamps: number[] = [];
  private readonly windowMs: number;
  
  constructor(windowMs: number) {
    this.windowMs = windowMs;
  }
  
  /**
   * Record a failure.
   */
  record(timestamp: number = Date.now()): void {
    this.cleanup(timestamp);
    this.timestamps.push(timestamp);
  }
  
  /**
   * Get count of failures in window.
   */
  count(now: number = Date.now()): number {
    this.cleanup(now);
    return this.timestamps.length;
  }
  
  /**
   * Clear all failures.
   */
  clear(): void {
    this.timestamps.length = 0;
  }
  
  /**
   * Remove expired entries.
   */
  private cleanup(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0]! < cutoff) {
      this.timestamps.shift();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// CIRCUIT BREAKER IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Circuit breaker implementation.
 */
export class CircuitBreakerImpl implements CircuitBreaker {
  readonly name: string;
  
  private readonly config: CircuitBreakerConfig;
  private readonly logger = getLogger({ component: 'circuit-breaker' });
  private readonly failureWindow: SlidingWindow;
  
  // State
  private state: CircuitState = 'CLOSED';
  private lastStateChangeTime: number = Date.now();
  private openedAt: number = 0;
  
  // Counters
  private successCount = 0;           // Successes in HALF_OPEN
  private halfOpenInFlight = 0;       // Current requests in HALF_OPEN
  
  // Lifetime metrics
  private totalRequests = 0;
  private successfulRequests = 0;
  private failedRequests = 0;
  private rejectedRequests = 0;
  private timedOutRequests = 0;
  private slowRequests = 0;
  
  // Timestamps
  private lastFailureTime?: number;
  private lastSuccessTime?: number;
  
  constructor(config: CircuitBreakerConfig) {
    this.name = config.name;
    this.config = config;
    this.failureWindow = new SlidingWindow(config.failureWindowMs);
    
    this.logger.debug('Circuit breaker created', {
      name: this.name,
      failureThreshold: config.failureThreshold,
      resetTimeoutMs: config.resetTimeoutMs,
    });
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────────────────────
  
  getState(): CircuitState {
    // Check if we should transition from OPEN to HALF_OPEN
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed >= this.config.resetTimeoutMs) {
        this.transitionTo('HALF_OPEN', 'Reset timeout elapsed');
      }
    }
    return this.state;
  }
  
  private transitionTo(newState: CircuitState, reason: string): void {
    const oldState = this.state;
    if (oldState === newState) return;
    
    this.state = newState;
    this.lastStateChangeTime = Date.now();
    
    // Reset counters on state change
    if (newState === 'HALF_OPEN') {
      this.successCount = 0;
      this.halfOpenInFlight = 0;
    } else if (newState === 'CLOSED') {
      this.failureWindow.clear();
    } else if (newState === 'OPEN') {
      this.openedAt = Date.now();
    }
    
    // Log and emit event
    this.logger.warn('Circuit state changed', {
      circuit: this.name,
      from: oldState,
      to: newState,
      reason,
      failureCount: this.failureWindow.count(),
    });
    
    // Emit metric
    setGauge('circuit_breaker_state', this.stateToNumber(newState), {
      circuit: this.name,
    });
    
    incCounter('circuit_breaker_state_changes_total', {
      circuit: this.name,
      from: oldState,
      to: newState,
    });
    
    // Callback
    const event: StateChangeEvent = {
      name: this.name,
      from: oldState,
      to: newState,
      timestamp: Date.now(),
      reason,
      failureCount: this.failureWindow.count(),
      successCount: this.successCount,
    };
    
    this.config.onStateChange?.(event);
  }
  
  private stateToNumber(state: CircuitState): number {
    switch (state) {
      case 'CLOSED': return 0;
      case 'HALF_OPEN': return 1;
      case 'OPEN': return 2;
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Request handling
  // ─────────────────────────────────────────────────────────────────────────────
  
  isAllowed(): boolean {
    const state = this.getState();
    
    switch (state) {
      case 'CLOSED':
        return true;
        
      case 'OPEN':
        return false;
        
      case 'HALF_OPEN':
        // Allow limited requests in half-open
        return this.halfOpenInFlight < this.config.halfOpenRequests;
    }
  }
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.getState();
    
    // Check if allowed
    if (!this.isAllowed()) {
      this.rejectedRequests++;
      this.totalRequests++;
      
      const retryAfterMs = state === 'OPEN'
        ? Math.max(0, this.config.resetTimeoutMs - (Date.now() - this.openedAt))
        : 0;
      
      incCounter('circuit_breaker_rejections_total', {
        circuit: this.name,
        reason: state === 'OPEN' ? 'circuit_open' : 'half_open_capacity',
      });
      
      const rejectEvent: RejectEvent = {
        name: this.name,
        state,
        timestamp: Date.now(),
        retryAfterMs,
        reason: state === 'OPEN' ? 'circuit_open' : 'half_open_capacity',
      };
      
      this.config.onReject?.(rejectEvent);
      
      throw new CircuitOpenError(this.name, retryAfterMs);
    }
    
    // Track half-open in-flight
    if (state === 'HALF_OPEN') {
      this.halfOpenInFlight++;
    }
    
    this.totalRequests++;
    const startTime = Date.now();
    
    try {
      // Execute with optional timeout
      let result: T;
      
      if (this.config.requestTimeoutMs > 0) {
        result = await this.withTimeout(fn, this.config.requestTimeoutMs);
      } else {
        result = await fn();
      }
      
      const durationMs = Date.now() - startTime;
      
      // Check for slow request
      const isSlow = this.config.trackSlowRequests && 
                     durationMs > this.config.slowRequestThresholdMs;
      
      if (isSlow) {
        this.slowRequests++;
        // Optionally count slow requests as partial failures
        if (Math.random() * 100 < this.config.slowRequestFailurePercent) {
          this.recordFailure(undefined, durationMs);
          return result;
        }
      }
      
      this.recordSuccess(durationMs);
      return result;
      
    } catch (error) {
      const durationMs = Date.now() - startTime;
      
      // Check if this error should count as a failure
      const shouldCount = this.config.isFailure
        ? this.config.isFailure(error)
        : true;
      
      if (shouldCount) {
        this.recordFailure(error instanceof Error ? error : undefined, durationMs);
      } else {
        // Don't count as failure but still record success for half-open
        if (state === 'HALF_OPEN') {
          this.recordSuccess(durationMs);
        }
      }
      
      throw error;
      
    } finally {
      if (state === 'HALF_OPEN') {
        this.halfOpenInFlight--;
      }
    }
  }
  
  private async withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.timedOutRequests++;
        reject(new CircuitTimeoutError(this.name, timeoutMs));
      }, timeoutMs);
      
      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Recording
  // ─────────────────────────────────────────────────────────────────────────────
  
  recordSuccess(durationMs: number): void {
    this.successfulRequests++;
    this.lastSuccessTime = Date.now();
    
    incCounter('circuit_breaker_requests_total', {
      circuit: this.name,
      result: 'success',
    });
    
    const event: RequestEvent = {
      name: this.name,
      state: this.state,
      durationMs,
      timestamp: Date.now(),
    };
    
    this.config.onSuccess?.(event);
    
    // Handle state transitions
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      
      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo('CLOSED', `Success threshold reached (${this.successCount}/${this.config.successThreshold})`);
      }
    }
  }
  
  recordFailure(error?: Error, durationMs?: number): void {
    this.failedRequests++;
    this.lastFailureTime = Date.now();
    this.failureWindow.record();
    
    incCounter('circuit_breaker_requests_total', {
      circuit: this.name,
      result: 'failure',
    });
    
    const event: RequestEvent = {
      name: this.name,
      state: this.state,
      durationMs: durationMs ?? 0,
      timestamp: Date.now(),
      error,
    };
    
    this.config.onFailure?.(event);
    
    // Handle state transitions
    if (this.state === 'HALF_OPEN') {
      // Any failure in HALF_OPEN reopens the circuit
      this.transitionTo('OPEN', 'Failure during recovery test');
      
    } else if (this.state === 'CLOSED') {
      const failureCount = this.failureWindow.count();
      
      if (failureCount >= this.config.failureThreshold) {
        this.transitionTo('OPEN', `Failure threshold reached (${failureCount}/${this.config.failureThreshold})`);
      }
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Control
  // ─────────────────────────────────────────────────────────────────────────────
  
  forceOpen(): void {
    this.transitionTo('OPEN', 'Forced open');
  }
  
  forceClosed(): void {
    this.transitionTo('CLOSED', 'Forced closed');
  }
  
  reset(): void {
    this.state = 'CLOSED';
    this.lastStateChangeTime = Date.now();
    this.openedAt = 0;
    this.successCount = 0;
    this.halfOpenInFlight = 0;
    this.failureWindow.clear();
    
    // Reset lifetime metrics
    this.totalRequests = 0;
    this.successfulRequests = 0;
    this.failedRequests = 0;
    this.rejectedRequests = 0;
    this.timedOutRequests = 0;
    this.slowRequests = 0;
    this.lastFailureTime = undefined;
    this.lastSuccessTime = undefined;
    
    this.logger.info('Circuit breaker reset', { circuit: this.name });
    
    setGauge('circuit_breaker_state', 0, { circuit: this.name });
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Metrics
  // ─────────────────────────────────────────────────────────────────────────────
  
  getMetrics(): CircuitMetrics {
    const now = Date.now();
    const total = this.totalRequests || 1; // Avoid division by zero
    
    return {
      name: this.name,
      state: this.getState(),
      totalRequests: this.totalRequests,
      successfulRequests: this.successfulRequests,
      failedRequests: this.failedRequests,
      rejectedRequests: this.rejectedRequests,
      timedOutRequests: this.timedOutRequests,
      slowRequests: this.slowRequests,
      currentFailures: this.failureWindow.count(),
      currentSuccesses: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      lastStateChangeTime: this.lastStateChangeTime,
      timeInState: now - this.lastStateChangeTime,
      successRate: this.successfulRequests / total,
      failureRate: this.failedRequests / total,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// REGISTRY
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Global circuit breaker registry.
 */
class CircuitBreakerRegistryImpl implements CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly configs = new Map<string, CircuitBreakerConfig>();
  private readonly logger = getLogger({ component: 'circuit-registry' });
  
  /**
   * Register a custom configuration for a service.
   */
  configure(name: string, config: Partial<CircuitBreakerConfig>): void {
    const fullConfig: CircuitBreakerConfig = {
      ...DEFAULT_CIRCUIT_CONFIG,
      ...getServiceConfig(name),
      ...config,
      name,
    };
    this.configs.set(name, fullConfig);
  }
  
  get(name: string): CircuitBreaker {
    let breaker = this.breakers.get(name);
    
    if (!breaker) {
      // Get config (custom or default for service)
      const config = this.configs.get(name) ?? {
        ...DEFAULT_CIRCUIT_CONFIG,
        ...getServiceConfig(name),
        name,
      };
      
      breaker = new CircuitBreakerImpl(config);
      this.breakers.set(name, breaker);
      
      this.logger.debug('Circuit breaker created', { name });
    }
    
    return breaker;
  }
  
  find(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }
  
  getAll(): CircuitBreaker[] {
    return Array.from(this.breakers.values());
  }
  
  getAllMetrics(): CircuitMetrics[] {
    return this.getAll().map(b => b.getMetrics());
  }
  
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }
  
  remove(name: string): boolean {
    const breaker = this.breakers.get(name);
    if (breaker) {
      breaker.reset();
      this.breakers.delete(name);
      this.configs.delete(name);
      return true;
    }
    return false;
  }
  
  clear(): void {
    this.resetAll();
    this.breakers.clear();
    this.configs.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON REGISTRY
// ─────────────────────────────────────────────────────────────────────────────────

const registry = new CircuitBreakerRegistryImpl();

/**
 * Get the global circuit breaker registry.
 */
export function getCircuitBreakerRegistry(): CircuitBreakerRegistry & {
  configure(name: string, config: Partial<CircuitBreakerConfig>): void;
} {
  return registry;
}

/**
 * Get or create a circuit breaker by name.
 */
export function getCircuitBreaker(name: string): CircuitBreaker {
  return registry.get(name);
}

/**
 * Configure a circuit breaker.
 */
export function configureCircuitBreaker(
  name: string,
  config: Partial<CircuitBreakerConfig>
): void {
  registry.configure(name, config);
}

// ─────────────────────────────────────────────────────────────────────────────────
// DECORATOR / WRAPPER
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Wrap a function with circuit breaker protection.
 */
export function withCircuitBreaker<TArgs extends unknown[], TResult>(
  name: string,
  fn: (...args: TArgs) => Promise<TResult>
): (...args: TArgs) => Promise<TResult> {
  const breaker = getCircuitBreaker(name);
  
  return async (...args: TArgs): Promise<TResult> => {
    return breaker.execute(() => fn(...args));
  };
}

/**
 * Create a circuit breaker wrapper for a service client.
 */
export function createProtectedClient<T extends object>(
  name: string,
  client: T,
  methodNames?: (keyof T)[]
): T {
  const breaker = getCircuitBreaker(name);
  const methods = methodNames ?? (Object.keys(client) as (keyof T)[]);
  
  const proxy = {} as T;
  
  for (const key of methods) {
    const value = client[key];
    if (typeof value === 'function') {
      (proxy as Record<keyof T, unknown>)[key] = async (...args: unknown[]) => {
        return breaker.execute(() => (value as Function).apply(client, args));
      };
    } else {
      (proxy as Record<keyof T, unknown>)[key] = value;
    }
  }
  
  return proxy;
}
