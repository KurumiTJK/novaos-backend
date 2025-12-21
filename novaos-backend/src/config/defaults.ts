// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION DEFAULTS — Environment-Specific Default Values
// Sword System v3.0 — Phase 1: Configuration & Core Types
// ═══════════════════════════════════════════════════════════════════════════════

import type { AppConfig, Environment } from './schema.js';

// ─────────────────────────────────────────────────────────────────────────────────
// DEVELOPMENT DEFAULTS
// Relaxed limits, verbose logging, faster iteration
// ─────────────────────────────────────────────────────────────────────────────────

const DEVELOPMENT_DEFAULTS: Partial<AppConfig> = {
  environment: 'development',
  
  server: {
    port: 3000,
    host: '0.0.0.0',
    shutdownTimeoutMs: 5000,
    trustProxy: false,
  },
  
  redis: {
    host: 'localhost',
    port: 6379,
    password: undefined,
    tls: false,
    keyPrefix: 'nova:dev:',
    disabled: false,
    connectTimeoutMs: 5000,
    commandTimeoutMs: 5000,
    maxRetriesPerRequest: 3,
  },
  
  encryption: {
    enabled: false,
    algorithm: 'aes-256-gcm',
    currentKeyId: 'dev-key-1',
  },
  
  auth: {
    jwtIssuer: 'novaos-dev',
    jwtAudience: 'novaos-api-dev',
    tokenExpirySeconds: 86400 * 7, // 7 days for dev convenience
    required: false,
  },
  
  rateLimits: {
    api: { windowMs: 60000, maxRequests: 1000 }, // Very relaxed
    ssrf: { windowMs: 60000, maxRequests: 100 },
    goalCreation: { windowMs: 60000, maxRequests: 50 },
    sparkGeneration: { windowMs: 60000, maxRequests: 100 },
    multiplier: 2.0, // Double the limits in dev
  },
  
  ssrf: {
    allowedPorts: [80, 443, 3000, 5173, 8080], // Include dev ports
    dnsTimeoutMs: 5000,
    requestTimeoutMs: 15000,
    maxResponseBytes: 5242880, // 5MB in dev
    maxRedirects: 5,
    allowPrivateIps: true, // Allow in dev for local testing
    allowLocalhost: true,
    validateCerts: false, // Allow self-signed in dev
    preventDnsRebinding: false,
    blockedDomains: ['169.254.169.254', 'metadata.google.internal'],
  },
  
  llm: {
    provider: 'openai',
    model: 'gpt-4o-mini', // Cheaper model for dev
    timeoutMs: 60000, // Longer timeout for debugging
    maxTokens: 4000,
    maxInputTokens: 8000,
    temperature: 0.7,
    useMock: false,
  },
  
  swordLimits: {
    maxGoalsPerUser: 50, // Relaxed for testing
    maxActiveGoals: 10,
    goalStatementMaxLength: 1000,
    maxEscalationLevel: 5,
    maxRemindersPerStep: 5,
    maxConversationHistory: 100,
    minSparkMinutes: 1,
    maxSparkMinutes: 60,
    dailyStepGenerationHour: 6,
    morningSparkHour: 8,
    maxQuestsPerGoal: 30,
    maxStepsPerQuest: 50,
  },
  
  retention: {
    completedGoalsDays: 365,
    abandonedGoalsDays: 180,
    auditLogDays: 30,
    conversationDays: 365,
    memoryDays: 730,
  },
  
  verification: {
    enabled: false,
    required: false,
    cacheTTLSeconds: 60, // Short cache for dev
    maxCacheEntries: 100,
    maxVerificationsPerRequest: 5,
    maxConcurrentVerifications: 3,
    trustedDomains: ['wikipedia.org', 'gov', 'edu', 'reuters.com', 'apnews.com'],
  },
  
  webFetch: {
    enabled: false,
    allowlist: [],
    blocklist: ['169.254.169.254', 'metadata.google.internal'],
    maxSizeBytes: 5242880, // 5MB
    maxRedirects: 5,
    connectTimeoutMs: 10000,
    readTimeoutMs: 15000,
    totalTimeoutMs: 30000,
    dnsTimeoutMs: 5000,
  },
  
  observability: {
    debugMode: true,
    redactPII: false, // Don't redact in dev for debugging
    logLevel: 'debug',
    enableMetrics: true,
    enableTracing: true,
  },
  
  cors: {
    allowedOrigins: ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173'],
    allowCredentials: true,
    maxAge: 3600,
  },
};

// ─────────────────────────────────────────────────────────────────────────────────
// STAGING DEFAULTS
// Production-like but with debug features and cheaper models
// ─────────────────────────────────────────────────────────────────────────────────

