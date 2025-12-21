// ═══════════════════════════════════════════════════════════════════════════════
// CIRCUIT BREAKER TYPES — States, Configuration, Events
// NovaOS Infrastructure — Phase 4
// ═══════════════════════════════════════════════════════════════════════════════
//
// Circuit breaker pattern implementation types:
// - State machine: CLOSED → OPEN → HALF_OPEN → CLOSED
// - Failure tracking and thresholds
// - Recovery testing with gradual reopening
//
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// STATES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Circuit breaker states.
 * 
 * CLOSED: Normal operation, requests pass through
 * OPEN: Failing fast, requests are rejected immediately
 * HALF_OPEN: Testing recovery, limited requests allowed
 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * State descriptions for logging/monitoring.
 */
export const CircuitStateDescriptions: Record<CircuitState, string> = {
  CLOSED: 'Circuit closed - requests flowing normally',
  OPEN: 'Circuit open - requests failing fast',
  HALF_OPEN: 'Circuit half-open - testing recovery',
};

// ─────────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Circuit breaker configuration.
 */
export interface CircuitBreakerConfig {
  /** Unique identifier for this breaker */
  readonly name: string;
  
  /** Number of failures before opening circuit */
  readonly failureThreshold: number;
  
  /** Number of successes in HALF_OPEN before closing */
  readonly successThreshold: number;
  
  /** Time in ms to wait before testing recovery (OPEN → HALF_OPEN) */
  readonly resetTimeoutMs: number;
  
  /** Time window in ms for counting failures */
  readonly failureWindowMs: number;
  
  /** Number of requests allowed in HALF_OPEN state */
  readonly halfOpenRequests: number;
  
  /** Timeout for individual requests in ms (0 = no timeout) */
  readonly requestTimeoutMs: number;
  
  /** Whether to track slow requests as failures */
  readonly trackSlowRequests: boolean;
  
  /** Threshold in ms for slow request tracking */
  readonly slowRequestThresholdMs: number;
  
  /** Percentage of slow requests that count as failure (0-100) */
  readonly slowRequestFailurePercent: number;
  
  /** Custom error classifier */
  readonly isFailure?: (error: unknown) => boolean;
  
  /** Event handlers */
  readonly onStateChange?: (event: StateChangeEvent) => void;
  readonly onSuccess?: (event: RequestEvent) => void;
  readonly onFailure?: (event: RequestEvent) => void;
  readonly onReject?: (event: RejectEvent) => void;
}

/**
 * Default configuration values.
 */
export const DEFAULT_CIRCUIT_CONFIG: Omit<CircuitBreakerConfig, 'name'> = {
  failureThreshold: 5,
  successThreshold: 3,
  resetTimeoutMs: 30000,        // 30 seconds
  failureWindowMs: 60000,       // 1 minute
  halfOpenRequests: 3,
  requestTimeoutMs: 10000,      // 10 seconds
  trackSlowRequests: false,
  slowRequestThresholdMs: 5000, // 5 seconds
  slowRequestFailurePercent: 50,
};

// ─────────────────────────────────────────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * State change event.
 */
export interface StateChangeEvent {
  /** Circuit breaker name */
  readonly name: string;
  
  /** Previous state */
  readonly from: CircuitState;
  
  /** New state */
  readonly to: CircuitState;
  
  /** Timestamp of change */
  readonly timestamp: number;
  
  /** Reason for change */
  readonly reason: string;
  
  /** Current failure count */
  readonly failureCount: number;
  
  /** Current success count (in HALF_OPEN) */
  readonly successCount: number;
}

/**
 * Request event (success or failure).
 */
export interface RequestEvent {
  /** Circuit breaker name */
  readonly name: string;
  
  /** Current state */
  readonly state: CircuitState;
  
  /** Request duration in ms */
  readonly durationMs: number;
  
  /** Timestamp */
  readonly timestamp: number;
  
  /** Error if failure */
  readonly error?: Error;
  
  /** Whether this was a slow request */
  readonly slow?: boolean;
}

/**
 * Request rejection event.
 */
export interface RejectEvent {
  /** Circuit breaker name */
  readonly name: string;
  
