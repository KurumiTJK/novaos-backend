// ═══════════════════════════════════════════════════════════════════════════════
// SPARK ENGINE TYPES — Extended Sword Types for Learning System
// NovaOS Spark Engine — Phase 8: Core Types & SparkEngine
// ═══════════════════════════════════════════════════════════════════════════════
//
// This module defines the complete extended types for the Sword learning system:
//   - Goal: Learning objective with configuration
//   - Quest: Themed section (e.g., "Week 1: Basics")
//   - Step: Single day's learning content
//   - Spark: Minimal action with escalation support
//   - Activity: Single task within a step
//   - StepResource: Verified resource attached to a step
//   - Reminder: Persistent spark delivery system
//
// All types use branded IDs from Phase 1 for compile-time type safety.
//
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  GoalId,
  UserId,
  QuestId,
  StepId,
  SparkId,
  ReminderId,
  ResourceId,
  Timestamp,
} from '../../types/branded.js';
import type { ResourceContentType } from './resource-discovery/types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// COMMON TYPES
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// DAYS OF WEEK
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Days of the week for scheduling.
 */
export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

/**
 * All days of the week.
 */
export const ALL_DAYS: readonly DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

/**
 * Weekdays only.
 */
export const WEEKDAYS: readonly DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
];

// ═══════════════════════════════════════════════════════════════════════════════
// GOAL TYPES
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// GOAL STATUS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Goal lifecycle status.
 */
export type GoalStatus = 'active' | 'paused' | 'completed' | 'abandoned';

// ─────────────────────────────────────────────────────────────────────────────────
// LEARNING CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * User's current skill level.
 */
export type UserLevel = 'beginner' | 'intermediate' | 'advanced';

/**
 * Preferred learning style.
 */
export type LearningStyle = 'reading' | 'video' | 'hands-on' | 'mixed';

/**
 * Learning preferences and scheduling configuration.
 */
export interface LearningConfig {
  /** User's current level for this goal */
  readonly userLevel?: UserLevel;

  /** Daily time commitment in minutes */
  readonly dailyTimeCommitment?: number;

  /** Preferred learning style */
  readonly learningStyle?: LearningStyle;

  /** Total duration (e.g., "6 weeks", "30 days") */
  readonly totalDuration?: string;

  /** Start date (YYYY-MM-DD) */
  readonly startDate?: string;

