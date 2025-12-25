// ═══════════════════════════════════════════════════════════════════════════════
// SPARK ROUTES — CRUD Operations for Sparks
// NovaOS API Layer — Phase 14
// ═══════════════════════════════════════════════════════════════════════════════
//
// Endpoints:
//   POST   /sparks/generate     Generate a new spark
//   GET    /sparks/active       Get the active spark for user
//   GET    /sparks              List sparks with filters
//   GET    /sparks/:id          Get a spark by ID
//   POST   /sparks/:id/accept   Accept a suggested spark
//   POST   /sparks/:id/complete Complete a spark
//   POST   /sparks/:id/skip     Skip a spark
//   POST   /sparks/:id/transition  Generic state transition
//
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, type Response, type RequestHandler } from 'express';
import { auth, type AuthenticatedRequest } from '../../auth/index.js';
import { createRateLimiter, RateLimitCategory } from '../../security/rate-limiting/index.js';
import { getSwordStore, getSparkGenerator } from '../../core/sword/index.js';
import { getLogger } from '../../logging/index.js';
import type { SparkId } from '../../types/branded.js';

// Middleware
import {
  asyncHandler,
  NotFoundError,
  ValidationError,
} from '../middleware/error-handler.js';

// Schemas
import {
  SparkIdSchema,
  GenerateSparkSchema,
  CompleteSparkSchema,
  SkipSparkSchema,
  AcceptSparkSchema,
  ListSparksQuerySchema,
  SparkTransitionSchema,
  createCursor,
  parseCursor,
  type PaginationMeta,
} from '../schemas/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'spark-routes' });

// ─────────────────────────────────────────────────────────────────────────────────
// RATE LIMITERS
// ─────────────────────────────────────────────────────────────────────────────────

const sparkGenerationLimiter = createRateLimiter(RateLimitCategory.SPARK_GENERATION);

// ─────────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Parse and validate spark ID from params.
 */
function parseSparkId(id: string): SparkId {
  const result = SparkIdSchema.safeParse(id);
  if (!result.success) {
    throw new ValidationError('Invalid spark ID format');
  }
  return result.data;
}

/**
 * Get spark and verify ownership.
 */
async function getSparkWithOwnership(
  sparkId: SparkId,
  userId: string
): Promise<NonNullable<Awaited<ReturnType<ReturnType<typeof getSwordStore>['getSpark']>>>> {
  const store = getSwordStore();
  const spark = await store.getSpark(sparkId);
  
  if (!spark) {
    throw new NotFoundError('Spark', sparkId);
  }
  
  if (spark.userId !== userId) {
    throw new NotFoundError('Spark', sparkId);
  }
  
  return spark;
}

// ─────────────────────────────────────────────────────────────────────────────────
// ROUTER FACTORY
// ─────────────────────────────────────────────────────────────────────────────────

