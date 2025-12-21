// ═══════════════════════════════════════════════════════════════════════════════
// SECRETS MANAGEMENT — Abstracted Secret Storage Interface
// Sword System v3.0 — Phase 1: Configuration & Core Types
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Known secret keys used by the application.
 */
export type SecretKey =
  | 'encryptionKey'
  | 'encryptionKeyPrevious'
  | 'jwtSigningKey'
  | 'openaiApiKey'
  | 'geminiApiKey'
  | 'youtubeApiKey'
  | 'githubApiToken'
  | 'finnhubApiKey'
  | 'openweathermapApiKey'
  | 'tavilyApiKey'
  | 'googleCseApiKey'
  | 'redisPassword'
  | 'webhookSecret';

/**
 * Secret value with metadata.
 */
export interface Secret {
  readonly value: string;
  readonly version?: string;
  readonly createdAt?: Date;
  readonly expiresAt?: Date;
}

/**
 * Result of a secret retrieval operation.
 */
export type SecretResult =
  | { readonly success: true; readonly secret: Secret }
  | { readonly success: false; readonly error: string };

/**
 * Secret provider interface — implement this for different backends.
 */
export interface SecretProvider {
  /**
   * Provider name for logging/debugging.
   */
  readonly name: string;
  
  /**
   * Get a secret by key.
   */
  getSecret(key: SecretKey): Promise<SecretResult>;
  
  /**
   * Check if provider is available/healthy.
   */
  isAvailable(): Promise<boolean>;
  
  /**
   * Refresh/reload secrets (if supported).
   */
  refresh?(): Promise<void>;
}

/**
 * Options for the secrets manager.
 */
export interface SecretsManagerOptions {
  /**
   * Secret provider to use.
   */
  readonly provider: SecretProvider;
  
  /**
   * Cache TTL in milliseconds (0 to disable caching).
   */
  readonly cacheTTLMs?: number;
  
  /**
   * Whether to throw on missing secrets.
   */
  readonly throwOnMissing?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────
// ENVIRONMENT VARIABLE PROVIDER
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Maps secret keys to environment variable names.
 */
const ENV_VAR_MAPPING: Record<SecretKey, string> = {
  encryptionKey: 'ENCRYPTION_KEY',
  encryptionKeyPrevious: 'ENCRYPTION_KEY_PREVIOUS',
  jwtSigningKey: 'JWT_SECRET',
  openaiApiKey: 'OPENAI_API_KEY',
  geminiApiKey: 'GEMINI_API_KEY',
  youtubeApiKey: 'YOUTUBE_API_KEY',
  githubApiToken: 'GITHUB_API_TOKEN',
  finnhubApiKey: 'FINNHUB_API_KEY',
  openweathermapApiKey: 'OPENWEATHERMAP_API_KEY',
  tavilyApiKey: 'TAVILY_API_KEY',
  googleCseApiKey: 'GOOGLE_CSE_API_KEY',
  redisPassword: 'REDIS_PASSWORD',
  webhookSecret: 'WEBHOOK_SECRET',
};

/**
 * Environment variable-based secret provider.
 * Suitable for development and simple deployments.
 */
export class EnvironmentSecretProvider implements SecretProvider {
  readonly name = 'environment';
  
  async getSecret(key: SecretKey): Promise<SecretResult> {
    const envVar = ENV_VAR_MAPPING[key];
    const value = process.env[envVar];
    
    if (value === undefined || value.trim() === '') {
      return {
        success: false,
        error: `Secret '${key}' not found (env: ${envVar})`,
      };
    }
    
    return {
      success: true,
      secret: {
        value,
        version: 'env',
      },
    };
  }
  
