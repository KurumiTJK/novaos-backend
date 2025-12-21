// ═══════════════════════════════════════════════════════════════════════════════
// CIRCUIT BREAKER CONFIG — Per-Service Configuration
// NovaOS Infrastructure — Phase 4
// ═══════════════════════════════════════════════════════════════════════════════
//
// Pre-defined circuit breaker configurations for various services:
// - Redis (fast fail for cache misses)
// - LLM providers (tolerant for slow responses)
// - External APIs (per-provider tuning)
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { CircuitBreakerConfig } from './types.js';
import { DEFAULT_CIRCUIT_CONFIG } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CONFIGURATION PRESETS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Configuration preset types.
 */
export type ConfigPreset = 
  | 'aggressive'    // Fast failure, quick recovery (caches, simple services)
  | 'moderate'      // Balanced (most APIs)
  | 'tolerant'      // Slow to open, patient recovery (LLMs, complex services)
  | 'critical';     // Very conservative (payment, auth)

/**
 * Preset configurations.
 */
export const PRESETS: Record<ConfigPreset, Omit<CircuitBreakerConfig, 'name'>> = {
  aggressive: {
    failureThreshold: 3,
    successThreshold: 2,
    resetTimeoutMs: 10000,       // 10 seconds
    failureWindowMs: 30000,      // 30 seconds
    halfOpenRequests: 2,
    requestTimeoutMs: 5000,      // 5 seconds
    trackSlowRequests: true,
    slowRequestThresholdMs: 2000,
    slowRequestFailurePercent: 30,
  },
  
  moderate: {
    ...DEFAULT_CIRCUIT_CONFIG,
  },
  
  tolerant: {
    failureThreshold: 10,
    successThreshold: 5,
    resetTimeoutMs: 60000,       // 1 minute
    failureWindowMs: 120000,     // 2 minutes
    halfOpenRequests: 5,
    requestTimeoutMs: 30000,     // 30 seconds
    trackSlowRequests: false,
    slowRequestThresholdMs: 10000,
    slowRequestFailurePercent: 50,
  },
  
  critical: {
    failureThreshold: 2,
    successThreshold: 5,
    resetTimeoutMs: 60000,       // 1 minute
    failureWindowMs: 60000,      // 1 minute
    halfOpenRequests: 1,
    requestTimeoutMs: 10000,     // 10 seconds
    trackSlowRequests: true,
    slowRequestThresholdMs: 3000,
    slowRequestFailurePercent: 20,
  },
};

// ─────────────────────────────────────────────────────────────────────────────────
// SERVICE CONFIGURATIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Service-specific circuit breaker configurations.
 */
export const SERVICE_CONFIGS: Record<string, Omit<CircuitBreakerConfig, 'name'>> = {
  // ─────────────────────────────────────────────────────────────────────────────
  // Infrastructure Services
  // ─────────────────────────────────────────────────────────────────────────────
  
  /** Redis cache - aggressive, fast recovery */
  redis: {
    ...PRESETS.aggressive,
    failureThreshold: 5,
    resetTimeoutMs: 5000,        // Quick retry for cache
    requestTimeoutMs: 1000,      // 1 second max
  },
  
  // ─────────────────────────────────────────────────────────────────────────────
  // LLM Providers
  // ─────────────────────────────────────────────────────────────────────────────
  
  /** OpenAI API - tolerant, LLMs are slow */
  openai: {
    ...PRESETS.tolerant,
    failureThreshold: 5,
    requestTimeoutMs: 60000,     // 60 seconds for LLM
    slowRequestThresholdMs: 30000,
    trackSlowRequests: false,    // LLMs are inherently slow
  },
  
  /** Google Gemini API */
  gemini: {
    ...PRESETS.tolerant,
    failureThreshold: 5,
    requestTimeoutMs: 60000,
    trackSlowRequests: false,
  },
  
  /** Anthropic Claude API */
  anthropic: {
    ...PRESETS.tolerant,
    failureThreshold: 5,
    requestTimeoutMs: 120000,    // Claude can be slower
    trackSlowRequests: false,
  },
  
  // ─────────────────────────────────────────────────────────────────────────────
  // External Data APIs
  // ─────────────────────────────────────────────────────────────────────────────
  
  /** Finnhub stock API - moderate */
  finnhub: {
    ...PRESETS.moderate,
    requestTimeoutMs: 5000,
  },
  
  /** OpenWeatherMap API */
  openweathermap: {
    ...PRESETS.moderate,
    requestTimeoutMs: 5000,
  },
  
  /** CoinGecko API */
  coingecko: {
    ...PRESETS.moderate,
    failureThreshold: 8,         // More tolerant (free tier has limits)
    requestTimeoutMs: 10000,
  },
  
  /** Frankfurter exchange rate API */
  frankfurter: {
    ...PRESETS.moderate,
    requestTimeoutMs: 5000,
  },
  
  /** YouTube Data API */
  youtube: {
    ...PRESETS.moderate,
    requestTimeoutMs: 10000,
  },
  
  /** GitHub API */
  github: {
    ...PRESETS.moderate,
    requestTimeoutMs: 10000,
  },
  
  /** Tavily search API */
  tavily: {
    ...PRESETS.moderate,
    requestTimeoutMs: 15000,
  },
  
  /** Google Custom Search */
  googlecse: {
    ...PRESETS.moderate,
    requestTimeoutMs: 10000,
  },
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Web Fetch (SSRF-protected)
  // ─────────────────────────────────────────────────────────────────────────────
  
  /** Generic web fetch - per-domain breakers recommended */
  webfetch: {
    ...PRESETS.moderate,
    failureThreshold: 10,        // More tolerant for diverse targets
    requestTimeoutMs: 15000,
    trackSlowRequests: true,
    slowRequestThresholdMs: 5000,
  },
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Internal Services
  // ─────────────────────────────────────────────────────────────────────────────
  
  /** Verification service */
  verification: {
    ...PRESETS.moderate,
    failureThreshold: 5,
    requestTimeoutMs: 20000,     // Verification can be slow
  },
  
  /** Spark generation */
  sparkgen: {
    ...PRESETS.tolerant,
    requestTimeoutMs: 45000,     // LLM-backed
  },
  
  /** Step generation */
  stepgen: {
    ...PRESETS.tolerant,
    requestTimeoutMs: 45000,     // LLM-backed
  },
};

