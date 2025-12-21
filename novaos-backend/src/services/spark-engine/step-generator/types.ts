// ═══════════════════════════════════════════════════════════════════════════════
// STEP GENERATOR TYPES — Step Generation Configuration & Results
// NovaOS Spark Engine — Phase 9: Step Generation
// ═══════════════════════════════════════════════════════════════════════════════
//
// Types for the step generation pipeline:
//   - StepGenerationConfig: Configuration for generating steps
//   - StepGenerationResult: Result of step generation with diagnostics
//   - ValidationIssue: Day sequence and gap validation issues
//   - GapRemediation: Strategy for handling topic gaps
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { QuestId, StepId } from '../../../types/branded.js';
import type { Step, DayOfWeek, UserLevel, LearningStyle } from '../types.js';
import type { TopicId, VerifiedResource } from '../resource-discovery/types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// STEP GENERATION CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Configuration for step generation.
 * Derived from Goal.learningConfig but with required fields.
 */
export interface StepGenerationConfig {
  /** Daily time commitment in minutes */
  readonly dailyMinutes: number;

  /** User's current skill level */
  readonly userLevel: UserLevel;

  /** Preferred learning style */
  readonly learningStyle: LearningStyle;

  /** Start date for the learning plan (YYYY-MM-DD) */
  readonly startDate: string;

  /** Days of the week to schedule learning */
  readonly activeDays: readonly DayOfWeek[];

  /** User's timezone (IANA format) */
  readonly timezone: string;
}

/**
 * Default step generation configuration.
 */
export const DEFAULT_STEP_GENERATION_CONFIG: StepGenerationConfig = {
  dailyMinutes: 30,
  userLevel: 'beginner',
  learningStyle: 'mixed',
  startDate: new Date().toISOString().split('T')[0]!,
  activeDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
  timezone: 'UTC',
};

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION ISSUES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Severity of a validation issue.
 */
export type ValidationSeverity = 'error' | 'warning' | 'info';

/**
 * Type of validation issue.
 */
export type ValidationIssueType =
  | 'gap_in_day_sequence'      // Missing day number in sequence
  | 'duplicate_day'            // Same day number appears twice
  | 'invalid_day_number'       // Day number out of range
  | 'missing_prerequisite'     // Resource references missing prerequisite
  | 'uncovered_topic'          // Topic has no resources assigned
  | 'overloaded_day'           // Day exceeds time budget
  | 'underloaded_day'          // Day significantly under time budget
  | 'invalid_date'             // Scheduled date is invalid
  | 'past_date'                // Scheduled date is in the past
  | 'inactive_day';            // Scheduled on a non-active day

/**
 * A validation issue found during step generation.
 */
export interface ValidationIssue {
  /** Issue type */
  readonly type: ValidationIssueType;

  /** Severity level */
  readonly severity: ValidationSeverity;

  /** Human-readable message */
  readonly message: string;

  /** Day number affected (if applicable) */
  readonly dayNumber?: number;

  /** Step ID affected (if applicable) */
  readonly stepId?: StepId;

  /** Topic ID affected (if applicable) */
  readonly topicId?: TopicId;

  /** Suggested remediation */
  readonly suggestion?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GAP REMEDIATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Strategy for handling a gap in topic coverage.
 */
export type GapRemediationStrategy =
  | 'use_fallback'      // Use fallback resource pattern
  | 'manual_search'     // Requires manual resource search
  | 'skip'              // Skip the topic (low priority)
  | 'defer'             // Defer to later in curriculum
  | 'combine';          // Combine with adjacent topic

/**
 * A gap in topic coverage that needs remediation.
 */
export interface TopicGap {
  /** The uncovered topic */
  readonly topicId: TopicId;

  /** Topic display name */
  readonly topicName: string;

  /** Why this gap exists */
  readonly reason: string;

  /** Priority (1 = highest) */
  readonly priority: number;

  /** Estimated minutes needed */
  readonly estimatedMinutes: number;

  /** Prerequisites that are covered */
  readonly coveredPrerequisites: readonly TopicId[];

  /** Prerequisites that are missing */
  readonly missingPrerequisites: readonly TopicId[];
}

/**
 * Remediation plan for a topic gap.
 */
export interface GapRemediation {
  /** The gap being remediated */
  readonly gap: TopicGap;

  /** Chosen strategy */
  readonly strategy: GapRemediationStrategy;

  /** Fallback resource (if using fallback strategy) */
  readonly fallbackResource?: {
    readonly type: 'official_docs' | 'curated_tutorial' | 'exercise_only';
    readonly url?: string;
    readonly title: string;
    readonly estimatedMinutes: number;
  };

  /** Day to insert remediation (if applicable) */
  readonly insertAtDay?: number;

  /** Whether remediation was applied */
  readonly applied: boolean;

  /** Result message */
  readonly message: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP GENERATION RESULT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Diagnostics from step generation.
 */
export interface StepGenerationDiagnostics {
  /** Time spent discovering resources (ms) */
  readonly discoveryDurationMs: number;

  /** Time spent generating curriculum (ms) */
  readonly curriculumDurationMs: number;

  /** Time spent creating step entities (ms) */
  readonly stepCreationDurationMs: number;

