// ═══════════════════════════════════════════════════════════════════════════════
// COMMON SCHEMAS — Shared Validation Schemas for API Routes
// NovaOS API Layer — Phase 14
// ═══════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import type {
  GoalId,
  QuestId,
  StepId,
  SparkId,
  UserId,
  ReminderId,
} from '../../types/branded.js';

// ─────────────────────────────────────────────────────────────────────────────────
// ID VALIDATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Base ID pattern: alphanumeric with hyphens and underscores.
 * Matches patterns like: "abc123", "goal_abc123", "lxyz-abc123"
 */
const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const ID_MIN_LENGTH = 1;
const ID_MAX_LENGTH = 128;

/**
 * Generic ID schema for path parameters.
 */
export const IdSchema = z
  .string()
  .min(ID_MIN_LENGTH, 'ID is required')
  .max(ID_MAX_LENGTH, `ID must be ${ID_MAX_LENGTH} characters or less`)
  .regex(ID_PATTERN, 'ID contains invalid characters');

/**
 * Goal ID schema with branded type coercion.
 */
export const GoalIdSchema = IdSchema.transform((val) => val as GoalId);

/**
 * Quest ID schema with branded type coercion.
 */
export const QuestIdSchema = IdSchema.transform((val) => val as QuestId);

/**
 * Step ID schema with branded type coercion.
 */
export const StepIdSchema = IdSchema.transform((val) => val as StepId);

/**
 * Spark ID schema with branded type coercion.
 */
export const SparkIdSchema = IdSchema.transform((val) => val as SparkId);

/**
 * User ID schema with branded type coercion.
 */
export const UserIdSchema = IdSchema.transform((val) => val as UserId);

/**
 * Reminder ID schema with branded type coercion.
 */
export const ReminderIdSchema = IdSchema.transform((val) => val as ReminderId);

// ─────────────────────────────────────────────────────────────────────────────────
// PATH PARAMETERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Schema for routes with :id parameter.
 */
export const IdParamSchema = z.object({
  id: IdSchema,
});

/**
 * Schema for routes with :goalId parameter.
 */
export const GoalIdParamSchema = z.object({
  goalId: GoalIdSchema,
});

/**
 * Schema for routes with :questId parameter.
 */
export const QuestIdParamSchema = z.object({
  questId: QuestIdSchema,
});

/**
 * Schema for routes with :stepId parameter.
 */
export const StepIdParamSchema = z.object({
  stepId: StepIdSchema,
});

/**
 * Schema for routes with :sparkId parameter.
 */
export const SparkIdParamSchema = z.object({
  sparkId: SparkIdSchema,
});

// ─────────────────────────────────────────────────────────────────────────────────
// PAGINATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Default pagination limits.
 */
export const PAGINATION_DEFAULTS = {
  limit: 20,
  maxLimit: 100,
} as const;

/**
 * Offset-based pagination schema (legacy support).
 */
export const OffsetPaginationSchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => {
      const num = val ? parseInt(val, 10) : PAGINATION_DEFAULTS.limit;
      return Math.min(Math.max(1, num), PAGINATION_DEFAULTS.maxLimit);
    }),
  offset: z
    .string()
    .optional()
    .transform((val) => {
      const num = val ? parseInt(val, 10) : 0;
      return Math.max(0, num);
    }),
});

/**
 * Cursor-based pagination schema (preferred).
 * 
 * @example
 * GET /goals?limit=20&cursor=eyJpZCI6ImFiYzEyMyJ9
 */
export const CursorPaginationSchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => {
      const num = val ? parseInt(val, 10) : PAGINATION_DEFAULTS.limit;
      return Math.min(Math.max(1, num), PAGINATION_DEFAULTS.maxLimit);
    }),
  cursor: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (!val) return true;
        try {
          // Cursor should be base64-encoded JSON
          const decoded = Buffer.from(val, 'base64').toString('utf-8');
          JSON.parse(decoded);
          return true;
        } catch {
          return false;
        }
      },
      { message: 'Invalid cursor format' }
    ),
  direction: z.enum(['forward', 'backward']).optional().default('forward'),
});

/**
 * Pagination response metadata.
 */
export interface PaginationMeta {
  readonly limit: number;
  readonly hasMore: boolean;
  readonly nextCursor?: string;
  readonly prevCursor?: string;
  readonly total?: number;
}

/**
 * Create a cursor from an ID and optional timestamp.
 */
export function createCursor(id: string, timestamp?: string): string {
  const payload = { id, ts: timestamp };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * Parse a cursor back to its components.
 */
export function parseCursor(cursor: string): { id: string; ts?: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// COMMON FIELD SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Title field (used in goals, quests, steps).
 */
export const TitleSchema = z
  .string()
  .min(1, 'Title is required')
  .max(500, 'Title must be 500 characters or less')
  .trim();

/**
 * Description field.
 */
export const DescriptionSchema = z
  .string()
  .max(10000, 'Description must be 10000 characters or less')
  .trim()
  .optional();

/**
 * ISO date string schema.
 */
export const ISODateSchema = z
  .string()
  .refine(
    (val) => {
      const date = new Date(val);
      return !isNaN(date.getTime());
    },
    { message: 'Invalid date format. Use ISO 8601 format (e.g., 2025-01-15)' }
  );

/**
 * Optional ISO date string schema.
 */
export const OptionalISODateSchema = ISODateSchema.optional();

/**
 * Timezone schema (IANA timezone identifier).
 */
export const TimezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (val) => {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: val });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Invalid timezone. Use IANA format (e.g., America/New_York)' }
  );

/**
 * Optional timezone schema.
 */
export const OptionalTimezoneSchema = TimezoneSchema.optional();

/**
 * Time string schema (HH:MM format).
 */
export const TimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format. Use HH:MM (24-hour)');

/**
 * Tags array schema.
 */
export const TagsSchema = z
  .array(z.string().min(1).max(50).trim())
  .max(20, 'Maximum 20 tags allowed')
  .optional();

// ─────────────────────────────────────────────────────────────────────────────────
// FILTER SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Goal status filter.
 */
export const GoalStatusFilterSchema = z
  .enum(['active', 'paused', 'completed', 'abandoned'])
  .optional();

/**
 * Quest status filter.
 */
export const QuestStatusFilterSchema = z
  .enum(['not_started', 'active', 'blocked', 'completed', 'skipped'])
  .optional();

/**
 * Step status filter.
 */
export const StepStatusFilterSchema = z
  .enum(['pending', 'active', 'completed', 'skipped'])
  .optional();

/**
 * Spark status filter.
 */
export const SparkStatusFilterSchema = z
  .enum(['suggested', 'accepted', 'completed', 'skipped', 'expired'])
  .optional();

// ─────────────────────────────────────────────────────────────────────────────────
// TYPE EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export type IdParam = z.infer<typeof IdParamSchema>;
export type GoalIdParam = z.infer<typeof GoalIdParamSchema>;
export type QuestIdParam = z.infer<typeof QuestIdParamSchema>;
export type StepIdParam = z.infer<typeof StepIdParamSchema>;
export type SparkIdParam = z.infer<typeof SparkIdParamSchema>;
export type OffsetPagination = z.infer<typeof OffsetPaginationSchema>;
export type CursorPagination = z.infer<typeof CursorPaginationSchema>;
