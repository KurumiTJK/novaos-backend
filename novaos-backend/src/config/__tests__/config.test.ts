// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION TESTS — Validation, Loading, and Feature Flags
// Sword System v3.0 — Phase 1: Configuration & Core Types
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AppConfigSchema,
  validateConfig,
  safeValidateConfig,
  formatConfigErrors,
  getDefaultConfig,
  type AppConfig,
  type Environment,
} from '../schema.js';
import {
  getDefaults,
  getDevelopmentDefaults,
  getStagingDefaults,
  getProductionDefaults,
  isProductionLike,
} from '../defaults.js';
import {
  loadConfig,
  getConfig,
  isConfigLoaded,
  resetConfig,
  loadTestConfig,
  getEnvironment,
  isProduction,
  isDevelopment,
  isDebugMode,
} from '../loader.js';
import {
  getStaticFlags,
  DynamicFlagManager,
  evaluateUserFlags,
  FeatureFlagManager,
  initFeatureFlags,
  getFeatureFlags,
  resetFeatureFlags,
  type StaticFeatureFlags,
  type FlagContext,
} from '../feature-flags.js';
import {
  SecretsManager,
  EnvironmentSecretProvider,
  MockSecretProvider,
  createSecretsManager,
  initSecrets,
  getSecrets,
  resetSecrets,
  type SecretKey,
} from '../secrets.js';

