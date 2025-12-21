// ═══════════════════════════════════════════════════════════════════════════════
// DAY SEQUENCE VALIDATION — Curriculum Day Validation
// NovaOS Spark Engine — Phase 9: Step Generation
// ═══════════════════════════════════════════════════════════════════════════════
//
// Validates the day sequence in a generated curriculum:
//   - Gaps in day numbers (missing days)
//   - Duplicate day numbers
//   - Invalid day numbers (out of range)
//   - Time budget overload/underload
//   - Missing prerequisites
//   - Date scheduling issues
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { Step, DayOfWeek } from '../types.js';
import type { ResolvedCurriculumDay } from '../curriculum/types.js';
import type {
  ValidationIssue,
  ValidationSeverity,
  ValidationIssueType,
  StepGenerationConfig,
  ScheduledDay,
} from './types.js';
import { STEP_GENERATION_CONSTRAINTS } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// DAY SEQUENCE VALIDATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Validate a sequence of curriculum days.
 *
 * @param days - Curriculum days to validate
 * @param config - Step generation config for time budget validation
 * @returns Array of validation issues found
 */
export function validateDaySequence(
  days: readonly ResolvedCurriculumDay[],
  config?: StepGenerationConfig
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (days.length === 0) {
    issues.push({
      type: 'gap_in_day_sequence',
      severity: 'error',
      message: 'No days in curriculum',
      suggestion: 'Ensure curriculum generation produced at least one day',
    });
    return issues;
  }

  // Check for gaps and duplicates
  issues.push(...validateDayNumbers(days));

  // Check time budgets
  if (config) {
    issues.push(...validateTimeBudgets(days, config.dailyMinutes));
  }

  // Check prerequisites
  issues.push(...validatePrerequisites(days));

  return issues;
}

/**
 * Validate day numbers for gaps and duplicates.
 */
