// ═══════════════════════════════════════════════════════════════════════════════
// JWT TOKEN HANDLING — Generation, Verification, Revocation
// NovaOS Security Module — Phase 2
// ═══════════════════════════════════════════════════════════════════════════════

import jwt from 'jsonwebtoken';
import type { SignOptions, VerifyOptions, JwtPayload } from 'jsonwebtoken';
import { getStore, type KeyValueStore } from '../../storage/index.js';
import { createTimestamp, type UserId } from '../../types/branded.js';
import { ok, err, type Result } from '../../types/result.js';
import {
  type AuthenticatedUser,
  type JWTPayload,
  type TokenOptions,
  type GeneratedToken,
  type TokenVerificationResult,
  type TokenError,
  type TokenType,
  type UserTier,
  type UserRole,
  getDefaultPermissions,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Token configuration with defaults.
 */
export interface TokenConfig {
  readonly secret: string;
  readonly issuer: string;
  readonly audience: string;
  readonly accessTokenExpiry: string;
  readonly refreshTokenExpiry: string;
  readonly apiKeyExpiry: string;
  readonly serviceTokenExpiry: string;
  readonly algorithm: jwt.Algorithm;
}

/**
 * Default token configuration.
 * In production, secret should come from secrets manager.
 */
const DEFAULT_CONFIG: TokenConfig = {
  secret: process.env.JWT_SECRET ?? 'nova-dev-secret-change-in-production',
  issuer: process.env.JWT_ISSUER ?? 'novaos',
  audience: process.env.JWT_AUDIENCE ?? 'novaos-api',
  accessTokenExpiry: process.env.JWT_ACCESS_EXPIRY ?? '24h',
  refreshTokenExpiry: process.env.JWT_REFRESH_EXPIRY ?? '7d',
  apiKeyExpiry: process.env.JWT_API_KEY_EXPIRY ?? '365d',
  serviceTokenExpiry: process.env.JWT_SERVICE_EXPIRY ?? '1h',
  algorithm: 'HS256',
};

let tokenConfig: TokenConfig = DEFAULT_CONFIG;

/**
 * Initialize token configuration.
 */
export function initTokenConfig(config: Partial<TokenConfig>): void {
  tokenConfig = { ...DEFAULT_CONFIG, ...config };
}

/**
 * Get current token configuration.
 */
export function getTokenConfig(): Readonly<TokenConfig> {
  return tokenConfig;
}

// ─────────────────────────────────────────────────────────────────────────────────
// REVOCATION STORE
// ─────────────────────────────────────────────────────────────────────────────────

const REVOCATION_PREFIX = 'token:revoked:';

/**
 * Token revocation store using Redis/Memory.
 */
export class TokenRevocationStore {
  constructor(private store: KeyValueStore) {}

  private getKey(jwtId: string): string {
    return `${REVOCATION_PREFIX}${jwtId}`;
  }

  /**
   * Revoke a token by its JWT ID.
   * TTL should match or exceed the token's remaining lifetime.
   */
  async revoke(jwtId: string, ttlSeconds: number, reason?: string): Promise<void> {
    const data = JSON.stringify({
      revokedAt: Date.now(),
      reason: reason ?? 'manual_revocation',
    });
    await this.store.set(this.getKey(jwtId), data, ttlSeconds);
  }

  /**
   * Check if a token is revoked.
   */
  async isRevoked(jwtId: string): Promise<{ revoked: boolean; revokedAt?: Date; reason?: string }> {
    const data = await this.store.get(this.getKey(jwtId));
    if (!data) {
      return { revoked: false };
    }

    try {
      const parsed = JSON.parse(data);
      return {
        revoked: true,
        revokedAt: new Date(parsed.revokedAt),
        reason: parsed.reason,
      };
    } catch {
      return { revoked: true };
    }
  }

  /**
   * Unrevoke a token (for admin use).
   */
  async unrevoke(jwtId: string): Promise<boolean> {
    return this.store.delete(this.getKey(jwtId));
  }
}

let revocationStore: TokenRevocationStore | null = null;

function getRevocationStore(): TokenRevocationStore {
  if (!revocationStore) {
    revocationStore = new TokenRevocationStore(getStore());
  }
  return revocationStore;
}

// ─────────────────────────────────────────────────────────────────────────────────
// TOKEN ID GENERATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Generate a unique JWT ID for revocation tracking.
 */
function generateJwtId(): string {
  return `jti_${crypto.randomUUID()}`;
}

// ─────────────────────────────────────────────────────────────────────────────────
// TOKEN GENERATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Generate an access token for a user.
 */
export function generateAccessToken(
  user: AuthenticatedUser,
  options?: TokenOptions
): GeneratedToken {
  return generateToken(user, 'access', {
    expiresIn: tokenConfig.accessTokenExpiry,
    ...options,
  });
}

/**
 * Generate a refresh token for a user.
 */
export function generateRefreshToken(
  user: AuthenticatedUser,
  options?: TokenOptions
): GeneratedToken {
  return generateToken(user, 'refresh', {
    expiresIn: tokenConfig.refreshTokenExpiry,
    ...options,
  });
}

/**
 * Generate an API key (long-lived token).
 */
export function generateApiKey(
  user: AuthenticatedUser,
  options?: TokenOptions
): GeneratedToken {
  const token = generateToken(user, 'api_key', {
    expiresIn: tokenConfig.apiKeyExpiry,
    ...options,
  });
  
  // Prefix API keys for easy identification
  return {
    ...token,
    token: `nova_${token.token}`,
  };
}

/**
 * Generate a token for internal service authentication.
 */
export function generateServiceToken(
  serviceId: string,
  serviceName: string,
  permissions: readonly string[],
  options?: TokenOptions
): GeneratedToken {
  const jwtId = options?.jwtId ?? generateJwtId();
  const expiresIn = options?.expiresIn ?? tokenConfig.serviceTokenExpiry;
  
  const payload = {
    sub: serviceId,
    type: 'service',
    serviceName,
    permissions,
  };

  const signOptions: SignOptions = {
    algorithm: tokenConfig.algorithm,
    issuer: options?.issuer ?? tokenConfig.issuer,
    audience: options?.audience ?? tokenConfig.audience,
    expiresIn: expiresIn as SignOptions['expiresIn'],
    jwtid: jwtId,
  };

  const token = jwt.sign(payload, tokenConfig.secret, signOptions);
  const decoded = jwt.decode(token) as JwtPayload;
  const expiresAt = new Date((decoded.exp ?? 0) * 1000);

  return {
    token,
    type: 'service',
    expiresAt,
    expiresIn: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
    jwtId,
  };
}

/**
 * Core token generation.
 */
function generateToken(
  user: AuthenticatedUser,
  type: TokenType,
  options: TokenOptions
): GeneratedToken {
  const jwtId = options.jwtId ?? generateJwtId();
  
  const payload: Omit<JWTPayload, 'iat' | 'exp' | 'iss' | 'aud'> = {
    sub: user.id as string,
    email: user.email,
    tier: user.tier,
    roles: user.roles,
    sessionId: options.sessionId,
    jti: jwtId,
  };

  const signOptions: SignOptions = {
    algorithm: tokenConfig.algorithm,
    issuer: options.issuer ?? tokenConfig.issuer,
    audience: options.audience ?? tokenConfig.audience,
    expiresIn: options.expiresIn as SignOptions['expiresIn'],
  };

  const token = jwt.sign(payload, tokenConfig.secret, signOptions);
  
  // Decode to get actual expiry time
  const decoded = jwt.decode(token) as JwtPayload;
  const expiresAt = new Date((decoded.exp ?? 0) * 1000);

  return {
    token,
    type,
    expiresAt,
    expiresIn: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
    jwtId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// TOKEN VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Verify a token and return the authenticated user.
 * Checks signature, expiry, issuer, audience, and revocation.
 */
export async function verifyToken(token: string): Promise<TokenVerificationResult> {
  // Handle API key prefix
  const actualToken = token.startsWith('nova_') ? token.slice(5) : token;

  // Verify signature and basic claims
  const verifyOptions: VerifyOptions = {
    algorithms: [tokenConfig.algorithm],
    issuer: tokenConfig.issuer,
    audience: tokenConfig.audience,
  };

  let payload: JWTPayload;
  try {
    payload = jwt.verify(actualToken, tokenConfig.secret, verifyOptions) as JWTPayload;
  } catch (error) {
    return { valid: false, error: mapJwtError(error) };
  }

  // Check if token is revoked (if it has a jti)
  if (payload.jti) {
    const revocation = await getRevocationStore().isRevoked(payload.jti);
    if (revocation.revoked) {
      return {
        valid: false,
        error: {
          code: 'REVOKED',
          message: `Token has been revoked: ${revocation.reason ?? 'unknown reason'}`,
          revokedAt: revocation.revokedAt,
        },
      };
    }
  }

  // Build authenticated user from payload
  const user = payloadToUser(payload);

  return { valid: true, payload, user };
}

/**
 * Verify token synchronously (without revocation check).
 * Use only when revocation check is not needed or done separately.
 */
export function verifyTokenSync(token: string): Result<JWTPayload, TokenError> {
  const actualToken = token.startsWith('nova_') ? token.slice(5) : token;

  const verifyOptions: VerifyOptions = {
    algorithms: [tokenConfig.algorithm],
    issuer: tokenConfig.issuer,
    audience: tokenConfig.audience,
  };

  try {
    const payload = jwt.verify(actualToken, tokenConfig.secret, verifyOptions) as JWTPayload;
    return ok(payload);
  } catch (error) {
    return err(mapJwtError(error));
  }
}

/**
 * Decode a token without verification (for inspection only).
 */
export function decodeToken(token: string): JWTPayload | null {
  const actualToken = token.startsWith('nova_') ? token.slice(5) : token;
  try {
    return jwt.decode(actualToken) as JWTPayload | null;
  } catch {
    return null;
  }
}

/**
 * Map jsonwebtoken errors to TokenError.
 */
function mapJwtError(error: unknown): TokenError {
  if (error instanceof jwt.TokenExpiredError) {
    return {
      code: 'EXPIRED',
      message: 'Token has expired',
      expiredAt: error.expiredAt,
    };
  }

  if (error instanceof jwt.JsonWebTokenError) {
    if (error.message.includes('invalid signature')) {
      return {
        code: 'INVALID_SIGNATURE',
        message: 'Token signature is invalid',
      };
    }
    if (error.message.includes('jwt malformed')) {
      return {
        code: 'MALFORMED',
        message: 'Token is malformed',
      };
    }
    if (error.message.includes('issuer')) {
      return {
        code: 'INVALID_ISSUER',
        message: 'Token issuer is invalid',
      };
    }
    if (error.message.includes('audience')) {
      return {
        code: 'INVALID_AUDIENCE',
        message: 'Token audience is invalid',
      };
    }
  }

  return {
    code: 'MALFORMED',
    message: error instanceof Error ? error.message : 'Unknown token error',
  };
}

/**
 * Convert JWT payload to AuthenticatedUser.
 * Includes backward-compatibility properties for legacy route handlers.
 */
function payloadToUser(payload: JWTPayload): AuthenticatedUser {
  const userId = payload.sub as UserId;
  const tier = payload.tier;
  const roles = payload.roles ?? ['user'];
  
  // Calculate createdAt as Unix timestamp from JWT iat claim
  const createdAtUnix = payload.iat * 1000;
  const createdAtTimestamp = createTimestamp(new Date(createdAtUnix));

  return {
    // New canonical properties
    id: userId,
    email: payload.email,
    tier,
    roles,
    permissions: getDefaultPermissions(tier),
    metadata: {
      createdAt: createdAtTimestamp,
    },
    
    // Backward compatibility aliases for legacy routes
    // Legacy code accesses req.user.userId and req.user.createdAt
    userId: payload.sub,
    createdAt: createdAtUnix,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// TOKEN REFRESH
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Refresh an access token using a valid token.
 * The old token is NOT automatically revoked — caller should handle this.
 */
export async function refreshToken(
  token: string,
  options?: TokenOptions
): Promise<Result<GeneratedToken, TokenError>> {
  const verification = await verifyToken(token);
  
  if (!verification.valid) {
    return err(verification.error);
  }

  // Generate new access token with same user
  const newToken = generateAccessToken(verification.user, {
    sessionId: verification.payload.sessionId,
    ...options,
  });

  return ok(newToken);
}

// ─────────────────────────────────────────────────────────────────────────────────
// TOKEN REVOCATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Revoke a token by its JWT ID.
 */
export async function revokeToken(jwtId: string, reason?: string): Promise<void> {
  // Use a long TTL since we don't know exact expiry
  // Tokens will naturally expire, but revocation persists
  const ttlSeconds = 7 * 24 * 60 * 60; // 7 days
  await getRevocationStore().revoke(jwtId, ttlSeconds, reason);
}

/**
 * Revoke a token by parsing it first.
 */
export async function revokeTokenByValue(token: string, reason?: string): Promise<boolean> {
  const payload = decodeToken(token);
  if (!payload?.jti) {
    return false;
  }

  // Calculate remaining TTL from token expiry
  const remainingSeconds = Math.max(
    0,
    Math.floor((payload.exp * 1000 - Date.now()) / 1000) + 60 // +60s buffer
  );

  await getRevocationStore().revoke(payload.jti, remainingSeconds, reason);
  return true;
}

/**
 * Check if a token is revoked.
 */
export async function isTokenRevoked(jwtId: string): Promise<boolean> {
  const result = await getRevocationStore().isRevoked(jwtId);
  return result.revoked;
}

/**
 * Revoke all tokens for a user (by storing user ID in revocation list).
 * This is a more aggressive approach that requires checking on each verification.
 */
export async function revokeAllUserTokens(
  userId: UserId,
  reason?: string
): Promise<void> {
  const store = getStore();
  const data = JSON.stringify({
    revokedAt: Date.now(),
    reason: reason ?? 'all_tokens_revoked',
  });
  // Store for 7 days — matches max token lifetime
  await store.set(`token:user_revoked:${userId}`, data, 7 * 24 * 60 * 60);
}

/**
 * Check if all tokens for a user are revoked.
 */
export async function areUserTokensRevoked(userId: UserId): Promise<boolean> {
  const store = getStore();
  const data = await store.get(`token:user_revoked:${userId}`);
  return data !== null;
}

/**
 * Clear user-wide token revocation.
 */
export async function clearUserTokenRevocation(userId: UserId): Promise<boolean> {
  const store = getStore();
  return store.delete(`token:user_revoked:${userId}`);
}

// ─────────────────────────────────────────────────────────────────────────────────
// TOKEN UTILITIES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Extract token from Authorization header.
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}

/**
 * Extract token from API key header.
 */
export function extractApiKey(apiKeyHeader: string | undefined): string | null {
  if (!apiKeyHeader?.startsWith('nova_')) {
    return null;
  }
  return apiKeyHeader;
}

/**
 * Get remaining time until token expires.
 */
export function getTokenRemainingTime(token: string): number | null {
  const payload = decodeToken(token);
  if (!payload?.exp) {
    return null;
  }
  return Math.max(0, payload.exp * 1000 - Date.now());
}

/**
 * Check if a token is expired (without full verification).
 */
export function isTokenExpired(token: string): boolean {
  const remaining = getTokenRemainingTime(token);
  return remaining === null || remaining <= 0;
}

// ─────────────────────────────────────────────────────────────────────────────────
// TESTING UTILITIES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Reset token config to defaults (for testing).
 * @internal
 */
export function resetTokenConfig(): void {
  tokenConfig = DEFAULT_CONFIG;
}

/**
 * Set a mock revocation store (for testing).
 * @internal
 */
export function setRevocationStore(store: KeyValueStore): void {
  revocationStore = new TokenRevocationStore(store);
}

/**
 * Reset revocation store (for testing).
 * @internal
 */
export function resetRevocationStore(): void {
  revocationStore = null;
}
