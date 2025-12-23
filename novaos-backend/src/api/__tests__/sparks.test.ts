// ═══════════════════════════════════════════════════════════════════════════════
// SPARK ROUTES TESTS — Integration Tests for Spark Endpoints
// NovaOS API Layer — Phase 14
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createSparkRouter } from '../routes/sparks.js';
import { errorHandler } from '../middleware/error-handler.js';

// ─────────────────────────────────────────────────────────────────────────────────
// MOCKS
// ─────────────────────────────────────────────────────────────────────────────────

// Mock auth
vi.mock('../../auth/index.js', () => ({
  auth: {
    middleware: (required: boolean) => (req: any, res: any, next: any) => {
      if (required && !req.headers.authorization) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      req.userId = 'user_123';
      req.user = { userId: 'user_123', tier: 'pro' };
      req.requestId = 'req_test_123';
      next();
    },
  },
}));

// Mock rate limiter
vi.mock('../../security/rate-limiting/index.js', () => ({
  createRateLimiter: () => (_req: any, _res: any, next: any) => next(),
  RateLimitCategory: { SPARK_GENERATION: 'SPARK_GENERATION' },
}));

// Mock logger
vi.mock('../../logging/index.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock sword store and generator
const mockSparks = new Map<string, any>();

vi.mock('../../core/sword/index.js', () => ({
  getSwordStore: () => ({
    getSpark: vi.fn(async (id: string) => mockSparks.get(id) || null),
    getActiveSpark: vi.fn(async (userId: string) => {
      const sparks = Array.from(mockSparks.values());
      return sparks.find(s => s.userId === userId && s.status === 'accepted') || null;
    }),
    getUserSparks: vi.fn(async (userId: string) => {
      return Array.from(mockSparks.values()).filter(s => s.userId === userId);
    }),
    transitionSparkState: vi.fn(async (id: string, event: string) => {
      const spark = mockSparks.get(id);
      if (!spark) return { success: false, error: 'Spark not found' };
      
      const transitions: Record<string, Record<string, string>> = {
        suggested: { accept: 'accepted', skip: 'skipped' },
        accepted: { complete: 'completed', skip: 'skipped' },
      };
      
      const newStatus = transitions[spark.status]?.[event];
      if (!newStatus) {
        return { 
          success: false, 
          error: `Invalid transition: ${event} from ${spark.status}`,
          allowedEvents: Object.keys(transitions[spark.status] || {}),
        };
      }
      
      spark.status = newStatus;
      if (newStatus === 'completed') spark.completedAt = new Date().toISOString();
      mockSparks.set(id, spark);
      return { success: true, spark };
    }),
    updateSpark: vi.fn(async (id: string, updates: any) => {
      const spark = mockSparks.get(id);
      if (!spark) return null;
      Object.assign(spark, updates);
      mockSparks.set(id, spark);
      return spark;
    }),
  }),
  getSparkGenerator: () => ({
    generate: vi.fn(async (userId: string, input: any) => {
      const spark = {
        id: `spark_${Date.now()}`,
        userId,
        stepId: input.stepId,
        questId: input.questId,
        goalId: input.goalId,
        action: 'Generated action',
        estimatedMinutes: input.maxMinutes || 15,
        frictionLevel: input.frictionLevel || 'minimal',
        status: 'suggested',
        createdAt: new Date().toISOString(),
      };
      mockSparks.set(spark.id, spark);
      return spark;
    }),
    generateNextSpark: vi.fn(async (userId: string, goalId: string) => {
      const spark = {
        id: `spark_${Date.now()}`,
        userId,
        goalId,
        action: 'Next spark action',
        estimatedMinutes: 15,
        status: 'suggested',
        createdAt: new Date().toISOString(),
      };
      mockSparks.set(spark.id, spark);
      return spark;
    }),
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────────
// TEST SETUP
// ─────────────────────────────────────────────────────────────────────────────────

function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/sparks', createSparkRouter());
  app.use(errorHandler);
  return app;
}

describe('Spark Routes', () => {
  let app: Express;

  beforeEach(() => {
    app = createTestApp();
    mockSparks.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GENERATE SPARK
  // ─────────────────────────────────────────────────────────────────────────────

  describe('POST /sparks/generate', () => {
    it('should generate a spark with stepId', async () => {
      const res = await request(app)
        .post('/sparks/generate')
        .set('Authorization', 'Bearer test-token')
        .send({
          stepId: 'step_123',
        });

      expect(res.status).toBe(201);
      expect(res.body.spark).toBeDefined();
      expect(res.body.spark.stepId).toBe('step_123');
      expect(res.body.spark.status).toBe('suggested');
      expect(res.body._links.complete).toBeDefined();
      expect(res.body._links.skip).toBeDefined();
    });

    it('should accept optional parameters', async () => {
      const res = await request(app)
        .post('/sparks/generate')
        .set('Authorization', 'Bearer test-token')
        .send({
          goalId: 'goal_123',
          maxMinutes: 30,
          frictionLevel: 'low',
          context: 'Morning session',
        });

      expect(res.status).toBe(201);
      expect(res.body.spark.estimatedMinutes).toBe(30);
      expect(res.body.spark.frictionLevel).toBe('low');
    });

    it('should reject without any ID', async () => {
      const res = await request(app)
        .post('/sparks/generate')
        .set('Authorization', 'Bearer test-token')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid maxMinutes', async () => {
      const res = await request(app)
        .post('/sparks/generate')
        .set('Authorization', 'Bearer test-token')
        .send({
          stepId: 'step_123',
          maxMinutes: 200, // > 120
        });

      expect(res.status).toBe(400);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET ACTIVE SPARK
  // ─────────────────────────────────────────────────────────────────────────────

  describe('GET /sparks/active', () => {
    it('should return active spark', async () => {
      mockSparks.set('spark_active', {
        id: 'spark_active',
        userId: 'user_123',
        action: 'Active spark',
        status: 'accepted',
      });

      const res = await request(app)
        .get('/sparks/active')
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body.spark).toBeDefined();
      expect(res.body.spark.id).toBe('spark_active');
    });

    it('should return null when no active spark', async () => {
      const res = await request(app)
        .get('/sparks/active')
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body.spark).toBeNull();
      expect(res.body.message).toContain('No active spark');
      expect(res.body._links.generate).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // LIST SPARKS
  // ─────────────────────────────────────────────────────────────────────────────

  describe('GET /sparks', () => {
    beforeEach(() => {
      mockSparks.set('spark_1', {
        id: 'spark_1',
        userId: 'user_123',
        status: 'completed',
        createdAt: '2025-01-01T00:00:00Z',
      });
      mockSparks.set('spark_2', {
        id: 'spark_2',
        userId: 'user_123',
        status: 'suggested',
        stepId: 'step_123',
        createdAt: '2025-01-02T00:00:00Z',
      });
      mockSparks.set('spark_3', {
        id: 'spark_3',
        userId: 'other_user',
        status: 'suggested',
        createdAt: '2025-01-03T00:00:00Z',
      });
    });

    it('should list sparks for user', async () => {
      const res = await request(app)
        .get('/sparks')
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body.sparks).toHaveLength(2);
      expect(res.body.pagination).toBeDefined();
    });

    it('should filter by status', async () => {
      const res = await request(app)
        .get('/sparks?status=completed')
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body.sparks).toHaveLength(1);
      expect(res.body.sparks[0].status).toBe('completed');
    });

    it('should filter by stepId', async () => {
      const res = await request(app)
        .get('/sparks?stepId=step_123')
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body.sparks).toHaveLength(1);
      expect(res.body.sparks[0].stepId).toBe('step_123');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // COMPLETE SPARK
  // ─────────────────────────────────────────────────────────────────────────────

  describe('POST /sparks/:id/complete', () => {
    beforeEach(() => {
      mockSparks.set('spark_123', {
        id: 'spark_123',
        userId: 'user_123',
        status: 'accepted',
        action: 'Test spark',
      });
    });

    it('should complete spark', async () => {
      const res = await request(app)
        .post('/sparks/spark_123/complete')
        .set('Authorization', 'Bearer test-token')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.completed).toBe(true);
      expect(res.body.spark.status).toBe('completed');
    });

    it('should accept completion data', async () => {
      const res = await request(app)
        .post('/sparks/spark_123/complete')
        .set('Authorization', 'Bearer test-token')
        .send({
          notes: 'Completed successfully',
          actualMinutes: 12,
          satisfactionRating: 4,
        });

      expect(res.status).toBe(200);
      expect(res.body.completed).toBe(true);
    });

    it('should reject invalid satisfaction rating', async () => {
      const res = await request(app)
        .post('/sparks/spark_123/complete')
        .set('Authorization', 'Bearer test-token')
        .send({
          satisfactionRating: 10,
        });

      expect(res.status).toBe(400);
    });

    it('should return 404 for non-existent spark', async () => {
      const res = await request(app)
        .post('/sparks/nonexistent/complete')
        .set('Authorization', 'Bearer test-token')
        .send({});

      expect(res.status).toBe(404);
    });

    it('should reject completing already completed spark', async () => {
      mockSparks.set('spark_completed', {
        id: 'spark_completed',
        userId: 'user_123',
        status: 'completed',
      });

      const res = await request(app)
        .post('/sparks/spark_completed/complete')
        .set('Authorization', 'Bearer test-token')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SKIP SPARK
  // ─────────────────────────────────────────────────────────────────────────────

  describe('POST /sparks/:id/skip', () => {
    beforeEach(() => {
      mockSparks.set('spark_123', {
        id: 'spark_123',
        userId: 'user_123',
        status: 'suggested',
        stepId: 'step_123',
      });
    });

    it('should skip spark with reason', async () => {
      const res = await request(app)
        .post('/sparks/spark_123/skip')
        .set('Authorization', 'Bearer test-token')
        .send({
          reason: 'no_time',
        });

      expect(res.status).toBe(200);
      expect(res.body.skipped).toBe(true);
      expect(res.body.spark.status).toBe('skipped');
      expect(res.body.reason).toBe('no_time');
    });

    it('should require reason', async () => {
      const res = await request(app)
        .post('/sparks/spark_123/skip')
        .set('Authorization', 'Bearer test-token')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid reason', async () => {
      const res = await request(app)
        .post('/sparks/spark_123/skip')
        .set('Authorization', 'Bearer test-token')
        .send({
          reason: 'invalid_reason',
        });

      expect(res.status).toBe(400);
    });

    it('should generate new spark when reschedule is true', async () => {
      const res = await request(app)
        .post('/sparks/spark_123/skip')
        .set('Authorization', 'Bearer test-token')
        .send({
          reason: 'no_time',
          reschedule: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.skipped).toBe(true);
      expect(res.body.newSpark).toBeDefined();
      expect(res.body._links.newSpark).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // ACCEPT SPARK
  // ─────────────────────────────────────────────────────────────────────────────

  describe('POST /sparks/:id/accept', () => {
    beforeEach(() => {
      mockSparks.set('spark_123', {
        id: 'spark_123',
        userId: 'user_123',
        status: 'suggested',
      });
    });

    it('should accept a suggested spark', async () => {
      const res = await request(app)
        .post('/sparks/spark_123/accept')
        .set('Authorization', 'Bearer test-token')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.accepted).toBe(true);
      expect(res.body.spark.status).toBe('accepted');
    });

    it('should accept with scheduled time', async () => {
      const res = await request(app)
        .post('/sparks/spark_123/accept')
        .set('Authorization', 'Bearer test-token')
        .send({
          scheduledFor: '2025-01-15T10:00:00Z',
        });

      expect(res.status).toBe(200);
      expect(res.body.accepted).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TRANSITION SPARK
  // ─────────────────────────────────────────────────────────────────────────────

  describe('POST /sparks/:id/transition', () => {
    beforeEach(() => {
      mockSparks.set('spark_123', {
        id: 'spark_123',
        userId: 'user_123',
        status: 'suggested',
      });
    });

    it('should transition spark state', async () => {
      const res = await request(app)
        .post('/sparks/spark_123/transition')
        .set('Authorization', 'Bearer test-token')
        .send({ type: 'accept' });

      expect(res.status).toBe(200);
      expect(res.body.transition.from).toBe('suggested');
      expect(res.body.transition.to).toBe('accepted');
    });

    it('should reject invalid transition type', async () => {
      const res = await request(app)
        .post('/sparks/spark_123/transition')
        .set('Authorization', 'Bearer test-token')
        .send({ type: 'invalid' });

      expect(res.status).toBe(400);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // OWNERSHIP CHECKS
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Ownership checks', () => {
    it('should return 404 for other user\'s spark', async () => {
      mockSparks.set('other_spark', {
        id: 'other_spark',
        userId: 'other_user',
        status: 'suggested',
      });

      const res = await request(app)
        .get('/sparks/other_spark')
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(404);
    });

    it('should not allow completing other user\'s spark', async () => {
      mockSparks.set('other_spark', {
        id: 'other_spark',
        userId: 'other_user',
        status: 'accepted',
      });

      const res = await request(app)
        .post('/sparks/other_spark/complete')
        .set('Authorization', 'Bearer test-token')
        .send({});

      expect(res.status).toBe(404);
    });
  });
});
