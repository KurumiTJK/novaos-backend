// ═══════════════════════════════════════════════════════════════════════════════
// RETRY MODULE INDEX — Retry Policy Exports
// NovaOS Infrastructure — Phase 4
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Strategy types
  type BackoffStrategy,
  type JitterType,
  
  // Configuration
  type RetryConfig,
  DEFAULT_RETRY_CONFIG,
  
  // Events
  type RetryEvent,
  type ExhaustedEvent,
  type SuccessEvent,
  
  // Result
  type RetryResult,
  
  // Errors
  RetryExhaustedError,
  AttemptTimeoutError,
  
  // Interfaces
  type RetryPolicy,
  type BackoffCalculator,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// BACKOFF
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Implementation
  BackoffCalculatorImpl,
  
  // Factory functions
  createBackoffCalculator,
  exponentialBackoff,
  fixedBackoff,
  linearBackoff,
  
  // Utilities
  sleep,
  sleepWithAbort,
  calculateMaxRetryTime,
  formatDelay,
} from './backoff.js';

// ─────────────────────────────────────────────────────────────────────────────────
// POLICY
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Error detection
  isRetryableError,
  
  // Implementation
  RetryPolicyImpl,
  
  // Factory functions
  createRetryPolicy,
  retryWithBackoff,
  retryWithFixedDelay,
  
  // Convenience functions
  retry,
  tryRetry,
  withRetry,
  
  // Presets
  RetryPresets,
} from './policy.js';
