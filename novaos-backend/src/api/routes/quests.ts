// ═══════════════════════════════════════════════════════════════════════════════
// QUEST ROUTES — CRUD Operations for Quests
// NovaOS API Layer — Phase 14
// ═══════════════════════════════════════════════════════════════════════════════
//
// Endpoints:
//   POST   /quests              Create a new quest
//   GET    /quests              List quests with filters
//   GET    /quests/:id          Get a quest by ID
//   PATCH  /quests/:id          Update a quest
//   POST   /quests/:id/transition  Transition quest state
//   GET    /quests/:id/steps    List steps for quest
//
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, type Response } from 'express';
import { z } from 'zod';
import { auth, type AuthenticatedRequest } from '../../auth/index.js';
import { getSwordStore } from '../../core/sword/index.js';
import { getLogger } from '../../logging/index.js';
import type { QuestId, GoalId } from '../../types/branded.js';

// Middleware
import {
  asyncHandler,
  NotFoundError,
  ValidationError,
} from '../middleware/error-handler.js';

// Schemas
import {
  QuestIdSchema,
  GoalIdSchema,
  TitleSchema,
  DescriptionSchema,
  QuestStatusFilterSchema,
  CursorPaginationSchema,
  createCursor,
  parseCursor,
  type PaginationMeta,
} from '../schemas/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'quest-routes' });

// ─────────────────────────────────────────────────────────────────────────────────
// QUEST-SPECIFIC SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Schema for creating a new quest.
 */
const CreateQuestSchema = z.object({
  goalId: GoalIdSchema,
  title: TitleSchema,
  description: DescriptionSchema,
  order: z.number().int().min(0).optional(),
  estimatedMinutes: z.number().int().min(1).max(10080).optional(), // max 1 week
});

/**
 * Schema for updating a quest.
 */
const UpdateQuestSchema = z.object({
  title: TitleSchema.optional(),
  description: DescriptionSchema,
  order: z.number().int().min(0).optional(),
  estimatedMinutes: z.number().int().min(1).max(10080).optional(),
}).refine(
  (data) => Object.values(data).some((v) => v !== undefined),
  { message: 'At least one field must be provided for update' }
);

/**
 * Schema for listing quests.
 */
const ListQuestsQuerySchema = CursorPaginationSchema.extend({
  goalId: z.string().optional(),
  status: QuestStatusFilterSchema,
});

/**
 * Quest event types for state transitions.
 */
const QuestEventTypeSchema = z.enum([
  'start',
  'block',
  'unblock',
  'complete',
  'skip',
]);

/**
 * Schema for quest state transition.
 */