  /** Current state (always OPEN or HALF_OPEN at capacity) */
  readonly state: CircuitState;
  
  /** Timestamp */
  readonly timestamp: number;
  
  /** Time until circuit may close */
  readonly retryAfterMs: number;
  
  /** Reason for rejection */
  readonly reason: 'circuit_open' | 'half_open_capacity';
}

// ─────────────────────────────────────────────────────────────────────────────────
// METRICS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Circuit breaker metrics snapshot.
 */
export interface CircuitMetrics {
  /** Circuit breaker name */
  readonly name: string;
  
  /** Current state */
  readonly state: CircuitState;
  
  /** Total requests */
  readonly totalRequests: number;
  
  /** Successful requests */
  readonly successfulRequests: number;
  
  /** Failed requests */
  readonly failedRequests: number;
  
  /** Rejected requests (circuit open) */
  readonly rejectedRequests: number;
  
  /** Timed out requests */
  readonly timedOutRequests: number;
  
  /** Slow requests */
  readonly slowRequests: number;
  
  /** Current failure count in window */
  readonly currentFailures: number;
  
  /** Current success count (HALF_OPEN) */
  readonly currentSuccesses: number;
  
  /** Last failure timestamp */
  readonly lastFailureTime?: number;
  
  /** Last success timestamp */
  readonly lastSuccessTime?: number;
  
  /** Last state change timestamp */
  readonly lastStateChangeTime: number;
  
  /** Time in current state (ms) */
  readonly timeInState: number;
  
  /** Success rate (0-1) */
  readonly successRate: number;
  
  /** Failure rate (0-1) */
  readonly failureRate: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// ERRORS
// ─────────────────────────────────────════════════════════════════════════════════

/**
 * Error thrown when circuit is open.
 */
export class CircuitOpenError extends Error {
  readonly name = 'CircuitOpenError';
  readonly circuitName: string;
  readonly retryAfterMs: number;
  
  constructor(circuitName: string, retryAfterMs: number) {
    super(`Circuit breaker '${circuitName}' is open. Retry after ${retryAfterMs}ms`);
    this.circuitName = circuitName;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Error thrown when request times out.
 */
export class CircuitTimeoutError extends Error {
  readonly name = 'CircuitTimeoutError';
  readonly circuitName: string;
  readonly timeoutMs: number;
  
  constructor(circuitName: string, timeoutMs: number) {
    super(`Circuit breaker '${circuitName}' request timed out after ${timeoutMs}ms`);
    this.circuitName = circuitName;
    this.timeoutMs = timeoutMs;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// INTERFACES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Circuit breaker interface.
 */
export interface CircuitBreaker {
  /** Circuit name */
  readonly name: string;
  
  /** Get current state */
  getState(): CircuitState;
  
  /** Get current metrics */
  getMetrics(): CircuitMetrics;
  
  /** Check if request is allowed */
  isAllowed(): boolean;
  
  /** Execute a function with circuit breaker protection */
  execute<T>(fn: () => Promise<T>): Promise<T>;
  
  /** Record a success */
  recordSuccess(durationMs: number): void;
  
  /** Record a failure */
  recordFailure(error?: Error, durationMs?: number): void;
  
  /** Force circuit open (for testing/maintenance) */
  forceOpen(): void;
  
  /** Force circuit closed (for testing/maintenance) */
  forceClosed(): void;
  
  /** Reset circuit to initial state */
  reset(): void;
}

/**
 * Circuit breaker registry interface.
 */
export interface CircuitBreakerRegistry {
  /** Get or create a circuit breaker */
  get(name: string): CircuitBreaker;
  
  /** Get a circuit breaker if it exists */
  find(name: string): CircuitBreaker | undefined;
  
  /** Get all circuit breakers */
  getAll(): CircuitBreaker[];
  
  /** Get metrics for all breakers */
  getAllMetrics(): CircuitMetrics[];
  
  /** Reset all circuit breakers */
  resetAll(): void;
  
  /** Remove a circuit breaker */
  remove(name: string): boolean;
  
  /** Clear all circuit breakers */
  clear(): void;
}