function validateDayNumbers(days: readonly ResolvedCurriculumDay[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenDays = new Map<number, number>(); // dayNumber -> count

  // Count occurrences
  for (const day of days) {
    const count = seenDays.get(day.day) ?? 0;
    seenDays.set(day.day, count + 1);
  }

  // Check for duplicates
  for (const [dayNumber, count] of seenDays) {
    if (count > 1) {
      issues.push({
        type: 'duplicate_day',
        severity: 'error',
        message: `Day ${dayNumber} appears ${count} times`,
        dayNumber,
        suggestion: 'Merge duplicate days or renumber them',
      });
    }
  }

  // Check for gaps
  const dayNumbers = Array.from(seenDays.keys()).sort((a, b) => a - b);
  
  if (dayNumbers.length === 0) {
    return issues;
  }

  const minDay = dayNumbers[0]!;
  const maxDay = dayNumbers[dayNumbers.length - 1]!;

  // Check if starts at 1
  if (minDay !== 1) {
    issues.push({
      type: 'invalid_day_number',
      severity: 'warning',
      message: `Day sequence starts at ${minDay} instead of 1`,
      dayNumber: minDay,
      suggestion: 'Renumber days to start at 1',
    });
  }

  // Check for gaps
  for (let i = minDay; i <= maxDay; i++) {
    if (!seenDays.has(i)) {
      issues.push({
        type: 'gap_in_day_sequence',
        severity: 'error',
        message: `Missing day ${i} in sequence`,
        dayNumber: i,
        suggestion: `Add content for day ${i} or renumber subsequent days`,
      });
    }
  }

  // Check for invalid day numbers
  for (const dayNumber of dayNumbers) {
    if (dayNumber < 1) {
      issues.push({
        type: 'invalid_day_number',
        severity: 'error',
        message: `Invalid day number: ${dayNumber} (must be >= 1)`,
        dayNumber,
        suggestion: 'Renumber to a positive integer',
      });
    }

    if (dayNumber > STEP_GENERATION_CONSTRAINTS.MAX_DAYS) {
      issues.push({
        type: 'invalid_day_number',
        severity: 'warning',
        message: `Day ${dayNumber} exceeds maximum of ${STEP_GENERATION_CONSTRAINTS.MAX_DAYS}`,
        dayNumber,
        suggestion: 'Consider splitting into multiple goals',
      });
    }
  }

  return issues;
}

/**
 * Validate time budgets for each day.
 */
function validateTimeBudgets(
  days: readonly ResolvedCurriculumDay[],
  targetMinutes: number
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const overloadThreshold = targetMinutes * (1 + STEP_GENERATION_CONSTRAINTS.OVERLOAD_TOLERANCE_PERCENT / 100);
  const underloadThreshold = targetMinutes * (1 - STEP_GENERATION_CONSTRAINTS.UNDERLOAD_TOLERANCE_PERCENT / 100);

  for (const day of days) {
    if (day.totalMinutes > overloadThreshold) {
      const overloadPercent = Math.round((day.totalMinutes / targetMinutes - 1) * 100);
      issues.push({
        type: 'overloaded_day',
        severity: 'warning',
        message: `Day ${day.day} is ${overloadPercent}% over time budget (${day.totalMinutes}min vs ${targetMinutes}min target)`,
        dayNumber: day.day,
        suggestion: 'Move some content to adjacent days or mark resources as optional',
      });
    }

    if (day.totalMinutes < underloadThreshold && day.totalMinutes > 0) {
      const underloadPercent = Math.round((1 - day.totalMinutes / targetMinutes) * 100);
      issues.push({
        type: 'underloaded_day',
        severity: 'info',
        message: `Day ${day.day} is ${underloadPercent}% under time budget (${day.totalMinutes}min vs ${targetMinutes}min target)`,
        dayNumber: day.day,
        suggestion: 'Consider adding exercises or optional resources',
      });
    }
  }

  return issues;
}

/**
 * Validate prerequisite days are scheduled before dependent days.
 */
function validatePrerequisites(days: readonly ResolvedCurriculumDay[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const day of days) {
    if (!day.prerequisiteDays || day.prerequisiteDays.length === 0) {
      continue;
    }

    for (const prereqDay of day.prerequisiteDays) {
      if (prereqDay >= day.day) {
        issues.push({
          type: 'missing_prerequisite',
          severity: 'error',
          message: `Day ${day.day} lists day ${prereqDay} as prerequisite, but it comes after or at the same position`,
          dayNumber: day.day,
          suggestion: `Reorder days so day ${prereqDay} comes before day ${day.day}`,
        });
      }
    }
  }

  return issues;
}

// ─────────────────────────────────────────────────────────────────────────────────
// STEP SEQUENCE VALIDATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Validate a sequence of generated steps.
 *
 * @param steps - Steps to validate
 * @param config - Step generation config
 * @returns Array of validation issues found
 */
export function validateStepSequence(
  steps: readonly Step[],
  config: StepGenerationConfig
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (steps.length === 0) {
    issues.push({
      type: 'gap_in_day_sequence',
      severity: 'error',
      message: 'No steps generated',
      suggestion: 'Check resource discovery and curriculum generation',
    });
    return issues;
  }

  // Validate day numbers
  issues.push(...validateStepDayNumbers(steps));

  // Validate scheduled dates
  issues.push(...validateScheduledDates(steps, config));

  // Validate time budgets
  issues.push(...validateStepTimeBudgets(steps, config.dailyMinutes));

  return issues;
}

/**
 * Validate step day numbers.
 */
function validateStepDayNumbers(steps: readonly Step[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenDays = new Map<number, Step[]>();

  for (const step of steps) {
    const existing = seenDays.get(step.dayNumber) ?? [];
    existing.push(step);
    seenDays.set(step.dayNumber, existing);
  }

  // Check for duplicates
  for (const [dayNumber, stepsOnDay] of seenDays) {
    if (stepsOnDay.length > 1) {
      issues.push({
        type: 'duplicate_day',
        severity: 'error',
        message: `Multiple steps scheduled for day ${dayNumber}`,
        dayNumber,
        stepId: stepsOnDay[0]!.id,
        suggestion: 'Merge steps or reschedule to different days',
      });
    }
  }

  // Check for gaps
  const dayNumbers = Array.from(seenDays.keys()).sort((a, b) => a - b);
  if (dayNumbers.length > 0) {
    const minDay = dayNumbers[0]!;
    const maxDay = dayNumbers[dayNumbers.length - 1]!;

    for (let i = minDay; i <= maxDay; i++) {
      if (!seenDays.has(i)) {
        issues.push({
          type: 'gap_in_day_sequence',
          severity: 'error',
          message: `No step scheduled for day ${i}`,
          dayNumber: i,
          suggestion: 'Add content for this day or renumber steps',
        });
      }
    }
  }

  return issues;
}

/**
 * Validate scheduled dates.
 */
function validateScheduledDates(
  steps: readonly Step[],
  config: StepGenerationConfig
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const today = getTodayInTimezone(config.timezone);
  const seenDates = new Map<string, Step[]>();

  for (const step of steps) {
    if (!step.scheduledDate) {
      issues.push({
        type: 'invalid_date',
        severity: 'error',
        message: `Step for day ${step.dayNumber} has no scheduled date`,
        dayNumber: step.dayNumber,
        stepId: step.id,
        suggestion: 'Assign a scheduled date',
      });
      continue;
    }

    // Check date format
    if (!isValidDateString(step.scheduledDate)) {
      issues.push({
        type: 'invalid_date',
        severity: 'error',
        message: `Invalid date format for day ${step.dayNumber}: ${step.scheduledDate}`,
        dayNumber: step.dayNumber,
        stepId: step.id,
        suggestion: 'Use YYYY-MM-DD format',
      });
      continue;
    }

    // Check for past dates (only for day 1)
    if (step.dayNumber === 1 && step.scheduledDate < today) {
      issues.push({
        type: 'past_date',
        severity: 'warning',
        message: `Day 1 is scheduled for ${step.scheduledDate}, which is in the past`,
        dayNumber: step.dayNumber,
        stepId: step.id,
        suggestion: 'Update start date to today or later',
      });
    }

    // Check day of week
    const dayOfWeek = getDayOfWeek(step.scheduledDate);
    if (!config.activeDays.includes(dayOfWeek)) {
      issues.push({
        type: 'inactive_day',
        severity: 'warning',
        message: `Day ${step.dayNumber} is scheduled on ${dayOfWeek}, which is not an active learning day`,
        dayNumber: step.dayNumber,
        stepId: step.id,
        suggestion: `Reschedule to an active day (${config.activeDays.join(', ')})`,
      });
    }

    // Track for duplicate detection
    const existing = seenDates.get(step.scheduledDate) ?? [];
    existing.push(step);
    seenDates.set(step.scheduledDate, existing);
  }

  // Check for duplicate dates
  for (const [date, stepsOnDate] of seenDates) {
    if (stepsOnDate.length > 1) {
      issues.push({
        type: 'duplicate_day',
        severity: 'error',
        message: `Multiple steps scheduled for ${date}: days ${stepsOnDate.map(s => s.dayNumber).join(', ')}`,
        suggestion: 'Reschedule steps to different dates',
      });
    }
  }

  return issues;
}

/**
 * Validate step time budgets.
 */
function validateStepTimeBudgets(
  steps: readonly Step[],
  targetMinutes: number
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const overloadThreshold = targetMinutes * (1 + STEP_GENERATION_CONSTRAINTS.OVERLOAD_TOLERANCE_PERCENT / 100);
  const underloadThreshold = targetMinutes * (1 - STEP_GENERATION_CONSTRAINTS.UNDERLOAD_TOLERANCE_PERCENT / 100);

  for (const step of steps) {
    if (step.estimatedMinutes > overloadThreshold) {
      const overloadPercent = Math.round((step.estimatedMinutes / targetMinutes - 1) * 100);
      issues.push({
        type: 'overloaded_day',
        severity: 'warning',
        message: `Day ${step.dayNumber} is ${overloadPercent}% over budget (${step.estimatedMinutes}min vs ${targetMinutes}min)`,
        dayNumber: step.dayNumber,
        stepId: step.id,
        suggestion: 'Split into multiple days or reduce content',
      });
    }

    if (step.estimatedMinutes < underloadThreshold && step.estimatedMinutes > 0) {
      const underloadPercent = Math.round((1 - step.estimatedMinutes / targetMinutes) * 100);
      issues.push({
        type: 'underloaded_day',
        severity: 'info',
        message: `Day ${step.dayNumber} is ${underloadPercent}% under budget (${step.estimatedMinutes}min vs ${targetMinutes}min)`,
        dayNumber: step.dayNumber,
        stepId: step.id,
        suggestion: 'Add exercises or supplementary content',
      });
    }
  }

  return issues;
}

// ─────────────────────────────────────────────────────────────────────────────────
// DATE UTILITIES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Get today's date in the given timezone.
 */
export function getTodayInTimezone(timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  } catch {
    // Fallback to UTC
    return new Date().toISOString().split('T')[0]!;
  }
}

/**
 * Check if a string is a valid YYYY-MM-DD date.
 */
export function isValidDateString(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }
  const parsed = new Date(date + 'T00:00:00Z');
  return !isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date);
}

