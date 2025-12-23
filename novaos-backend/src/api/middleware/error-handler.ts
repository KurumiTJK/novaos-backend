// ═══════════════════════════════════════════════════════════════════════════════
// ERROR HANDLER — Sanitized Error Responses for API Routes
// NovaOS API Layer — Phase 14
// ═══════════════════════════════════════════════════════════════════════════════
//
// This middleware:
// 1. Logs full error details internally (for debugging)
// 2. Sanitizes error responses (hides internals in production)
// 3. Maps error types to appropriate HTTP status codes
// 4. Provides consistent error response format
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { getLogger } from '../../logging/index.js';
import type { AppError } from '../../types/result.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'api-error-handler' });

// ─────────────────────────────────────────────────────────────────────────────────
// ERROR TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Client-facing error with status code.
 * These errors are safe to expose to clients.
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number = 400,
    code: string = 'BAD_REQUEST',
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true; // Operational errors are expected and handled
  }
}

/**
 * Not found error (404).
 */
export class NotFoundError extends ApiError {
  constructor(resource: string = 'Resource', id?: string) {
    const message = id ? `${resource} not found: ${id}` : `${resource} not found`;
    super(message, 404, 'NOT_FOUND');
  }
}

/**
 * Validation error (400).
 */
export class ValidationError extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

/**
 * Unauthorized error (401).
 */
export class UnauthorizedError extends ApiError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

/**
 * Forbidden error (403).
 */
export class ForbiddenError extends ApiError {
  constructor(message: string = 'Access denied') {
    super(message, 403, 'FORBIDDEN');
  }
}

/**
 * Conflict error (409).
 */
export class ConflictError extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 409, 'CONFLICT', details);
  }
}

/**
 * Rate limit error (429).
 */
export class RateLimitError extends ApiError {
  readonly retryAfter: number;

  constructor(retryAfterSeconds: number = 60) {
    super('Too many requests', 429, 'RATE_LIMITED', { retryAfter: retryAfterSeconds });
    this.retryAfter = retryAfterSeconds;
  }
}

/**
 * Internal server error (500).
 * Message is sanitized in production.
 */
export class InternalError extends ApiError {
  constructor(message: string = 'Internal server error') {
    super(message, 500, 'INTERNAL_ERROR');
    this.isOperational = false; // Non-operational errors are unexpected
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// ERROR RESPONSE FORMAT
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Standardized error response format.
 */
export interface ErrorResponse {
  readonly error: string;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly requestId?: string;
  readonly timestamp: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// ERROR MAPPING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Map AppError codes to HTTP status codes.
 */
const APP_ERROR_STATUS_MAP: Record<string, number> = {
  // Validation
  VALIDATION_ERROR: 400,
  INVALID_INPUT: 400,
  
  // Not found
  NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  GOAL_NOT_FOUND: 404,
  QUEST_NOT_FOUND: 404,
  STEP_NOT_FOUND: 404,
  SPARK_NOT_FOUND: 404,
  
  // Authorization
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  
  // Rate limiting
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 429,
  
  // Conflict
  CONFLICT: 409,
  ALREADY_EXISTS: 409,
  VERSION_CONFLICT: 409,
  
  // External services
  PROVIDER_ERROR: 502,
  TIMEOUT: 504,
  NETWORK_ERROR: 502,
  
  // Internal
  INTERNAL_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  CONFIGURATION_ERROR: 500,
};

/**
 * Check if an object is an AppError.
 */
function isAppError(error: unknown): error is AppError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    typeof (error as AppError).code === 'string' &&
    typeof (error as AppError).message === 'string'
  );
}

/**
 * Check if an object is an ApiError.
 */
function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Check if an object is a ZodError.
 */
function isZodError(error: unknown): error is ZodError {
  return error instanceof ZodError;
}

// ─────────────────────────────────────────────────────────────────────────────────
// ZOD ERROR FORMATTING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Format Zod validation errors into a readable structure.
 */
function formatZodError(error: ZodError): { message: string; details: Record<string, string[]> } {
  const details: Record<string, string[]> = {};
  
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_root';
    if (!details[path]) {
      details[path] = [];
    }
    details[path].push(issue.message);
  }
  
  // Create a summary message
  const issueCount = error.issues.length;
  const message = issueCount === 1
    ? error.issues[0]!.message
    : `Validation failed with ${issueCount} errors`;
  
  return { message, details };
}

// ─────────────────────────────────────────────────────────────────────────────────
// ERROR SANITIZATION
// ─────────────────────────────────────────────────────────────────────────────────

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Sensitive patterns to redact from error messages.
 */
const SENSITIVE_PATTERNS = [
  /password/gi,
  /secret/gi,
  /token/gi,
  /api[_-]?key/gi,
  /authorization/gi,
  /bearer/gi,
  /credential/gi,
];

/**
 * Check if a message contains sensitive information.
 */