// ─────────────────────────────────────────────────────────────────────────────────
// CONFIGURATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Get configuration for a service.
 * Falls back to moderate preset if service not found.
 */
export function getServiceConfig(serviceName: string): Omit<CircuitBreakerConfig, 'name'> {
  const normalized = serviceName.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SERVICE_CONFIGS[normalized] ?? PRESETS.moderate;
}

/**
 * Create a full configuration for a service.
 */
export function createServiceConfig(
  serviceName: string,
  overrides?: Partial<CircuitBreakerConfig>
): CircuitBreakerConfig {
  const base = getServiceConfig(serviceName);
  return {
    ...base,
    ...overrides,
    name: serviceName,
  };
}

/**
 * Create configuration from a preset.
 */
export function createFromPreset(
  name: string,
  preset: ConfigPreset,
  overrides?: Partial<CircuitBreakerConfig>
): CircuitBreakerConfig {
  return {
    ...PRESETS[preset],
    ...overrides,
    name,
  };
}

/**
 * Create a custom configuration.
 */
export function createCustomConfig(
  name: string,
  config: Partial<Omit<CircuitBreakerConfig, 'name'>>
): CircuitBreakerConfig {
  return {
    ...DEFAULT_CIRCUIT_CONFIG,
    ...config,
    name,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// ERROR CLASSIFIERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Check if an error is retryable (should count as failure).
 * Returns false for client errors that won't be fixed by retry.
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  
  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();
  
  // Client errors - don't count as circuit failures
  const clientErrors = [
    'validation',
    'invalid',
    'unauthorized',
    'forbidden',
    'not found',
    'bad request',
    '400',
    '401',
    '403',
    '404',
    '422',
  ];
  
  for (const clientError of clientErrors) {
    if (message.includes(clientError) || name.includes(clientError)) {
      return false;
    }
  }
  
  // Network/server errors - count as circuit failures
  const serverErrors = [
    'timeout',
    'econnrefused',
    'econnreset',
    'enotfound',
    'etimedout',
    'socket',
    'network',
    '500',
    '502',
    '503',
    '504',
    'service unavailable',
    'internal server error',
    'bad gateway',
    'gateway timeout',
  ];
  
  for (const serverError of serverErrors) {
    if (message.includes(serverError) || name.includes(serverError)) {
      return true;
    }
  }
  
  // Default: count as failure
  return true;
}

/**
 * Create an error classifier for HTTP status codes.
 */
export function createHttpErrorClassifier(
  retryableStatuses: number[] = [408, 429, 500, 502, 503, 504]
): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    if (!(error instanceof Error)) return true;
    
    // Check for status code in error
    const statusMatch = error.message.match(/\b([45]\d{2})\b/);
    if (statusMatch) {
      const status = parseInt(statusMatch[1]!, 10);
      return retryableStatuses.includes(status);
    }
    
    // Fall back to generic classifier
    return isRetryableError(error);
  };
}

/**
 * Create error classifier for specific error types.
 */
export function createErrorTypeClassifier(
  retryableTypes: string[]
): (error: unknown) => boolean {
  const normalizedTypes = retryableTypes.map(t => t.toLowerCase());
  
  return (error: unknown): boolean => {
    if (!(error instanceof Error)) return true;
    
    const errorName = error.name.toLowerCase();
    const errorMessage = error.message.toLowerCase();
    
    for (const type of normalizedTypes) {
      if (errorName.includes(type) || errorMessage.includes(type)) {
        return true;
      }
    }
    
    return false;
  };
}