const STAGING_DEFAULTS: Partial<AppConfig> = {
  environment: 'staging',
  
  server: {
    port: 3000,
    host: '0.0.0.0',
    shutdownTimeoutMs: 15000,
    trustProxy: true,
  },
  
  redis: {
    host: 'localhost',
    port: 6379,
    password: undefined,
    tls: false,
    keyPrefix: 'nova:staging:',
    disabled: false,
    connectTimeoutMs: 5000,
    commandTimeoutMs: 5000,
    maxRetriesPerRequest: 3,
  },
  
  encryption: {
    enabled: true,
    algorithm: 'aes-256-gcm',
    currentKeyId: 'staging-key-1',
  },
  
  auth: {
    jwtIssuer: 'novaos-staging',
    jwtAudience: 'novaos-api-staging',
    tokenExpirySeconds: 86400, // 24 hours
    required: true,
  },
  
  rateLimits: {
    api: { windowMs: 60000, maxRequests: 60 },
    ssrf: { windowMs: 60000, maxRequests: 10 },
    goalCreation: { windowMs: 60000, maxRequests: 5 },
    sparkGeneration: { windowMs: 60000, maxRequests: 10 },
    multiplier: 1.0,
  },
  
  ssrf: {
    allowedPorts: [80, 443],
    dnsTimeoutMs: 3000,
    requestTimeoutMs: 10000,
    maxResponseBytes: 1048576, // 1MB
    maxRedirects: 3,
    allowPrivateIps: false,
    allowLocalhost: false,
    validateCerts: true,
    preventDnsRebinding: true,
    blockedDomains: [
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '169.254.169.254',
      'metadata.google.internal',
    ],
  },
  
  llm: {
    provider: 'openai',
    model: 'gpt-4o-mini', // Cheaper model for staging
    timeoutMs: 30000,
    maxTokens: 2000, // Reduced for cost
    maxInputTokens: 4000,
    temperature: 0.7,
    useMock: false,
  },
  
  swordLimits: {
    maxGoalsPerUser: 10,
    maxActiveGoals: 3,
    goalStatementMaxLength: 500,
    maxEscalationLevel: 3,
    maxRemindersPerStep: 3,
    maxConversationHistory: 50,
    minSparkMinutes: 2,
    maxSparkMinutes: 30,
    dailyStepGenerationHour: 6,
    morningSparkHour: 8,
    maxQuestsPerGoal: 20,
    maxStepsPerQuest: 30,
  },
  
  retention: {
    completedGoalsDays: 180,
    abandonedGoalsDays: 60,
    auditLogDays: 60,
    conversationDays: 180,
    memoryDays: 365,
  },
  
  verification: {
    enabled: true,
    required: false,
    cacheTTLSeconds: 300,
    maxCacheEntries: 500,
    maxVerificationsPerRequest: 3,
    maxConcurrentVerifications: 2,
    trustedDomains: ['wikipedia.org', 'gov', 'edu', 'reuters.com', 'apnews.com'],
  },
  
  webFetch: {
    enabled: true,
    allowlist: [],
    blocklist: [
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '169.254.169.254',
      'metadata.google.internal',
    ],
    maxSizeBytes: 1048576,
    maxRedirects: 3,
    connectTimeoutMs: 5000,
    readTimeoutMs: 10000,
    totalTimeoutMs: 15000,
    dnsTimeoutMs: 3000,
  },
  
  observability: {
    debugMode: true, // Extra logging in staging
    redactPII: true,
    logLevel: 'debug',
    enableMetrics: true,
    enableTracing: true,
  },
  
  cors: {
    allowedOrigins: [], // Set via environment
    allowCredentials: true,
    maxAge: 86400,
  },
  
  stagingOverrides: {
    openaiModel: 'gpt-4o-mini',
    geminiModel: 'gemini-1.5-flash',
    maxRequestsPerMinute: 30,
    maxTokensPerRequest: 1000,
    maxConversationMessages: 20,
    requestTimeoutMs: 15000,
    disableVerification: false,
    disableWebFetch: false,
  },
};

// ─────────────────────────────────────────────────────────────────────────────────
// PRODUCTION DEFAULTS
// Strict limits, minimal logging, maximum security
// ─────────────────────────────────────────────────────────────────────────────────

