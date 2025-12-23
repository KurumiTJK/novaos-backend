// ═══════════════════════════════════════════════════════════════════════════════
// ERROR HANDLER TESTS — Middleware Unit Tests
// NovaOS API Layer — Phase 14
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { ZodError, z } from 'zod';
import {
  errorHandler,
  ApiError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  RateLimitError,
  InternalError,
  asyncHandler,
} from '../middleware/error-handler.js';

// ─────────────────────────────────────────────────────────────────────────────────
// MOCKS
// ─────────────────────────────────────────────────────────────────────────────────

function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    path: '/test',
    method: 'GET',
    headers: {},
    ...overrides,
  } as Request;
}

function createMockResponse(): Response & { 
  _status: number; 
  _json: unknown;
  _headers: Record<string, string>;
} {
  const res = {
    _status: 200,
    _json: null,
    _headers: {} as Record<string, string>,
    status(code: number) {
      this._status = code;
      return this;
    },
    json(data: unknown) {
      this._json = data;
      return this;
    },
    setHeader(name: string, value: string) {
      this._headers[name] = value;
      return this;
    },
  };
  return res as any;
}

const mockNext: NextFunction = vi.fn();

// ─────────────────────────────────────────────────────────────────────────────────
// ERROR CLASSES
// ─────────────────────────────────────────────────────────────────────────────────

