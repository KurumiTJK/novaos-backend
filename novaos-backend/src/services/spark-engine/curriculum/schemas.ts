// ═══════════════════════════════════════════════════════════════════════════════
// CURRICULUM SCHEMAS — Strict Zod Validation Schemas
// NovaOS Spark Engine — Phase 7: LLM Security & Curriculum
// ═══════════════════════════════════════════════════════════════════════════════
//
// Strict validation schemas for LLM-generated curriculum:
//   - ASCII printable only (no unicode abuse)
//   - Maximum lengths enforced
//   - Resource indices must be 1..N
//   - Minutes must sum correctly
//   - Day sequence must be valid
//
// SECURITY: These schemas prevent LLM hallucinations and injection.
//
// ═══════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { CURRICULUM_CONSTRAINTS } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CUSTOM VALIDATORS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * ASCII printable characters only (0x20-0x7E) plus newlines and tabs.
 */
const ASCII_PRINTABLE_REGEX = /^[\x20-\x7E\n\t\r]*$/;

/**
 * Validate string contains only ASCII printable characters.
 */
function isAsciiPrintable(str: string): boolean {
  return ASCII_PRINTABLE_REGEX.test(str);
}

/**
 * Custom Zod refinement for ASCII-only strings.
 * Returns a ZodEffects, so cannot chain .min() or .max() after this.
 */
function asciiString(maxLength: number) {
  return z
    .string()
    .max(maxLength, `Maximum ${maxLength} characters`)
    .refine(isAsciiPrintable, {
      message: 'Must contain only ASCII printable characters',
    });
}

/**
 * Custom Zod refinement for non-empty ASCII strings.
 * 
 * FIX: Apply .min() BEFORE .refine() since .refine() returns ZodEffects
 * which doesn't have the .min() method.
 */
function asciiStringNonEmpty(maxLength: number) {
  return z
    .string()
    .min(1, 'Cannot be empty')
    .max(maxLength, `Maximum ${maxLength} characters`)
    .refine(isAsciiPrintable, {
      message: 'Must contain only ASCII printable characters',
    });
}

/**
 * Positive integer within range.
 */
function positiveInt(min: number, max: number) {
  return z
    .number()
    .int('Must be an integer')
    .min(min, `Minimum value is ${min}`)
    .max(max, `Maximum value is ${max}`);
}

// ─────────────────────────────────────────────────────────────────────────────────
// DIFFICULTY SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Difficulty level schema.
 */
export const DifficultyLevelSchema = z.enum(['beginner', 'intermediate', 'advanced']);

/**
 * Difficulty progression schema.
 */
export const DifficultyProgressionSchema = z.enum(['flat', 'gradual', 'steep']);

/**
 * Coerce string to difficulty level with fallback.
 */
export const CoerceDifficultySchema = z
  .string()
  .toLowerCase()
  .transform((val) => {
    if (val.includes('begin') || val.includes('easy') || val.includes('intro')) {
      return 'beginner';
    }
    if (val.includes('advanc') || val.includes('hard') || val.includes('expert')) {
      return 'advanced';
    }
    return 'intermediate';
  })
  .pipe(DifficultyLevelSchema);

// ─────────────────────────────────────────────────────────────────────────────────
// RESOURCE ASSIGNMENT SCHEMA
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Resource assignment schema (references by index).
 */
export const ResourceAssignmentSchema = z.object({
  index: positiveInt(1, 1000), // Will be validated against actual resource count
  minutes: positiveInt(
    CURRICULUM_CONSTRAINTS.MIN_MINUTES_PER_RESOURCE,
    CURRICULUM_CONSTRAINTS.MAX_MINUTES_PER_RESOURCE
  ),
  optional: z.boolean().default(false),
  focus: asciiString(200).optional(),
  notes: asciiString(CURRICULUM_CONSTRAINTS.MAX_NOTES_LENGTH).optional(),
});

export type ResourceAssignmentInput = z.input<typeof ResourceAssignmentSchema>;

// ─────────────────────────────────────────────────────────────────────────────────
// LEARNING OBJECTIVE SCHEMA
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Learning objective schema.
 */
