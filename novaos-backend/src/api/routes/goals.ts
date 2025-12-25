// ═══════════════════════════════════════════════════════════════════════════════
// GOAL ROUTES — CRUD Operations for Goals
// NovaOS API Layer — Phase 14
// ═══════════════════════════════════════════════════════════════════════════════
//
// Endpoints:
//   POST   /goals              Create a new goal
//   GET    /goals              List goals with filters and pagination
//   GET    /goals/:id          Get a goal by ID
//   PATCH  /goals/:id          Update a goal
//   DELETE /goals/:id          Delete a goal (with confirmation)
//   POST   /goals/:id/transition  Transition goal state
//
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, type Response, type RequestHandler } from 'express';
import { auth, type AuthenticatedRequest } from '../../auth/index.js';
import { createRateLimiter, RateLimitCategory } from '../../security/rate-limiting/index.js';
import { getSwordStore } from '../../core/sword/index.js';
import { getLogger } from '../../logging/index.js';
import type { GoalId } from '../../types/branded.js';
import { createGoalId } from '../../types/branded.js';

// Middleware
import {
  asyncHandler,
  NotFoundError,
  ValidationError,
  ForbiddenError,
} from '../middleware/error-handler.js';

// Schemas
import {
  GoalIdSchema,
  CreateGoalSchema,
  UpdateGoalSchema,
  ListGoalsQuerySchema,
  GoalTransitionSchema,
  DeleteGoalSchema,
  createCursor,
  parseCursor,
  type PaginationMeta,
} from '../schemas/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'goal-routes' });

// ─────────────────────────────────────────────────────────────────────────────────
// RATE LIMITERS
// ─────────────────────────────────────────────────────────────────────────────────

const goalCreationLimiter = createRateLimiter(RateLimitCategory.GOAL_CREATION);

// ─────────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Parse and validate goal ID from params.
 */
function parseGoalId(id: string): GoalId {
  const result = GoalIdSchema.safeParse(id);
  if (!result.success) {
    throw new ValidationError('Invalid goal ID format');
  }
  return result.data;
}

/**
 * Get goal and verify ownership.
 */
async function getGoalWithOwnership(
  goalId: GoalId,
  userId: string
): Promise<NonNullable<Awaited<ReturnType<ReturnType<typeof getSwordStore>['getGoal']>>>> {
  const store = getSwordStore();
  const goal = await store.getGoal(goalId);
  
  if (!goal) {
    throw new NotFoundError('Goal', goalId);
  }
  
  if (goal.userId !== userId) {
    // Return 404 to avoid leaking existence of other users' goals
    throw new NotFoundError('Goal', goalId);
  }
  
  return goal;
}

// ─────────────────────────────────────────────────────────────────────────────────
// ROUTER FACTORY
// ─────────────────────────────────────────────────────────────────────────────────