describe('Error Classes', () => {
  describe('ApiError', () => {
    it('should create error with defaults', () => {
      const error = new ApiError('Something went wrong');
      expect(error.message).toBe('Something went wrong');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('BAD_REQUEST');
      expect(error.isOperational).toBe(true);
    });

    it('should create error with custom values', () => {
      const error = new ApiError('Custom error', 422, 'UNPROCESSABLE', { field: 'test' });
      expect(error.statusCode).toBe(422);
      expect(error.code).toBe('UNPROCESSABLE');
      expect(error.details).toEqual({ field: 'test' });
    });
  });

  describe('NotFoundError', () => {
    it('should create 404 error with resource name', () => {
      const error = new NotFoundError('Goal');
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('NOT_FOUND');
      expect(error.message).toBe('Goal not found');
    });

    it('should include ID in message', () => {
      const error = new NotFoundError('Goal', 'goal_123');
      expect(error.message).toBe('Goal not found: goal_123');
    });
  });

  describe('ValidationError', () => {
    it('should create 400 error', () => {
      const error = new ValidationError('Invalid input', { field: 'title' });
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.details).toEqual({ field: 'title' });
    });
  });

  describe('UnauthorizedError', () => {
    it('should create 401 error with default message', () => {
      const error = new UnauthorizedError();
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('UNAUTHORIZED');
      expect(error.message).toBe('Authentication required');
    });
  });

  describe('ForbiddenError', () => {
    it('should create 403 error', () => {
      const error = new ForbiddenError('Not allowed');
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe('FORBIDDEN');
    });
  });

  describe('ConflictError', () => {
    it('should create 409 error', () => {
      const error = new ConflictError('Resource already exists');
      expect(error.statusCode).toBe(409);
      expect(error.code).toBe('CONFLICT');
    });
  });

  describe('RateLimitError', () => {
    it('should create 429 error with retryAfter', () => {
      const error = new RateLimitError(120);
      expect(error.statusCode).toBe(429);
      expect(error.code).toBe('RATE_LIMITED');
      expect(error.retryAfter).toBe(120);
      expect(error.details).toEqual({ retryAfter: 120 });
    });
  });

  describe('InternalError', () => {
    it('should create 500 error', () => {
      const error = new InternalError('Database connection failed');
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe('INTERNAL_ERROR');
      expect(error.isOperational).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// ERROR HANDLER MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────────

describe('errorHandler middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle ApiError', () => {
    const req = createMockRequest();
    const res = createMockResponse();
    const error = new NotFoundError('Goal', 'goal_123');

    errorHandler(error, req, res, mockNext);

    expect(res._status).toBe(404);
    expect(res._json).toMatchObject({
      error: 'Goal not found: goal_123',
      code: 'NOT_FOUND',
    });
  });

  it('should handle ValidationError with details', () => {
    const req = createMockRequest();
    const res = createMockResponse();
    const error = new ValidationError('Invalid input', { 
      fields: { title: ['Required'] } 
    });

    errorHandler(error, req, res, mockNext);

    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({
      error: 'Invalid input',
      code: 'VALIDATION_ERROR',
      details: { fields: { title: ['Required'] } },
    });
  });

  it('should handle ZodError', () => {
    const req = createMockRequest();
    const res = createMockResponse();
    
    const schema = z.object({
      title: z.string().min(1, 'Title is required'),
      count: z.number().positive('Count must be positive'),
    });
    
    const result = schema.safeParse({ title: '', count: -1 });
    if (!result.success) {
      errorHandler(result.error, req, res, mockNext);
    }

    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect((res._json as any).details).toBeDefined();
  });

  it('should handle RateLimitError with Retry-After header', () => {
    const req = createMockRequest();
    const res = createMockResponse();
    const error = new RateLimitError(60);

    errorHandler(error, req, res, mockNext);

    expect(res._status).toBe(429);
    expect(res._headers['Retry-After']).toBe('60');
  });

  it('should handle JSON parse errors', () => {
    const req = createMockRequest();
    const res = createMockResponse();
    const error = new SyntaxError('Unexpected token');
    (error as any).body = '{ invalid json }';

    errorHandler(error, req, res, mockNext);

    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({
      error: 'Invalid JSON in request body',
      code: 'INVALID_JSON',
    });
  });

  it('should handle unknown errors as 500', () => {
    const req = createMockRequest();
    const res = createMockResponse();
    const error = new Error('Something unexpected');

    errorHandler(error, req, res, mockNext);

    expect(res._status).toBe(500);
    expect(res._json).toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });

  it('should include requestId in response', () => {
    const req = createMockRequest({ requestId: 'req_123' } as any);
    const res = createMockResponse();
    const error = new NotFoundError('Goal');

    errorHandler(error, req, res, mockNext);

    expect((res._json as any).requestId).toBe('req_123');
  });

  it('should include timestamp in response', () => {
    const req = createMockRequest();
    const res = createMockResponse();
    const error = new NotFoundError('Goal');

    errorHandler(error, req, res, mockNext);

    expect((res._json as any).timestamp).toBeDefined();
    expect(new Date((res._json as any).timestamp).getTime()).not.toBeNaN();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// ERROR SANITIZATION
// ─────────────────────────────────────────────────────────────────────────────────

describe('Error sanitization', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('should sanitize 500 errors in production', () => {
    process.env.NODE_ENV = 'production';
    
    const req = createMockRequest();
    const res = createMockResponse();
    const error = new InternalError('Database connection string: postgres://user:pass@host');

    errorHandler(error, req, res, mockNext);

    expect(res._status).toBe(500);
    expect((res._json as any).error).toBe('An unexpected error occurred');
    expect((res._json as any).details).toBeUndefined();
  });

  it('should show details in development', () => {
    process.env.NODE_ENV = 'development';
    
    const req = createMockRequest();
    const res = createMockResponse();
    const error = new ApiError('Detailed error', 400, 'TEST', { debug: 'info' });

    errorHandler(error, req, res, mockNext);

    expect(res._status).toBe(400);
    expect((res._json as any).details).toEqual({ debug: 'info' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// ASYNC HANDLER
// ─────────────────────────────────────────────────────────────────────────────────

describe('asyncHandler', () => {
  it('should pass successful async results through', async () => {
    const req = createMockRequest();
    const res = createMockResponse();
    const next = vi.fn();

    const handler = asyncHandler(async (_req, res) => {
      res.json({ success: true });
    });

    await handler(req, res, next);

    expect(res._json).toEqual({ success: true });
    expect(next).not.toHaveBeenCalled();
  });

  it('should catch async errors and pass to next', async () => {
    const req = createMockRequest();
    const res = createMockResponse();
    const next = vi.fn();

    const error = new NotFoundError('Goal');
    const handler = asyncHandler(async () => {
      throw error;
    });

    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it('should handle rejected promises', async () => {
    const req = createMockRequest();
    const res = createMockResponse();
    const next = vi.fn();

    const error = new Error('Promise rejected');
    const handler = asyncHandler(async () => {
      return Promise.reject(error);
    });

    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// APP ERROR MAPPING
// ─────────────────────────────────────────────────────────────────────────────────

describe('AppError mapping', () => {
  it('should map NOT_FOUND to 404', () => {
    const req = createMockRequest();
    const res = createMockResponse();
    const error = { code: 'NOT_FOUND', message: 'Resource not found' };

    errorHandler(error as any, req, res, mockNext);

    expect(res._status).toBe(404);
  });

  it('should map RATE_LIMITED to 429', () => {
    const req = createMockRequest();
    const res = createMockResponse();
    const error = { code: 'RATE_LIMITED', message: 'Too many requests' };

    errorHandler(error as any, req, res, mockNext);

    expect(res._status).toBe(429);
  });

  it('should map PROVIDER_ERROR to 502', () => {
    const req = createMockRequest();
    const res = createMockResponse();
    const error = { code: 'PROVIDER_ERROR', message: 'External service failed' };

    errorHandler(error as any, req, res, mockNext);

    expect(res._status).toBe(502);
  });

  it('should map unknown codes to 500', () => {
    const req = createMockRequest();
    const res = createMockResponse();
    const error = { code: 'UNKNOWN_CODE', message: 'Something happened' };

    errorHandler(error as any, req, res, mockNext);

    expect(res._status).toBe(500);
  });
});
