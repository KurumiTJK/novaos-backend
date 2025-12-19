// ═══════════════════════════════════════════════════════════════════════════════
// SEARCH CONFIGURATION — Tier-specific Search Settings
// ═══════════════════════════════════════════════════════════════════════════════

import type { SearchConfig, MediumSearchConfig, HighSearchConfig } from '../gates/lens/types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// DEFAULT SEARCH CONFIG
// ─────────────────────────────────────────────────────────────────────────────────

export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  medium: {
    primaryProvider: 'tavily',
    fallbackProvider: 'google_cse',
    maxResults: 5,
    maxFetchUrls: 3,
    timeoutMs: 3000,
    requireOfficialSources: false,
    dedupe: true,
    capturePublishedAt: true,
  },
  high: {
    providers: ['official', 'google_cse', 'tavily'],
    parallelFetch: true,
    maxResults: 10,
    maxFetchUrls: 5,
    timeoutMs: 5000,
    requireOfficialSources: true,
    requireMultipleSources: true,
    minSourcesForClaim: 2,
    officialSourceException: true,
    dedupe: true,
    capturePublishedAt: true,
  },
};

// ─────────────────────────────────────────────────────────────────────────────────
// LOAD CONFIG FROM ENVIRONMENT
// ─────────────────────────────────────────────────────────────────────────────────

export function loadSearchConfig(): SearchConfig {
  const config = { ...DEFAULT_SEARCH_CONFIG };

  // Override with environment variables if present
  if (process.env.LENS_MEDIUM_TIMEOUT_MS) {
    config.medium.timeoutMs = parseInt(process.env.LENS_MEDIUM_TIMEOUT_MS, 10);
  }

  if (process.env.LENS_HIGH_TIMEOUT_MS) {
    config.high.timeoutMs = parseInt(process.env.LENS_HIGH_TIMEOUT_MS, 10);
  }

  if (process.env.LENS_HIGH_MIN_SOURCES) {
    config.high.minSourcesForClaim = parseInt(process.env.LENS_HIGH_MIN_SOURCES, 10);
  }

  if (process.env.LENS_REQUIRE_OFFICIAL === 'false') {
    config.high.requireOfficialSources = false;
  }

  return config;
}

// ─────────────────────────────────────────────────────────────────────────────────
// VALIDATE CONFIG
// ─────────────────────────────────────────────────────────────────────────────────

export function validateSearchConfig(config: SearchConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate medium config
  if (config.medium.maxResults < 1 || config.medium.maxResults > 20) {
    errors.push('medium.maxResults must be between 1 and 20');
  }

  if (config.medium.timeoutMs < 1000 || config.medium.timeoutMs > 30000) {
    errors.push('medium.timeoutMs must be between 1000 and 30000');
  }

  // Validate high config
  if (config.high.maxResults < 1 || config.high.maxResults > 50) {
    errors.push('high.maxResults must be between 1 and 50');
  }

  if (config.high.timeoutMs < 1000 || config.high.timeoutMs > 60000) {
    errors.push('high.timeoutMs must be between 1000 and 60000');
  }

  if (config.high.minSourcesForClaim < 1 || config.high.minSourcesForClaim > 5) {
    errors.push('high.minSourcesForClaim must be between 1 and 5');
  }

  if (config.high.providers.length === 0) {
    errors.push('high.providers must have at least one provider');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