  async isAvailable(): Promise<boolean> {
    return true; // Always available
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// MOCK PROVIDER (for testing)
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Mock secret provider for testing.
 */
export class MockSecretProvider implements SecretProvider {
  readonly name = 'mock';
  private readonly secrets: Map<SecretKey, Secret>;
  private available: boolean;
  
  constructor(secrets?: Partial<Record<SecretKey, string>>) {
    this.secrets = new Map();
    this.available = true;
    
    if (secrets) {
      for (const [key, value] of Object.entries(secrets)) {
        if (value !== undefined) {
          this.secrets.set(key as SecretKey, {
            value,
            version: 'mock-v1',
            createdAt: new Date(),
          });
        }
      }
    }
  }
  
  async getSecret(key: SecretKey): Promise<SecretResult> {
    const secret = this.secrets.get(key);
    
    if (!secret) {
      return {
        success: false,
        error: `Mock secret '${key}' not configured`,
      };
    }
    
    return { success: true, secret };
  }
  
  async isAvailable(): Promise<boolean> {
    return this.available;
  }
  
  // Test helpers
  setSecret(key: SecretKey, value: string): void {
    this.secrets.set(key, {
      value,
      version: 'mock-v1',
      createdAt: new Date(),
    });
  }
  
  removeSecret(key: SecretKey): void {
    this.secrets.delete(key);
  }
  
  setAvailable(available: boolean): void {
    this.available = available;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// AWS SECRETS MANAGER PROVIDER (stub for future implementation)
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * AWS Secrets Manager provider options.
 */
export interface AWSSecretsManagerOptions {
  readonly region: string;
  readonly secretPrefix?: string;
  readonly cacheEnabled?: boolean;
}

/**
 * AWS Secrets Manager provider.
 * 
 * NOTE: This is a stub implementation. In production, you would:
 * 1. Install @aws-sdk/client-secrets-manager
 * 2. Implement actual AWS API calls
 * 3. Handle authentication via IAM roles or access keys
 * 
 * @example Future implementation:
 * ```typescript
 * import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
 * 
 * const client = new SecretsManagerClient({ region: 'us-east-1' });
 * const response = await client.send(new GetSecretValueCommand({
 *   SecretId: 'novaos/production/openai-api-key',
 * }));
 * ```
 */
export class AWSSecretsManagerProvider implements SecretProvider {
  readonly name = 'aws-secrets-manager';
  private readonly options: AWSSecretsManagerOptions;
  
  constructor(options: AWSSecretsManagerOptions) {
    this.options = options;
  }
  
  async getSecret(key: SecretKey): Promise<SecretResult> {
    // Stub implementation — returns error indicating not implemented
    return {
      success: false,
      error: `AWS Secrets Manager not implemented. Key: ${key}, Region: ${this.options.region}`,
    };
  }
  
  async isAvailable(): Promise<boolean> {
    // Would check AWS connectivity
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// HASHICORP VAULT PROVIDER (stub for future implementation)
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * HashiCorp Vault provider options.
 */
export interface VaultOptions {
  readonly address: string;
  readonly token?: string;
  readonly namespace?: string;
  readonly secretPath?: string;
}

/**
 * HashiCorp Vault provider.
 * 
 * NOTE: This is a stub implementation. In production, you would:
 * 1. Install node-vault or similar
 * 2. Implement actual Vault API calls
 * 3. Handle authentication via tokens or AppRole
 */
export class VaultSecretProvider implements SecretProvider {
  readonly name = 'vault';
  private readonly options: VaultOptions;
  
  constructor(options: VaultOptions) {
    this.options = options;
  }
  
  async getSecret(key: SecretKey): Promise<SecretResult> {
    // Stub implementation
    return {
      success: false,
      error: `Vault not implemented. Key: ${key}, Address: ${this.options.address}`,
    };
  }
  
  async isAvailable(): Promise<boolean> {
    // Would check Vault connectivity
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SECRETS MANAGER
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Centralized secrets manager with caching and provider abstraction.
 */
export class SecretsManager {
  private readonly provider: SecretProvider;
  private readonly cache: Map<SecretKey, { secret: Secret; expiresAt: number }>;
  private readonly cacheTTLMs: number;
  private readonly throwOnMissing: boolean;
  
  constructor(options: SecretsManagerOptions) {
    this.provider = options.provider;
    this.cache = new Map();
    this.cacheTTLMs = options.cacheTTLMs ?? 300000; // 5 minutes default
    this.throwOnMissing = options.throwOnMissing ?? false;
  }
  
  /**
   * Get the provider name.
   */
  getProviderName(): string {
    return this.provider.name;
  }
  
  /**
   * Get a secret value.
   */
  async getSecret(key: SecretKey): Promise<string | null> {
    // Check cache
    if (this.cacheTTLMs > 0) {
      const cached = this.cache.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.secret.value;
      }
    }
    
    // Fetch from provider
    const result = await this.provider.getSecret(key);
    
    if (!result.success) {
      if (this.throwOnMissing) {
        throw new Error(`Secret '${key}' not found: ${result.error}`);
      }
      return null;
    }
    
    // Update cache
    if (this.cacheTTLMs > 0) {
      this.cache.set(key, {
        secret: result.secret,
        expiresAt: Date.now() + this.cacheTTLMs,
      });
    }
    
    return result.secret.value;
  }
  
  /**
   * Get a secret, throwing if not found.
   */
  async requireSecret(key: SecretKey): Promise<string> {
    const value = await this.getSecret(key);
    if (value === null) {
      throw new Error(`Required secret '${key}' not found`);
    }
    return value;
  }
  
  /**
   * Get multiple secrets at once.
   */
  async getSecrets(keys: SecretKey[]): Promise<Map<SecretKey, string | null>> {
    const results = new Map<SecretKey, string | null>();
    
    await Promise.all(
      keys.map(async (key) => {
        const value = await this.getSecret(key);
        results.set(key, value);
      })
    );
    
    return results;
  }
  
  /**
   * Check if a secret exists.
   */
  async hasSecret(key: SecretKey): Promise<boolean> {
    const value = await this.getSecret(key);
    return value !== null;
  }
  
  /**
   * Check if the provider is available.
   */
  async isAvailable(): Promise<boolean> {
    return this.provider.isAvailable();
  }
  
  /**
   * Clear the secrets cache.
   */
  clearCache(): void {
    this.cache.clear();
  }
  
  /**
   * Refresh secrets from provider.
   */
  async refresh(): Promise<void> {
    this.clearCache();
    if (this.provider.refresh) {
      await this.provider.refresh();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON & FACTORY
// ─────────────────────────────────────────────────────────────────────────────────

let secretsManagerInstance: SecretsManager | null = null;

/**
 * Create a secrets manager with the appropriate provider for the environment.
 */
export function createSecretsManager(options?: {
  provider?: SecretProvider;
  cacheTTLMs?: number;
  throwOnMissing?: boolean;
}): SecretsManager {
  const provider = options?.provider ?? new EnvironmentSecretProvider();
  
  return new SecretsManager({
    provider,
    cacheTTLMs: options?.cacheTTLMs,
    throwOnMissing: options?.throwOnMissing,
  });
}

/**
 * Initialize the secrets manager singleton.
 */
export function initSecrets(options?: Parameters<typeof createSecretsManager>[0]): SecretsManager {
  secretsManagerInstance = createSecretsManager(options);
  return secretsManagerInstance;
}

/**
 * Get the secrets manager singleton.
 */
export function getSecrets(): SecretsManager {
  if (!secretsManagerInstance) {
    // Auto-initialize with environment provider for convenience
    secretsManagerInstance = createSecretsManager();
  }
  return secretsManagerInstance;
}

/**
 * Check if secrets manager has been initialized.
 */
export function isSecretsInitialized(): boolean {
  return secretsManagerInstance !== null;
}

/**
 * Reset secrets manager (for testing).
 * @internal
 */
export function resetSecrets(): void {
  secretsManagerInstance = null;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONVENIENCE FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Get a secret value (convenience function).
 */
export async function getSecretValue(key: SecretKey): Promise<string | null> {
  return getSecrets().getSecret(key);
}

/**
 * Require a secret value (convenience function).
 */
export async function requireSecretValue(key: SecretKey): Promise<string> {
  return getSecrets().requireSecret(key);
}

/**
 * Check if a secret exists (convenience function).
 */
export async function hasSecretValue(key: SecretKey): Promise<boolean> {
  return getSecrets().hasSecret(key);
}

// ─────────────────────────────────────────────────────────────────────────────────
// ENCRYPTION KEY HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Encryption key with metadata for key rotation support.
 */
export interface EncryptionKey {
  readonly id: string;
  readonly key: Buffer;
  readonly algorithm: string;
  readonly createdAt?: Date;
}

/**
 * Get the current encryption key.
 */
export async function getEncryptionKey(keyId: string): Promise<EncryptionKey | null> {
  const secrets = getSecrets();
  const keyValue = await secrets.getSecret('encryptionKey');
  
  if (!keyValue) {
    return null;
  }
  
  return {
    id: keyId,
    key: Buffer.from(keyValue, 'base64'),
    algorithm: 'aes-256-gcm',
  };
}

/**
 * Get all encryption keys (current + previous for rotation).
 */
export async function getEncryptionKeys(currentKeyId: string): Promise<EncryptionKey[]> {
  const secrets = getSecrets();
  const keys: EncryptionKey[] = [];
  
  // Current key
  const currentKey = await secrets.getSecret('encryptionKey');
  if (currentKey) {
    keys.push({
      id: currentKeyId,
      key: Buffer.from(currentKey, 'base64'),
      algorithm: 'aes-256-gcm',
    });
  }
  
  // Previous key (for decrypting old data during rotation)
  const previousKey = await secrets.getSecret('encryptionKeyPrevious');
  if (previousKey) {
    keys.push({
      id: `${currentKeyId}-previous`,
      key: Buffer.from(previousKey, 'base64'),
      algorithm: 'aes-256-gcm',
    });
  }
  
  return keys;
}
