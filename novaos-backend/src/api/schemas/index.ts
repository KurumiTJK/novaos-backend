// ═══════════════════════════════════════════════════════════════════════════════
// SCHEMAS INDEX — API Request/Response Validation Schemas
// NovaOS API Layer — Phase 14
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// COMMON
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // ID Schemas
  IdSchema,
  GoalIdSchema,
  QuestIdSchema,
  StepIdSchema,
  SparkIdSchema,
  UserIdSchema,
  ReminderIdSchema,
  
  // Param Schemas
  IdParamSchema,
  GoalIdParamSchema,
  QuestIdParamSchema,
  StepIdParamSchema,
  SparkIdParamSchema,
  
  // Pagination
  PAGINATION_DEFAULTS,
  OffsetPaginationSchema,
  CursorPaginationSchema,
  createCursor,
  parseCursor,
  
  // Field Schemas
  TitleSchema,
  DescriptionSchema,
  ISODateSchema,
  OptionalISODateSchema,
  TimezoneSchema,
  OptionalTimezoneSchema,
  TimeSchema,
  TagsSchema,
  
  // Filter Schemas
  GoalStatusFilterSchema,
  QuestStatusFilterSchema,
  StepStatusFilterSchema,
  SparkStatusFilterSchema,
  
  // Types
  type IdParam,
  type GoalIdParam,
  type QuestIdParam,
  type StepIdParam,
  type SparkIdParam,
  type OffsetPagination,
  type CursorPagination,
  type PaginationMeta,
} from './common.js';

// ─────────────────────────────────────────────────────────────────────────────────
// GOALS
// ─────────────────────────────────────────────────────────────────────────────────

export {
  InterestLevelSchema,
  CreateGoalSchema,
  UpdateGoalSchema,
  ListGoalsQuerySchema,
  GoalEventTypeSchema,
  GoalTransitionSchema,
  DeleteGoalSchema,
  
  type CreateGoalRequest,
  type UpdateGoalRequest,
  type ListGoalsQuery,
  type GoalTransitionRequest,
  type DeleteGoalRequest,
} from './goals.js';

// ─────────────────────────────────────────────────────────────────────────────────
// SPARKS
// ─────────────────────────────────────────────────────────────────────────────────

export {
  FrictionLevelSchema,
  GenerateSparkSchema,
  CompleteSparkSchema,
  SkipSparkSchema,
  SkipReasonSchema,
  AcceptSparkSchema,
  ListSparksQuerySchema,
  ListStepSparksQuerySchema,
  SparkEventTypeSchema,
  SparkTransitionSchema,
  
  type GenerateSparkRequest,
  type CompleteSparkRequest,
  type SkipSparkRequest,
  type AcceptSparkRequest,
  type ListSparksQuery,
  type ListStepSparksQuery,
  type SparkTransitionRequest,
  type SkipReason,
  type FrictionLevel,
} from './sparks.js';

// ─────────────────────────────────────────────────────────────────────────────────
// REMINDERS
// ─────────────────────────────────────────────────────────────────────────────────

export {
  DayOfWeekSchema,
  DaysOfWeekSchema,
  DeliveryChannelSchema,
  DeliveryChannelsSchema,
  EscalationLevelSchema,
  EscalationConfigSchema,
  QuietHoursSchema,
  ReminderScheduleSchema,
  ReminderConfigSchema,
  UpdateReminderConfigSchema,
  PauseRemindersSchema,
  
  type DayOfWeek,
  type DeliveryChannel,
  type EscalationLevel,
  type EscalationConfig,
  type QuietHours,
  type ReminderSchedule,
  type ReminderConfig,
  type UpdateReminderConfigRequest,
  type PauseRemindersRequest,
} from './reminders.js';
