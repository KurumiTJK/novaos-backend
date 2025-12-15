// ═══════════════════════════════════════════════════════════════════════════════
// REQUEST MIDDLEWARE — RequestId, Logging, Timing
// ═══════════════════════════════════════════════════════════════════════════════

import type { Request, Response, NextFunction } from 'express';
import { logRequest, getLogger } from '../../logging/index.js';
import { loadConfig } from '../../config/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// EXTEND EXPRESS TYPES
// ─────────────────────────────────────────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      startTime: number;
      logger: ReturnType<typeof getLogger>;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// REQUEST ID MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────────

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Use existing request ID from header or generate new one
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  
  req.requestId = requestId;
  req.startTime = Date.now();
  
  // Create request-scoped logger
  req.logger = getLogger({ requestId });
  
  // Add request ID to response headers for tracing
  res.setHeader('X-Request-Id', requestId);
  
  next();
}

// ─────────────────────────────────────────────────────────────────────────────────
// REQUEST LOGGING MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────────

export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const config = loadConfig();
  
  // Log on response finish
  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    
    // Skip health check logging in production to reduce noise
    if (config.env.isProduction && (req.path === '/health' || req.path === '/ready' || req.path === '/')) {
      return;
    }
    
    logRequest({
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      requestId: req.requestId,
      userId: (req as any).userId,
      userAgent: req.headers['user-agent'],
      ip: config.features.redactPII ? undefined : req.ip,
    });
  });
  
  next();
}

// ─────────────────────────────────────────────────────────────────────────────────
// COMBINED MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────────

export function requestMiddleware(req: Request, res: Response, next: NextFunction): void {
  requestIdMiddleware(req, res, (err) => {
    if (err) return next(err);
    requestLoggingMiddleware(req, res, next);
  });
}
