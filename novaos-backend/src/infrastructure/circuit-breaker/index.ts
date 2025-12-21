// ═══════════════════════════════════════════════════════════════════════════════
// CIRCUIT BREAKER MODULE INDEX — Circuit Breaker Exports
// NovaOS Infrastructure — Phase 4
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // States
  type CircuitState,
  CircuitStateDescriptions,
  
  // Configuration
  type CircuitBreakerConfig,
  DEFAULT_CIRCUIT_CONFIG,
  
  // Events
  type StateChangeEvent,
  type RequestEvent,
  type RejectEvent,
  
  // Metrics
  type CircuitMetrics,
  
  // Errors
  CircuitOpenError,
  CircuitTimeoutError,
  
  // Interfaces
  type CircuitBreaker,
  type CircuitBreakerRegistry,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Presets
  type ConfigPreset,
  PRESETS,
  
  // Service configs
  SERVICE_CONFIGS,
  getServiceConfig,
  createServiceConfig,
  createFromPreset,
  createCustomConfig,
  
  // Error classifiers
  isRetryableError,
  createHttpErrorClassifier,
  createErrorTypeClassifier,
} from './config.js';

// ─────────────────────────────────────────────────────────────────────────────────
// IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Implementation
  CircuitBreakerImpl,
  
  // Registry
  getCircuitBreakerRegistry,
  getCircuitBreaker,
  configureCircuitBreaker,
  
  // Wrappers
  withCircuitBreaker,
  createProtectedClient,
} from './breaker.js';
