// ═══════════════════════════════════════════════════════════════════════════════
// AUTH MODULE — JWT Authentication, Rate Limiting, Abuse Detection
// ═══════════════════════════════════════════════════════════════════════════════

import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import {
  getStore,
  RateLimitStore,
  SessionStore,
  AckTokenStore,
  BlockStore,
  VetoHistoryStore,
  AuditLogStore,
} from '../storage/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface UserPayload {
  userId: string;
  email?: string;
  tier: 'free' | 'pro' | 'enterprise';
  createdAt: number;
}

export interface AuthenticatedRequest extends Request {
  user?: UserPayload;
  userId?: string;
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  maxTokens?: number;
}

export interface AbusePattern {
  type: 'rapid_fire' | 'token_flood' | 'repeated_veto' | 'prompt_injection' | 'harassment';
  severity: 'low' | 'medium' | 'high';
  action: 'warn' | 'throttle' | 'block';
}

// ─────────────────────────────────────────────────────────────────────────────────
// RATE LIMIT TIERS
// ─────────────────────────────────────────────────────────────────────────────────

export const RATE_LIMITS: Record<UserPayload['tier'], RateLimitConfig> = {
  free: {
    windowMs: 60 * 1000,
    maxRequests: 10,
    maxTokens: 10000,
  },
  pro: {
    windowMs: 60 * 1000,
    maxRequests: 60,
    maxTokens: 100000,
  },
  enterprise: {
    windowMs: 60 * 1000,
    maxRequests: 300,
    maxTokens: 500000,
  },
};

// ─────────────────────────────────────────────────────────────────────────────────
// STORE INSTANCES (lazy initialization)
// ─────────────────────────────────────────────────────────────────────────────────

let rateLimitStore: RateLimitStore | null = null;
let sessionStore: SessionStore | null = null;
let ackTokenStore: AckTokenStore | null = null;
let blockStore: BlockStore | null = null;
let vetoHistoryStore: VetoHistoryStore | null = null;
let auditLogStore: AuditLogStore | null = null;

function getRateLimitStore(): RateLimitStore {
  if (!rateLimitStore) rateLimitStore = new RateLimitStore(getStore());
  return rateLimitStore;
}

function getSessionStore(): SessionStore {
  if (!sessionStore) sessionStore = new SessionStore(getStore());
  return sessionStore;
}

function getAckTokenStore(): AckTokenStore {
  if (!ackTokenStore) ackTokenStore = new AckTokenStore(getStore());
  return ackTokenStore;
}

function getBlockStore(): BlockStore {
  if (!blockStore) blockStore = new BlockStore(getStore());
  return blockStore;
}

function getVetoHistoryStore(): VetoHistoryStore {
  if (!vetoHistoryStore) vetoHistoryStore = new VetoHistoryStore(getStore());
  return vetoHistoryStore;
}

function getAuditLogStore(): AuditLogStore {
  if (!auditLogStore) auditLogStore = new AuditLogStore(getStore());
  return auditLogStore;
}

// ─────────────────────────────────────────────────────────────────────────────────
// JWT UTILITIES
// ─────────────────────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET ?? 'nova-dev-secret-change-in-production';
const JWT_EXPIRY = process.env.JWT_EXPIRY ?? '24h';

export function generateToken(payload: Omit<UserPayload, 'createdAt'>): string {
  const fullPayload: UserPayload = { ...payload, createdAt: Date.now() };
  return jwt.sign(fullPayload, JWT_SECRET, { expiresIn: JWT_EXPIRY as jwt.SignOptions['expiresIn'] });
}

export function verifyToken(token: string): UserPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as UserPayload;
  } catch {
    return null;
  }
}

export function generateApiKey(userId: string, tier: UserPayload['tier']): string {
  const payload: UserPayload = { userId, tier, createdAt: Date.now() };
  return 'nova_' + jwt.sign(payload, JWT_SECRET, { expiresIn: '365d' });
}

// ─────────────────────────────────────────────────────────────────────────────────
// AUTHENTICATION MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────────