export function createGoalRouter(): Router {
  const router = Router();

  // ═══════════════════════════════════════════════════════════════════════════════
  // CREATE GOAL
  // POST /goals
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.post(
    '/',
    auth.middleware(true),
    goalCreationLimiter as RequestHandler,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      
      // Validate request body
      const parseResult = CreateGoalSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          parseResult.error.issues.map((i) => i.message).join(', '),
          { fields: parseResult.error.flatten().fieldErrors }
        );
      }
      
      const input = parseResult.data;
      
      logger.info('Creating goal', {
        userId,
        title: input.title.substring(0, 50),
        requestId: req.requestId,
      });
      
      const store = getSwordStore();
      const goal = await store.createGoal(userId, {
        title: input.title,
        description: input.description,
        desiredOutcome: input.desiredOutcome,
        interestLevel: input.interestLevel,
        targetDate: input.targetDate,
        motivations: input.motivations,
        constraints: input.constraints,
        successCriteria: input.successCriteria,
        tags: input.tags,
      });
      
      logger.info('Goal created', {
        userId,
        goalId: goal.id,
        requestId: req.requestId,
      });
      
      res.status(201).json({
        goal,
        _links: {
          self: `/api/v1/goals/${goal.id}`,
          quests: `/api/v1/goals/${goal.id}/quests`,
          path: `/api/v1/path/${goal.id}`,
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // LIST GOALS
  // GET /goals
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get(
    '/',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      
      // Validate query params
      const parseResult = ListGoalsQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        throw new ValidationError(
          parseResult.error.issues.map((i) => i.message).join(', ')
        );
      }
      
      const { limit, cursor, direction, status, tag } = parseResult.data;
      
      const store = getSwordStore();
      
      // Get all goals for user (filtered by status if provided)
      let goals = await store.getUserGoals(userId, status);
      
      // Filter by tag if provided
      if (tag) {
        goals = goals.filter((g) => g.tags?.includes(tag));
      }
      
      // Sort by createdAt descending (newest first)
      goals.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      
      // Apply cursor-based pagination
      let startIndex = 0;
      if (cursor) {
        const cursorData = parseCursor(cursor);
        if (cursorData) {
          const cursorIndex = goals.findIndex((g) => g.id === cursorData.id);
          if (cursorIndex !== -1) {
            startIndex = direction === 'forward' ? cursorIndex + 1 : Math.max(0, cursorIndex - limit);
          }
        }
      }
      
      // Slice to limit
      const paginatedGoals = goals.slice(startIndex, startIndex + limit);
      const hasMore = startIndex + limit < goals.length;
      
      // Build pagination metadata
      const pagination: PaginationMeta = {
        limit,
        hasMore,
        nextCursor: hasMore && paginatedGoals.length > 0
          ? createCursor(paginatedGoals[paginatedGoals.length - 1]!.id)
          : undefined,
        prevCursor: startIndex > 0 && paginatedGoals.length > 0
          ? createCursor(paginatedGoals[0]!.id)
          : undefined,
        total: goals.length,
      };
      
      res.json({
        goals: paginatedGoals,
        pagination,
        _links: {
          self: '/api/v1/goals',
          create: '/api/v1/goals',
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET GOAL
  // GET /goals/:id
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get(
    '/:id',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      const goalId = parseGoalId(req.params.id!);
      
      const goal = await getGoalWithOwnership(goalId, userId);
      
      // Get associated quests
      const store = getSwordStore();
      const quests = await store.getQuestsForGoal(goalId);
      
      // Get path if available
      const path = await store.getPath(goalId, userId);
      
      res.json({
        goal,
        quests,
        path,
        _links: {
          self: `/api/v1/goals/${goal.id}`,
          quests: `/api/v1/goals/${goal.id}/quests`,
          path: `/api/v1/path/${goal.id}`,
          transition: `/api/v1/goals/${goal.id}/transition`,
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // UPDATE GOAL
  // PATCH /goals/:id
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.patch(
    '/:id',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      const goalId = parseGoalId(req.params.id!);
      
      // Verify ownership first
      await getGoalWithOwnership(goalId, userId);
      
      // Validate request body
      const parseResult = UpdateGoalSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          parseResult.error.issues.map((i) => i.message).join(', '),
          { fields: parseResult.error.flatten().fieldErrors }
        );
      }
      
      const updates = parseResult.data;
      
      logger.info('Updating goal', {
        userId,
        goalId,
        fields: Object.keys(updates),
        requestId: req.requestId,
      });
      
      const store = getSwordStore();
      
      // Convert null to undefined for optional fields
      const cleanedUpdates = {
        ...updates,
        tags: updates.tags ?? undefined,
        constraints: updates.constraints ?? undefined,
        motivations: updates.motivations ?? undefined,
        targetDate: updates.targetDate ?? undefined,
        successCriteria: updates.successCriteria ?? undefined,
      };
      
      const updatedGoal = await store.updateGoal(goalId, cleanedUpdates);
      
      if (!updatedGoal) {
        throw new NotFoundError(`Goal not found: ${goalId}`);
      }
      
      res.json({
        goal: updatedGoal,
        _links: {
          self: `/api/v1/goals/${updatedGoal.id}`,
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // DELETE GOAL
  // DELETE /goals/:id
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.delete(
    '/:id',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      const goalId = parseGoalId(req.params.id!);
      
      // Verify ownership first
      await getGoalWithOwnership(goalId, userId);
      
      // Require confirmation in body
      const parseResult = DeleteGoalSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          'Deletion requires confirmation. Send { "confirm": true } in request body.'
        );
      }
      
      logger.warn('Deleting goal', {
        userId,
        goalId,
        requestId: req.requestId,
      });
      
      const store = getSwordStore();
      await store.deleteGoal(goalId);
      
      res.status(204).send();
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // TRANSITION GOAL STATE
  // POST /goals/:id/transition
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.post(
    '/:id/transition',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      const goalId = parseGoalId(req.params.id!);
      
      // Verify ownership first
      const goal = await getGoalWithOwnership(goalId, userId);
      
      // Validate request body
      const parseResult = GoalTransitionSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          parseResult.error.issues.map((i) => i.message).join(', ')
        );
      }
      
      const { type, reason } = parseResult.data;
      
      // ✅ FIX: Capture original status BEFORE transition (object may be mutated in place)
      const fromStatus = goal.status;
      
      logger.info('Transitioning goal state', {
        userId,
        goalId,
        from: fromStatus,
        event: type,
        requestId: req.requestId,
      });
      
      const store = getSwordStore();
      const result = await store.transitionGoalState(goalId, type);
      
      if (!result) {
        throw new ValidationError(
          `Failed to transition goal state`,
          { goalId, event: type }
        );
      }
      
      if (!result.success) {
        throw new ValidationError(
          result.error || `Cannot transition from ${fromStatus} with event ${type}`,
          { 
            currentState: fromStatus,
            event: type,
            allowedEvents: result.allowedEvents,
          }
        );
      }
      
      res.json({
        goal: result.goal,
        transition: {
          from: fromStatus,  // ✅ FIX: Use captured status, not mutated object
          to: result.goal?.status,
          event: type,
          reason,
        },
        _links: {
          self: `/api/v1/goals/${goalId}`,
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // LIST QUESTS FOR GOAL
  // GET /goals/:id/quests
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get(
    '/:id/quests',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      const goalId = parseGoalId(req.params.id!);
      
      // Verify ownership
      await getGoalWithOwnership(goalId, userId);
      
      const store = getSwordStore();
      const quests = await store.getQuestsForGoal(goalId);
      
      res.json({
        quests,
        _links: {
          self: `/api/v1/goals/${goalId}/quests`,
          goal: `/api/v1/goals/${goalId}`,
        },
      });
    })
  );

  return router;
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export default createGoalRouter;
