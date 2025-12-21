// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION SCHEMA — Zod-Validated Configuration Types
// Sword System v3.0 — Phase 1: Configuration & Core Types
// ═══════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────────
// ENVIRONMENT
// ─────────────────────────────────────────────────────────────────────────────────

export const EnvironmentSchema = z.enum(['development', 'staging', 'production']);
export type Environment = z.infer<typeof EnvironmentSchema>;

// ─────────────────────────────────────────────────────────────────────────────────
// SERVER
// ─────────────────────────────────────────────────────────────────────────────────

export const ServerConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(3000),
  host: z.string().default('0.0.0.0'),
  shutdownTimeoutMs: z.number().int().min(0).default(30000),
  trustProxy: z.boolean().default(false),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────────
// REDIS
// ─────────────────────────────────────────────────────────────────────────────────

export const RedisConfigSchema = z.object({
  host: z.string().default('localhost'),
  port: z.number().int().min(1).max(65535).default(6379),
  password: z.string().optional(),
  tls: z.boolean().default(false),
  keyPrefix: z.string().default('nova:'),
  url: z.string().url().optional(),
  disabled: z.boolean().default(false),
  connectTimeoutMs: z.number().int().min(0).default(5000),
  commandTimeoutMs: z.number().int().min(0).default(5000),
  maxRetriesPerRequest: z.number().int().min(0).default(3),
});

export type RedisConfig = z.infer<typeof RedisConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────────
// ENCRYPTION
// ─────────────────────────────────────────────────────────────────────────────────

export const EncryptionAlgorithmSchema = z.enum(['aes-256-gcm', 'aes-256-cbc']);

export const EncryptionConfigSchema = z.object({
  enabled: z.boolean().default(false),
  algorithm: EncryptionAlgorithmSchema.default('aes-256-gcm'),
  currentKeyId: z.string().default('key-1'),
});

export type EncryptionConfig = z.infer<typeof EncryptionConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────────
// AUTHENTICATION
// ─────────────────────────────────────────────────────────────────────────────────

export const AuthConfigSchema = z.object({
  jwtSecret: z.string().min(32).optional(),
  jwtIssuer: z.string().default('novaos'),
  jwtAudience: z.string().default('novaos-api'),
  tokenExpirySeconds: z.number().int().min(60).default(86400), // 24 hours
  required: z.boolean().default(false),
});

export type AuthConfig = z.infer<typeof AuthConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────────
// RATE LIMITS
// ─────────────────────────────────────────────────────────────────────────────────

export const RateLimitRuleSchema = z.object({
  windowMs: z.number().int().min(1000).default(60000), // 1 minute
  maxRequests: z.number().int().min(1).default(60),
});

export const RateLimitsConfigSchema = z.object({
  api: RateLimitRuleSchema.default({ windowMs: 60000, maxRequests: 60 }),
  ssrf: RateLimitRuleSchema.default({ windowMs: 60000, maxRequests: 10 }),
  goalCreation: RateLimitRuleSchema.default({ windowMs: 60000, maxRequests: 5 }),
  sparkGeneration: RateLimitRuleSchema.default({ windowMs: 60000, maxRequests: 10 }),
  multiplier: z.number().min(0.1).max(10).default(1.0),
});

export type RateLimitsConfig = z.infer<typeof RateLimitsConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────────
// SSRF PROTECTION
// ─────────────────────────────────────────────────────────────────────────────────

export const SSRFConfigSchema = z.object({
  allowedPorts: z.array(z.number().int().min(1).max(65535)).default([80, 443]),
  dnsTimeoutMs: z.number().int().min(100).default(3000),
  requestTimeoutMs: z.number().int().min(100).default(10000),
  maxResponseBytes: z.number().int().min(1024).default(1048576), // 1MB
  maxRedirects: z.number().int().min(0).max(10).default(3),
  allowPrivateIps: z.boolean().default(false),
  allowLocalhost: z.boolean().default(false),
  validateCerts: z.boolean().default(true),
  preventDnsRebinding: z.boolean().default(true),
  blockedDomains: z.array(z.string()).default([
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '169.254.169.254',
    'metadata.google.internal',
  ]),
});

export type SSRFConfig = z.infer<typeof SSRFConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────────
// LLM PROVIDER
// ─────────────────────────────────────────────────────────────────────────────────

