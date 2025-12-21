// ═══════════════════════════════════════════════════════════════════════════════
// BACKOFF — Exponential Backoff with Jitter
// NovaOS Infrastructure — Phase 4
// ═══════════════════════════════════════════════════════════════════════════════
//
// Implements various backoff strategies:
// - Fixed: Same delay each time
// - Linear: Delay increases linearly
// - Exponential: Delay doubles each time
// - Exponential with jitter: Randomized to prevent thundering herd
//
// Jitter types:
// - None: No randomization
// - Full: Random between 0 and calculated delay
// - Equal: Random between delay/2 and delay
// - Decorrelated: AWS-style, based on previous delay
//
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  BackoffStrategy,
  JitterType,
  BackoffCalculator,
  RetryConfig,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// BACKOFF CALCULATOR IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Backoff calculator with configurable strategy and jitter.
 */
export class BackoffCalculatorImpl implements BackoffCalculator {
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly strategy: BackoffStrategy;
  private readonly jitter: JitterType;
  private readonly multiplier: number;
  
  // State for decorrelated jitter
  private lastDelay: number;
  
  constructor(config: Pick<RetryConfig, 'initialDelayMs' | 'maxDelayMs' | 'backoffStrategy' | 'jitter' | 'backoffMultiplier'>) {
    this.initialDelayMs = config.initialDelayMs;
    this.maxDelayMs = config.maxDelayMs;
    this.strategy = config.backoffStrategy;
    this.jitter = config.jitter;
    this.multiplier = config.backoffMultiplier;
    this.lastDelay = config.initialDelayMs;
  }
  
  /**
   * Calculate delay for given attempt (1-based).
   */
  calculate(attempt: number): number {
    // Calculate base delay based on strategy
    let baseDelay = this.calculateBaseDelay(attempt);
    
    // Apply jitter
    baseDelay = this.applyJitter(baseDelay);
    
    // Clamp to max
    return Math.min(baseDelay, this.maxDelayMs);
  }
  
  /**
   * Reset state (for decorrelated jitter).
   */
  reset(): void {
    this.lastDelay = this.initialDelayMs;
  }
  
  /**
   * Calculate base delay without jitter.
   */
  private calculateBaseDelay(attempt: number): number {
    switch (this.strategy) {
      case 'fixed':
        return this.initialDelayMs;
        
      case 'linear':
        return this.initialDelayMs * attempt * this.multiplier;
        
      case 'exponential':
      case 'exponential-jitter':
        // delay = initialDelay * multiplier^(attempt-1)
        return this.initialDelayMs * Math.pow(this.multiplier, attempt - 1);
        
      default:
        return this.initialDelayMs;
    }
  }
  
  /**
   * Apply jitter to delay.
   */
  private applyJitter(delay: number): number {
    // For exponential-jitter strategy, use full jitter by default
    const jitterType = this.strategy === 'exponential-jitter' && this.jitter === 'none'
      ? 'full'
      : this.jitter;
    
    switch (jitterType) {
      case 'none':
        return delay;
        
      case 'full':
        // Random between 0 and delay
        return Math.random() * delay;
        
      case 'equal':
        // Random between delay/2 and delay
        return (delay / 2) + (Math.random() * delay / 2);
        
      case 'decorrelated':
        // AWS-style: random between initialDelay and lastDelay * 3
        const min = this.initialDelayMs;
        const max = this.lastDelay * 3;
        this.lastDelay = min + Math.random() * (max - min);
        return Math.min(this.lastDelay, this.maxDelayMs);
        
      default:
        return delay;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// FACTORY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create a backoff calculator from config.
 */
export function createBackoffCalculator(
  config: Pick<RetryConfig, 'initialDelayMs' | 'maxDelayMs' | 'backoffStrategy' | 'jitter' | 'backoffMultiplier'>
): BackoffCalculator {
  return new BackoffCalculatorImpl(config);
}

/**
 * Create an exponential backoff calculator with sensible defaults.
 */
export function exponentialBackoff(options?: {
  initialDelayMs?: number;
  maxDelayMs?: number;
  multiplier?: number;
  jitter?: JitterType;
}): BackoffCalculator {
  return new BackoffCalculatorImpl({
    initialDelayMs: options?.initialDelayMs ?? 1000,
    maxDelayMs: options?.maxDelayMs ?? 30000,
    backoffStrategy: 'exponential-jitter',
    jitter: options?.jitter ?? 'full',
    backoffMultiplier: options?.multiplier ?? 2,
  });
}

/**
 * Create a fixed delay backoff calculator.
 */
export function fixedBackoff(delayMs: number): BackoffCalculator {
  return new BackoffCalculatorImpl({
    initialDelayMs: delayMs,
    maxDelayMs: delayMs,
    backoffStrategy: 'fixed',
    jitter: 'none',
    backoffMultiplier: 1,
  });
}

/**
 * Create a linear backoff calculator.
 */
export function linearBackoff(options?: {
  initialDelayMs?: number;
  maxDelayMs?: number;
  increment?: number;
}): BackoffCalculator {
  return new BackoffCalculatorImpl({
    initialDelayMs: options?.initialDelayMs ?? 1000,
    maxDelayMs: options?.maxDelayMs ?? 30000,
    backoffStrategy: 'linear',
    jitter: 'none',
    backoffMultiplier: options?.increment ?? 1,
  });
}

// ─────────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Sleep for a given duration.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sleep with abort support.
 */
export function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }
    
    const timer = setTimeout(resolve, ms);
    
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    };
    
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Calculate total maximum time for all retries.
 */
export function calculateMaxRetryTime(
  maxAttempts: number,
  calculator: BackoffCalculator
): number {
  let total = 0;
  for (let i = 1; i <= maxAttempts; i++) {
    total += calculator.calculate(i);
  }
  return total;
}

/**
 * Format delay for logging.
 */
export function formatDelay(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  } else {
    return `${(ms / 60000).toFixed(1)}m`;
  }
}