  /** Total duration (ms) */
  readonly totalDurationMs: number;

  /** Number of resources discovered */
  readonly resourcesDiscovered: number;

  /** Number of resources used in curriculum */
  readonly resourcesUsed: number;

  /** Topics requested */
  readonly topicsRequested: number;

  /** Topics covered */
  readonly topicsCovered: number;

  /** Cache hit for resources */
  readonly resourceCacheHit: boolean;

  /** LLM tokens used for curriculum */
  readonly llmTokensUsed: number;
}

/**
 * Error codes for step generation.
 */
export type StepGenerationErrorCode =
  | 'LOCK_FAILED'               // Could not acquire distributed lock
  | 'LOCK_TIMEOUT'              // Lock acquisition timed out
  | 'STEPS_ALREADY_EXIST'       // Steps already generated for quest
  | 'NO_RESOURCES'              // No resources found for topics
  | 'DISCOVERY_FAILED'          // Resource discovery failed
  | 'CURRICULUM_FAILED'         // Curriculum generation failed
  | 'VALIDATION_FAILED'         // Day sequence validation failed
  | 'REMEDIATION_FAILED'        // Gap remediation failed
  | 'STORE_ERROR'               // Storage operation failed
  | 'INVALID_CONFIG'            // Invalid generation config
  | 'QUEST_NOT_FOUND'           // Quest doesn't exist
  | 'GOAL_NOT_FOUND';           // Goal doesn't exist

/**
 * Result of step generation.
 */
export interface StepGenerationResult {
  /** Whether generation succeeded */
  readonly success: boolean;

  /** Generated steps (empty if failed) */
  readonly steps: readonly Step[];

  /** Topic gaps found */
  readonly gaps: readonly TopicGap[];

  /** Remediations applied */
  readonly remediations: readonly GapRemediation[];

  /** Validation warnings (non-blocking) */
  readonly warnings: readonly ValidationIssue[];

  /** Error message (if failed) */
  readonly error?: string;

  /** Error code (if failed) */
  readonly errorCode?: StepGenerationErrorCode;

  /** Generation diagnostics */
  readonly diagnostics?: StepGenerationDiagnostics;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOCK TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Distributed lock for step generation.
 */
export interface StepGenerationLock {
  /** Lock key */
  readonly key: string;

  /** Lock owner ID */
  readonly ownerId: string;

  /** Fencing token (monotonically increasing) */
  readonly fencingToken: number;

  /** When the lock expires */
  readonly expiresAt: Date;

  /** Whether lock is held */
  readonly acquired: boolean;
}

/**
 * Lock configuration.
 */
export interface LockConfig {
  /** Lock TTL in milliseconds */
  readonly ttlMs: number;

  /** Maximum wait time for lock acquisition */
  readonly waitTimeoutMs: number;

  /** Retry interval when lock is held */
  readonly retryIntervalMs: number;

  /** Maximum retry attempts */
  readonly maxRetries: number;
}

/**
 * Default lock configuration.
 */
export const DEFAULT_LOCK_CONFIG: LockConfig = {
  ttlMs: 5 * 60 * 1000,         // 5 minutes
  waitTimeoutMs: 30 * 1000,     // 30 seconds
  retryIntervalMs: 500,         // 500ms between retries
  maxRetries: 60,               // 60 retries = 30 seconds
};

// ═══════════════════════════════════════════════════════════════════════════════
// DAY SCHEDULING TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A scheduled learning day.
 */
export interface ScheduledDay {
  /** Day number in the curriculum (1-based) */
  readonly dayNumber: number;

  /** Calendar date (YYYY-MM-DD) */
  readonly date: string;

  /** Day of week */
  readonly dayOfWeek: DayOfWeek;

  /** Whether this is an active learning day */
  readonly isActive: boolean;
}

/**
 * Day scheduling configuration.
 */
export interface DaySchedulingConfig {
  /** Start date (YYYY-MM-DD) */
  readonly startDate: string;

  /** Active days of the week */
  readonly activeDays: readonly DayOfWeek[];

  /** User's timezone */
  readonly timezone: string;

  /** Total number of learning days needed */
  readonly totalDays: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Step generation constraints.
 */
export const STEP_GENERATION_CONSTRAINTS = {
  /** Minimum daily minutes */
  MIN_DAILY_MINUTES: 10,

  /** Maximum daily minutes */
  MAX_DAILY_MINUTES: 480,

  /** Minimum days in curriculum */
  MIN_DAYS: 1,

  /** Maximum days in curriculum */
  MAX_DAYS: 90,

  /** Tolerance for day overload (percentage) */
  OVERLOAD_TOLERANCE_PERCENT: 20,

  /** Tolerance for day underload (percentage) */
  UNDERLOAD_TOLERANCE_PERCENT: 30,

  /** Maximum gaps before failing */
  MAX_GAPS_BEFORE_FAILURE: 5,
} as const;

/**
 * Lock key prefix for step generation.
 */
export const STEP_GENERATION_LOCK_PREFIX = 'sword:lock:step-generation:';

/**
 * Build lock key for a quest.
 */
export function buildLockKey(questId: QuestId): string {
  return `${STEP_GENERATION_LOCK_PREFIX}${questId}`;
}
