// ═══════════════════════════════════════════════════════════════════════════════
// RETRY TYPES — Retry Policy Types and Configuration
// NovaOS Infrastructure — Phase 4
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// BACKOFF STRATEGIES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Backoff strategy types.
 */
export type BackoffStrategy = 
  | 'fixed'           // Same delay each time
  | 'linear'          // Delay increases linearly
  | 'exponential'     // Delay doubles each time
  | 'exponential-jitter';  // Exponential with random jitter

/**
 * Jitter types for randomization.
 */
export type JitterType =
  | 'none'           // No jitter
  | 'full'           // Random between 0 and delay
  | 'equal'          // Random between delay/2 and delay
  | 'decorrelated';  // AWS-style decorrelated jitter

// ─────────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Retry policy configuration.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (excluding initial attempt) */
  readonly maxAttempts: number;
  
  /** Initial delay in ms before first retry */
  readonly initialDelayMs: number;
  
  /** Maximum delay in ms between retries */
  readonly maxDelayMs: number;
  
  /** Backoff strategy */
  readonly backoffStrategy: BackoffStrategy;
  
  /** Jitter type for randomization */
  readonly jitter: JitterType;
  
  /** Multiplier for exponential/linear backoff */
  readonly backoffMultiplier: number;
  
  /** Total timeout for all attempts in ms (0 = no limit) */
  readonly totalTimeoutMs: number;
  
  /** Timeout for individual attempts in ms (0 = no limit) */
  readonly attemptTimeoutMs: number;
  
  /** Function to determine if error is retryable */
  readonly isRetryable?: (error: unknown, attempt: number) => boolean;
  
  /** Called before each retry */
  readonly onRetry?: (event: RetryEvent) => void | Promise<void>;
  
  /** Called when all retries exhausted */
  readonly onExhausted?: (event: ExhaustedEvent) => void;
  
  /** Called on success */
  readonly onSuccess?: (event: SuccessEvent) => void;
}

/**
 * Default retry configuration.
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffStrategy: 'exponential-jitter',
  jitter: 'full',
  backoffMultiplier: 2,
  totalTimeoutMs: 0,
  attemptTimeoutMs: 0,
};

// ─────────────────────────────────────────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Retry attempt event.
 */
export interface RetryEvent {
  /** Current attempt number (1-based) */
  readonly attempt: number;
  
  /** Maximum attempts allowed */
  readonly maxAttempts: number;
  
  /** Error that caused the retry */
  readonly error: Error;
  
  /** Delay before this retry in ms */
  readonly delayMs: number;
  
  /** Time elapsed since first attempt in ms */
  readonly elapsedMs: number;
  
  /** Time remaining until total timeout (if set) */
  readonly remainingMs?: number;
}

/**
 * Exhausted event (all retries failed).
 */
export interface ExhaustedEvent {
  /** Total attempts made */
  readonly attempts: number;
  
  /** Final error */
  readonly error: Error;
  
  /** All errors from each attempt */
  readonly allErrors: Error[];
  
  /** Total time spent in ms */
  readonly totalTimeMs: number;
  
  /** Reason for exhaustion */
  readonly reason: 'max_attempts' | 'timeout' | 'non_retryable';
}

/**
 * Success event.
 */
export interface SuccessEvent {
  /** Attempt that succeeded (1-based) */
  readonly attempt: number;
  
  /** Total time spent in ms */
  readonly totalTimeMs: number;
  
  /** Whether retries were needed */
  readonly retried: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────
// RESULT
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Result of a retry operation.
 */
export type RetryResult<T> = 
  | { success: true; value: T; attempts: number; totalTimeMs: number }
  | { success: false; error: Error; attempts: number; totalTimeMs: number; allErrors: Error[] };

// ─────────────────────────────────────────────────────────────────────────────────
// ERRORS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Error thrown when retries are exhausted.
 */
export class RetryExhaustedError extends Error {
  readonly name = 'RetryExhaustedError';
  readonly attempts: number;
  readonly allErrors: Error[];
  readonly totalTimeMs: number;
  readonly reason: ExhaustedEvent['reason'];
  
  constructor(event: ExhaustedEvent) {
    super(`Retry exhausted after ${event.attempts} attempts: ${event.error.message}`);
    this.attempts = event.attempts;
    this.allErrors = event.allErrors;
    this.totalTimeMs = event.totalTimeMs;
    this.reason = event.reason;
    this.cause = event.error;
  }
}

/**
 * Error thrown when attempt times out.
 */
export class AttemptTimeoutError extends Error {
  readonly name = 'AttemptTimeoutError';
  readonly attempt: number;
  readonly timeoutMs: number;
  
  constructor(attempt: number, timeoutMs: number) {
    super(`Attempt ${attempt} timed out after ${timeoutMs}ms`);
    this.attempt = attempt;
    this.timeoutMs = timeoutMs;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// INTERFACES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Retry policy interface.
 */
export interface RetryPolicy {
  /** Execute a function with retry */
  execute<T>(fn: () => Promise<T>): Promise<T>;
  
  /** Execute and return detailed result */
  executeWithResult<T>(fn: () => Promise<T>): Promise<RetryResult<T>>;
  
  /** Get the configuration */
  getConfig(): RetryConfig;
}

/**
 * Backoff calculator interface.
 */
export interface BackoffCalculator {
  /** Calculate delay for given attempt */
  calculate(attempt: number): number;
  
  /** Reset state (for decorrelated jitter) */
  reset(): void;
}
