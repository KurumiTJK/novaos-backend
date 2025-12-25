// ═══════════════════════════════════════════════════════════════════════════════
// AUTHENTICATION TYPES — Core Security Type Definitions
// NovaOS Security Module — Phase 2
// ═══════════════════════════════════════════════════════════════════════════════

import type { Request } from 'express';
import type {
  UserId,
  RequestId,
  SessionId,
  CorrelationId,
  Timestamp,
} from '../../types/branded.js';

// ─────────────────────────────────────────────────────────────────────────────────
// USER TIERS & ROLES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * User subscription tier.
 */
export type UserTier = 'free' | 'pro' | 'enterprise';

/**
 * User role for authorization.
 */
export type UserRole = 'user' | 'premium' | 'admin' | 'service';

/**
 * Permission string format: "resource:action"
 */
export type Permission = string;

// ─────────────────────────────────────────────────────────────────────────────────
// AUTHENTICATED USER
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * User metadata stored with authentication.
 */
export interface UserMetadata {
  readonly createdAt: Timestamp;
  readonly lastLoginAt?: Timestamp;
  readonly loginCount?: number;
  readonly mfaEnabled?: boolean;
}

/**
 * Authenticated user attached to requests.
 * This is the canonical user representation in the security layer.
 * 
 * Includes backward-compatibility aliases for legacy code that expects
 * `userId` and `createdAt` as direct properties.
 */
export interface AuthenticatedUser {
  readonly id: UserId;
  readonly email?: string;
  readonly tier: UserTier;
  readonly roles: readonly UserRole[];
  readonly permissions: readonly Permission[];
  readonly metadata: UserMetadata;
  
  // ─────────────────────────────────────────────────────────────────────────────
  // BACKWARD COMPATIBILITY ALIASES
  // These properties mirror existing fields for legacy code compatibility.
  // Legacy routes access `req.user.userId` and `req.user.createdAt`.
  // ─────────────────────────────────────────────────────────────────────────────
  
  /** @deprecated Use `id` instead. Alias for backward compatibility with legacy auth. */
  readonly userId: string;
  
  /** @deprecated Use `metadata.createdAt` instead. Unix timestamp for legacy compatibility. */
  readonly createdAt: number;
}

/**
 * Minimal user info for token payloads (smaller footprint).
 */
