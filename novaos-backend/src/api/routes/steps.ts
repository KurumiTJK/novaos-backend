// ═══════════════════════════════════════════════════════════════════════════════
// STEP ROUTES — CRUD Operations for Steps
// NovaOS API Layer — Phase 14
// ═══════════════════════════════════════════════════════════════════════════════
//
// Endpoints:
//   POST   /steps              Create a new step
//   GET    /steps/:id          Get a step by ID
//   PATCH  /steps/:id          Update a step
//   POST   /steps/:id/transition  Transition step state
//   POST   /steps/:id/complete    Complete a step (convenience endpoint)
//   POST   /steps/:id/skip        Skip a step (convenience endpoint)
//
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, type Response } from 'express';
import { z } from 'zod';
import { auth, type AuthenticatedRequest } from '../../auth/index.js';
import { getSwordStore } from '../../core/sword/index.js';
import { getLogger } from '../../logging/index.js';
import type { StepId, QuestId } from '../../types/branded.js';

// Middleware
import {
  asyncHandler,
  NotFoundError,
  ValidationError,
  ForbiddenError,
} from '../middleware/error-handler.js';

// Schemas
import {
  StepIdSchema,
  QuestIdSchema,
  TitleSchema,
  DescriptionSchema,
} from '../schemas/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'step-routes' });

// ─────────────────────────────────────────────────────────────────────────────────
// STEP-SPECIFIC SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Schema for creating a new step.
 */
const CreateStepSchema = z.object({
  questId: QuestIdSchema,
  title: TitleSchema,
  description: DescriptionSchema,
  order: z.number().int().min(0).optional(),
  estimatedMinutes: z.number().int().min(1).max(480).optional(), // max 8 hours
  actionType: z.enum(['do', 'learn', 'decide', 'create', 'review']).optional(),
});

/**
 * Schema for updating a step.
 */
const UpdateStepSchema = z.object({
  title: TitleSchema.optional(),
  description: DescriptionSchema,
  order: z.number().int().min(0).optional(),
  estimatedMinutes: z.number().int().min(1).max(480).optional(),
  actionType: z.enum(['do', 'learn', 'decide', 'create', 'review']).optional(),
}).refine(
  (data) => Object.values(data).some((v) => v !== undefined),
  { message: 'At least one field must be provided for update' }
);

/**
 * Step event types for state transitions.
 */
const StepEventTypeSchema = z.enum([
  'start',
  'complete',
  'skip',
  'reset',
]);

/**
 * Schema for step state transition.
 */
const StepTransitionSchema = z.object({
  type: StepEventTypeSchema,
  reason: z.string().max(1000).trim().optional(),
});

/**
 * Schema for completing a step.
 */
const CompleteStepSchema = z.object({
  notes: z.string().max(2000).trim().optional(),
  actualMinutes: z.number().int().min(0).max(480).optional(),
});

/**
 * Schema for skipping a step.
 */
