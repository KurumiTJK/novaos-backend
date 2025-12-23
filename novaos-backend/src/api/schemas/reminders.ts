// ═══════════════════════════════════════════════════════════════════════════════
// REMINDER SCHEMAS — Validation Schemas for Reminder API Routes
// NovaOS API Layer — Phase 14
// ═══════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { TimezoneSchema, TimeSchema } from './common.js';

// ─────────────────────────────────────────────────────────────────────────────────
// DAYS OF WEEK
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Day of week schema.
 */
export const DayOfWeekSchema = z.enum([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);

/**
 * Array of days schema.
 */
export const DaysOfWeekSchema = z
  .array(DayOfWeekSchema)
  .min(1, 'At least one day must be selected')
  .max(7)
  .refine(
    (days) => new Set(days).size === days.length,
    { message: 'Duplicate days are not allowed' }
  );

// ─────────────────────────────────────────────────────────────────────────────────
// DELIVERY CHANNELS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Reminder delivery channel schema.
 */
export const DeliveryChannelSchema = z.enum([
  'push',
  'email',
  'sms',
  'in_app',
]);

/**
 * Array of delivery channels schema.
 */
export const DeliveryChannelsSchema = z
  .array(DeliveryChannelSchema)
  .min(1, 'At least one channel must be selected')
  .max(4);

// ─────────────────────────────────────────────────────────────────────────────────
// ESCALATION CONFIG
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Escalation level schema.
 */
export const EscalationLevelSchema = z.object({
  delayMinutes: z
    .number()
    .int()
    .min(5, 'Minimum delay is 5 minutes')
    .max(1440, 'Maximum delay is 24 hours (1440 minutes)'),
  message: z
    .string()
    .max(500, 'Message must be 500 characters or less')
    .trim()
    .optional(),
  channels: DeliveryChannelsSchema.optional(),
});

/**
 * Escalation config schema.
 */
export const EscalationConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxEscalations: z
    .number()
    .int()
    .min(0, 'Cannot be negative')
    .max(5, 'Maximum 5 escalations')
    .default(3),
  levels: z
    .array(EscalationLevelSchema)
    .max(5, 'Maximum 5 escalation levels')
    .optional(),
});

// ─────────────────────────────────────────────────────────────────────────────────
// QUIET HOURS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Quiet hours configuration schema.
 */
export const QuietHoursSchema = z.object({
  enabled: z.boolean().default(false),
  start: TimeSchema,
  end: TimeSchema,
  timezone: TimezoneSchema.optional(),
}).refine(
  (data) => {
    if (!data.enabled) return true;
    // Both start and end must be provided if enabled
    return data.start && data.end;
  },
  { message: 'Start and end times are required when quiet hours are enabled' }
);

// ─────────────────────────────────────────────────────────────────────────────────
// REMINDER SCHEDULE
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Reminder schedule configuration schema.
 */
export const ReminderScheduleSchema = z.object({
  time: TimeSchema,
  timezone: TimezoneSchema,
  activeDays: DaysOfWeekSchema.optional().default([
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
  ]),
});

// ─────────────────────────────────────────────────────────────────────────────────
// REMINDER CONFIG
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Full reminder configuration schema.
 * Used for GET /api/v1/reminders/config response.
 */
export const ReminderConfigSchema = z.object({
  enabled: z.boolean().default(true),
  schedule: ReminderScheduleSchema,
  channels: DeliveryChannelsSchema.default(['push', 'in_app']),
  escalation: EscalationConfigSchema.optional(),
  quietHours: QuietHoursSchema.optional(),
  pausedUntil: z
    .string()
    .refine((val) => !isNaN(new Date(val).getTime()), {
      message: 'Invalid date format',
    })
    .nullable()
    .optional(),
});

/**
 * Schema for updating reminder configuration.
 * All fields are optional — only provided fields are updated.
 * 
 * @example
 * PATCH /api/v1/reminders/config
 * {
 *   "enabled": true,
 *   "schedule": {
 *     "time": "09:00",
 *     "timezone": "America/New_York",
 *     "activeDays": ["monday", "wednesday", "friday"]
 *   }
 * }
 */
export const UpdateReminderConfigSchema = z.object({
  enabled: z.boolean().optional(),
  schedule: z.object({
    time: TimeSchema.optional(),
    timezone: TimezoneSchema.optional(),
    activeDays: DaysOfWeekSchema.optional(),
  }).optional(),
  channels: DeliveryChannelsSchema.optional(),
  escalation: z.object({
    enabled: z.boolean().optional(),
    maxEscalations: z.number().int().min(0).max(5).optional(),
    levels: z.array(EscalationLevelSchema).max(5).optional(),
  }).optional(),
  quietHours: z.object({
    enabled: z.boolean().optional(),
    start: TimeSchema.optional(),
    end: TimeSchema.optional(),
    timezone: TimezoneSchema.optional(),
  }).optional(),
  pausedUntil: z
    .string()
    .refine((val) => !isNaN(new Date(val).getTime()), {
      message: 'Invalid date format',
    })
    .nullable()
    .optional(),
}).refine(
  (data) => Object.values(data).some((v) => v !== undefined),
  { message: 'At least one field must be provided for update' }
);

// ─────────────────────────────────────────────────────────────────────────────────
// PAUSE/RESUME
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Schema for pausing reminders.
 * 
 * @example
 * POST /api/v1/reminders/pause
 * {
 *   "until": "2025-01-20T00:00:00Z",
 *   "reason": "vacation"
 * }
 */
export const PauseRemindersSchema = z.object({
  until: z
    .string()
    .refine((val) => {
      const date = new Date(val);
      return !isNaN(date.getTime()) && date > new Date();
    }, { message: 'Must be a valid future date' }),
  reason: z
    .string()
    .max(500, 'Reason must be 500 characters or less')
    .trim()
    .optional(),
});

// ─────────────────────────────────────────────────────────────────────────────────
// TYPE EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export type DayOfWeek = z.infer<typeof DayOfWeekSchema>;
export type DeliveryChannel = z.infer<typeof DeliveryChannelSchema>;
export type EscalationLevel = z.infer<typeof EscalationLevelSchema>;
export type EscalationConfig = z.infer<typeof EscalationConfigSchema>;
export type QuietHours = z.infer<typeof QuietHoursSchema>;
export type ReminderSchedule = z.infer<typeof ReminderScheduleSchema>;
export type ReminderConfig = z.infer<typeof ReminderConfigSchema>;
export type UpdateReminderConfigRequest = z.infer<typeof UpdateReminderConfigSchema>;
export type PauseRemindersRequest = z.infer<typeof PauseRemindersSchema>;