export interface UserIdentity {
  readonly id: UserId;
  readonly email?: string;
  readonly tier: UserTier;
  readonly roles: readonly UserRole[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// JWT PAYLOAD
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * JWT token payload structure.
 * Standard claims + custom Nova claims.
 */
export interface JWTPayload {
  // Standard JWT claims
  readonly sub: string;         // Subject (User ID)
  readonly iat: number;         // Issued at (Unix timestamp)
  readonly exp: number;         // Expiration (Unix timestamp)
  readonly iss: string;         // Issuer
  readonly aud: string;         // Audience
  readonly jti?: string;        // JWT ID (for revocation)
  
  // Custom Nova claims
  readonly email?: string;
  readonly tier: UserTier;
  readonly roles: readonly UserRole[];
  readonly sessionId?: string;  // For session binding
}

/**
 * Decoded and validated JWT with metadata.
 */
export interface ValidatedToken {
  readonly payload: JWTPayload;
  readonly token: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly remainingMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// SERVICE IDENTITY (Internal Service Auth)
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Internal service identity for service-to-service auth.
 */
export interface ServiceIdentity {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly permissions: readonly Permission[];
  readonly environment: 'development' | 'staging' | 'production';
}

/**
 * Service token payload.
 */
export interface ServiceTokenPayload {
  readonly sub: string;         // Service ID
  readonly iat: number;
  readonly exp: number;
  readonly iss: string;
  readonly type: 'service';
  readonly serviceName: string;
  readonly permissions: readonly Permission[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// REQUEST CONTEXT
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Security context attached to every request.
 * Provides tracing, user info, and request metadata.
 */
export interface RequestContext {
  // Tracing
  readonly requestId: RequestId;
  readonly correlationId: CorrelationId;
  readonly sessionId?: SessionId;
  
  // Timing
  readonly timestamp: Timestamp;
  readonly startTime: number;
  
  // Client info
  readonly ip: string;
  readonly userAgent?: string;
  readonly origin?: string;
  
  // Authentication (one or the other, or neither for anonymous)
  readonly user?: AuthenticatedUser;
  readonly service?: ServiceIdentity;
  
  // Request classification
  readonly isAuthenticated: boolean;
  readonly isService: boolean;
  readonly isAnonymous: boolean;
}

/**
 * Create an anonymous request context.
 */
export function createAnonymousContext(partial: {
  requestId: RequestId;
  correlationId: CorrelationId;
  timestamp: Timestamp;
  startTime: number;
  ip: string;
  userAgent?: string;
  origin?: string;
}): RequestContext {
  return {
    ...partial,
    isAuthenticated: false,
    isService: false,
    isAnonymous: true,
  };
}

/**
 * Create an authenticated user context.
 */
export function createUserContext(
  partial: Omit<RequestContext, 'isAuthenticated' | 'isService' | 'isAnonymous' | 'service'>,
  user: AuthenticatedUser
): RequestContext {
  return {
    ...partial,
    user,
    isAuthenticated: true,
    isService: false,
    isAnonymous: false,
  };
}

/**
 * Create a service context.
 */
export function createServiceContext(
  partial: Omit<RequestContext, 'isAuthenticated' | 'isService' | 'isAnonymous' | 'user'>,
  service: ServiceIdentity
): RequestContext {
  return {
    ...partial,
    service,
    isAuthenticated: true,
    isService: true,
    isAnonymous: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPRESS EXTENSIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Extended Express Request with security context.
 */
export interface SecureRequest extends Request {
  // From existing request middleware
  requestId: string;
  startTime: number;
  
  // Security additions
  context: RequestContext;
  user?: AuthenticatedUser;
  service?: ServiceIdentity;
  
  // Convenience accessors
  userId?: string;
  isAuthenticated: boolean;
}

/**
 * Type guard for authenticated requests.
 */
export function isAuthenticatedRequest(
  req: SecureRequest
): req is SecureRequest & { user: AuthenticatedUser } {
  return req.isAuthenticated && req.user !== undefined;
}

/**
 * Type guard for service requests.
 */
export function isServiceRequest(
  req: SecureRequest
): req is SecureRequest & { service: ServiceIdentity } {
  return req.context?.isService === true && req.service !== undefined;
}

// ─────────────────────────────────────────────────────────────────────────────────
// TOKEN TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Token type discriminator.
 */
export type TokenType = 'access' | 'refresh' | 'api_key' | 'service';

/**
 * Token generation options.
 */
export interface TokenOptions {
  readonly expiresIn?: string | number;  // '24h', '7d', or seconds
  readonly audience?: string;
  readonly issuer?: string;
  readonly jwtId?: string;               // For revocation tracking
  readonly sessionId?: string;           // Bind to session
}

/**
 * Token generation result.
 */
export interface GeneratedToken {
  readonly token: string;
  readonly type: TokenType;
  readonly expiresAt: Date;
  readonly expiresIn: number;            // Seconds until expiry
  readonly jwtId?: string;
}

/**
 * Token verification result.
 */
export type TokenVerificationResult =
  | { readonly valid: true; readonly payload: JWTPayload; readonly user: AuthenticatedUser }
  | { readonly valid: false; readonly error: TokenError };

/**
 * Token error types.
 */
export type TokenError =
  | { readonly code: 'EXPIRED'; readonly message: string; readonly expiredAt: Date }
  | { readonly code: 'INVALID_SIGNATURE'; readonly message: string }
  | { readonly code: 'MALFORMED'; readonly message: string }
  | { readonly code: 'REVOKED'; readonly message: string; readonly revokedAt?: Date }
  | { readonly code: 'INVALID_ISSUER'; readonly message: string }
  | { readonly code: 'INVALID_AUDIENCE'; readonly message: string }
  | { readonly code: 'MISSING'; readonly message: string };

/**
 * Get error code from TokenError.
 */
export function getTokenErrorCode(error: TokenError): string {
  return error.code;
}

// ─────────────────────────────────────────────────────────────────────────────────
// AUTHENTICATION EVENTS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Authentication event types for audit logging.
 */
export type AuthEventType =
  | 'login_success'
  | 'login_failure'
  | 'logout'
  | 'token_issued'
  | 'token_refreshed'
  | 'token_revoked'
  | 'token_expired'
  | 'token_invalid'
  | 'permission_denied'
  | 'rate_limited'
  | 'blocked';

/**
 * Authentication event for audit logging.
 */
export interface AuthEvent {
  readonly type: AuthEventType;
  readonly timestamp: Timestamp;
  readonly requestId: RequestId;
  readonly userId?: UserId;
  readonly ip: string;
  readonly userAgent?: string;
  readonly details?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────────
// BACKWARD COMPATIBILITY
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Legacy UserPayload for compatibility with existing auth module.
 * Maps to the existing src/auth/index.ts UserPayload.
 */
export interface LegacyUserPayload {
  userId: string;
  email?: string;
  tier: UserTier;
  createdAt: number;
}

/**
 * Convert legacy payload to AuthenticatedUser.
 * Includes backward-compatibility properties for legacy route handlers.
 */
export function fromLegacyPayload(payload: LegacyUserPayload): AuthenticatedUser {
  const createdAtTimestamp = new Date(payload.createdAt).toISOString() as Timestamp;
  
  return {
    // New canonical properties
    id: payload.userId as UserId,
    email: payload.email,
    tier: payload.tier,
    roles: [payload.tier === 'enterprise' ? 'premium' : 'user'],
    permissions: getDefaultPermissions(payload.tier),
    metadata: {
      createdAt: createdAtTimestamp,
    },
    
    // Backward compatibility aliases
    userId: payload.userId,
    createdAt: payload.createdAt,
  };
}

/**
 * Convert AuthenticatedUser to legacy payload.
 */
export function toLegacyPayload(user: AuthenticatedUser): LegacyUserPayload {
  return {
    userId: user.id as string,
    email: user.email,
    tier: user.tier,
    createdAt: user.createdAt,
  };
}

/**
 * Get default permissions for a tier.
 */
export function getDefaultPermissions(tier: UserTier): Permission[] {
  const base = [
    'goals:read',
    'goals:write',
    'quests:read',
    'quests:write',
    'steps:read',
    'steps:write',
    'sparks:read',
    'sparks:write',
    'memories:read',
    'memories:write',
    'conversations:read',
    'conversations:write',
  ];
  
  if (tier === 'pro' || tier === 'enterprise') {
    base.push(
      'advanced_features',
      'export:read',
      'analytics:read'
    );
  }
  
  if (tier === 'enterprise') {
    base.push(
      'team:read',
      'team:write',
      'audit:read'
    );
  }
  
  return base;
}