export const LLMProviderSchema = z.enum(['openai', 'gemini', 'mock']);

export const LLMConfigSchema = z.object({
  provider: LLMProviderSchema.default('openai'),
  model: z.string().default('gpt-4o'),
  timeoutMs: z.number().int().min(1000).default(30000),
  maxTokens: z.number().int().min(1).default(4000),
  maxInputTokens: z.number().int().min(1).default(8000),
  temperature: z.number().min(0).max(2).default(0.7),
  useMock: z.boolean().default(false),
  openaiApiKey: z.string().optional(),
  geminiApiKey: z.string().optional(),
});

export type LLMConfig = z.infer<typeof LLMConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────────
// EXTERNAL APIS
// ─────────────────────────────────────────────────────────────────────────────────

export const ExternalApisConfigSchema = z.object({
  youtube: z.object({
    apiKey: z.string().optional(),
    quotaPerDay: z.number().int().min(0).default(10000),
  }).default({}),
  github: z.object({
    apiToken: z.string().optional(),
    quotaPerHour: z.number().int().min(0).default(5000),
  }).default({}),
  finnhub: z.object({
    apiKey: z.string().optional(),
    quotaPerMinute: z.number().int().min(0).default(60),
  }).default({}),
  openweathermap: z.object({
    apiKey: z.string().optional(),
    quotaPerDay: z.number().int().min(0).default(1000),
  }).default({}),
  tavily: z.object({
    apiKey: z.string().optional(),
  }).default({}),
  googleCse: z.object({
    apiKey: z.string().optional(),
    cseId: z.string().optional(),
  }).default({}),
});

export type ExternalApisConfig = z.infer<typeof ExternalApisConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────────
// SWORD SYSTEM LIMITS
// ─────────────────────────────────────────────────────────────────────────────────

export const SwordLimitsConfigSchema = z.object({
  // Goal limits
  maxGoalsPerUser: z.number().int().min(1).max(100).default(10),
  maxActiveGoals: z.number().int().min(1).max(20).default(3),
  goalStatementMaxLength: z.number().int().min(50).max(2000).default(500),
  
  // Escalation
  maxEscalationLevel: z.number().int().min(1).max(10).default(3),
  maxRemindersPerStep: z.number().int().min(1).max(10).default(3),
  
  // Conversation
  maxConversationHistory: z.number().int().min(1).max(100).default(50),
  
  // Spark timing
  minSparkMinutes: z.number().int().min(1).max(60).default(2),
  maxSparkMinutes: z.number().int().min(1).max(120).default(30),
  
  // Scheduling
  dailyStepGenerationHour: z.number().int().min(0).max(23).default(6),
  morningSparkHour: z.number().int().min(0).max(23).default(8),
  
  // Quest limits
  maxQuestsPerGoal: z.number().int().min(1).max(50).default(20),
  maxStepsPerQuest: z.number().int().min(1).max(100).default(30),
});

export type SwordLimitsConfig = z.infer<typeof SwordLimitsConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────────
// DATA RETENTION
// ─────────────────────────────────────────────────────────────────────────────────

export const RetentionConfigSchema = z.object({
  completedGoalsDays: z.number().int().min(1).default(365),
  abandonedGoalsDays: z.number().int().min(1).default(90),
  auditLogDays: z.number().int().min(1).default(90),
  conversationDays: z.number().int().min(1).default(365),
  memoryDays: z.number().int().min(1).default(730), // 2 years
});

export type RetentionConfig = z.infer<typeof RetentionConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────────
// VERIFICATION (from existing config)
// ─────────────────────────────────────────────────────────────────────────────────

export const VerificationConfigSchema = z.object({
  enabled: z.boolean().default(false),
  required: z.boolean().default(false),
  cacheTTLSeconds: z.number().int().min(0).default(300),
  maxCacheEntries: z.number().int().min(0).default(1000),
  maxVerificationsPerRequest: z.number().int().min(1).default(3),
  maxConcurrentVerifications: z.number().int().min(1).default(2),
  trustedDomains: z.array(z.string()).default([
    'wikipedia.org',
    'gov',
    'edu',
    'reuters.com',
    'apnews.com',
  ]),
});