const SkipStepSchema = z.object({
  reason: z.enum([
    'not_relevant',
    'already_done',
    'blocked',
    'defer',
    'other',
  ]),
  notes: z.string().max(1000).trim().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Parse and validate step ID from params.
 */
function parseStepId(id: string): StepId {
  const result = StepIdSchema.safeParse(id);
  if (!result.success) {
    throw new ValidationError('Invalid step ID format');
  }
  return result.data;
}

/**
 * Get step and verify ownership through quest.
 */
async function getStepWithOwnership(
  stepId: StepId,
  userId: string
): Promise<NonNullable<Awaited<ReturnType<ReturnType<typeof getSwordStore>['getStep']>>>> {
  const store = getSwordStore();
  const step = await store.getStep(stepId);
  
  if (!step) {
    throw new NotFoundError('Step', stepId);
  }
  
  // Verify ownership through quest
  const quest = await store.getQuest(step.questId);
  if (!quest || quest.userId !== userId) {
    throw new NotFoundError('Step', stepId);
  }
  
  return step;
}

/**
 * Verify quest ownership.
 */
async function verifyQuestOwnership(questId: QuestId, userId: string): Promise<void> {
  const store = getSwordStore();
  const quest = await store.getQuest(questId);
  
  if (!quest || quest.userId !== userId) {
    throw new NotFoundError('Quest', questId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// ROUTER FACTORY
// ─────────────────────────────────────────────────────────────────────────────────

export function createStepRouter(): Router {
  const router = Router();

  // ═══════════════════════════════════════════════════════════════════════════════
  // CREATE STEP
  // POST /steps
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.post(
    '/',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      
      // Validate request body
      const parseResult = CreateStepSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          parseResult.error.issues.map((i) => i.message).join(', '),
          { fields: parseResult.error.flatten().fieldErrors }
        );
      }
      
      const input = parseResult.data;
      
      // Verify quest ownership
      await verifyQuestOwnership(input.questId, userId);
      
      logger.info('Creating step', {
        userId,
        questId: input.questId,
        title: input.title.substring(0, 50),
        requestId: req.requestId,
      });
      
      const store = getSwordStore();
      const step = await store.createStep({
        questId: input.questId,
        title: input.title,
        description: input.description,
        order: input.order,
        estimatedMinutes: input.estimatedMinutes,
        actionType: input.actionType,
      });
      
      logger.info('Step created', {
        userId,
        stepId: step.id,
        questId: input.questId,
        requestId: req.requestId,
      });
      
      res.status(201).json({
        step,
        _links: {
          self: `/api/v1/steps/${step.id}`,
          quest: `/api/v1/quests/${step.questId}`,
          sparks: `/api/v1/steps/${step.id}/sparks`,
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET STEP
  // GET /steps/:id
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get(
    '/:id',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      const stepId = parseStepId(req.params.id!);
      
      const step = await getStepWithOwnership(stepId, userId);
      
      // Get sparks for this step
      const store = getSwordStore();
      const sparks = await store.getSparksForStep(stepId);
      
      res.json({
        step,
        sparks,
        _links: {
          self: `/api/v1/steps/${step.id}`,
          quest: `/api/v1/quests/${step.questId}`,
          transition: `/api/v1/steps/${step.id}/transition`,
          complete: `/api/v1/steps/${step.id}/complete`,
          skip: `/api/v1/steps/${step.id}/skip`,
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // UPDATE STEP
  // PATCH /steps/:id
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.patch(
    '/:id',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      const stepId = parseStepId(req.params.id!);
      
      // Verify ownership
      await getStepWithOwnership(stepId, userId);
      
      // Validate request body
      const parseResult = UpdateStepSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          parseResult.error.issues.map((i) => i.message).join(', '),
          { fields: parseResult.error.flatten().fieldErrors }
        );
      }
      
      const updates = parseResult.data;
      
      logger.info('Updating step', {
        userId,
        stepId,
        fields: Object.keys(updates),
        requestId: req.requestId,
      });
      
      const store = getSwordStore();
      const updatedStep = await store.updateStep(stepId, updates);
      
      res.json({
        step: updatedStep,
        _links: {
          self: `/api/v1/steps/${stepId}`,
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // TRANSITION STEP STATE
  // POST /steps/:id/transition
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.post(
    '/:id/transition',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      const stepId = parseStepId(req.params.id!);
      
      // Verify ownership
      const step = await getStepWithOwnership(stepId, userId);
      
      // Validate request body
      const parseResult = StepTransitionSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          parseResult.error.issues.map((i) => i.message).join(', ')
        );
      }
      
      const { type, reason } = parseResult.data;
      
      logger.info('Transitioning step state', {
        userId,
        stepId,
        from: step.status,
        event: type,
        requestId: req.requestId,
      });
      
      const store = getSwordStore();
      const result = await store.transitionStepState(stepId, type);
      
      if (!result.success) {
        throw new ValidationError(
          result.error || `Cannot transition from ${step.status} with event ${type}`,
          {
            currentState: step.status,
            event: type,
            allowedEvents: result.allowedEvents,
          }
        );
      }
      
      res.json({
        step: result.step,
        transition: {
          from: step.status,
          to: result.step?.status,
          event: type,
          reason,
        },
        _links: {
          self: `/api/v1/steps/${stepId}`,
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // COMPLETE STEP (Convenience Endpoint)
  // POST /steps/:id/complete
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.post(
    '/:id/complete',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      const stepId = parseStepId(req.params.id!);
      
      // Verify ownership
      const step = await getStepWithOwnership(stepId, userId);
      
      // Validate optional body
      const parseResult = CompleteStepSchema.safeParse(req.body || {});
      if (!parseResult.success) {
        throw new ValidationError(
          parseResult.error.issues.map((i) => i.message).join(', ')
        );
      }
      
      const { notes, actualMinutes } = parseResult.data;
      
      logger.info('Completing step', {
        userId,
        stepId,
        from: step.status,
        actualMinutes,
        requestId: req.requestId,
      });
      
      const store = getSwordStore();
      
      // Perform transition
      const result = await store.transitionStepState(stepId, 'complete');
      
      if (!result.success) {
        throw new ValidationError(
          result.error || `Cannot complete step in ${step.status} state`,
          {
            currentState: step.status,
            allowedEvents: result.allowedEvents,
          }
        );
      }
      
      // Update with completion data if provided
      if (notes || actualMinutes !== undefined) {
        await store.updateStep(stepId, {
          completionNotes: notes,
          actualMinutes,
        });
      }
      
      // Refetch to get updated data
      const completedStep = await store.getStep(stepId);
      
      res.json({
        step: completedStep,
        completed: true,
        _links: {
          self: `/api/v1/steps/${stepId}`,
          quest: `/api/v1/quests/${step.questId}`,
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // SKIP STEP (Convenience Endpoint)
  // POST /steps/:id/skip
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.post(
    '/:id/skip',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      const stepId = parseStepId(req.params.id!);
      
      // Verify ownership
      const step = await getStepWithOwnership(stepId, userId);
      
      // Validate body
      const parseResult = SkipStepSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          parseResult.error.issues.map((i) => i.message).join(', ')
        );
      }
      
      const { reason, notes } = parseResult.data;
      
      logger.info('Skipping step', {
        userId,
        stepId,
        from: step.status,
        reason,
        requestId: req.requestId,
      });
      
      const store = getSwordStore();
      
      // Perform transition
      const result = await store.transitionStepState(stepId, 'skip');
      
      if (!result.success) {
        throw new ValidationError(
          result.error || `Cannot skip step in ${step.status} state`,
          {
            currentState: step.status,
            allowedEvents: result.allowedEvents,
          }
        );
      }
      
      // Update with skip data
      await store.updateStep(stepId, {
        skipReason: reason,
        skipNotes: notes,
      });
      
      // Refetch to get updated data
      const skippedStep = await store.getStep(stepId);
      
      res.json({
        step: skippedStep,
        skipped: true,
        reason,
        _links: {
          self: `/api/v1/steps/${stepId}`,
          quest: `/api/v1/quests/${step.questId}`,
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // LIST SPARKS FOR STEP
  // GET /steps/:id/sparks
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get(
    '/:id/sparks',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      const stepId = parseStepId(req.params.id!);
      
      // Verify ownership
      await getStepWithOwnership(stepId, userId);
      
      const store = getSwordStore();
      const sparks = await store.getSparksForStep(stepId);
      
      res.json({
        sparks,
        _links: {
          self: `/api/v1/steps/${stepId}/sparks`,
          step: `/api/v1/steps/${stepId}`,
          generate: `/api/v1/sparks/generate`,
        },
      });
    })
  );

  return router;
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export default createStepRouter;
