// ═══════════════════════════════════════════════════════════════════════════════
// GOAL SCHEMAS — Validation Schemas for Goal API Routes
// NovaOS API Layer — Phase 14
// ═══════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import {
  TitleSchema,
  DescriptionSchema,
  OptionalISODateSchema,
  TagsSchema,
  GoalStatusFilterSchema,
  CursorPaginationSchema,
} from './common.js';
import type { InterestLevel } from '../../core/sword/types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// INTEREST LEVEL
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Interest level schema (Constitution §4 - Interest Stack).
 */
export const InterestLevelSchema = z.enum([
  'physical_safety',
  'financial_stability',
  'career_capital',
  'reputation',
  'emotional_stability',
  'comfort',
]) as z.ZodType<InterestLevel>;

// ─────────────────────────────────────────────────────────────────────────────────
// CREATE GOAL
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Schema for creating a new goal.
 * 
 * @example
 * POST /api/v1/goals
 * {
 *   "title": "Learn TypeScript",
 *   "description": "Master TypeScript for backend development",
 *   "desiredOutcome": "Build production-ready TypeScript applications"
 * }
 */
export const CreateGoalSchema = z.object({
  title: TitleSchema,
  description: z
    .string()
    .min(1, 'Description is required')
    .max(10000, 'Description must be 10000 characters or less')
    .trim(),
  desiredOutcome: z
    .string()
    .min(1, 'Desired outcome is required')
    .max(2000, 'Desired outcome must be 2000 characters or less')
    .trim(),
  interestLevel: InterestLevelSchema.optional().default('career_capital'),
  targetDate: OptionalISODateSchema,
  motivations: z
    .array(z.string().min(1).max(500).trim())
    .max(10, 'Maximum 10 motivations allowed')
    .optional(),
  constraints: z
    .array(z.string().min(1).max(500).trim())
    .max(10, 'Maximum 10 constraints allowed')
    .optional(),
  successCriteria: z
    .array(z.string().min(1).max(500).trim())
    .max(10, 'Maximum 10 success criteria allowed')
    .optional(),
  tags: TagsSchema,
});

// ─────────────────────────────────────────────────────────────────────────────────
// UPDATE GOAL
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Schema for updating an existing goal.
 * All fields are optional — only provided fields are updated.
 * 
 * @example
 * PATCH /api/v1/goals/:id
 * {
 *   "title": "Master TypeScript",
 *   "targetDate": "2025-06-01"
 * }
 */
export const UpdateGoalSchema = z.object({
  title: TitleSchema.optional(),
  description: DescriptionSchema,
  desiredOutcome: z
    .string()
    .min(1)
    .max(2000, 'Desired outcome must be 2000 characters or less')
    .trim()
    .optional(),
  interestLevel: InterestLevelSchema.optional(),
  targetDate: OptionalISODateSchema.nullable(), // null to clear
  motivations: z
    .array(z.string().min(1).max(500).trim())
    .max(10)
    .optional()
    .nullable(),
  constraints: z
    .array(z.string().min(1).max(500).trim())
    .max(10)
    .optional()
    .nullable(),
  successCriteria: z
    .array(z.string().min(1).max(500).trim())
    .max(10)
    .optional()
    .nullable(),
  tags: TagsSchema.nullable(),
}).refine(
  (data) => Object.values(data).some((v) => v !== undefined),
  { message: 'At least one field must be provided for update' }
);

// ─────────────────────────────────────────────────────────────────────────────────
// LIST GOALS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Schema for listing goals with filters and pagination.
 * 
 * @example
 * GET /api/v1/goals?status=active&limit=10
 */
export const ListGoalsQuerySchema = CursorPaginationSchema.extend({
  status: GoalStatusFilterSchema,
  tag: z.string().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────────
// GOAL TRANSITION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Goal event types for state transitions.
 */
export const GoalEventTypeSchema = z.enum([
  'start',
  'pause',
  'resume',
  'complete',
  'abandon',
]);

/**
 * Schema for goal state transition.
 * 
 * @example
 * POST /api/v1/goals/:id/transition
 * {
 *   "type": "complete",
 *   "reason": "All milestones achieved"
 * }
 */
export const GoalTransitionSchema = z.object({
  type: GoalEventTypeSchema,
  reason: z.string().max(1000).trim().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────────
// DELETE GOAL
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Schema for goal deletion confirmation.
 * 
 * @example
 * DELETE /api/v1/goals/:id
 * {
 *   "confirm": true
 * }
 */
export const DeleteGoalSchema = z.object({
  confirm: z.literal(true, {
    errorMap: () => ({ message: 'Must confirm deletion with confirm: true' }),
  }),
});

// ─────────────────────────────────────────────────────────────────────────────────
// TYPE EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export type CreateGoalRequest = z.infer<typeof CreateGoalSchema>;
export type UpdateGoalRequest = z.infer<typeof UpdateGoalSchema>;
export type ListGoalsQuery = z.infer<typeof ListGoalsQuerySchema>;
export type GoalTransitionRequest = z.infer<typeof GoalTransitionSchema>;
export type DeleteGoalRequest = z.infer<typeof DeleteGoalSchema>;