/**
 * Get the day of week for a date string.
 */
export function getDayOfWeek(date: string): DayOfWeek {
  const days: DayOfWeek[] = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ];
  const d = new Date(date + 'T12:00:00Z'); // Use noon to avoid timezone issues
  return days[d.getUTCDay()]!;
}

/**
 * Get the next active date from a starting date.
 */
export function getNextActiveDate(
  currentDate: string,
  activeDays: readonly DayOfWeek[],
  skipCurrent = false
): string {
  let date = new Date(currentDate + 'T12:00:00Z');
  
  if (skipCurrent) {
    date.setUTCDate(date.getUTCDate() + 1);
  }

  // Safety limit to prevent infinite loop
  for (let i = 0; i < 14; i++) {
    const dayOfWeek = getDayOfWeek(date.toISOString().split('T')[0]!);
    if (activeDays.includes(dayOfWeek)) {
      return date.toISOString().split('T')[0]!;
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }

  // Fallback: return current date if no active days found
  return currentDate;
}

/**
 * Generate a schedule of dates for a curriculum.
 */
export function generateSchedule(
  startDate: string,
  totalDays: number,
  activeDays: readonly DayOfWeek[]
): ScheduledDay[] {
  const schedule: ScheduledDay[] = [];
  let currentDate = startDate;

  for (let dayNumber = 1; dayNumber <= totalDays; dayNumber++) {
    // Find next active date
    currentDate = getNextActiveDate(
      currentDate,
      activeDays,
      dayNumber > 1 // Skip current for days after first
    );

    schedule.push({
      dayNumber,
      date: currentDate,
      dayOfWeek: getDayOfWeek(currentDate),
      isActive: true,
    });
  }

  return schedule;
}

// ─────────────────────────────────────────────────────────────────────────────────
// ISSUE AGGREGATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Count issues by severity.
 */
export function countBySeverity(
  issues: readonly ValidationIssue[]
): Record<ValidationSeverity, number> {
  const counts: Record<ValidationSeverity, number> = {
    error: 0,
    warning: 0,
    info: 0,
  };

  for (const issue of issues) {
    counts[issue.severity]++;
  }

  return counts;
}

/**
 * Check if any issues are blocking (errors).
 */
export function hasBlockingIssues(issues: readonly ValidationIssue[]): boolean {
  return issues.some(issue => issue.severity === 'error');
}

/**
 * Filter issues by type.
 */
export function filterByType(
  issues: readonly ValidationIssue[],
  types: readonly ValidationIssueType[]
): ValidationIssue[] {
  return issues.filter(issue => types.includes(issue.type));
}

/**
 * Get issues for a specific day.
 */
export function getIssuesForDay(
  issues: readonly ValidationIssue[],
  dayNumber: number
): ValidationIssue[] {
  return issues.filter(issue => issue.dayNumber === dayNumber);
}
