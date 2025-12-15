// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG MODULE — Feature Flags, Environment Config, Capability Control
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// ENVIRONMENT HELPERS
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

function envString(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

function envList(key: string, defaultValue: string[] = []): string[] {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────────
// FEATURE FLAGS
// ─────────────────────────────────────────────────────────────────────────────────

export interface FeatureFlags {
  // Verification
  verificationEnabled: boolean;
  verificationRequired: boolean;  // If true, fails without verification
  
  // Web fetch
  webFetchEnabled: boolean;
  webFetchAllowlist: string[];    // Empty = allow all (with SSRF protection)
  webFetchBlocklist: string[];    // Always blocked domains
  
  // Model providers
  mockProviderOnly: boolean;
  preferredProvider: 'openai' | 'gemini' | 'mock';
  
  // Auth
  authRequired: boolean;
  
  // Rate limits
  rateLimitMultiplier: number;    // 1.0 = normal, 0.5 = stricter, 2.0 = relaxed
  
  // Logging
  debugMode: boolean;
  redactPII: boolean;
}

export function loadFeatureFlags(): FeatureFlags {
  return {
    // Verification - OFF by default for safety
    verificationEnabled: envBool('VERIFICATION_ENABLED', false),
    verificationRequired: envBool('VERIFICATION_REQUIRED', false),
    
    // Web fetch - OFF by default
    webFetchEnabled: envBool('WEB_FETCH_ENABLED', false),
    webFetchAllowlist: envList('WEB_FETCH_ALLOWLIST'),
    webFetchBlocklist: envList('WEB_FETCH_BLOCKLIST', [
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '169.254.169.254',  // AWS metadata
      'metadata.google.internal',
    ]),
    
    // Providers
    mockProviderOnly: envBool('USE_MOCK_PROVIDER', false),
    preferredProvider: envString('PREFERRED_PROVIDER', 'openai') as 'openai' | 'gemini' | 'mock',
    
    // Auth
    authRequired: envBool('REQUIRE_AUTH', false),
    
    // Rate limits
    rateLimitMultiplier: parseFloat(process.env.RATE_LIMIT_MULTIPLIER ?? '1.0') || 1.0,
    
    // Logging
    debugMode: envBool('DEBUG', false),
    redactPII: envBool('REDACT_PII', true),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// WEB FETCH CONFIG
// ─────────────────────────────────────────────────────────────────────────────────

export interface WebFetchConfig {
  // Timeouts
  connectTimeoutMs: number;
  readTimeoutMs: number;
  totalTimeoutMs: number;
  
  // Size limits
  maxResponseSizeBytes: number;
  maxRedirects: number;
  
  // Security
  allowPrivateIPs: boolean;
  allowLocalhost: boolean;
  validateCertificates: boolean;
  
  // DNS
  dnsResolutionTimeoutMs: number;
  preventDNSRebinding: boolean;
  
  // Domains
  allowlist: string[];
  blocklist: string[];
  
  // Headers
  userAgent: string;
  acceptHeader: string;
}

export function loadWebFetchConfig(): WebFetchConfig {
  const flags = loadFeatureFlags();
  
  return {
    // Timeouts
    connectTimeoutMs: envNumber('WEB_FETCH_CONNECT_TIMEOUT_MS', 5000),
    readTimeoutMs: envNumber('WEB_FETCH_READ_TIMEOUT_MS', 10000),
    totalTimeoutMs: envNumber('WEB_FETCH_TOTAL_TIMEOUT_MS', 15000),
    
    // Size limits (default 1MB)
    maxResponseSizeBytes: envNumber('WEB_FETCH_MAX_SIZE_BYTES', 1024 * 1024),
    maxRedirects: envNumber('WEB_FETCH_MAX_REDIRECTS', 3),
    
    // Security - strict by default
    allowPrivateIPs: envBool('WEB_FETCH_ALLOW_PRIVATE_IPS', false),
    allowLocalhost: envBool('WEB_FETCH_ALLOW_LOCALHOST', false),
    validateCertificates: envBool('WEB_FETCH_VALIDATE_CERTS', true),
    
    // DNS
    dnsResolutionTimeoutMs: envNumber('WEB_FETCH_DNS_TIMEOUT_MS', 3000),
    preventDNSRebinding: envBool('WEB_FETCH_PREVENT_DNS_REBINDING', true),
    
    // Domains
    allowlist: flags.webFetchAllowlist,
    blocklist: flags.webFetchBlocklist,
    
    // Headers
    userAgent: envString('WEB_FETCH_USER_AGENT', 'NovaOS/1.0 (Verification Bot)'),
    acceptHeader: envString('WEB_FETCH_ACCEPT', 'text/html,application/json,text/plain'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// VERIFICATION CONFIG
// ─────────────────────────────────────────────────────────────────────────────────

export interface VerificationConfig {
  enabled: boolean;
  required: boolean;
  
  // Cache
  cacheTTLSeconds: number;
  maxCacheEntries: number;
  
  // Limits
  maxVerificationsPerRequest: number;
  maxConcurrentVerifications: number;
  
  // Trusted sources (prioritized for verification)
  trustedDomains: string[];
}

export function loadVerificationConfig(): VerificationConfig {
  const flags = loadFeatureFlags();
  
  return {
    enabled: flags.verificationEnabled,
    required: flags.verificationRequired,
    
    // Cache
    cacheTTLSeconds: envNumber('VERIFICATION_CACHE_TTL_SECONDS', 300), // 5 minutes
    maxCacheEntries: envNumber('VERIFICATION_MAX_CACHE_ENTRIES', 1000),
    
    // Limits
    maxVerificationsPerRequest: envNumber('VERIFICATION_MAX_PER_REQUEST', 3),
    maxConcurrentVerifications: envNumber('VERIFICATION_MAX_CONCURRENT', 2),
    
    // Trusted sources
    trustedDomains: envList('VERIFICATION_TRUSTED_DOMAINS', [
      'wikipedia.org',
      'gov',
      'edu',
      'reuters.com',
      'apnews.com',
    ]),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// STAGING MODE
// ─────────────────────────────────────────────────────────────────────────────────

export type Environment = 'development' | 'staging' | 'production';

export interface EnvironmentConfig {
  environment: Environment;
  isProduction: boolean;
  isStaging: boolean;
  isDevelopment: boolean;
}

export function loadEnvironmentConfig(): EnvironmentConfig {
  const env = envString('NODE_ENV', 'development') as Environment;
  
  return {
    environment: env,
    isProduction: env === 'production',
    isStaging: env === 'staging',
    isDevelopment: env === 'development',
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// STAGING MODE CONFIG (cheaper models, stricter limits)
// ─────────────────────────────────────────────────────────────────────────────────

export interface StagingConfig {
  // Model selection
  preferCheaperModels: boolean;
  openaiModel: string;
  geminiModel: string;
  
  // Rate limits (multiplied by base limits)
  rateLimitMultiplier: number;
  
  // Request limits
  maxRequestsPerMinute: number;
  maxTokensPerRequest: number;
  maxConversationMessages: number;
  
  // Timeouts
  requestTimeoutMs: number;
  
  // Features
  disableVerification: boolean;
  disableWebFetch: boolean;
}

export function loadStagingConfig(): StagingConfig {
  const envConfig = loadEnvironmentConfig();
  
  // Staging uses cheaper models and stricter limits
  if (envConfig.isStaging) {
    return {
      preferCheaperModels: true,
      openaiModel: envString('STAGING_OPENAI_MODEL', 'gpt-4o-mini'),
      geminiModel: envString('STAGING_GEMINI_MODEL', 'gemini-1.5-flash'),
      rateLimitMultiplier: 0.5,  // Half the normal limits
      maxRequestsPerMinute: envNumber('STAGING_MAX_REQUESTS_PER_MINUTE', 30),
      maxTokensPerRequest: envNumber('STAGING_MAX_TOKENS_PER_REQUEST', 1000),
      maxConversationMessages: envNumber('STAGING_MAX_CONVERSATION_MESSAGES', 20),
      requestTimeoutMs: envNumber('STAGING_REQUEST_TIMEOUT_MS', 15000),
      disableVerification: envBool('STAGING_DISABLE_VERIFICATION', true),
      disableWebFetch: envBool('STAGING_DISABLE_WEB_FETCH', true),
    };
  }
  
  // Production uses full capabilities
  if (envConfig.isProduction) {
    return {
      preferCheaperModels: false,
      openaiModel: envString('OPENAI_MODEL', 'gpt-4o'),
      geminiModel: envString('GEMINI_MODEL', 'gemini-1.5-pro'),
      rateLimitMultiplier: 1.0,
      maxRequestsPerMinute: envNumber('MAX_REQUESTS_PER_MINUTE', 60),
      maxTokensPerRequest: envNumber('MAX_TOKENS_PER_REQUEST', 4000),
      maxConversationMessages: envNumber('MAX_CONVERSATION_MESSAGES', 100),
      requestTimeoutMs: envNumber('REQUEST_TIMEOUT_MS', 30000),
      disableVerification: false,
      disableWebFetch: false,
    };
  }
  
  // Development - relaxed limits for testing
  return {
    preferCheaperModels: envBool('USE_CHEAPER_MODELS', true),
    openaiModel: envString('OPENAI_MODEL', 'gpt-4o-mini'),
    geminiModel: envString('GEMINI_MODEL', 'gemini-1.5-flash'),
    rateLimitMultiplier: 2.0,  // Double limits for dev
    maxRequestsPerMinute: envNumber('MAX_REQUESTS_PER_MINUTE', 120),
    maxTokensPerRequest: envNumber('MAX_TOKENS_PER_REQUEST', 4000),
    maxConversationMessages: envNumber('MAX_CONVERSATION_MESSAGES', 100),
    requestTimeoutMs: envNumber('REQUEST_TIMEOUT_MS', 60000),
    disableVerification: false,
    disableWebFetch: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// COMBINED CONFIG
// ─────────────────────────────────────────────────────────────────────────────────

export interface NovaConfig {
  env: EnvironmentConfig;
  features: FeatureFlags;
  webFetch: WebFetchConfig;
  verification: VerificationConfig;
  staging: StagingConfig;
}

let cachedConfig: NovaConfig | null = null;

export function loadConfig(): NovaConfig {
  if (cachedConfig) return cachedConfig;
  
  cachedConfig = {
    env: loadEnvironmentConfig(),
    features: loadFeatureFlags(),
    webFetch: loadWebFetchConfig(),
    verification: loadVerificationConfig(),
    staging: loadStagingConfig(),
  };
  
  return cachedConfig;
}

export function reloadConfig(): NovaConfig {
  cachedConfig = null;
  return loadConfig();
}

// ─────────────────────────────────────────────────────────────────────────────────
// CAPABILITY CHECKS
// ─────────────────────────────────────────────────────────────────────────────────

export function canVerify(): boolean {
  const config = loadConfig();
  return config.features.verificationEnabled && config.features.webFetchEnabled;
}

export function mustVerify(): boolean {
  const config = loadConfig();
  return config.verification.required;
}

export function canFetchUrl(url: string): { allowed: boolean; reason?: string } {
  const config = loadConfig();
  
  if (!config.features.webFetchEnabled) {
    return { allowed: false, reason: 'Web fetch disabled' };
  }
  
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    
    // Check blocklist first
    for (const blocked of config.webFetch.blocklist) {
      if (hostname === blocked || hostname.endsWith('.' + blocked)) {
        return { allowed: false, reason: `Domain blocked: ${blocked}` };
      }
    }
    
    // Check allowlist if configured
    if (config.webFetch.allowlist.length > 0) {
      const allowed = config.webFetch.allowlist.some(domain => 
        hostname === domain || hostname.endsWith('.' + domain)
      );
      if (!allowed) {
        return { allowed: false, reason: 'Domain not in allowlist' };
      }
    }
    
    // Check protocol
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { allowed: false, reason: 'Invalid protocol' };
    }
    
    return { allowed: true };
  } catch {
    return { allowed: false, reason: 'Invalid URL' };
  }
}