export function createSparkRouter(): Router {
  const router = Router();

  // ═══════════════════════════════════════════════════════════════════════════════
  // GENERATE SPARK
  // POST /sparks/generate
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.post(
    '/generate',
    auth.middleware(true),
    sparkGenerationLimiter as RequestHandler,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      
      // Validate request body
      const parseResult = GenerateSparkSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          parseResult.error.issues.map((i) => i.message).join(', '),
          { fields: parseResult.error.flatten().fieldErrors }
        );
      }
      
      const input = parseResult.data;
      
      logger.info('Generating spark', {
        userId,
        stepId: input.stepId,
        questId: input.questId,
        goalId: input.goalId,
        maxMinutes: input.maxMinutes,
        frictionLevel: input.frictionLevel,
        requestId: req.requestId,
      });
      
      const generator = getSparkGenerator();
      const spark = await generator.generate(userId, {
        stepId: input.stepId,
        questId: input.questId,
        goalId: input.goalId,
        context: input.context,
        maxMinutes: input.maxMinutes,
        frictionLevel: input.frictionLevel,
      });
      
      logger.info('Spark generated', {
        userId,
        sparkId: spark.id,
        stepId: spark.stepId,
        requestId: req.requestId,
      });
      
      res.status(201).json({
        spark,
        _links: {
          self: `/api/v1/sparks/${spark.id}`,
          accept: `/api/v1/sparks/${spark.id}/accept`,
          complete: `/api/v1/sparks/${spark.id}/complete`,
          skip: `/api/v1/sparks/${spark.id}/skip`,
          step: spark.stepId ? `/api/v1/steps/${spark.stepId}` : undefined,
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET ACTIVE SPARK
  // GET /sparks/active
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get(
    '/active',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      
      const store = getSwordStore();
      const spark = await store.getActiveSpark(userId);
      
      if (!spark) {
        res.json({
          spark: null,
          message: 'No active spark. Generate one to get started!',
          _links: {
            generate: '/api/v1/sparks/generate',
            list: '/api/v1/sparks',
          },
        });
        return;
      }
      
      res.json({
        spark,
        _links: {
          self: `/api/v1/sparks/${spark.id}`,
          complete: `/api/v1/sparks/${spark.id}/complete`,
          skip: `/api/v1/sparks/${spark.id}/skip`,
          step: spark.stepId ? `/api/v1/steps/${spark.stepId}` : undefined,
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // LIST SPARKS
  // GET /sparks
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get(
    '/',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      
      // Validate query params
      const parseResult = ListSparksQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        throw new ValidationError(
          parseResult.error.issues.map((i) => i.message).join(', ')
        );
      }
      
      const { limit, cursor, direction, status, stepId, goalId } = parseResult.data;
      
      const store = getSwordStore();
      
      // Get sparks for user
      let sparks = await store.getUserSparks(userId, 1000); // Get all, then filter
      
      // Filter by status if provided
      if (status) {
        sparks = sparks.filter((s) => s.status === status);
      }
      
      // Filter by stepId if provided
      if (stepId) {
        sparks = sparks.filter((s) => s.stepId === stepId);
      }
      
      // Filter by goalId if provided
      if (goalId) {
        sparks = sparks.filter((s) => s.goalId === goalId);
      }
      
      // Sort by createdAt descending (newest first)
      sparks.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      
      // Apply cursor-based pagination
      let startIndex = 0;
      if (cursor) {
        const cursorData = parseCursor(cursor);
        if (cursorData) {
          const cursorIndex = sparks.findIndex((s) => s.id === cursorData.id);
          if (cursorIndex !== -1) {
            startIndex = direction === 'forward' ? cursorIndex + 1 : Math.max(0, cursorIndex - limit);
          }
        }
      }
      
      const paginatedSparks = sparks.slice(startIndex, startIndex + limit);
      const hasMore = startIndex + limit < sparks.length;
      
      const pagination: PaginationMeta = {
        limit,
        hasMore,
        nextCursor: hasMore && paginatedSparks.length > 0
          ? createCursor(paginatedSparks[paginatedSparks.length - 1]!.id)
          : undefined,
        total: sparks.length,
      };
      
      res.json({
        sparks: paginatedSparks,
        pagination,
        _links: {
          self: '/api/v1/sparks',
          active: '/api/v1/sparks/active',
          generate: '/api/v1/sparks/generate',
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET SPARK
  // GET /sparks/:id
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get(
    '/:id',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      const sparkId = parseSparkId(req.params.id!);
      
      const spark = await getSparkWithOwnership(sparkId, userId);
      
      res.json({
        spark,
        _links: {
          self: `/api/v1/sparks/${spark.id}`,
          accept: spark.status === 'suggested' ? `/api/v1/sparks/${spark.id}/accept` : undefined,
          complete: `/api/v1/sparks/${spark.id}/complete`,
          skip: `/api/v1/sparks/${spark.id}/skip`,
          step: spark.stepId ? `/api/v1/steps/${spark.stepId}` : undefined,
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // ACCEPT SPARK
  // POST /sparks/:id/accept
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.post(
    '/:id/accept',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      const sparkId = parseSparkId(req.params.id!);
      
      // Verify ownership
      const spark = await getSparkWithOwnership(sparkId, userId);
      
      // Validate optional body
      const parseResult = AcceptSparkSchema.safeParse(req.body || {});
      if (!parseResult.success) {
        throw new ValidationError(
          parseResult.error.issues.map((i) => i.message).join(', ')
        );
      }
      
      const { scheduledFor } = parseResult.data;
      
      logger.info('Accepting spark', {
        userId,
        sparkId,
        from: spark.status,
        scheduledFor,
        requestId: req.requestId,
      });
      
      const store = getSwordStore();
      const result = await store.transitionSparkState(sparkId, 'accept');
      
      if (!result) {
        throw new ValidationError(`Failed to transition spark state`, { sparkId, event: 'accept' });
      }
      
      if (!result.success) {
        throw new ValidationError(
          result.error || `Cannot accept spark in ${spark.status} state`,
          {
            currentState: spark.status,
            allowedEvents: result.allowedEvents,
          }
        );
      }
      
      // Update scheduled time if provided
      if (scheduledFor) {
        await store.updateSpark(sparkId, { scheduledFor });
      }
      
      const acceptedSpark = await store.getSpark(sparkId);
      
      res.json({
        spark: acceptedSpark,
        accepted: true,
        _links: {
          self: `/api/v1/sparks/${sparkId}`,
          complete: `/api/v1/sparks/${sparkId}/complete`,
          skip: `/api/v1/sparks/${sparkId}/skip`,
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // COMPLETE SPARK
  // POST /sparks/:id/complete
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.post(
    '/:id/complete',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      const sparkId = parseSparkId(req.params.id!);
      
      // Verify ownership
      const spark = await getSparkWithOwnership(sparkId, userId);
      
      // Validate optional body
      const parseResult = CompleteSparkSchema.safeParse(req.body || {});
      if (!parseResult.success) {
        throw new ValidationError(
          parseResult.error.issues.map((i) => i.message).join(', ')
        );
      }
      
      const { notes, actualMinutes, satisfactionRating } = parseResult.data;
      
      logger.info('Completing spark', {
        userId,
        sparkId,
        from: spark.status,
        actualMinutes,
        satisfactionRating,
        requestId: req.requestId,
      });
      
      const store = getSwordStore();
      const result = await store.transitionSparkState(sparkId, 'complete');
      
      if (!result) {
        throw new ValidationError(`Failed to transition spark state`, { sparkId, event: 'complete' });
      }
      
      if (!result.success) {
        throw new ValidationError(
          result.error || `Cannot complete spark in ${spark.status} state`,
          {
            currentState: spark.status,
            allowedEvents: result.allowedEvents,
          }
        );
      }
      
      // Update with completion data
      if (notes || actualMinutes !== undefined || satisfactionRating !== undefined) {
        await store.updateSpark(sparkId, {
          completionNotes: notes,
          actualMinutes,
          satisfactionRating,
        });
      }
      
      const completedSpark = await store.getSpark(sparkId);
      
      res.json({
        spark: completedSpark,
        completed: true,
        _links: {
          self: `/api/v1/sparks/${sparkId}`,
          step: spark.stepId ? `/api/v1/steps/${spark.stepId}` : undefined,
          generate: '/api/v1/sparks/generate',
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // SKIP SPARK
  // POST /sparks/:id/skip
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.post(
    '/:id/skip',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      const sparkId = parseSparkId(req.params.id!);
      
      // Verify ownership
      const spark = await getSparkWithOwnership(sparkId, userId);
      
      // Validate body
      const parseResult = SkipSparkSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          parseResult.error.issues.map((i) => i.message).join(', ')
        );
      }
      
      const { reason, notes, reschedule } = parseResult.data;
      
      logger.info('Skipping spark', {
        userId,
        sparkId,
        from: spark.status,
        reason,
        reschedule,
        requestId: req.requestId,
      });
      
      const store = getSwordStore();
      const result = await store.transitionSparkState(sparkId, 'skip');
      
      if (!result) {
        throw new ValidationError(`Failed to transition spark state`, { sparkId, event: 'skip' });
      }
      
      if (!result.success) {
        throw new ValidationError(
          result.error || `Cannot skip spark in ${spark.status} state`,
          {
            currentState: spark.status,
            allowedEvents: result.allowedEvents,
          }
        );
      }
      
      // Update with skip data
      await store.updateSpark(sparkId, {
        skipReason: reason,
        skipNotes: notes,
      });
      
      const skippedSpark = await store.getSpark(sparkId);
      
      // Optionally generate a new spark if reschedule is requested
      let newSpark = null;
      if (reschedule && spark.stepId) {
        const generator = getSparkGenerator();
        newSpark = await generator.generate(userId, {
          stepId: spark.stepId,
          context: 'Rescheduled after skip',
        });
      }
      
      res.json({
        spark: skippedSpark,
        skipped: true,
        reason,
        newSpark,
        _links: {
          self: `/api/v1/sparks/${sparkId}`,
          generate: '/api/v1/sparks/generate',
          newSpark: newSpark ? `/api/v1/sparks/${newSpark.id}` : undefined,
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // TRANSITION SPARK STATE (Generic)
  // POST /sparks/:id/transition
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.post(
    '/:id/transition',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      const sparkId = parseSparkId(req.params.id!);
      
      // Verify ownership
      const spark = await getSparkWithOwnership(sparkId, userId);
      
      // Validate request body
      const parseResult = SparkTransitionSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          parseResult.error.issues.map((i) => i.message).join(', ')
        );
      }
      
      const { type, reason, notes } = parseResult.data;
      
      // ✅ FIX: Capture original status BEFORE transition (object may be mutated in place)
      const fromStatus = spark.status;
      
      logger.info('Transitioning spark state', {
        userId,
        sparkId,
        from: fromStatus,
        event: type,
        requestId: req.requestId,
      });
      
      const store = getSwordStore();
      const result = await store.transitionSparkState(sparkId, type);
      
      if (!result) {
        throw new ValidationError(`Failed to transition spark state`, { sparkId, event: type });
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
        spark: result.spark,
        transition: {
          from: fromStatus,  // ✅ FIX: Use captured status, not mutated object
          to: result.spark?.status,
          event: type,
          reason,
        },
        _links: {
          self: `/api/v1/sparks/${sparkId}`,
        },
      });
    })
  );

  return router;
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export default createSparkRouter;
