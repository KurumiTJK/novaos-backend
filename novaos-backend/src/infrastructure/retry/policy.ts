// ═══════════════════════════════════════════════════════════════════════════════
// RETRY POLICY — Retry with Backoff Implementation
// NovaOS Infrastructure — Phase 4
// ═══════════════════════════════════════════════════════════════════════════════
//
// Retry policy implementation with:
// - Configurable max attempts and timeouts
// - Pluggable backoff strategies
// - Retryable error detection
// - Event callbacks for monitoring
//
// ═══════════════════════════════════════════════════════════════════════════════

import {
  type RetryConfig,
  type RetryPolicy,
  type RetryResult,
  type RetryEvent,
  type ExhaustedEvent,
  type SuccessEvent,
  type BackoffCalculator,
  DEFAULT_RETRY_CONFIG,
  RetryExhaustedError,
  AttemptTimeoutError,
} from './types.js';
import {
  createBackoffCalculator,
  sleep,
  formatDelay,
} from './backoff.js';
import { getLogger } from '../../observability/logging/index.js';
import { incCounter, observeHistogram } from '../../observability/metrics/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// DEFAULT RETRYABLE ERRORS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Default function to determine if an error is retryable.
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  
  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();
  
  // Non-retryable errors (client errors, validation, auth)
  const nonRetryable = [
    'validation',
    'invalid',
    'unauthorized',
    'forbidden',
    'not found',
    'bad request',
    'unprocessable',
    '400',
    '401',
    '403',
    '404',
    '422',
  ];
  
  for (const term of nonRetryable) {
    if (message.includes(term) || name.includes(term)) {
      return false;
    }
  }
  
  // Retryable errors (network, timeout, server errors)
  const retryable = [
    'timeout',
    'etimedout',
    'econnreset',
    'econnrefused',
    'enotfound',
    'socket hang up',
    'network',
    'temporarily unavailable',
    '429',
    '500',
    '502',
    '503',
    '504',
    'rate limit',
    'too many requests',
    'service unavailable',
    'internal server error',
    'bad gateway',
    'gateway timeout',
  ];
  
  for (const term of retryable) {
    if (message.includes(term) || name.includes(term)) {
      return true;
    }
  }
  
  // Default: retry unknown errors
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────────
// RETRY POLICY IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Retry policy implementation.
 */
export class RetryPolicyImpl implements RetryPolicy {
  private readonly config: RetryConfig;
  private readonly backoff: BackoffCalculator;
  private readonly logger = getLogger({ component: 'retry' });
  