const QuestTransitionSchema = z.object({
  type: QuestEventTypeSchema,
  reason: z.string().max(1000).trim().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Parse and validate quest ID from params.
 */
function parseQuestId(id: string): QuestId {
  const result = QuestIdSchema.safeParse(id);
  if (!result.success) {
    throw new ValidationError('Invalid quest ID format');
  }
  return result.data;
}

/**
 * Get quest and verify ownership.
 */
async function getQuestWithOwnership(
  questId: QuestId,
  userId: string
): Promise<NonNullable<Awaited<ReturnType<ReturnType<typeof getSwordStore>['getQuest']>>>> {
  const store = getSwordStore();
  const quest = await store.getQuest(questId);
  
  if (!quest) {
    throw new NotFoundError('Quest', questId);
  }
  
  if (quest.userId !== userId) {
    throw new NotFoundError('Quest', questId);
  }
  
  return quest;
}

/**
 * Verify goal ownership.
 */
async function verifyGoalOwnership(goalId: GoalId, userId: string): Promise<void> {
  const store = getSwordStore();
  const goal = await store.getGoal(goalId);
  
  if (!goal || goal.userId !== userId) {
    throw new NotFoundError('Goal', goalId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// ROUTER FACTORY
// ─────────────────────────────────────────────────────────────────────────────────

export function createQuestRouter(): Router {
  const router = Router();

  // ═══════════════════════════════════════════════════════════════════════════════
  // CREATE QUEST
  // POST /quests
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.post(
    '/',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      
      // Validate request body
      const parseResult = CreateQuestSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          parseResult.error.issues.map((i) => i.message).join(', '),
          { fields: parseResult.error.flatten().fieldErrors }
        );
      }
      
      const input = parseResult.data;
      
      // Verify goal ownership
      await verifyGoalOwnership(input.goalId, userId);
      
      logger.info('Creating quest', {
        userId,
        goalId: input.goalId,
        title: input.title.substring(0, 50),
        requestId: req.requestId,
      });
      
      const store = getSwordStore();
      const quest = await store.createQuest(userId, {
        goalId: input.goalId,
        title: input.title,
        description: input.description,
        order: input.order,
        estimatedMinutes: input.estimatedMinutes,
      });
      
      if (!quest) {
        throw new ValidationError('Failed to create quest. Goal may not exist.');
      }
      
      logger.info('Quest created', {
        userId,
        questId: quest.id,
        goalId: input.goalId,
        requestId: req.requestId,
      });
      
      res.status(201).json({
        quest,
        _links: {
          self: `/api/v1/quests/${quest.id}`,
          goal: `/api/v1/goals/${quest.goalId}`,
          steps: `/api/v1/quests/${quest.id}/steps`,
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // LIST QUESTS
  // GET /quests
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get(
    '/',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      
      // Validate query params
      const parseResult = ListQuestsQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        throw new ValidationError(
          parseResult.error.issues.map((i) => i.message).join(', ')
        );
      }
      
      const { limit, cursor, direction, goalId, status } = parseResult.data;
      
      const store = getSwordStore();
      
      let quests: Awaited<ReturnType<typeof store.getQuestsForGoal>>;
      
      if (goalId) {
        // Verify goal ownership first
        const parsedGoalId = GoalIdSchema.safeParse(goalId);
        if (!parsedGoalId.success) {
          throw new ValidationError('Invalid goalId format');
        }
        await verifyGoalOwnership(parsedGoalId.data, userId);
        quests = await store.getQuestsForGoal(parsedGoalId.data);
      } else {
        // Get all quests for user
        quests = await store.getUserQuests(userId);
      }
      
      // Filter by status if provided
      if (status) {
        quests = quests.filter((q) => q.status === status);
      }
      
      // Sort by order, then createdAt
      quests.sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
      
      // Apply cursor-based pagination
      let startIndex = 0;
      if (cursor) {
        const cursorData = parseCursor(cursor);
        if (cursorData) {
          const cursorIndex = quests.findIndex((q) => q.id === cursorData.id);
          if (cursorIndex !== -1) {
            startIndex = direction === 'forward' ? cursorIndex + 1 : Math.max(0, cursorIndex - limit);
          }
        }
      }
      
      const paginatedQuests = quests.slice(startIndex, startIndex + limit);
      const hasMore = startIndex + limit < quests.length;
      
      const pagination: PaginationMeta = {
        limit,
        hasMore,
        nextCursor: hasMore && paginatedQuests.length > 0
          ? createCursor(paginatedQuests[paginatedQuests.length - 1]!.id)
          : undefined,
        total: quests.length,
      };
      
      res.json({
        quests: paginatedQuests,
        pagination,
        _links: {
          self: '/api/v1/quests',
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET QUEST
  // GET /quests/:id
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get(
    '/:id',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      const questId = parseQuestId(req.params.id!);
      
      const quest = await getQuestWithOwnership(questId, userId);
      
      // Get associated steps
      const store = getSwordStore();
      const steps = await store.getStepsForQuest(questId);
      
      res.json({
        quest,
        steps,
        _links: {
          self: `/api/v1/quests/${quest.id}`,
          goal: `/api/v1/goals/${quest.goalId}`,
          steps: `/api/v1/quests/${quest.id}/steps`,
          transition: `/api/v1/quests/${quest.id}/transition`,
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // UPDATE QUEST
  // PATCH /quests/:id
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.patch(
    '/:id',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      const questId = parseQuestId(req.params.id!);
      
      // Verify ownership
      await getQuestWithOwnership(questId, userId);
      
      // Validate request body
      const parseResult = UpdateQuestSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          parseResult.error.issues.map((i) => i.message).join(', '),
          { fields: parseResult.error.flatten().fieldErrors }
        );
      }
      
      const updates = parseResult.data;
      
      logger.info('Updating quest', {
        userId,
        questId,
        fields: Object.keys(updates),
        requestId: req.requestId,
      });
      
      const store = getSwordStore();
      const updatedQuest = await store.updateQuest(questId, updates);
      
      res.json({
        quest: updatedQuest,
        _links: {
          self: `/api/v1/quests/${questId}`,
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // TRANSITION QUEST STATE
  // POST /quests/:id/transition
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.post(
    '/:id/transition',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      const questId = parseQuestId(req.params.id!);
      
      // Verify ownership
      const quest = await getQuestWithOwnership(questId, userId);
      
      // Validate request body
      const parseResult = QuestTransitionSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          parseResult.error.issues.map((i) => i.message).join(', ')
        );
      }
      
      const { type, reason } = parseResult.data;
      
      logger.info('Transitioning quest state', {
        userId,
        questId,
        from: quest.status,
        event: type,
        requestId: req.requestId,
      });
      
      const store = getSwordStore();
      const result = await store.transitionQuestState(questId, type);
      
      if (!result.success) {
        throw new ValidationError(
          result.error || `Cannot transition from ${quest.status} with event ${type}`,
          {
            currentState: quest.status,
            event: type,
            allowedEvents: result.allowedEvents,
          }
        );
      }
      
      res.json({
        quest: result.quest,
        transition: {
          from: quest.status,
          to: result.quest?.status,
          event: type,
          reason,
        },
        _links: {
          self: `/api/v1/quests/${questId}`,
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // LIST STEPS FOR QUEST
  // GET /quests/:id/steps
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get(
    '/:id/steps',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      const questId = parseQuestId(req.params.id!);
      
      // Verify ownership
      await getQuestWithOwnership(questId, userId);
      
      const store = getSwordStore();
      const steps = await store.getStepsForQuest(questId);
      
      res.json({
        steps,
        _links: {
          self: `/api/v1/quests/${questId}/steps`,
          quest: `/api/v1/quests/${questId}`,
        },
      });
    })
  );

  return router;
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export default createQuestRouter;