export const LearningObjectiveSchema = z.object({
  description: asciiStringNonEmpty(CURRICULUM_CONSTRAINTS.MAX_OBJECTIVE_LENGTH),
  topic: asciiString(100).optional(),
  outcome: asciiString(CURRICULUM_CONSTRAINTS.MAX_OBJECTIVE_LENGTH).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────────
// EXERCISE SCHEMA
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Exercise type schema.
 */
export const ExerciseTypeSchema = z.enum([
  'practice',
  'quiz',
  'project',
  'reflection',
  'discussion',
]);

/**
 * Coerce string to exercise type with fallback.
 */
export const CoerceExerciseTypeSchema = z
  .string()
  .toLowerCase()
  .transform((val) => {
    if (val.includes('prac') || val.includes('code') || val.includes('hands')) {
      return 'practice';
    }
    if (val.includes('quiz') || val.includes('test') || val.includes('check')) {
      return 'quiz';
    }
    if (val.includes('project') || val.includes('build') || val.includes('create')) {
      return 'project';
    }
    if (val.includes('reflect') || val.includes('journal') || val.includes('think')) {
      return 'reflection';
    }
    if (val.includes('discuss') || val.includes('talk') || val.includes('share')) {
      return 'discussion';
    }
    return 'practice'; // Default
  })
  .pipe(ExerciseTypeSchema);

/**
 * Exercise schema.
 */
export const ExerciseSchema = z.object({
  type: CoerceExerciseTypeSchema,
  description: asciiStringNonEmpty(CURRICULUM_CONSTRAINTS.MAX_EXERCISE_LENGTH),
  minutes: positiveInt(5, 120),
  optional: z.boolean().default(false),
  relatedResources: z.array(positiveInt(1, 1000)).max(5).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────────
// CURRICULUM DAY SCHEMA
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Base curriculum day schema (before cross-validation).
 */
export const CurriculumDayBaseSchema = z.object({
  day: positiveInt(1, CURRICULUM_CONSTRAINTS.MAX_DAYS),
  theme: asciiStringNonEmpty(CURRICULUM_CONSTRAINTS.MAX_THEME_LENGTH),
  objectives: z.array(LearningObjectiveSchema).min(0).max(5).default([]),
  resources: z.array(ResourceAssignmentSchema).min(1).max(CURRICULUM_CONSTRAINTS.MAX_RESOURCES_PER_DAY),
  exercises: z.array(ExerciseSchema).min(0).max(5).default([]),
  totalMinutes: positiveInt(5, CURRICULUM_CONSTRAINTS.MAX_MINUTES_PER_DAY),
  difficulty: CoerceDifficultySchema.default('intermediate'),
  notes: asciiString(CURRICULUM_CONSTRAINTS.MAX_NOTES_LENGTH).optional(),
  prerequisiteDays: z.array(positiveInt(1, CURRICULUM_CONSTRAINTS.MAX_DAYS)).max(5).optional(),
});

/**
 * Curriculum day schema with minutes validation.
 */
export const CurriculumDaySchema = CurriculumDayBaseSchema.refine(
  (day) => {
    // Validate that resource minutes sum to approximately totalMinutes
    const resourceMinutes = day.resources.reduce((sum, r) => sum + r.minutes, 0);
    const exerciseMinutes = day.exercises.reduce((sum, e) => sum + e.minutes, 0);
    const computedTotal = resourceMinutes + exerciseMinutes;
    
    // Allow 20% tolerance for rounding
    const tolerance = day.totalMinutes * 0.2;
    return Math.abs(computedTotal - day.totalMinutes) <= Math.max(tolerance, 10);
  },
  {
    message: 'Resource and exercise minutes must sum to approximately totalMinutes',
    path: ['totalMinutes'],
  }
).refine(
  (day) => {
    // Validate prerequisite days are less than current day
    if (!day.prerequisiteDays) return true;
    return day.prerequisiteDays.every(prereq => prereq < day.day);
  },
  {
    message: 'Prerequisite days must be earlier than current day',
    path: ['prerequisiteDays'],
  }
);

// ─────────────────────────────────────────────────────────────────────────────────
// CURRICULUM METADATA SCHEMA
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Curriculum metadata schema.
 */
export const CurriculumMetadataSchema = z.object({
  title: asciiStringNonEmpty(200),
  description: asciiString(1000).default(''),
  targetAudience: asciiString(200).default('General learners'),
  prerequisites: z.array(asciiString(200)).max(10).default([]),
  topics: z.array(asciiString(100)).max(20).default([]),
  difficulty: CoerceDifficultySchema.default('intermediate'),
  progression: DifficultyProgressionSchema.default('gradual'),
  estimatedHours: z.number().min(0).max(1000).default(0),
});

// ─────────────────────────────────────────────────────────────────────────────────
// RAW LLM OUTPUT SCHEMA
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Raw curriculum output from LLM (lenient parsing).
 */
export const RawCurriculumOutputSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  targetAudience: z.string().optional(),
  prerequisites: z.array(z.string()).optional(),
  difficulty: z.string().optional(),
  progression: z.string().optional(),
  days: z.array(z.object({
    day: z.number(),
    theme: z.string(),
    objectives: z.array(z.object({
      description: z.string(),
      topic: z.string().optional(),
      outcome: z.string().optional(),
    })).optional(),
    resources: z.array(z.object({
      index: z.number(),
      minutes: z.number(),
      optional: z.boolean().optional(),
      focus: z.string().optional(),
      notes: z.string().optional(),
    })),
    exercises: z.array(z.object({
      type: z.string(),
      description: z.string(),
      minutes: z.number(),
      optional: z.boolean().optional(),
      relatedResources: z.array(z.number()).optional(),
    })).optional(),
    totalMinutes: z.number(),
    difficulty: z.string().optional(),
    notes: z.string().optional(),
    prerequisiteDays: z.array(z.number()).optional(),
  })).min(1),
});

export type RawCurriculumOutputInput = z.input<typeof RawCurriculumOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────────
// FULL CURRICULUM SCHEMA
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create curriculum schema with resource count validation.
 */
export function createCurriculumSchema(resourceCount: number) {
  const resourceIndexSchema = positiveInt(1, resourceCount);
  
  const resourceAssignmentWithBounds = ResourceAssignmentSchema.extend({
    index: resourceIndexSchema,
  });
  
  const exerciseWithBounds = ExerciseSchema.extend({
    relatedResources: z.array(resourceIndexSchema).max(5).optional(),
  });
  
  const dayWithBounds = CurriculumDayBaseSchema.extend({
    resources: z.array(resourceAssignmentWithBounds).min(1).max(CURRICULUM_CONSTRAINTS.MAX_RESOURCES_PER_DAY),
    exercises: z.array(exerciseWithBounds).min(0).max(5).default([]),
  });
  
  return z.object({
    title: asciiStringNonEmpty(200).default('Learning Curriculum'),
    description: asciiString(1000).default(''),
    targetAudience: asciiString(200).default('General learners'),
    prerequisites: z.array(asciiString(200)).max(10).default([]),
    difficulty: CoerceDifficultySchema.default('intermediate'),
    progression: DifficultyProgressionSchema.default('gradual'),
    days: z.array(dayWithBounds).min(1).max(CURRICULUM_CONSTRAINTS.MAX_DAYS),
  }).refine(
    (curriculum) => {
      // Validate day sequence is continuous starting from 1
      const days = curriculum.days.map(d => d.day).sort((a, b) => a - b);
      for (let i = 0; i < days.length; i++) {
        if (days[i] !== i + 1) {
          return false;
        }
      }
      return true;
    },
    {
      message: 'Days must be numbered sequentially starting from 1',
      path: ['days'],
    }
  ).refine(
    (curriculum) => {
      // Validate all resource indices are used at least once
      const usedIndices = new Set<number>();
      for (const day of curriculum.days) {
        for (const resource of day.resources) {
          usedIndices.add(resource.index);
        }
      }
      // Warning: not all resources need to be used
      return true;
    },
    {
      message: 'Resource indices should be valid',
      path: ['days'],
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────────
// VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Validate resource indices are within bounds.
 */
export function validateResourceIndices(
  days: Array<{ resources: Array<{ index: number }> }>,
  resourceCount: number
): { valid: boolean; invalidIndices: Array<{ day: number; index: number }> } {
  const invalidIndices: Array<{ day: number; index: number }> = [];
  
  for (const day of days) {
    for (const resource of day.resources) {
      if (resource.index < 1 || resource.index > resourceCount) {
        invalidIndices.push({ day: (day as { day: number }).day, index: resource.index });
      }
    }
  }
  
  return {
    valid: invalidIndices.length === 0,
    invalidIndices,
  };
}

/**
 * Validate day sequence is continuous.
 */
export function validateDaySequence(
  days: Array<{ day: number }>
): { valid: boolean; gaps: number[]; duplicates: number[] } {
  const dayNumbers = days.map(d => d.day).sort((a, b) => a - b);
  const gaps: number[] = [];
  const duplicates: number[] = [];
  const seen = new Set<number>();
  
  for (let i = 0; i < dayNumbers.length; i++) {
    const dayNum = dayNumbers[i]!;
    
    // Check for duplicates
    if (seen.has(dayNum)) {
      duplicates.push(dayNum);
    }
    seen.add(dayNum);
    
    // Check for gaps
    const expected = i + 1;
    if (dayNum !== expected && !gaps.includes(expected)) {
      gaps.push(expected);
    }
  }
  
  return {
    valid: gaps.length === 0 && duplicates.length === 0,
    gaps,
    duplicates,
  };
}

/**
 * Validate minutes sum correctly.
 */
export function validateMinutesSum(
  day: {
    resources: Array<{ minutes: number }>;
    exercises?: Array<{ minutes: number }>;
    totalMinutes: number;
  },
  tolerance: number = 0.2
): { valid: boolean; computed: number; declared: number; difference: number } {
  const resourceMinutes = day.resources.reduce((sum, r) => sum + r.minutes, 0);
  const exerciseMinutes = (day.exercises ?? []).reduce((sum, e) => sum + e.minutes, 0);
  const computed = resourceMinutes + exerciseMinutes;
  const difference = Math.abs(computed - day.totalMinutes);
  const maxDiff = Math.max(day.totalMinutes * tolerance, 10);
  
  return {
    valid: difference <= maxDiff,
    computed,
    declared: day.totalMinutes,
    difference,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// SAFE PARSING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Safely parse raw LLM output.
 */
export function parseRawCurriculumOutput(input: unknown): z.SafeParseReturnType<unknown, z.infer<typeof RawCurriculumOutputSchema>> {
  return RawCurriculumOutputSchema.safeParse(input);
}

/**
 * Strictly validate curriculum with resource bounds.
 */
export function validateCurriculum(
  input: unknown,
  resourceCount: number
): z.SafeParseReturnType<unknown, z.infer<ReturnType<typeof createCurriculumSchema>>> {
  const schema = createCurriculumSchema(resourceCount);
  return schema.safeParse(input);
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export {
  isAsciiPrintable,
  asciiString,
  asciiStringNonEmpty,
};