  constructor(config: Partial<RetryConfig> = {}) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
    this.backoff = createBackoffCalculator(this.config);
  }
  
  getConfig(): RetryConfig {
    return this.config;
  }
  
  /**
   * Execute with retry, throwing on exhaustion.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const result = await this.executeWithResult(fn);
    
    if (result.success) {
      return result.value;
    }
    
    throw new RetryExhaustedError({
      attempts: result.attempts,
      error: result.error,
      allErrors: result.allErrors,
      totalTimeMs: result.totalTimeMs,
      reason: this.determineExhaustionReason(result.attempts, result.error),
    });
  }
  
  /**
   * Execute with retry, returning detailed result.
   */
  async executeWithResult<T>(fn: () => Promise<T>): Promise<RetryResult<T>> {
    const startTime = Date.now();
    const errors: Error[] = [];
    let attempt = 0;
    
    // Reset backoff state
    this.backoff.reset();
    
    while (attempt <= this.config.maxAttempts) {
      attempt++;
      const attemptStart = Date.now();
      
      try {
        // Check total timeout
        if (this.config.totalTimeoutMs > 0) {
          const elapsed = Date.now() - startTime;
          if (elapsed >= this.config.totalTimeoutMs) {
            const lastError = errors[errors.length - 1] ?? new Error('Total timeout exceeded');
            return this.failure(lastError, errors, attempt - 1, Date.now() - startTime);
          }
        }
        
        // Execute with optional attempt timeout
        let result: T;
        
        if (this.config.attemptTimeoutMs > 0) {
          result = await this.withTimeout(fn, this.config.attemptTimeoutMs, attempt);
        } else {
          result = await fn();
        }
        
        // Success!
        const totalTimeMs = Date.now() - startTime;
        
        this.logger.debug('Retry succeeded', {
          attempt,
          totalTimeMs,
          retried: attempt > 1,
        });
        
        incCounter('retry_attempts_total', { result: 'success' });
        observeHistogram('retry_attempts_count', attempt, {});
        
        const successEvent: SuccessEvent = {
          attempt,
          totalTimeMs,
          retried: attempt > 1,
        };
        
        this.config.onSuccess?.(successEvent);
        
        return {
          success: true,
          value: result,
          attempts: attempt,
          totalTimeMs,
        };
        
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        errors.push(err);
        
        const elapsed = Date.now() - startTime;
        
        // Check if retryable
        const retryable = this.config.isRetryable
          ? this.config.isRetryable(error, attempt)
          : isRetryableError(error);
        
        if (!retryable) {
          this.logger.warn('Non-retryable error', {
            attempt,
            error: err.message,
            elapsed,
          });
          
          incCounter('retry_attempts_total', { result: 'non_retryable' });
          
          return this.failure(err, errors, attempt, elapsed);
        }
        
        // Check if we have attempts left
        if (attempt > this.config.maxAttempts) {
          this.logger.warn('Retry exhausted', {
            attempts: attempt,
            error: err.message,
            elapsed,
          });
          
          incCounter('retry_attempts_total', { result: 'exhausted' });
          
          return this.failure(err, errors, attempt, elapsed);
        }
        
        // Calculate delay
        const delayMs = this.backoff.calculate(attempt);
        
        // Check if delay would exceed total timeout
        if (this.config.totalTimeoutMs > 0) {
          const remaining = this.config.totalTimeoutMs - elapsed;
          if (delayMs >= remaining) {
            this.logger.warn('Retry timeout', {
              attempt,
              remaining,
              requiredDelay: delayMs,
            });
            
            incCounter('retry_attempts_total', { result: 'timeout' });
            
            return this.failure(err, errors, attempt, elapsed);
          }
        }
        
        // Emit retry event
        const retryEvent: RetryEvent = {
          attempt,
          maxAttempts: this.config.maxAttempts,
          error: err,
          delayMs,
          elapsedMs: elapsed,
          remainingMs: this.config.totalTimeoutMs > 0
            ? this.config.totalTimeoutMs - elapsed
            : undefined,
        };
        
        this.logger.debug('Retrying', {
          attempt,
          maxAttempts: this.config.maxAttempts,
          error: err.message,
          delay: formatDelay(delayMs),
        });
        
        incCounter('retry_attempts_total', { result: 'retry' });
        
        // Call onRetry callback
        await this.config.onRetry?.(retryEvent);
        
        // Wait before retry
        await sleep(delayMs);
      }
    }
    
    // Should not reach here
    const lastError = errors[errors.length - 1] ?? new Error('Unknown error');
    return this.failure(lastError, errors, attempt, Date.now() - startTime);
  }
  
  /**
   * Execute with timeout.
   */
  private async withTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    attempt: number
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new AttemptTimeoutError(attempt, timeoutMs));
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
  
  /**
   * Create failure result.
   */
  private failure<T>(
    error: Error,
    allErrors: Error[],
    attempts: number,
    totalTimeMs: number
  ): RetryResult<T> {
    const event: ExhaustedEvent = {
      attempts,
      error,
      allErrors,
      totalTimeMs,
      reason: this.determineExhaustionReason(attempts, error),
    };
    
    this.config.onExhausted?.(event);
    
    return {
      success: false,
      error,
      attempts,
      totalTimeMs,
      allErrors,
    };
  }
  
  /**
   * Determine reason for exhaustion.
   */
  private determineExhaustionReason(
    attempts: number,
    error: Error
  ): ExhaustedEvent['reason'] {
    if (error instanceof AttemptTimeoutError || error.message.includes('timeout')) {
      return 'timeout';
    }
    
    const retryable = this.config.isRetryable
      ? this.config.isRetryable(error, attempts)
      : isRetryableError(error);
    
    if (!retryable) {
      return 'non_retryable';
    }
    
    return 'max_attempts';
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// FACTORY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create a retry policy with custom configuration.
 */
export function createRetryPolicy(config?: Partial<RetryConfig>): RetryPolicy {
  return new RetryPolicyImpl(config);
}

/**
 * Create a retry policy with default exponential backoff.
 */
export function retryWithBackoff(options?: {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  totalTimeoutMs?: number;
}): RetryPolicy {
  return new RetryPolicyImpl({
    maxAttempts: options?.maxAttempts ?? 3,
    initialDelayMs: options?.initialDelayMs ?? 1000,
    maxDelayMs: options?.maxDelayMs ?? 30000,
    totalTimeoutMs: options?.totalTimeoutMs ?? 0,
    backoffStrategy: 'exponential-jitter',
    jitter: 'full',
  });
}

/**
 * Create a simple retry policy with fixed delay.
 */
export function retryWithFixedDelay(
  maxAttempts: number,
  delayMs: number
): RetryPolicy {
  return new RetryPolicyImpl({
    maxAttempts,
    initialDelayMs: delayMs,
    maxDelayMs: delayMs,
    backoffStrategy: 'fixed',
    jitter: 'none',
  });
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONVENIENCE FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Execute a function with retry using default policy.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryConfig>
): Promise<T> {
  const policy = createRetryPolicy(options);
  return policy.execute(fn);
}

/**
 * Execute a function with retry, returning result object.
 */
export async function tryRetry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryConfig>
): Promise<RetryResult<T>> {
  const policy = createRetryPolicy(options);
  return policy.executeWithResult(fn);
}

/**
 * Create a retryable version of an async function.
 */
export function withRetry<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options?: Partial<RetryConfig>
): (...args: TArgs) => Promise<TResult> {
  const policy = createRetryPolicy(options);
  
  return async (...args: TArgs): Promise<TResult> => {
    return policy.execute(() => fn(...args));
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// PRESETS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Preset configurations for common use cases.
 */
export const RetryPresets = {
  /** Quick retry for fast operations (cache, simple API) */
  quick: {
    maxAttempts: 2,
    initialDelayMs: 100,
    maxDelayMs: 1000,
    totalTimeoutMs: 5000,
  } as Partial<RetryConfig>,
  
  /** Standard retry for most operations */
  standard: {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    totalTimeoutMs: 30000,
  } as Partial<RetryConfig>,
  
  /** Patient retry for slow operations (LLM, complex processing) */
  patient: {
    maxAttempts: 5,
    initialDelayMs: 2000,
    maxDelayMs: 30000,
    totalTimeoutMs: 120000,
  } as Partial<RetryConfig>,
  
  /** Aggressive retry for critical operations */
  aggressive: {
    maxAttempts: 10,
    initialDelayMs: 500,
    maxDelayMs: 5000,
    totalTimeoutMs: 60000,
  } as Partial<RetryConfig>,
} as const;
