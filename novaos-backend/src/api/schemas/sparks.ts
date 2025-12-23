// ═══════════════════════════════════════════════════════════════════════════════
// SPARK SCHEMAS — Validation Schemas for Spark API Routes
// NovaOS API Layer — Phase 14
// ═══════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import {
  GoalIdSchema,
  QuestIdSchema,
  StepIdSchema,
  SparkStatusFilterSchema,
  CursorPaginationSchema,
} from './common.js';

// ─────────────────────────────────────────────────────────────────────────────────
// FRICTION LEVEL
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Friction level for spark generation.
 * Lower friction = easier to start.
 */
export const FrictionLevelSchema = z.enum(['minimal', 'low', 'medium']);

// ─────────────────────────────────────────────────────────────────────────────────
// GENERATE SPARK
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Schema for generating a new spark.
 * 
 * @example
 * POST /api/v1/sparks/generate
 * {
 *   "stepId": "step_abc123",
 *   "maxMinutes": 15,
 *   "frictionLevel": "minimal"
 * }
 */
export const GenerateSparkSchema = z.object({
  stepId: StepIdSchema.optional(),
  questId: QuestIdSchema.optional(),
  goalId: GoalIdSchema.optional(),
  context: z
    .string()
    .max(2000, 'Context must be 2000 characters or less')
    .trim()
    .optional(),
  maxMinutes: z
    .number()
    .int()
    .min(1, 'Minimum 1 minute')
    .max(120, 'Maximum 120 minutes')
    .optional()
    .default(15),
  frictionLevel: FrictionLevelSchema.optional().default('minimal'),
}).refine(
  (data) => data.stepId || data.questId || data.goalId,
  { message: 'At least one of stepId, questId, or goalId is required' }
);

// ─────────────────────────────────────────────────────────────────────────────────
// COMPLETE SPARK
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Schema for marking a spark as complete.
 * 
 * @example
 * POST /api/v1/sparks/:id/complete
 * {
 *   "notes": "Created the schema file successfully",
 *   "actualMinutes": 12
 * }
 */
export const CompleteSparkSchema = z.object({
  notes: z
    .string()
    .max(2000, 'Notes must be 2000 characters or less')
    .trim()
    .optional(),
  actualMinutes: z
    .number()
    .int()
    .min(0, 'Minutes cannot be negative')
    .max(480, 'Maximum 480 minutes (8 hours)')
    .optional(),
  satisfactionRating: z
    .number()
    .int()
    .min(1, 'Rating must be 1-5')
    .max(5, 'Rating must be 1-5')
    .optional(),
});

// ─────────────────────────────────────────────────────────────────────────────────
// SKIP SPARK
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Skip reasons for analytics and improvement.
 */
export const SkipReasonSchema = z.enum([
  'too_hard',
  'too_easy',
  'not_relevant',
  'no_time',
  'blocked',
  'changed_mind',
  'already_done',
  'other',
]);

/**
 * Schema for skipping a spark.
 * 
 * @example
 * POST /api/v1/sparks/:id/skip
 * {
 *   "reason": "no_time",
 *   "notes": "Will do tomorrow"
 * }
 */
export const SkipSparkSchema = z.object({
  reason: SkipReasonSchema,
  notes: z
    .string()
    .max(1000, 'Notes must be 1000 characters or less')
    .trim()
    .optional(),
  reschedule: z.boolean().optional().default(false),
});

// ─────────────────────────────────────────────────────────────────────────────────
// ACCEPT SPARK
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Schema for accepting a suggested spark.
 * 
 * @example
 * POST /api/v1/sparks/:id/accept
 */
export const AcceptSparkSchema = z.object({
  scheduledFor: z
    .string()
    .refine(
      (val) => !isNaN(new Date(val).getTime()),
      { message: 'Invalid date format' }
    )
    .optional(),
});

// ─────────────────────────────────────────────────────────────────────────────────
// LIST SPARKS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Schema for listing sparks with filters.
 * 
 * @example
 * GET /api/v1/sparks?status=suggested&limit=10
 */
export const ListSparksQuerySchema = CursorPaginationSchema.extend({
  status: SparkStatusFilterSchema,
  stepId: z.string().optional(),
  goalId: z.string().optional(),
});

/**
 * Schema for listing sparks for a specific step.
 * 
 * @example
 * GET /api/v1/steps/:stepId/sparks?limit=5
 */
export const ListStepSparksQuerySchema = CursorPaginationSchema.extend({
  status: SparkStatusFilterSchema,
  includeExpired: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
});

// ─────────────────────────────────────────────────────────────────────────────────
// SPARK TRANSITION (generic)
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Spark event types for state transitions.
 */
export const SparkEventTypeSchema = z.enum([
  'accept',
  'complete',
  'skip',
  'expire',
  'regenerate',
]);

/**
 * Schema for generic spark state transition.
 * Prefer dedicated endpoints (/complete, /skip) over this.
 * 
 * @example
 * POST /api/v1/sparks/:id/transition
 * {
 *   "type": "complete"
 * }
 */
export const SparkTransitionSchema = z.object({
  type: SparkEventTypeSchema,
  reason: z.string().max(1000).trim().optional(),
  notes: z.string().max(2000).trim().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────────
// TYPE EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export type GenerateSparkRequest = z.infer<typeof GenerateSparkSchema>;
export type CompleteSparkRequest = z.infer<typeof CompleteSparkSchema>;
export type SkipSparkRequest = z.infer<typeof SkipSparkSchema>;
export type AcceptSparkRequest = z.infer<typeof AcceptSparkSchema>;
export type ListSparksQuery = z.infer<typeof ListSparksQuerySchema>;
export type ListStepSparksQuery = z.infer<typeof ListStepSparksQuerySchema>;
export type SparkTransitionRequest = z.infer<typeof SparkTransitionSchema>;
export type SkipReason = z.infer<typeof SkipReasonSchema>;
export type FrictionLevel = z.infer<typeof FrictionLevelSchema>;