function containsSensitiveInfo(message: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Sanitize an error message for client response.
 */
function sanitizeMessage(message: string, statusCode: number): string {
  // Always sanitize 5xx errors in production
  if (IS_PRODUCTION && statusCode >= 500) {
    return 'An unexpected error occurred';
  }
  
  // Sanitize if contains sensitive info
  if (containsSensitiveInfo(message)) {
    return 'An error occurred';
  }
  
  return message;
}

/**
 * Sanitize error details for client response.
 */
function sanitizeDetails(
  details: Record<string, unknown> | undefined,
  statusCode: number
): Record<string, unknown> | undefined {
  // Never include details for 5xx in production
  if (IS_PRODUCTION && statusCode >= 500) {
    return undefined;
  }
  
  if (!details) {
    return undefined;
  }
  
  // Remove potentially sensitive keys
  const sanitized: Record<string, unknown> = {};
  const sensitiveKeys = ['password', 'token', 'secret', 'key', 'authorization', 'cookie'];
  
  for (const [key, value] of Object.entries(details)) {
    const lowerKey = key.toLowerCase();
    if (!sensitiveKeys.some((s) => lowerKey.includes(s))) {
      sanitized[key] = value;
    }
  }
  
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────────
// REQUEST CONTEXT
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Extract request ID from request object.
 */
function getRequestId(req: Request): string | undefined {
  return (req as any).requestId ?? req.headers['x-request-id'] as string;
}

/**
 * Extract user ID from request object.
 */
function getUserId(req: Request): string | undefined {
  return (req as any).userId ?? (req as any).user?.userId;
}

// ─────────────────────────────────────────────────────────────────────────────────
// ERROR HANDLER MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Express error handling middleware.
 * 
 * Must be registered as the LAST middleware in the chain.
 * 
 * @example
 * app.use('/api', router);
 * app.use(errorHandler); // Must be last
 */
export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = getRequestId(req);
  const userId = getUserId(req);
  
  let statusCode: number;
  let code: string;
  let message: string;
  let details: Record<string, unknown> | undefined;
  
  // ─── HANDLE DIFFERENT ERROR TYPES ───
  
  if (isApiError(error)) {
    // Our custom API errors
    statusCode = error.statusCode;
    code = error.code;
    message = error.message;
    details = error.details;
    
    // Log operational errors at warn level
    if (error.isOperational) {
      logger.warn('API error', {
        code,
        message,
        statusCode,
        requestId,
        userId,
        path: req.path,
        method: req.method,
      });
    } else {
      // Non-operational errors are unexpected
      logger.error('Unexpected API error', error, {
        requestId,
        userId,
        path: req.path,
        method: req.method,
      });
    }
  } else if (isZodError(error)) {
    // Zod validation errors
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    const formatted = formatZodError(error);
    message = formatted.message;
    details = formatted.details;
    
    logger.warn('Validation error', {
      code,
      message,
      details,
      requestId,
      userId,
      path: req.path,
      method: req.method,
    });
  } else if (isAppError(error)) {
    // Result pattern AppError
    statusCode = APP_ERROR_STATUS_MAP[error.code] ?? 500;
    code = error.code;
    message = error.message;
    details = error.context as Record<string, unknown>;
    
    logger.warn('Application error', {
      code,
      message,
      statusCode,
      requestId,
      userId,
      path: req.path,
      method: req.method,
      context: error.context,
    });
  } else if (error instanceof SyntaxError && 'body' in error) {
    // JSON parsing error
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'Invalid JSON in request body';
    
    logger.warn('JSON parse error', {
      code,
      message,
      requestId,
      userId,
      path: req.path,
      method: req.method,
    });
  } else {
    // Unknown/unexpected errors
    statusCode = 500;
    code = 'INTERNAL_ERROR';
    message = error.message || 'An unexpected error occurred';
    
    // Log full error for debugging
    logger.error('Unhandled error', error, {
      requestId,
      userId,
      path: req.path,
      method: req.method,
      stack: error.stack,
    });
  }
  
  // ─── BUILD RESPONSE ───
  
  const response: ErrorResponse = {
    error: sanitizeMessage(message, statusCode),
    code,
    details: sanitizeDetails(details, statusCode),
    requestId,
    timestamp: new Date().toISOString(),
  };
  
  // Remove undefined fields
  if (!response.details) delete (response as any).details;
  if (!response.requestId) delete (response as any).requestId;
  
  // ─── SEND RESPONSE ───
  
  // Set rate limit header if applicable
  if (error instanceof RateLimitError) {
    res.setHeader('Retry-After', error.retryAfter);
  }
  
  res.status(statusCode).json(response);
}

// ─────────────────────────────────────────────────────────────────────────────────
// NOT FOUND HANDLER
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Middleware for handling 404 Not Found.
 * 
 * Register AFTER all routes but BEFORE error handler.
 * 
 * @example
 * app.use('/api', router);
 * app.use(notFoundHandler);
 * app.use(errorHandler);
 */
export function notFoundHandler(
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = getRequestId(req);
  
  logger.debug('Route not found', {
    path: req.path,
    method: req.method,
    requestId,
  });
  
  const response: ErrorResponse = {
    error: `Cannot ${req.method} ${req.path}`,
    code: 'NOT_FOUND',
    requestId,
    timestamp: new Date().toISOString(),
  };
  
  if (!response.requestId) delete (response as any).requestId;
  
  res.status(404).json(response);
}

// ─────────────────────────────────────────────────────────────────────────────────
// ASYNC HANDLER WRAPPER
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Wrap async route handlers to catch errors and forward to error handler.
 * 
 * @example
 * router.get('/goals', asyncHandler(async (req, res) => {
 *   const goals = await getGoals();
 *   res.json({ goals });
 * }));
 */
export function asyncHandler<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: T, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Backward compatibility with existing ClientError
  ApiError as ClientError,
};
