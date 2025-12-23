// ═══════════════════════════════════════════════════════════════════════════════
// GOAL ROUTES TESTS — Integration Tests for Goal Endpoints
// NovaOS API Layer — Phase 14
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createGoalRouter } from '../routes/goals.js';
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
  RateLimitCategory: { GOAL_CREATION: 'GOAL_CREATION' },
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

// Mock sword store
const mockGoals = new Map<string, any>();
const mockQuests = new Map<string, any>();

vi.mock('../../core/sword/index.js', () => ({
  getSwordStore: () => ({
    createGoal: vi.fn(async (userId: string, input: any) => {
      const goal = {
        id: `goal_${Date.now()}`,
        userId,
        ...input,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      mockGoals.set(goal.id, goal);
      return goal;
    }),
    getUserGoals: vi.fn(async (userId: string, status?: string) => {
      const goals = Array.from(mockGoals.values()).filter(g => g.userId === userId);
      if (status) return goals.filter(g => g.status === status);
      return goals;
    }),
    getGoal: vi.fn(async (id: string) => mockGoals.get(id) || null),
    updateGoal: vi.fn(async (id: string, updates: any) => {
      const goal = mockGoals.get(id);
      if (!goal) return null;
      const updated = { ...goal, ...updates, updatedAt: new Date().toISOString() };
      mockGoals.set(id, updated);
      return updated;
    }),
    deleteGoal: vi.fn(async (id: string) => {
      mockGoals.delete(id);
    }),
    transitionGoalState: vi.fn(async (id: string, event: string) => {
      const goal = mockGoals.get(id);
      if (!goal) return { success: false, error: 'Goal not found' };
      
      const transitions: Record<string, Record<string, string>> = {
        active: { pause: 'paused', complete: 'completed', abandon: 'abandoned' },
        paused: { resume: 'active', abandon: 'abandoned' },
      };
      
      const newStatus = transitions[goal.status]?.[event];
      if (!newStatus) {
        return { 
          success: false, 
          error: `Invalid transition: ${event} from ${goal.status}`,
          allowedEvents: Object.keys(transitions[goal.status] || {}),
        };
      }
      
      goal.status = newStatus;
      mockGoals.set(id, goal);
      return { success: true, goal };
    }),
    getQuestsForGoal: vi.fn(async (goalId: string) => {
      return Array.from(mockQuests.values()).filter(q => q.goalId === goalId);
    }),
    getPath: vi.fn(async () => null),
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────────
// TEST SETUP
// ─────────────────────────────────────────────────────────────────────────────────

function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/goals', createGoalRouter());
  app.use(errorHandler);
  return app;
}

describe('Goal Routes', () => {
  let app: Express;

  beforeEach(() => {
    app = createTestApp();
    mockGoals.clear();
    mockQuests.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // CREATE GOAL
  // ─────────────────────────────────────────────────────────────────────────────

  describe('POST /goals', () => {
    it('should create a goal with valid input', async () => {
      const res = await request(app)
        .post('/goals')
        .set('Authorization', 'Bearer test-token')
        .send({
          title: 'Learn TypeScript',
          description: 'Master TypeScript for backend development',
          desiredOutcome: 'Build production-ready applications',
        });

      expect(res.status).toBe(201);
      expect(res.body.goal).toBeDefined();
      expect(res.body.goal.title).toBe('Learn TypeScript');
      expect(res.body.goal.status).toBe('active');
      expect(res.body._links).toBeDefined();
      expect(res.body._links.self).toContain('/goals/');
    });

    it('should reject missing required fields', async () => {
      const res = await request(app)
        .post('/goals')
        .set('Authorization', 'Bearer test-token')
        .send({
          title: 'Test',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject unauthorized requests', async () => {
      const res = await request(app)
        .post('/goals')
        .send({
          title: 'Test',
          description: 'Test',
          desiredOutcome: 'Test',
        });

      expect(res.status).toBe(401);
    });

    it('should accept optional fields', async () => {
      const res = await request(app)
        .post('/goals')
        .set('Authorization', 'Bearer test-token')
        .send({
          title: 'Learn TypeScript',
          description: 'Master TypeScript',
          desiredOutcome: 'Build apps',
          interestLevel: 'financial_stability',
          targetDate: '2025-06-01',
          motivations: ['Career growth'],
          tags: ['programming'],
        });

      expect(res.status).toBe(201);
      expect(res.body.goal.interestLevel).toBe('financial_stability');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // LIST GOALS
  // ─────────────────────────────────────────────────────────────────────────────

  describe('GET /goals', () => {
    beforeEach(async () => {
      // Create test goals
      mockGoals.set('goal_1', {
        id: 'goal_1',
        userId: 'user_123',
        title: 'Goal 1',
        status: 'active',
        createdAt: '2025-01-01T00:00:00Z',
      });
      mockGoals.set('goal_2', {
        id: 'goal_2',
        userId: 'user_123',
        title: 'Goal 2',
        status: 'completed',
        createdAt: '2025-01-02T00:00:00Z',
      });
      mockGoals.set('goal_3', {
        id: 'goal_3',
        userId: 'other_user',
        title: 'Other User Goal',
        status: 'active',
        createdAt: '2025-01-03T00:00:00Z',
      });
    });

    it('should list goals for authenticated user', async () => {
      const res = await request(app)
        .get('/goals')
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body.goals).toHaveLength(2);
      expect(res.body.pagination).toBeDefined();
    });

    it('should filter by status', async () => {
      const res = await request(app)
        .get('/goals?status=active')
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body.goals).toHaveLength(1);
      expect(res.body.goals[0].status).toBe('active');
    });

    it('should paginate results', async () => {
      const res = await request(app)
        .get('/goals?limit=1')
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body.goals).toHaveLength(1);
      expect(res.body.pagination.hasMore).toBe(true);
      expect(res.body.pagination.nextCursor).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET GOAL
  // ─────────────────────────────────────────────────────────────────────────────

  describe('GET /goals/:id', () => {
    beforeEach(() => {
      mockGoals.set('goal_123', {
        id: 'goal_123',
        userId: 'user_123',
        title: 'Test Goal',
        status: 'active',
      });
    });

    it('should return goal with quests and path', async () => {
      const res = await request(app)
        .get('/goals/goal_123')
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body.goal.id).toBe('goal_123');
      expect(res.body.quests).toBeDefined();
      expect(res.body._links).toBeDefined();
    });

    it('should return 404 for non-existent goal', async () => {
      const res = await request(app)
        .get('/goals/nonexistent')
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('should return 404 for other user\'s goal', async () => {
      mockGoals.set('other_goal', {
        id: 'other_goal',
        userId: 'other_user',
        title: 'Other Goal',
      });

      const res = await request(app)
        .get('/goals/other_goal')
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(404);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // UPDATE GOAL
  // ─────────────────────────────────────────────────────────────────────────────

  describe('PATCH /goals/:id', () => {
    beforeEach(() => {
      mockGoals.set('goal_123', {
        id: 'goal_123',
        userId: 'user_123',
        title: 'Original Title',
        status: 'active',
      });
    });

    it('should update goal fields', async () => {
      const res = await request(app)
        .patch('/goals/goal_123')
        .set('Authorization', 'Bearer test-token')
        .send({ title: 'Updated Title' });

      expect(res.status).toBe(200);
      expect(res.body.goal.title).toBe('Updated Title');
    });

    it('should reject empty updates', async () => {
      const res = await request(app)
        .patch('/goals/goal_123')
        .set('Authorization', 'Bearer test-token')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 404 for non-existent goal', async () => {
      const res = await request(app)
        .patch('/goals/nonexistent')
        .set('Authorization', 'Bearer test-token')
        .send({ title: 'Test' });

      expect(res.status).toBe(404);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // DELETE GOAL
  // ─────────────────────────────────────────────────────────────────────────────

  describe('DELETE /goals/:id', () => {
    beforeEach(() => {
      mockGoals.set('goal_123', {
        id: 'goal_123',
        userId: 'user_123',
        title: 'Goal to Delete',
      });
    });

    it('should delete goal with confirmation', async () => {
      const res = await request(app)
        .delete('/goals/goal_123')
        .set('Authorization', 'Bearer test-token')
        .send({ confirm: true });

      expect(res.status).toBe(204);
      expect(mockGoals.has('goal_123')).toBe(false);
    });

    it('should reject without confirmation', async () => {
      const res = await request(app)
        .delete('/goals/goal_123')
        .set('Authorization', 'Bearer test-token')
        .send({});

      expect(res.status).toBe(400);
      expect(mockGoals.has('goal_123')).toBe(true);
    });

    it('should return 404 for non-existent goal', async () => {
      const res = await request(app)
        .delete('/goals/nonexistent')
        .set('Authorization', 'Bearer test-token')
        .send({ confirm: true });

      expect(res.status).toBe(404);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TRANSITION GOAL
  // ─────────────────────────────────────────────────────────────────────────────

  describe('POST /goals/:id/transition', () => {
    beforeEach(() => {
      mockGoals.set('goal_123', {
        id: 'goal_123',
        userId: 'user_123',
        title: 'Test Goal',
        status: 'active',
      });
    });

    it('should transition goal state', async () => {
      const res = await request(app)
        .post('/goals/goal_123/transition')
        .set('Authorization', 'Bearer test-token')
        .send({ type: 'pause' });

      expect(res.status).toBe(200);
      expect(res.body.goal.status).toBe('paused');
      expect(res.body.transition.from).toBe('active');
      expect(res.body.transition.to).toBe('paused');
    });

    it('should reject invalid transition', async () => {
      const res = await request(app)
        .post('/goals/goal_123/transition')
        .set('Authorization', 'Bearer test-token')
        .send({ type: 'resume' }); // Can't resume an active goal

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid event type', async () => {
      const res = await request(app)
        .post('/goals/goal_123/transition')
        .set('Authorization', 'Bearer test-token')
        .send({ type: 'invalid' });

      expect(res.status).toBe(400);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // LIST QUESTS FOR GOAL
  // ─────────────────────────────────────────────────────────────────────────────

  describe('GET /goals/:id/quests', () => {
    beforeEach(() => {
      mockGoals.set('goal_123', {
        id: 'goal_123',
        userId: 'user_123',
        title: 'Test Goal',
      });
      mockQuests.set('quest_1', {
        id: 'quest_1',
        goalId: 'goal_123',
        title: 'Quest 1',
      });
      mockQuests.set('quest_2', {
        id: 'quest_2',
        goalId: 'goal_123',
        title: 'Quest 2',
      });
    });

    it('should list quests for goal', async () => {
      const res = await request(app)
        .get('/goals/goal_123/quests')
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body.quests).toHaveLength(2);
      expect(res.body._links.goal).toBe('/api/v1/goals/goal_123');
    });
  });
});