export function authMiddleware(required: boolean = true) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    const apiKey = req.headers['x-api-key'] as string | undefined;

    let token: string | undefined;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else if (apiKey?.startsWith('nova_')) {
      token = apiKey.slice(5);
    }

    if (!token) {
      if (required) {
        res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
        return;
      }
      req.userId = 'anonymous';
      req.user = { userId: 'anonymous', tier: 'free', createdAt: Date.now() };
      next();
      return;
    }

    const payload = verifyToken(token);
    if (!payload) {
      res.status(401).json({ error: 'Invalid or expired token', code: 'AUTH_INVALID' });
      return;
    }

    req.user = payload;
    req.userId = payload.userId;
    next();
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// RATE LIMITING MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────────

export function rateLimitMiddleware() {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.userId ?? 'anonymous';
    const tier = req.user?.tier ?? 'free';
    const config = RATE_LIMITS[tier];
    const windowSeconds = Math.ceil(config.windowMs / 1000);

    try {
      const blocked = await getBlockStore().isBlocked(userId);
      if (blocked.blocked) {
        const retryAfter = blocked.until ? Math.ceil((blocked.until - Date.now()) / 1000) : 3600;
        res.status(429).json({
          error: `Temporarily blocked: ${blocked.reason}`,
          code: 'USER_BLOCKED',
          retryAfter,
        });
        return;
      }

      const { count } = await getRateLimitStore().increment(userId, windowSeconds);

      if (count > config.maxRequests) {
        const vetoCount = await getVetoHistoryStore().track(userId, 300);
        if (vetoCount >= 5) {
          await getBlockStore().block(userId, 'Repeated rate limit violations', 15 * 60);
        }

        res.status(429).json({
          error: 'Rate limit exceeded',
          code: 'RATE_LIMITED',
          retryAfter: windowSeconds,
          limit: config.maxRequests,
          window: windowSeconds,
        });
        return;
      }

      res.setHeader('X-RateLimit-Limit', config.maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, config.maxRequests - count));
      res.setHeader('X-RateLimit-Reset', Math.ceil(Date.now() / 1000) + windowSeconds);

      next();
    } catch (error) {
      console.error('[RATE_LIMIT] Error:', error);
      next();
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// TOKEN USAGE TRACKING
// ─────────────────────────────────────────────────────────────────────────────────

export async function trackTokenUsage(userId: string, tokens: number): Promise<boolean> {
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────────
// ABUSE DETECTION
// ─────────────────────────────────────────────────────────────────────────────────

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+(your|all|the)\s+(instructions?|guidelines?|rules?)/i,
  /you\s+are\s+now\s+(a|an|in)\s+/i,
  /pretend\s+(you('re)?|to\s+be)\s+/i,
  /jailbreak/i,
  /DAN\s+mode/i,
  /bypass\s+(your\s+)?(restrictions?|limitations?|filters?)/i,
  /\[\s*system\s*\]/i,
  /<\s*system\s*>/i,
];

const HARASSMENT_PATTERNS = [
  /\b(kill|murder|rape|torture)\s+(you|yourself|the\s+ai)/i,
  /\b(stupid|dumb|worthless)\s+(ai|bot|machine)/i,
  /you('re)?\s+(garbage|trash|useless)/i,
];

export interface AbuseCheckResult {
  detected: boolean;
  patterns: AbusePattern[];
  shouldBlock: boolean;
  message?: string;
}

export function checkForAbuse(userId: string, message: string, recentVetos: number = 0): AbuseCheckResult {
  const patterns: AbusePattern[] = [];

  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(message)) {
      patterns.push({ type: 'prompt_injection', severity: 'high', action: 'block' });
      break;
    }
  }

  for (const pattern of HARASSMENT_PATTERNS) {
    if (pattern.test(message)) {
      patterns.push({ type: 'harassment', severity: 'medium', action: 'warn' });
      break;
    }
  }

  if (recentVetos >= 3) {
    patterns.push({
      type: 'repeated_veto',
      severity: recentVetos >= 5 ? 'high' : 'medium',
      action: recentVetos >= 5 ? 'throttle' : 'warn',
    });
  }

  const shouldBlock = patterns.some(p => p.action === 'block');
  const highSeverity = patterns.some(p => p.severity === 'high');

  return {
    detected: patterns.length > 0,
    patterns,
    shouldBlock,
    message: shouldBlock
      ? 'This request has been blocked due to policy violations.'
      : highSeverity
        ? 'Warning: Your request contains potentially problematic content.'
        : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// VETO TRACKING
// ─────────────────────────────────────────────────────────────────────────────────

export async function trackVeto(userId: string): Promise<number> {
  return getVetoHistoryStore().track(userId, 300);
}

export async function getRecentVetoCount(userId: string): Promise<number> {
  return getVetoHistoryStore().getCount(userId, 300);
}

// ─────────────────────────────────────────────────────────────────────────────────
// USER BLOCKING
// ─────────────────────────────────────────────────────────────────────────────────

export async function blockUser(userId: string, reason: string, durationMs: number): Promise<void> {
  await getBlockStore().block(userId, reason, Math.ceil(durationMs / 1000));
  console.log(`[AUTH] Blocked user ${userId}: ${reason} for ${durationMs / 1000}s`);
}

export async function unblockUser(userId: string): Promise<boolean> {
  return getBlockStore().unblock(userId);
}

export async function isUserBlocked(userId: string): Promise<{ blocked: boolean; reason?: string; until?: number }> {
  return getBlockStore().isBlocked(userId);
}

// ─────────────────────────────────────────────────────────────────────────────────
// ABUSE DETECTION MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────────

export function abuseDetectionMiddleware() {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.userId ?? 'anonymous';
    const message = req.body?.message ?? '';

    if (!message) {
      next();
      return;
    }

    try {
      const recentVetos = await getRecentVetoCount(userId);
      const abuseCheck = checkForAbuse(userId, message, recentVetos);

      if (abuseCheck.shouldBlock) {
        await blockUser(userId, 'Abuse detected: ' + abuseCheck.patterns.map(p => p.type).join(', '), 60 * 60 * 1000);
        
        await getAuditLogStore().log({
          userId,
          action: 'abuse_blocked',
          details: { patterns: abuseCheck.patterns, message: message.slice(0, 100) },
        });

        res.status(403).json({
          error: abuseCheck.message,
          code: 'ABUSE_DETECTED',
          patterns: abuseCheck.patterns.map(p => p.type),
        });
        return;
      }

      (req as any).abuseCheck = abuseCheck;
      next();
    } catch (error) {
      console.error('[ABUSE] Error:', error);
      next();
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// SESSION MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────────

export const session = {
  async create(userId: string, conversationId: string) {
    await getSessionStore().create(userId, conversationId);
    return { userId, conversationId, createdAt: Date.now(), lastActivity: Date.now(), messageCount: 0, tokenCount: 0 };
  },
  async get(conversationId: string) {
    return getSessionStore().get(conversationId);
  },
  async update(conversationId: string, updates: { messageCount?: number; tokenCount?: number }) {
    await getSessionStore().update(conversationId, updates);
    return getSessionStore().get(conversationId);
  },
  async delete(conversationId: string) {
    await getSessionStore().delete(conversationId);
  },
};

// ─────────────────────────────────────────────────────────────────────────────────
// ACK TOKEN MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────────

export const ackTokens = {
  async store(token: string, userId: string) {
    await getAckTokenStore().save(token, userId, 300);
  },
  async validate(token: string, userId: string) {
    return getAckTokenStore().validate(token, userId);
  },
};

// ─────────────────────────────────────────────────────────────────────────────────
// AUDIT LOGGING
// ─────────────────────────────────────────────────────────────────────────────────

export const audit = {
  async log(entry: { userId: string; action: string; details: Record<string, any>; requestId?: string; stance?: string; status?: string }) {
    return getAuditLogStore().log(entry);
  },
  async getUserLogs(userId: string, limit?: number) {
    return getAuditLogStore().getUserLogs(userId, limit);
  },
  async getGlobalLogs(limit?: number) {
    return getAuditLogStore().getGlobalLogs(limit);
  },
};

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export const auth = {
  generateToken,
  verifyToken,
  generateApiKey,
  middleware: authMiddleware,
  rateLimit: rateLimitMiddleware,
  abuseDetection: abuseDetectionMiddleware,
  trackVeto,
  trackTokenUsage,
  blockUser,
  unblockUser,
  isUserBlocked,
  session,
  ackTokens,
  audit,
};