export type VerificationConfig = z.infer<typeof VerificationConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────────
// WEB FETCH (from existing config)
// ─────────────────────────────────────────────────────────────────────────────────

export const WebFetchConfigSchema = z.object({
  enabled: z.boolean().default(false),
  allowlist: z.array(z.string()).default([]),
  blocklist: z.array(z.string()).default([
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '169.254.169.254',
    'metadata.google.internal',
  ]),
  maxSizeBytes: z.number().int().min(1024).default(1048576),
  maxRedirects: z.number().int().min(0).max(10).default(3),
  connectTimeoutMs: z.number().int().min(100).default(5000),
  readTimeoutMs: z.number().int().min(100).default(10000),
  totalTimeoutMs: z.number().int().min(100).default(15000),
  dnsTimeoutMs: z.number().int().min(100).default(3000),
});

export type WebFetchConfig = z.infer<typeof WebFetchConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────────
// OBSERVABILITY
// ─────────────────────────────────────────────────────────────────────────────────

export const ObservabilityConfigSchema = z.object({
  debugMode: z.boolean().default(false),
  redactPII: z.boolean().default(true),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  enableMetrics: z.boolean().default(true),
  enableTracing: z.boolean().default(false),
});

export type ObservabilityConfig = z.infer<typeof ObservabilityConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────────────────────────────────────────

export const CorsConfigSchema = z.object({
  allowedOrigins: z.array(z.string()).default(['http://localhost:3000', 'http://localhost:5173']),
  allowCredentials: z.boolean().default(true),
  maxAge: z.number().int().min(0).default(86400),
});

export type CorsConfig = z.infer<typeof CorsConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────────
// STAGING OVERRIDES
// ─────────────────────────────────────────────────────────────────────────────────

export const StagingOverridesSchema = z.object({
  openaiModel: z.string().optional(),
  geminiModel: z.string().optional(),
  maxRequestsPerMinute: z.number().int().min(1).optional(),
  maxTokensPerRequest: z.number().int().min(1).optional(),
  maxConversationMessages: z.number().int().min(1).optional(),
  requestTimeoutMs: z.number().int().min(1000).optional(),
  disableVerification: z.boolean().optional(),
  disableWebFetch: z.boolean().optional(),
});

export type StagingOverrides = z.infer<typeof StagingOverridesSchema>;

// ─────────────────────────────────────────────────────────────────────────────────
// COMPLETE APPLICATION CONFIG
// ─────────────────────────────────────────────────────────────────────────────────

export const AppConfigSchema = z.object({
  environment: EnvironmentSchema.default('development'),
  server: ServerConfigSchema.default({}),
  redis: RedisConfigSchema.default({}),
  encryption: EncryptionConfigSchema.default({}),
  auth: AuthConfigSchema.default({}),
  rateLimits: RateLimitsConfigSchema.default({}),
  ssrf: SSRFConfigSchema.default({}),
  llm: LLMConfigSchema.default({}),
  externalApis: ExternalApisConfigSchema.default({}),
  swordLimits: SwordLimitsConfigSchema.default({}),
  retention: RetentionConfigSchema.default({}),
  verification: VerificationConfigSchema.default({}),
  webFetch: WebFetchConfigSchema.default({}),
  observability: ObservabilityConfigSchema.default({}),
  cors: CorsConfigSchema.default({}),
  stagingOverrides: StagingOverridesSchema.optional(),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────────
// VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Validate configuration and return typed result.
 * Throws ZodError if validation fails.
 */
export function validateConfig(config: unknown): AppConfig {
  return AppConfigSchema.parse(config);
}

/**
 * Safely validate configuration, returning success/error result.
 */
export function safeValidateConfig(config: unknown): {
  success: true;
  data: AppConfig;
} | {
  success: false;
  error: z.ZodError;
} {
  const result = AppConfigSchema.safeParse(config);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Format Zod errors into readable messages.
 */
export function formatConfigErrors(error: z.ZodError): string[] {
  return error.errors.map((e) => {
    const path = e.path.join('.');
    return `${path}: ${e.message}`;
  });
}

/**
 * Get default configuration for an environment.
 */
export function getDefaultConfig(environment: Environment = 'development'): AppConfig {
  return AppConfigSchema.parse({ environment });
}