const PRODUCTION_DEFAULTS: Partial<AppConfig> = {
  environment: 'production',
  
  server: {
    port: 3000,
    host: '0.0.0.0',
    shutdownTimeoutMs: 30000,
    trustProxy: true,
  },
  
  redis: {
    host: 'localhost',
    port: 6379,
    password: undefined, // Set via environment
    tls: true,
    keyPrefix: 'nova:prod:',
    disabled: false,
    connectTimeoutMs: 5000,
    commandTimeoutMs: 5000,
    maxRetriesPerRequest: 3,
  },
  
  encryption: {
    enabled: true,
    algorithm: 'aes-256-gcm',
    currentKeyId: 'prod-key-1',
  },
  
  auth: {
    jwtIssuer: 'novaos',
    jwtAudience: 'novaos-api',
    tokenExpirySeconds: 86400, // 24 hours
    required: true,
  },
  
  rateLimits: {
    api: { windowMs: 60000, maxRequests: 60 },
    ssrf: { windowMs: 60000, maxRequests: 10 },
    goalCreation: { windowMs: 60000, maxRequests: 5 },
    sparkGeneration: { windowMs: 60000, maxRequests: 10 },
    multiplier: 1.0,
  },
  
  ssrf: {
    allowedPorts: [80, 443],
    dnsTimeoutMs: 3000,
    requestTimeoutMs: 10000,
    maxResponseBytes: 1048576, // 1MB
    maxRedirects: 3,
    allowPrivateIps: false,
    allowLocalhost: false,
    validateCerts: true,
    preventDnsRebinding: true,
    blockedDomains: [
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '169.254.169.254',
      'metadata.google.internal',
    ],
  },
  
  llm: {
    provider: 'openai',
    model: 'gpt-4o',
    timeoutMs: 30000,
    maxTokens: 4000,
    maxInputTokens: 8000,
    temperature: 0.7,
    useMock: false,
  },
  
  swordLimits: {
    maxGoalsPerUser: 10,
    maxActiveGoals: 3,
    goalStatementMaxLength: 500,
    maxEscalationLevel: 3,
    maxRemindersPerStep: 3,
    maxConversationHistory: 50,
    minSparkMinutes: 2,
    maxSparkMinutes: 30,
    dailyStepGenerationHour: 6,
    morningSparkHour: 8,
    maxQuestsPerGoal: 20,
    maxStepsPerQuest: 30,
  },
  
  retention: {
    completedGoalsDays: 365,
    abandonedGoalsDays: 90,
    auditLogDays: 90,
    conversationDays: 365,
    memoryDays: 730,
  },
  
  verification: {
    enabled: true,
    required: false,
    cacheTTLSeconds: 300,
    maxCacheEntries: 1000,
    maxVerificationsPerRequest: 3,
    maxConcurrentVerifications: 2,
    trustedDomains: ['wikipedia.org', 'gov', 'edu', 'reuters.com', 'apnews.com'],
  },
  
  webFetch: {
    enabled: true,
    allowlist: [],
    blocklist: [
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '169.254.169.254',
      'metadata.google.internal',
    ],
    maxSizeBytes: 1048576,
    maxRedirects: 3,
    connectTimeoutMs: 5000,
    readTimeoutMs: 10000,
    totalTimeoutMs: 15000,
    dnsTimeoutMs: 3000,
  },
  
  observability: {
    debugMode: false,
    redactPII: true,
    logLevel: 'info',
    enableMetrics: true,
    enableTracing: false, // Disable verbose tracing in prod
  },
  
  cors: {
    allowedOrigins: [], // Set via environment - MUST be configured
    allowCredentials: true,
    maxAge: 86400,
  },
};

// ─────────────────────────────────────────────────────────────────────────────────
// DEFAULTS REGISTRY
// ─────────────────────────────────────────────────────────────────────────────────

const DEFAULTS_BY_ENVIRONMENT: Record<Environment, Partial<AppConfig>> = {
  development: DEVELOPMENT_DEFAULTS,
  staging: STAGING_DEFAULTS,
  production: PRODUCTION_DEFAULTS,
};

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Get defaults for a specific environment.
 */
export function getDefaults(environment: Environment): Partial<AppConfig> {
  return DEFAULTS_BY_ENVIRONMENT[environment];
}

/**
 * Get development defaults.
 */
export function getDevelopmentDefaults(): Partial<AppConfig> {
  return DEVELOPMENT_DEFAULTS;
}

/**
 * Get staging defaults.
 */
export function getStagingDefaults(): Partial<AppConfig> {
  return STAGING_DEFAULTS;
}

/**
 * Get production defaults.
 */
export function getProductionDefaults(): Partial<AppConfig> {
  return PRODUCTION_DEFAULTS;
}

/**
 * Check if an environment is production-like (staging or production).
 */
export function isProductionLike(environment: Environment): boolean {
  return environment === 'staging' || environment === 'production';
}

/**
 * Get the appropriate LLM model for an environment.
 */
export function getDefaultLLMModel(environment: Environment): string {
  const defaults = DEFAULTS_BY_ENVIRONMENT[environment];
  return defaults.llm?.model ?? 'gpt-4o-mini';
}

/**
 * Get rate limit multiplier for an environment.
 */
export function getDefaultRateLimitMultiplier(environment: Environment): number {
  const defaults = DEFAULTS_BY_ENVIRONMENT[environment];
  return defaults.rateLimits?.multiplier ?? 1.0;
}

// Re-export individual defaults for direct access
export {
  DEVELOPMENT_DEFAULTS,
  STAGING_DEFAULTS,
  PRODUCTION_DEFAULTS,
};