  /** Days of the week to learn */
  readonly activeDays?: readonly DayOfWeek[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// LESSON PLAN METADATA
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Metadata about the generated lesson plan.
 */
export interface LessonPlanMetadata {
  /** When the lesson plan was generated */
  readonly generatedAt: Timestamp;

  /** Total number of learning days */
  readonly totalDays: number;

  /** Topics covered in the plan */
  readonly topicsCovered: readonly string[];

  /** Number of verified resources used */
  readonly resourcesUsed: number;

  /** Identified gaps in coverage */
  readonly gaps: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// GOAL
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Extended Goal with branded IDs and learning configuration.
 *
 * This extends the basic Goal concept with:
 * - Type-safe branded IDs
 * - Learning preferences (level, style, schedule)
 * - Reminder configuration
 * - Lesson plan metadata
 */
export interface Goal {
  /** Unique goal identifier */
  readonly id: GoalId;

  /** Owner user identifier */
  readonly userId: UserId;

  /** Goal title */
  readonly title: string;

  /** Detailed description */
  readonly description: string;

  /** Current status */
  readonly status: GoalStatus;

  /** Creation timestamp */
  readonly createdAt: Timestamp;

  /** Last update timestamp */
  readonly updatedAt: Timestamp;

  // ─────────────────────────────────────────────────────────────────────────────
  // Learning Configuration
  // ─────────────────────────────────────────────────────────────────────────────

  /** Learning preferences and schedule */
  readonly learningConfig?: LearningConfig;

  /** Reminder settings */
  readonly reminderConfig?: ReminderConfig;

  // ─────────────────────────────────────────────────────────────────────────────
  // Lesson Plan
  // ─────────────────────────────────────────────────────────────────────────────

  /** Generated lesson plan metadata */
  readonly lessonPlan?: LessonPlanMetadata;
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUEST TYPES
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// QUEST STATUS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Quest status for learning context.
 */
export type QuestStatus = 'pending' | 'active' | 'completed';

// ─────────────────────────────────────────────────────────────────────────────────
// QUEST RESOURCE
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * A verified resource associated with a quest.
 * Denormalized for display without additional lookups.
 */
export interface QuestResource {
  /** Resource identifier */
  readonly resourceId: ResourceId;

  /** Provider identifier (e.g., YouTube video ID, GitHub repo) */
  readonly providerId: string;

  /** Display title */
  readonly title: string;

  /** Content type */
  readonly type: ResourceContentType;

  /** Display URL (sanitized) */
  readonly url: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// QUEST
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * A themed section of a learning goal (e.g., "Week 1: Fundamentals").
 *
 * Quests group related Steps into logical units, typically representing
 * a week or phase of learning.
 */
export interface Quest {
  /** Unique quest identifier */
  readonly id: QuestId;

  /** Parent goal identifier */
  readonly goalId: GoalId;

  /** Quest title (e.g., "Week 1: Rust Basics") */
  readonly title: string;

  /** Detailed description of what this quest covers */
  readonly description: string;

  /** Current status */
  readonly status: QuestStatus;

  /** Order within the goal (1-based) */
  readonly order: number;

  /** Creation timestamp */
  readonly createdAt: Timestamp;

  /** Last update timestamp */
  readonly updatedAt: Timestamp;

  // ─────────────────────────────────────────────────────────────────────────────
  // Topic Coverage
  // ─────────────────────────────────────────────────────────────────────────────

  /** Topic IDs from taxonomy that this quest covers */
  readonly topicIds?: readonly string[];

  /** Estimated number of learning days */
  readonly estimatedDays?: number;

  // ─────────────────────────────────────────────────────────────────────────────
  // Resource Association
  // ─────────────────────────────────────────────────────────────────────────────

  /** Verified resources for this quest (denormalized) */
  readonly verifiedResources?: readonly QuestResource[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP TYPES
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// STEP STATUS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Step status in the learning flow.
 */
export type StepStatus = 'pending' | 'active' | 'completed' | 'skipped';

// ─────────────────────────────────────────────────────────────────────────────────
// DIFFICULTY RATING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * User-provided difficulty rating (1-5 scale).
 */
export type DifficultyRating = 1 | 2 | 3 | 4 | 5;

// ─────────────────────────────────────────────────────────────────────────────────
// STEP
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * A single day's learning content within a Quest.
 *
 * Steps represent one learning session with:
 * - Scheduled date and day number
 * - Learning objective and theme
 * - Activities to complete
 * - Associated resources
 * - Completion tracking with difficulty feedback
 * - Validation state for repair flow
 */
export interface Step {
  /** Unique step identifier */
  readonly id: StepId;

  /** Parent quest identifier */
  readonly questId: QuestId;

  /** Step title (e.g., "Day 3: Ownership & Borrowing") */
  readonly title: string;

  /** Detailed description */
  readonly description: string;

  /** Current status */
  readonly status: StepStatus;

  /** Order within the quest (1-based) */
  readonly order: number;

  /** Creation timestamp */
  readonly createdAt: Timestamp;

  /** Last update timestamp */
  readonly updatedAt: Timestamp;

  // ─────────────────────────────────────────────────────────────────────────────
  // Scheduling
  // ─────────────────────────────────────────────────────────────────────────────

  /** Scheduled date (YYYY-MM-DD format) */
  readonly scheduledDate?: string;

  /** Day number in the overall lesson plan (Day 1, 2, 3...) */
  readonly dayNumber?: number;

  // ─────────────────────────────────────────────────────────────────────────────
  // Learning Content
  // ─────────────────────────────────────────────────────────────────────────────

  /** Learning objective for this day */
  readonly objective?: string;

  /** Theme for the day (e.g., "Memory Safety") */
  readonly theme?: string;

  /** Activities to complete */
  readonly activities?: readonly Activity[];

  /** Resources for this step */
  readonly resources?: readonly StepResource[];

  /** Estimated total time in minutes */
  readonly estimatedMinutes?: number;

  // ─────────────────────────────────────────────────────────────────────────────
  // Completion Tracking
  // ─────────────────────────────────────────────────────────────────────────────

  /** When the user started this step */
  readonly startedAt?: Timestamp;

  /** When the user completed this step */
  readonly completedAt?: Timestamp;

  /** Actual time spent in minutes */
  readonly actualMinutes?: number;

  /** User's difficulty rating (1=easy, 5=very hard) */
  readonly difficultyRating?: DifficultyRating;

  // ─────────────────────────────────────────────────────────────────────────────
  // Validation
  // ─────────────────────────────────────────────────────────────────────────────

  /** Whether this step needs repair (broken resources, etc.) */
  readonly needsRepair?: boolean;

  /** Issues requiring repair */
  readonly repairIssues?: readonly string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTIVITY & STEP RESOURCE TYPES
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// ACTIVITY TYPE
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Type of learning activity.
 *
 * Maps to user actions:
 * - read: Read documentation, articles, book chapters
 * - watch: Watch video content
 * - code: Write or modify code
 * - exercise: Complete practice problems
 * - quiz: Answer knowledge-check questions
 * - project: Work on a mini-project
 */
export type ActivityType =
  | 'read'
  | 'watch'
  | 'code'
  | 'exercise'
  | 'quiz'
  | 'project';

/**
 * A single learning activity within a Step.
 *
 * Activities are actionable tasks that reference a specific resource.
 */
export interface Activity {
  /** Type of activity */
  readonly type: ActivityType;

  /** Resource to use for this activity */
  readonly resourceId: ResourceId;

  /** Specific section to focus on (e.g., "Chapter 4.1", "0:15:30-0:25:00") */
  readonly section?: string;

  /** Specific task to complete (e.g., "Complete exercises 1-5") */
  readonly task?: string;

  /** Estimated time in minutes */
  readonly minutes: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// VERIFICATION LEVEL
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Level of resource verification confidence.
 *
 * - strong: Known source, recently verified, no issues
 * - standard: API metadata valid, accessibility confirmed
 * - weak: Discovery data only, not independently verified
 */
export type VerificationLevel = 'strong' | 'standard' | 'weak';

// ─────────────────────────────────────────────────────────────────────────────────
// STEP RESOURCE
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * A verified resource attached to a Step.
 *
 * Denormalized from VerifiedResource for display without lookups.
 */
export interface StepResource {
  /** Resource identifier */
  readonly id: ResourceId;

  /** Provider identifier (e.g., YouTube video ID, GitHub repo path) */
  readonly providerId: string;

  /** Display title */
  readonly title: string;

  /** Content type */
  readonly type: ResourceContentType;

  /** Display URL (sanitized, safe for user display) */
  readonly url: string;

  /** Verification confidence level */
  readonly verificationLevel: VerificationLevel;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPARK TYPES
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// SPARK STATUS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Spark status in the learning flow.
 */
export type SparkStatus = 'pending' | 'active' | 'completed' | 'skipped';

// ─────────────────────────────────────────────────────────────────────────────────
// SPARK VARIANT (Escalation)
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Spark variant based on escalation level.
 *
 * As reminders escalate, the spark shrinks in scope:
 * - full: Complete action as originally designed
 * - reduced: Smaller subset of the action
 * - minimal: Absolute minimum viable action
 */
export type SparkVariant = 'full' | 'reduced' | 'minimal';

// ─────────────────────────────────────────────────────────────────────────────────
// SPARK BOUNDS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Bounds for spark estimated minutes.
 */
export const SPARK_MINUTES_BOUNDS = {
  /** Minimum minutes for a spark */
  MIN: 5,

  /** Maximum minutes for a spark */
  MAX: 120,
} as const;

// ─────────────────────────────────────────────────────────────────────────────────
// SPARK
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * A minimal, low-friction action that creates immediate forward motion.
 *
 * "Sword exists to convert intention into motion without relying on
 * motivation or willpower." — Nova Constitution §2.3
 *
 * The extended Spark supports:
 * - Escalation variants (shrinking scope over time)
 * - Resource linking for learning context
 * - Reminder tracking for the persistent spark delivery system
 */
export interface Spark {
  /** Unique spark identifier */
  readonly id: SparkId;

  /** Parent step identifier */
  readonly stepId: StepId;

  /** The minimal action text (imperative, actionable) */
  readonly action: string;

  /** Current status */
  readonly status: SparkStatus;

  /** Creation timestamp */
  readonly createdAt: Timestamp;

  /** Last update timestamp */
  readonly updatedAt: Timestamp;

  // ─────────────────────────────────────────────────────────────────────────────
  // Escalation
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Current variant based on escalation.
   * Starts at 'full', shrinks to 'reduced' then 'minimal'.
   */
  readonly variant: SparkVariant;

  /**
   * Escalation level (0 = initial, 1, 2, 3 = max).
   * Higher levels trigger smaller variants and different reminder tones.
   */
  readonly escalationLevel: number;

  // ─────────────────────────────────────────────────────────────────────────────
  // Resource Link
  // ─────────────────────────────────────────────────────────────────────────────

  /** Associated resource identifier (if action involves a resource) */
  readonly resourceId?: ResourceId;

  /** Display URL for the resource (sanitized) */
  readonly resourceUrl?: string;

  /** Specific section in the resource (e.g., "Chapter 3", "0:05:00") */
  readonly resourceSection?: string;

  // ─────────────────────────────────────────────────────────────────────────────
  // Timing
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Estimated time in minutes.
   * Bounded: minimum 5, maximum 120.
   */
  readonly estimatedMinutes: number;

  /** Scheduled time for this spark (ISO 8601 with timezone) */
  readonly scheduledTime?: string;

  // ─────────────────────────────────────────────────────────────────────────────
  // Reminder Tracking
  // ─────────────────────────────────────────────────────────────────────────────

  /** Associated reminder IDs for this spark */
  readonly reminderIds?: readonly ReminderId[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// REMINDER TYPES
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// REMINDER STATUS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Status of a scheduled reminder.
 */
export type ReminderStatus =
  | 'pending' // Scheduled, not yet sent
  | 'sent' // Delivered to user
  | 'cancelled' // Cancelled (spark completed or skipped)
  | 'acknowledged' // User acknowledged/dismissed
  | 'expired'; // Past delivery window, not sent

// ─────────────────────────────────────────────────────────────────────────────────
// REMINDER TONE
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Tone of the reminder message.
 * Changes based on escalation level.
 */
export type ReminderTone = 'encouraging' | 'gentle' | 'last_chance';

// ─────────────────────────────────────────────────────────────────────────────────
// REMINDER CHANNELS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Notification channels for reminders.
 */
export interface ReminderChannels {
  /** Push notification */
  readonly push: boolean;

  /** Email notification */
  readonly email: boolean;

  /** SMS notification */
  readonly sms: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────
// REMINDER SCHEDULE
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * A scheduled reminder for a spark.
 *
 * Reminders escalate over time:
 * - Level 0: First reminder, encouraging tone, full spark
 * - Level 1: Gentle nudge, still full spark
 * - Level 2: Reduced spark variant
 * - Level 3: Last chance, minimal spark variant
 */
export interface ReminderSchedule {
  /** Unique reminder identifier */
  readonly id: ReminderId;

  /** User to remind */
  readonly userId: UserId;

  /** Associated step */
  readonly stepId: StepId;

  /** Associated spark */
  readonly sparkId: SparkId;

  /** Scheduled delivery time (ISO 8601 with timezone) */
  readonly scheduledTime: string;

  /** Escalation level (0-3) */
  readonly escalationLevel: number;

  /** Spark variant to show at this level */
  readonly sparkVariant: SparkVariant;

  /** Tone for the reminder message */
  readonly tone: ReminderTone;

  /** Current status */
  readonly status: ReminderStatus;

  /** When actually sent (if sent) */
  readonly sentAt?: Timestamp;

  /** When user acknowledged (if acknowledged) */
  readonly acknowledgedAt?: Timestamp;

  /** Channels to use for this reminder */
  readonly channels: ReminderChannels;
}

// ─────────────────────────────────────────────────────────────────────────────────
// REMINDER CONFIG DEFAULTS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Default reminder configuration values.
 */
export const REMINDER_CONFIG_DEFAULTS = {
  /** Default first reminder hour (9 AM) */
  FIRST_REMINDER_HOUR: 9,

  /** Default last reminder hour (7 PM) */
  LAST_REMINDER_HOUR: 19,

  /** Default interval between reminders (3 hours) */
  INTERVAL_HOURS: 3,

  /** Default max reminders per day */
  MAX_REMINDERS_PER_DAY: 4,
} as const;

// ─────────────────────────────────────────────────────────────────────────────────
// REMINDER CONFIG
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * User's reminder preferences for a goal.
 *
 * Controls when and how reminders are delivered,
 * including the escalation behavior.
 */
export interface ReminderConfig {
  /** Whether reminders are enabled */
  readonly enabled: boolean;

  /** Hour to start sending reminders (0-23, default: 9) */
  readonly firstReminderHour: number;

  /** Hour to stop sending reminders (0-23, default: 19) */
  readonly lastReminderHour: number;

  /** Hours between reminders (default: 3) */
  readonly intervalHours: number;

  /** Notification channels */
  readonly channels: ReminderChannels;

  /** Whether to shrink spark scope on escalation */
  readonly shrinkSparksOnEscalation: boolean;

  /** Maximum reminders per day */
  readonly maxRemindersPerDay: number;

  /** Days to skip reminders (e.g., weekends) */
  readonly quietDays: readonly DayOfWeek[];

  /** User's timezone (IANA format, e.g., "America/New_York") */
  readonly timezone: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPARK ENGINE TYPES
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// CREATE PARAMS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Parameters for creating a new goal.
 */
export interface CreateGoalParams {
  /** User creating the goal */
  readonly userId: UserId;

  /** Goal title */
  readonly title: string;

  /** Goal description */
  readonly description: string;

  /** Learning configuration */
  readonly learningConfig?: LearningConfig;

  /** Reminder configuration */
  readonly reminderConfig?: ReminderConfig;
}

/**
 * Parameters for creating a new quest.
 */
export interface CreateQuestParams {
  /** Parent goal */
  readonly goalId: GoalId;

  /** Quest title */
  readonly title: string;

  /** Quest description */
  readonly description: string;

  /** Order within goal (1-based) */
  readonly order: number;

  /** Estimated days to complete */
  readonly estimatedDays?: number;
}

/**
 * Parameters for updating a goal.
 */
export interface UpdateGoalParams {
  /** New title */
  readonly title?: string;

  /** New description */
  readonly description?: string;

  /** Updated learning config (merged with existing) */
  readonly learningConfig?: Partial<LearningConfig>;

  /** Updated reminder config (merged with existing) */
  readonly reminderConfig?: Partial<ReminderConfig>;
}

// ─────────────────────────────────────────────────────────────────────────────────
// TODAY RESULT
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Result of getting today's learning content for a user.
 */
export interface TodayResult {
  /** Whether there is content scheduled for today */
  readonly hasContent: boolean;

  /** Today's step (if any) */
  readonly step: Step | null;

  /** Active spark for today (if any) */
  readonly spark: Spark | null;

  /** Today's date in user's timezone (YYYY-MM-DD) */
  readonly date: string;

  /** User's timezone */
  readonly timezone: string;

  /** Goal this content belongs to (if any) */
  readonly goalId: GoalId | null;

  /** Quest this content belongs to (if any) */
  readonly questId: QuestId | null;
}

// ─────────────────────────────────────────────────────────────────────────────────
// PATH PROGRESS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Progress through a goal's learning path.
 */
export interface PathProgress {
  /** Goal identifier */
  readonly goalId: GoalId;

  /** Overall progress (0-100) */
  readonly overallProgress: number;

  /** Completed steps count */
  readonly completedSteps: number;

  /** Total steps count */
  readonly totalSteps: number;

  /** Completed quests count */
  readonly completedQuests: number;

  /** Total quests count */
  readonly totalQuests: number;

  /** Current quest (if active) */
  readonly currentQuest: Quest | null;

  /** Current step (if active) */
  readonly currentStep: Step | null;

  /** Days completed */
  readonly daysCompleted: number;

  /** Total days in plan */
  readonly totalDays: number;

  /** Estimated completion date */
  readonly estimatedCompletionDate: string | null;

  /** Whether user is on track with schedule */
  readonly onTrack: boolean;

  /** Days behind schedule (0 if on track or ahead) */
  readonly daysBehind: number;

  /** Average difficulty rating from completed steps */
  readonly averageDifficulty: number | null;

  /** Last activity timestamp */
  readonly lastActivityAt: Timestamp | null;
}