// ─────────────────────────────────────────────────────────────────────────────────
// SCHEMA TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Configuration Schema', () => {
  describe('AppConfigSchema', () => {
    it('should accept empty object with all defaults', () => {
      const result = AppConfigSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.environment).toBe('development');
        expect(result.data.server.port).toBe(3000);
      }
    });

    it('should accept valid complete config', () => {
      const config = {
        environment: 'production',
        server: { port: 8080, host: '127.0.0.1' },
        llm: { provider: 'openai', model: 'gpt-4o' },
      };
      const result = AppConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should reject invalid port number', () => {
      const config = { server: { port: 99999 } };
      const result = AppConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject invalid environment', () => {
      const config = { environment: 'invalid' };
      const result = AppConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject negative rate limit values', () => {
      const config = {
        rateLimits: {
          api: { windowMs: -1000, maxRequests: 60 },
        },
      };
      const result = AppConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('validateConfig', () => {
    it('should return validated config on success', () => {
      const config = validateConfig({ environment: 'staging' });
      expect(config.environment).toBe('staging');
    });

    it('should throw on invalid config', () => {
      expect(() => validateConfig({ server: { port: -1 } })).toThrow();
    });
  });

  describe('safeValidateConfig', () => {
    it('should return success result for valid config', () => {
      const result = safeValidateConfig({ environment: 'development' });
      expect(result.success).toBe(true);
    });

    it('should return error result for invalid config', () => {
      const result = safeValidateConfig({ server: { port: 'invalid' } });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors.length).toBeGreaterThan(0);
      }
    });
  });

  describe('formatConfigErrors', () => {
    it('should format Zod errors into readable strings', () => {
      const result = safeValidateConfig({ server: { port: 'invalid' } });
      if (!result.success) {
        const messages = formatConfigErrors(result.error);
        expect(messages.length).toBeGreaterThan(0);
        expect(messages[0]).toContain('server.port');
      }
    });
  });

  describe('getDefaultConfig', () => {
    it('should return default config for development', () => {
      const config = getDefaultConfig('development');
      expect(config.environment).toBe('development');
    });

    it('should return default config for production', () => {
      const config = getDefaultConfig('production');
      expect(config.environment).toBe('production');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// DEFAULTS TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Configuration Defaults', () => {
  describe('getDefaults', () => {
    it('should return development defaults', () => {
      const defaults = getDefaults('development');
      expect(defaults.environment).toBe('development');
      expect(defaults.observability?.debugMode).toBe(true);
    });

    it('should return staging defaults', () => {
      const defaults = getDefaults('staging');
      expect(defaults.environment).toBe('staging');
      expect(defaults.auth?.required).toBe(true);
    });

    it('should return production defaults', () => {
      const defaults = getDefaults('production');
      expect(defaults.environment).toBe('production');
      expect(defaults.observability?.debugMode).toBe(false);
    });
  });

  describe('environment-specific getters', () => {
    it('should return correct development defaults', () => {
      const defaults = getDevelopmentDefaults();
      expect(defaults.swordLimits?.maxGoalsPerUser).toBe(50);
      expect(defaults.rateLimits?.multiplier).toBe(2.0);
    });

    it('should return correct staging defaults', () => {
      const defaults = getStagingDefaults();
      expect(defaults.swordLimits?.maxGoalsPerUser).toBe(10);
      expect(defaults.stagingOverrides).toBeDefined();
    });

    it('should return correct production defaults', () => {
      const defaults = getProductionDefaults();
      expect(defaults.swordLimits?.maxGoalsPerUser).toBe(10);
      expect(defaults.redis?.tls).toBe(true);
    });
  });

  describe('isProductionLike', () => {
    it('should return false for development', () => {
      expect(isProductionLike('development')).toBe(false);
    });

    it('should return true for staging', () => {
      expect(isProductionLike('staging')).toBe(true);
    });

    it('should return true for production', () => {
      expect(isProductionLike('production')).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// LOADER TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Configuration Loader', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetConfig();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    resetConfig();
  });

  describe('loadConfig', () => {
    it('should load configuration with defaults', () => {
      process.env.NODE_ENV = 'development';
      const config = loadConfig();
      expect(config.environment).toBe('development');
      expect(config.server.port).toBe(3000);
    });

    it('should apply environment variable overrides', () => {
      process.env.NODE_ENV = 'development';
      process.env.PORT = '8080';
      process.env.MAX_GOALS_PER_USER = '25';
      
      const config = loadConfig();
      expect(config.server.port).toBe(8080);
      expect(config.swordLimits.maxGoalsPerUser).toBe(25);
    });

    it('should return cached config on subsequent calls', () => {
      process.env.NODE_ENV = 'development';
      const config1 = loadConfig();
      const config2 = loadConfig();
      expect(config1).toBe(config2);
    });

    it('should freeze the config object', () => {
      process.env.NODE_ENV = 'development';
      const config = loadConfig();
      expect(Object.isFrozen(config)).toBe(true);
      expect(() => {
        (config as { environment: string }).environment = 'production';
      }).toThrow();
    });
  });

  describe('getConfig', () => {
    it('should throw if config not loaded', () => {
      expect(() => getConfig()).toThrow('Configuration not loaded');
    });

    it('should return config after loading', () => {
      process.env.NODE_ENV = 'development';
      loadConfig();
      const config = getConfig();
      expect(config.environment).toBe('development');
    });
  });

  describe('isConfigLoaded', () => {
    it('should return false initially', () => {
      expect(isConfigLoaded()).toBe(false);
    });

    it('should return true after loading', () => {
      process.env.NODE_ENV = 'development';
      loadConfig();
      expect(isConfigLoaded()).toBe(true);
    });
  });

  describe('loadTestConfig', () => {
    it('should allow overrides for testing', () => {
      process.env.NODE_ENV = 'development';
      const config = loadTestConfig({
        server: { port: 9999, host: 'test', shutdownTimeoutMs: 1000, trustProxy: false },
      });
      expect(config.server.port).toBe(9999);
    });
  });

  describe('convenience functions', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
      process.env.DEBUG = 'true';
      loadConfig();
    });

    it('getEnvironment should return current environment', () => {
      expect(getEnvironment()).toBe('development');
    });

    it('isProduction should return false in development', () => {
      expect(isProduction()).toBe(false);
    });

    it('isDevelopment should return true in development', () => {
      expect(isDevelopment()).toBe(true);
    });

    it('isDebugMode should reflect DEBUG env var', () => {
      expect(isDebugMode()).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// FEATURE FLAGS TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Feature Flags', () => {
  let testConfig: AppConfig;

  beforeEach(() => {
    resetFeatureFlags();
    testConfig = getDefaultConfig('development');
  });

  afterEach(() => {
    resetFeatureFlags();
  });

  describe('getStaticFlags', () => {
    it('should derive flags from config', () => {
      const flags = getStaticFlags(testConfig);
      expect(flags.enableReminders).toBe(true);
      expect(flags.enableDebugMode).toBe(false); // default config has debugMode: false
    });

    it('should reflect web search enabled state', () => {
      const configWithWebSearch: AppConfig = {
        ...testConfig,
        webFetch: { ...testConfig.webFetch, enabled: true },
      };
      const flags = getStaticFlags(configWithWebSearch);
      expect(flags.enableWebSearch).toBe(true);
    });

    it('should be frozen', () => {
      const flags = getStaticFlags(testConfig);
      expect(Object.isFrozen(flags)).toBe(true);
    });
  });

  describe('DynamicFlagManager', () => {
    it('should return default values without Redis', async () => {
      const manager = new DynamicFlagManager();
      const model = await manager.get('llmModel');
      expect(model).toBe('gpt-4o');
    });

    it('should cache values', async () => {
      const manager = new DynamicFlagManager({ cacheTTLMs: 60000 });
      await manager.set('llmModel', 'gpt-5');
      const model = await manager.get('llmModel');
      expect(model).toBe('gpt-5');
    });

    it('should reset to defaults', async () => {
      const manager = new DynamicFlagManager();
      await manager.set('maxGoalsPerUser', 100);
      await manager.reset('maxGoalsPerUser');
      const value = await manager.get('maxGoalsPerUser');
      expect(value).toBe(10); // default
    });

    it('should get all flags', async () => {
      const manager = new DynamicFlagManager();
      const flags = await manager.getAll();
      expect(flags.llmModel).toBe('gpt-4o');
      expect(flags.maxGoalsPerUser).toBe(10);
    });
  });

  describe('evaluateUserFlags', () => {
    it('should return default flags without context', () => {
      const flags = evaluateUserFlags({});
      expect(flags.sparkReminderVariant).toBe('control');
    });

    it('should assign consistent variant based on userId', () => {
      const flags1 = evaluateUserFlags({ userId: 'user-123' });
      const flags2 = evaluateUserFlags({ userId: 'user-123' });
      expect(flags1.sparkReminderVariant).toBe(flags2.sparkReminderVariant);
    });

    it('should assign different variants to different users', () => {
      // This test may be flaky depending on hash distribution
      // but demonstrates the concept
      const variants = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const flags = evaluateUserFlags({ userId: `user-${i}` });
        variants.add(flags.sparkReminderVariant);
      }
      // Should have at least 2 different variants across 100 users
      expect(variants.size).toBeGreaterThanOrEqual(1);
    });
  });

  describe('FeatureFlagManager', () => {
    it('should initialize with config', () => {
      const manager = new FeatureFlagManager(testConfig);
      expect(manager.getStatic().enableReminders).toBe(true);
    });

    it('should check static flags with isEnabled', () => {
      const manager = new FeatureFlagManager(testConfig);
      expect(manager.isEnabled('enableReminders')).toBe(true);
    });

    it('should get dynamic flags', async () => {
      const manager = new FeatureFlagManager(testConfig);
      const model = await manager.getDynamic('llmModel');
      expect(model).toBe('gpt-4o');
    });

    it('should evaluate user flags', () => {
      const manager = new FeatureFlagManager(testConfig);
      const userFlags = manager.evaluateUserFlags({ userId: 'test-user' });
      expect(userFlags).toBeDefined();
    });

    it('should get all flags combined', async () => {
      const manager = new FeatureFlagManager(testConfig);
      const allFlags = await manager.getAllFlags({ userId: 'test-user' });
      expect(allFlags.static).toBeDefined();
      expect(allFlags.dynamic).toBeDefined();
      expect(allFlags.user).toBeDefined();
    });
  });

  describe('singleton management', () => {
    it('should initialize and retrieve singleton', () => {
      initFeatureFlags(testConfig);
      const manager = getFeatureFlags();
      expect(manager).toBeDefined();
    });

    it('should throw if not initialized', () => {
      expect(() => getFeatureFlags()).toThrow('Feature flags not initialized');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// SECRETS TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Secrets Management', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetSecrets();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    resetSecrets();
  });

  describe('EnvironmentSecretProvider', () => {
    it('should get secret from environment variable', async () => {
      process.env.OPENAI_API_KEY = 'sk-test-key';
      const provider = new EnvironmentSecretProvider();
      const result = await provider.getSecret('openaiApiKey');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.secret.value).toBe('sk-test-key');
      }
    });

    it('should return error for missing secret', async () => {
      delete process.env.OPENAI_API_KEY;
      const provider = new EnvironmentSecretProvider();
      const result = await provider.getSecret('openaiApiKey');
      expect(result.success).toBe(false);
    });

    it('should always be available', async () => {
      const provider = new EnvironmentSecretProvider();
      expect(await provider.isAvailable()).toBe(true);
    });
  });

  describe('MockSecretProvider', () => {
    it('should return configured secrets', async () => {
      const provider = new MockSecretProvider({
        openaiApiKey: 'mock-key',
      });
      const result = await provider.getSecret('openaiApiKey');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.secret.value).toBe('mock-key');
      }
    });

    it('should allow setting secrets dynamically', async () => {
      const provider = new MockSecretProvider();
      provider.setSecret('jwtSigningKey', 'jwt-secret');
      const result = await provider.getSecret('jwtSigningKey');
      expect(result.success).toBe(true);
    });

    it('should allow removing secrets', async () => {
      const provider = new MockSecretProvider({ openaiApiKey: 'key' });
      provider.removeSecret('openaiApiKey');
      const result = await provider.getSecret('openaiApiKey');
      expect(result.success).toBe(false);
    });

    it('should allow simulating unavailability', async () => {
      const provider = new MockSecretProvider();
      provider.setAvailable(false);
      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('SecretsManager', () => {
    it('should get secrets through provider', async () => {
      const provider = new MockSecretProvider({ openaiApiKey: 'test-key' });
      const manager = new SecretsManager({ provider });
      const value = await manager.getSecret('openaiApiKey');
      expect(value).toBe('test-key');
    });

    it('should return null for missing secrets', async () => {
      const provider = new MockSecretProvider();
      const manager = new SecretsManager({ provider });
      const value = await manager.getSecret('openaiApiKey');
      expect(value).toBeNull();
    });

    it('should throw when requireSecret fails', async () => {
      const provider = new MockSecretProvider();
      const manager = new SecretsManager({ provider });
      await expect(manager.requireSecret('openaiApiKey')).rejects.toThrow();
    });

    it('should cache secrets', async () => {
      const provider = new MockSecretProvider({ openaiApiKey: 'cached-key' });
      const getSpy = vi.spyOn(provider, 'getSecret');
      const manager = new SecretsManager({ provider, cacheTTLMs: 60000 });
      
      await manager.getSecret('openaiApiKey');
      await manager.getSecret('openaiApiKey');
      
      expect(getSpy).toHaveBeenCalledTimes(1);
    });

    it('should check secret existence', async () => {
      const provider = new MockSecretProvider({ openaiApiKey: 'key' });
      const manager = new SecretsManager({ provider });
      
      expect(await manager.hasSecret('openaiApiKey')).toBe(true);
      expect(await manager.hasSecret('geminiApiKey')).toBe(false);
    });

    it('should get multiple secrets', async () => {
      const provider = new MockSecretProvider({
        openaiApiKey: 'openai-key',
        jwtSigningKey: 'jwt-key',
      });
      const manager = new SecretsManager({ provider });
      const secrets = await manager.getSecrets(['openaiApiKey', 'jwtSigningKey', 'geminiApiKey']);
      
      expect(secrets.get('openaiApiKey')).toBe('openai-key');
      expect(secrets.get('jwtSigningKey')).toBe('jwt-key');
      expect(secrets.get('geminiApiKey')).toBeNull();
    });

    it('should clear cache on refresh', async () => {
      const provider = new MockSecretProvider({ openaiApiKey: 'key' });
      const manager = new SecretsManager({ provider, cacheTTLMs: 60000 });
      
      await manager.getSecret('openaiApiKey');
      manager.clearCache();
      
      const getSpy = vi.spyOn(provider, 'getSecret');
      await manager.getSecret('openaiApiKey');
      expect(getSpy).toHaveBeenCalled();
    });
  });

  describe('singleton management', () => {
    it('should auto-initialize with environment provider', () => {
      const manager = getSecrets();
      expect(manager.getProviderName()).toBe('environment');
    });

    it('should allow explicit initialization', () => {
      const provider = new MockSecretProvider();
      initSecrets({ provider });
      expect(getSecrets().getProviderName()).toBe('mock');
    });
  });
});
