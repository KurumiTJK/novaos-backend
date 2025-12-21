// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION LOADER — Environment-Aware Config Loading & Validation
// Sword System v3.0 — Phase 1: Configuration & Core Types
// ═══════════════════════════════════════════════════════════════════════════════

import {
  AppConfigSchema,
  validateConfig,
  formatConfigErrors,
  type AppConfig,
  type Environment,
} from './schema.js';
import { getDefaults } from './defaults.js';

// ─────────────────────────────────────────────────────────────────────────────────
// ENVIRONMENT HELPERS (matching existing patterns)
// ─────────────────────────────────────────────────────────────────────────────────

function envBool(key: string, defaultValue: boolean = false): boolean {
  const value = process.env[key]?.toLowerCase();
  if (value === undefined) return defaultValue;
  return value === 'true' || value === '1' || value === 'yes';
}

function envNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function envFloat(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

function envString(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

function envStringOptional(key: string): string | undefined {
  const value = process.env[key];
  return value && value.trim() !== '' ? value : undefined;
}

function envList(key: string, defaultValue: string[] = []): string[] {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

function envNumberList(key: string, defaultValue: number[] = []): number[] {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n));
}

// ─────────────────────────────────────────────────────────────────────────────────
// ENVIRONMENT DETECTION
// ─────────────────────────────────────────────────────────────────────────────────

function detectEnvironment(): Environment {
  const env = process.env.NODE_ENV?.toLowerCase();
  if (env === 'production' || env === 'prod') return 'production';
  if (env === 'staging' || env === 'stage') return 'staging';
  return 'development';
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONFIG BUILDER — Reads all environment variables
// ─────────────────────────────────────────────────────────────────────────────────

function buildConfigFromEnvironment(): Record<string, unknown> {
  const environment = detectEnvironment();
  const defaults = getDefaults(environment);
  
  return {
    environment,
    
    server: {
      port: envNumber('PORT', defaults.server?.port ?? 3000),
      host: envString('HOST', defaults.server?.host ?? '0.0.0.0'),
      shutdownTimeoutMs: envNumber('SHUTDOWN_TIMEOUT_MS', defaults.server?.shutdownTimeoutMs ?? 30000),
      trustProxy: envBool('TRUST_PROXY', defaults.server?.trustProxy ?? false),
    },
    
    redis: {
      host: envString('REDIS_HOST', defaults.redis?.host ?? 'localhost'),
      port: envNumber('REDIS_PORT', defaults.redis?.port ?? 6379),
      password: envStringOptional('REDIS_PASSWORD') ?? defaults.redis?.password,
      tls: envBool('REDIS_TLS', defaults.redis?.tls ?? false),
      keyPrefix: envString('REDIS_KEY_PREFIX', defaults.redis?.keyPrefix ?? 'nova:'),
      url: envStringOptional('REDIS_URL') ?? defaults.redis?.url,
      disabled: envBool('DISABLE_REDIS', defaults.redis?.disabled ?? false),
      connectTimeoutMs: envNumber('REDIS_CONNECT_TIMEOUT_MS', defaults.redis?.connectTimeoutMs ?? 5000),
      commandTimeoutMs: envNumber('REDIS_COMMAND_TIMEOUT_MS', defaults.redis?.commandTimeoutMs ?? 5000),
      maxRetriesPerRequest: envNumber('REDIS_MAX_RETRIES', defaults.redis?.maxRetriesPerRequest ?? 3),
    },
    
    encryption: {
      enabled: envBool('ENCRYPTION_ENABLED', defaults.encryption?.enabled ?? false),
      algorithm: envString('ENCRYPTION_ALGORITHM', defaults.encryption?.algorithm ?? 'aes-256-gcm'),
      currentKeyId: envString('ENCRYPTION_KEY_ID', defaults.encryption?.currentKeyId ?? 'key-1'),
    },
    
    auth: {
      jwtSecret: envStringOptional('JWT_SECRET'),
      jwtIssuer: envString('JWT_ISSUER', defaults.auth?.jwtIssuer ?? 'novaos'),
      jwtAudience: envString('JWT_AUDIENCE', defaults.auth?.jwtAudience ?? 'novaos-api'),
      tokenExpirySeconds: envNumber('JWT_EXPIRY_SECONDS', defaults.auth?.tokenExpirySeconds ?? 86400),
      required: envBool('REQUIRE_AUTH', defaults.auth?.required ?? false),
    },
    
    rateLimits: {
      api: {
        windowMs: envNumber('RATE_LIMIT_API_WINDOW_MS', defaults.rateLimits?.api?.windowMs ?? 60000),
        maxRequests: envNumber('RATE_LIMIT_API_MAX', defaults.rateLimits?.api?.maxRequests ?? 60),
      },
      ssrf: {
        windowMs: envNumber('RATE_LIMIT_SSRF_WINDOW_MS', defaults.rateLimits?.ssrf?.windowMs ?? 60000),
        maxRequests: envNumber('RATE_LIMIT_SSRF_MAX', defaults.rateLimits?.ssrf?.maxRequests ?? 10),
      },
      goalCreation: {
        windowMs: envNumber('RATE_LIMIT_GOAL_WINDOW_MS', defaults.rateLimits?.goalCreation?.windowMs ?? 60000),
        maxRequests: envNumber('RATE_LIMIT_GOAL_MAX', defaults.rateLimits?.goalCreation?.maxRequests ?? 5),
      },
      sparkGeneration: {
        windowMs: envNumber('RATE_LIMIT_SPARK_WINDOW_MS', defaults.rateLimits?.sparkGeneration?.windowMs ?? 60000),
        maxRequests: envNumber('RATE_LIMIT_SPARK_MAX', defaults.rateLimits?.sparkGeneration?.maxRequests ?? 10),
      },
      multiplier: envFloat('RATE_LIMIT_MULTIPLIER', defaults.rateLimits?.multiplier ?? 1.0),
    },
    
    ssrf: {
      allowedPorts: envNumberList('SSRF_ALLOWED_PORTS', defaults.ssrf?.allowedPorts ?? [80, 443]),
      dnsTimeoutMs: envNumber('SSRF_DNS_TIMEOUT_MS', defaults.ssrf?.dnsTimeoutMs ?? 3000),
      requestTimeoutMs: envNumber('SSRF_REQUEST_TIMEOUT_MS', defaults.ssrf?.requestTimeoutMs ?? 10000),
      maxResponseBytes: envNumber('SSRF_MAX_RESPONSE_BYTES', defaults.ssrf?.maxResponseBytes ?? 1048576),
      maxRedirects: envNumber('SSRF_MAX_REDIRECTS', defaults.ssrf?.maxRedirects ?? 3),
      allowPrivateIps: envBool('WEB_FETCH_ALLOW_PRIVATE_IPS', defaults.ssrf?.allowPrivateIps ?? false),
      allowLocalhost: envBool('WEB_FETCH_ALLOW_LOCALHOST', defaults.ssrf?.allowLocalhost ?? false),
      validateCerts: envBool('WEB_FETCH_VALIDATE_CERTS', defaults.ssrf?.validateCerts ?? true),
      preventDnsRebinding: envBool('WEB_FETCH_PREVENT_DNS_REBINDING', defaults.ssrf?.preventDnsRebinding ?? true),
      blockedDomains: envList('WEB_FETCH_BLOCKLIST', defaults.ssrf?.blockedDomains ?? []),
    },
    
    llm: {
      provider: envString('PREFERRED_PROVIDER', defaults.llm?.provider ?? 'openai'),
      model: envString('OPENAI_MODEL', defaults.llm?.model ?? 'gpt-4o'),
      timeoutMs: envNumber('LLM_TIMEOUT_MS', defaults.llm?.timeoutMs ?? 30000),
      maxTokens: envNumber('LLM_MAX_TOKENS', defaults.llm?.maxTokens ?? 4000),
      maxInputTokens: envNumber('LLM_MAX_INPUT_TOKENS', defaults.llm?.maxInputTokens ?? 8000),
      temperature: envFloat('LLM_TEMPERATURE', defaults.llm?.temperature ?? 0.7),
      useMock: envBool('USE_MOCK_PROVIDER', defaults.llm?.useMock ?? false),
      openaiApiKey: envStringOptional('OPENAI_API_KEY'),
      geminiApiKey: envStringOptional('GEMINI_API_KEY'),
    },
    
    externalApis: {
      youtube: {
        apiKey: envStringOptional('YOUTUBE_API_KEY'),
        quotaPerDay: envNumber('YOUTUBE_QUOTA_PER_DAY', defaults.externalApis?.youtube?.quotaPerDay ?? 10000),
      },
      github: {
        apiToken: envStringOptional('GITHUB_API_TOKEN'),
        quotaPerHour: envNumber('GITHUB_QUOTA_PER_HOUR', defaults.externalApis?.github?.quotaPerHour ?? 5000),
      },
      finnhub: {
        apiKey: envStringOptional('FINNHUB_API_KEY'),
        quotaPerMinute: envNumber('FINNHUB_QUOTA_PER_MINUTE', defaults.externalApis?.finnhub?.quotaPerMinute ?? 60),
      },
      openweathermap: {
        apiKey: envStringOptional('OPENWEATHERMAP_API_KEY'),
        quotaPerDay: envNumber('OPENWEATHERMAP_QUOTA_PER_DAY', defaults.externalApis?.openweathermap?.quotaPerDay ?? 1000),
      },
      tavily: {
        apiKey: envStringOptional('TAVILY_API_KEY'),
      },
      googleCse: {
        apiKey: envStringOptional('GOOGLE_CSE_API_KEY'),
        cseId: envStringOptional('GOOGLE_CSE_ID'),
      },
    },
    
    swordLimits: {
      maxGoalsPerUser: envNumber('MAX_GOALS_PER_USER', defaults.swordLimits?.maxGoalsPerUser ?? 10),
      maxActiveGoals: envNumber('MAX_ACTIVE_GOALS', defaults.swordLimits?.maxActiveGoals ?? 3),
      goalStatementMaxLength: envNumber('GOAL_STATEMENT_MAX_LENGTH', defaults.swordLimits?.goalStatementMaxLength ?? 500),
      maxEscalationLevel: envNumber('MAX_ESCALATION_LEVEL', defaults.swordLimits?.maxEscalationLevel ?? 3),
      maxRemindersPerStep: envNumber('MAX_REMINDERS_PER_STEP', defaults.swordLimits?.maxRemindersPerStep ?? 3),
      maxConversationHistory: envNumber('MAX_CONVERSATION_HISTORY', defaults.swordLimits?.maxConversationHistory ?? 50),
      minSparkMinutes: envNumber('MIN_SPARK_MINUTES', defaults.swordLimits?.minSparkMinutes ?? 2),
      maxSparkMinutes: envNumber('MAX_SPARK_MINUTES', defaults.swordLimits?.maxSparkMinutes ?? 30),
      dailyStepGenerationHour: envNumber('DAILY_STEP_GENERATION_HOUR', defaults.swordLimits?.dailyStepGenerationHour ?? 6),
      morningSparkHour: envNumber('MORNING_SPARK_HOUR', defaults.swordLimits?.morningSparkHour ?? 8),
      maxQuestsPerGoal: envNumber('MAX_QUESTS_PER_GOAL', defaults.swordLimits?.maxQuestsPerGoal ?? 20),
      maxStepsPerQuest: envNumber('MAX_STEPS_PER_QUEST', defaults.swordLimits?.maxStepsPerQuest ?? 30),
    },
    
    retention: {
      completedGoalsDays: envNumber('RETENTION_COMPLETED_GOALS_DAYS', defaults.retention?.completedGoalsDays ?? 365),
      abandonedGoalsDays: envNumber('RETENTION_ABANDONED_GOALS_DAYS', defaults.retention?.abandonedGoalsDays ?? 90),
      auditLogDays: envNumber('RETENTION_AUDIT_LOG_DAYS', defaults.retention?.auditLogDays ?? 90),
      conversationDays: envNumber('RETENTION_CONVERSATION_DAYS', defaults.retention?.conversationDays ?? 365),
      memoryDays: envNumber('RETENTION_MEMORY_DAYS', defaults.retention?.memoryDays ?? 730),
    },
    
    verification: {
      enabled: envBool('VERIFICATION_ENABLED', defaults.verification?.enabled ?? false),
      required: envBool('VERIFICATION_REQUIRED', defaults.verification?.required ?? false),
      cacheTTLSeconds: envNumber('VERIFICATION_CACHE_TTL_SECONDS', defaults.verification?.cacheTTLSeconds ?? 300),
      maxCacheEntries: envNumber('VERIFICATION_MAX_CACHE_ENTRIES', defaults.verification?.maxCacheEntries ?? 1000),
      maxVerificationsPerRequest: envNumber('VERIFICATION_MAX_PER_REQUEST', defaults.verification?.maxVerificationsPerRequest ?? 3),
      maxConcurrentVerifications: envNumber('VERIFICATION_MAX_CONCURRENT', defaults.verification?.maxConcurrentVerifications ?? 2),
      trustedDomains: envList('VERIFICATION_TRUSTED_DOMAINS', defaults.verification?.trustedDomains ?? []),
    },
    
    webFetch: {
      enabled: envBool('WEB_FETCH_ENABLED', defaults.webFetch?.enabled ?? false),
      allowlist: envList('WEB_FETCH_ALLOWLIST', defaults.webFetch?.allowlist ?? []),
      blocklist: envList('WEB_FETCH_BLOCKLIST', defaults.webFetch?.blocklist ?? []),
      maxSizeBytes: envNumber('WEB_FETCH_MAX_SIZE_BYTES', defaults.webFetch?.maxSizeBytes ?? 1048576),
      maxRedirects: envNumber('WEB_FETCH_MAX_REDIRECTS', defaults.webFetch?.maxRedirects ?? 3),
      connectTimeoutMs: envNumber('WEB_FETCH_CONNECT_TIMEOUT_MS', defaults.webFetch?.connectTimeoutMs ?? 5000),
      readTimeoutMs: envNumber('WEB_FETCH_READ_TIMEOUT_MS', defaults.webFetch?.readTimeoutMs ?? 10000),
      totalTimeoutMs: envNumber('WEB_FETCH_TOTAL_TIMEOUT_MS', defaults.webFetch?.totalTimeoutMs ?? 15000),
      dnsTimeoutMs: envNumber('WEB_FETCH_DNS_TIMEOUT_MS', defaults.webFetch?.dnsTimeoutMs ?? 3000),
    },
    
    observability: {
      debugMode: envBool('DEBUG', defaults.observability?.debugMode ?? false),
      redactPII: envBool('REDACT_PII', defaults.observability?.redactPII ?? true),
      logLevel: envString('LOG_LEVEL', defaults.observability?.logLevel ?? 'info'),
      enableMetrics: envBool('ENABLE_METRICS', defaults.observability?.enableMetrics ?? true),
      enableTracing: envBool('ENABLE_TRACING', defaults.observability?.enableTracing ?? false),
    },
    
    cors: {
      allowedOrigins: envList('ALLOWED_ORIGINS', defaults.cors?.allowedOrigins ?? []),
      allowCredentials: envBool('CORS_ALLOW_CREDENTIALS', defaults.cors?.allowCredentials ?? true),
      maxAge: envNumber('CORS_MAX_AGE', defaults.cors?.maxAge ?? 86400),
    },
    
    // Staging overrides (only applied when NODE_ENV=staging)
    ...(detectEnvironment() === 'staging' && {
      stagingOverrides: {
        openaiModel: envStringOptional('STAGING_OPENAI_MODEL'),
        geminiModel: envStringOptional('STAGING_GEMINI_MODEL'),
        maxRequestsPerMinute: envNumber('STAGING_MAX_REQUESTS_PER_MINUTE', 30),
        maxTokensPerRequest: envNumber('STAGING_MAX_TOKENS_PER_REQUEST', 1000),
        maxConversationMessages: envNumber('STAGING_MAX_CONVERSATION_MESSAGES', 20),
        requestTimeoutMs: envNumber('STAGING_REQUEST_TIMEOUT_MS', 15000),
        disableVerification: envBool('STAGING_DISABLE_VERIFICATION', false),
        disableWebFetch: envBool('STAGING_DISABLE_WEB_FETCH', false),
      },
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONFIG SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let configInstance: AppConfig | null = null;
let configFrozen = false;

/**
 * Load and validate configuration from environment variables.
 * 
 * This function:
 * 1. Reads all environment variables
 * 2. Merges with environment-specific defaults
 * 3. Validates against Zod schema
 * 4. Freezes the config object (immutable)
 * 5. Caches the result for subsequent calls
 * 
 * If validation fails, exits the process with error details.
 */
export function loadConfig(): AppConfig {
  // Return cached config if already loaded
  if (configInstance !== null) {
    return configInstance;
  }
  
  const rawConfig = buildConfigFromEnvironment();
  
  try {
    const validatedConfig = validateConfig(rawConfig);
    
    // Deep freeze to prevent mutation
    configInstance = deepFreeze(validatedConfig) as AppConfig;
    configFrozen = true;
    
    return configInstance;
  } catch (error) {
    if (error instanceof Error && 'errors' in error) {
      // Zod validation error
      const zodError = error as { errors: unknown };
      const messages = formatConfigErrors(zodError as Parameters<typeof formatConfigErrors>[0]);
      
      console.error('═══════════════════════════════════════════════════════════════');
      console.error('CONFIGURATION ERROR — Invalid configuration detected');
      console.error('═══════════════════════════════════════════════════════════════');
      console.error('');
      messages.forEach(msg => console.error(`  ✗ ${msg}`));
      console.error('');
      console.error('Please check your environment variables and try again.');
      console.error('═══════════════════════════════════════════════════════════════');
      
      process.exit(1);
    }
    
    // Unknown error
    console.error('CONFIGURATION ERROR:', error);
    process.exit(1);
  }
}

/**
 * Get the current configuration without reloading.
 * Throws if config hasn't been loaded yet.
 */
export function getConfig(): AppConfig {
  if (configInstance === null) {
    throw new Error('Configuration not loaded. Call loadConfig() first.');
  }
  return configInstance;
}

/**
 * Check if configuration has been loaded.
 */
export function isConfigLoaded(): boolean {
  return configInstance !== null;
}

/**
 * Reset configuration (for testing only).
 * @internal
 */
export function resetConfig(): void {
  configInstance = null;
  configFrozen = false;
}

/**
 * Load configuration for testing with custom overrides.
 * @internal
 */
export function loadTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  resetConfig();
  
  const rawConfig = buildConfigFromEnvironment();
  const merged = deepMerge(rawConfig, overrides);
  
  configInstance = deepFreeze(validateConfig(merged)) as AppConfig;
  configFrozen = true;
  
  return configInstance;
}

// ─────────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Deep freeze an object to prevent mutation.
 */
function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  Object.freeze(obj);
  
  for (const key of Object.keys(obj)) {
    const value = (obj as Record<string, unknown>)[key];
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  
  return obj;
}

/**
 * Deep merge two objects.
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  
  for (const key of Object.keys(source)) {
    const sourceValue = source[key as keyof T];
    const targetValue = target[key as keyof T];
    
    if (
      sourceValue !== null &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue !== null &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      result[key as keyof T] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as T[keyof T];
    } else if (sourceValue !== undefined) {
      result[key as keyof T] = sourceValue as T[keyof T];
    }
  }
  
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONVENIENCE ACCESSORS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Get the current environment.
 */
export function getEnvironment(): Environment {
  return getConfig().environment;
}

/**
 * Check if running in production.
 */
export function isProduction(): boolean {
  return getConfig().environment === 'production';
}

/**
 * Check if running in staging.
 */
export function isStaging(): boolean {
  return getConfig().environment === 'staging';
}

/**
 * Check if running in development.
 */
export function isDevelopment(): boolean {
  return getConfig().environment === 'development';
}

/**
 * Check if running in production-like environment (staging or production).
 */
export function isProductionLike(): boolean {
  const env = getConfig().environment;
  return env === 'production' || env === 'staging';
}

/**
 * Check if debug mode is enabled.
 */
export function isDebugMode(): boolean {
  return getConfig().observability.debugMode;
}

/**
 * Check if verification capability is available.
 */
export function canVerify(): boolean {
  const config = getConfig();
  return config.verification.enabled && config.webFetch.enabled;
}

/**
 * Check if web fetch is available.
 */
export function canFetch(): boolean {
  return getConfig().webFetch.enabled;
}

/**
 * Get the LLM configuration.
 */
export function getLLMConfig() {
  return getConfig().llm;
}

/**
 * Get the Sword limits configuration.
 */
export function getSwordLimits() {
  return getConfig().swordLimits;
}

// ─────────────────────────────────────────────────────────────────────────────────
// RE-EXPORTS FOR CONVENIENCE
// ─────────────────────────────────────────────────────────────────────────────────

export type { AppConfig, Environment } from './schema.js';
export {
  AppConfigSchema,
  ServerConfigSchema,
  RedisConfigSchema,
  LLMConfigSchema,
  SwordLimitsConfigSchema,
} from './schema.js';
