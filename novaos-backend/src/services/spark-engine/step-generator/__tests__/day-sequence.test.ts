// ═══════════════════════════════════════════════════════════════════════════════
// DAY SEQUENCE TESTS — Day Validation Tests
// NovaOS Spark Engine — Phase 9: Step Generation
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';

import {
  validateDaySequence,
  validateStepSequence,
  hasBlockingIssues,
  countBySeverity,
  getTodayInTimezone,
  isValidDateString,
  getDayOfWeek,
  getNextActiveDate,
  generateSchedule,
  filterByType,
  getIssuesForDay,
} from '../day-sequence.js';
import type { ResolvedCurriculumDay } from '../../curriculum/types.js';
import type { Step } from '../../types.js';
import type { StepGenerationConfig } from '../types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────────────────────────

function createMockDay(day: number, totalMinutes: number = 30): ResolvedCurriculumDay {
  return {
    day,
    theme: `Day ${day} Theme`,
    objectives: [{ description: `Objective for day ${day}` }],
    resources: [],
    exercises: [],
    totalMinutes,
    difficulty: 'beginner',
  };
}

function createMockStep(
  dayNumber: number,
  scheduledDate: string,
  estimatedMinutes: number = 30
): Step {
  return {
    id: `step-${dayNumber}` as any,
    questId: 'quest-1' as any,
    title: `Step ${dayNumber}`,
    description: `Description for step ${dayNumber}`,
    status: 'pending',
    order: dayNumber,
    createdAt: '2025-01-01T00:00:00Z' as any,
    updatedAt: '2025-01-01T00:00:00Z' as any,
    scheduledDate,
    dayNumber,
    objective: `Objective ${dayNumber}`,
    theme: `Theme ${dayNumber}`,
    activities: [],
    resources: [],
    estimatedMinutes,
    needsRepair: false,
    repairIssues: [],
  };
}

const defaultConfig: StepGenerationConfig = {
  dailyMinutes: 30,
  userLevel: 'beginner',
  learningStyle: 'mixed',
  startDate: '2025-01-06', // Monday
  activeDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
  timezone: 'UTC',
};

// ─────────────────────────────────────────────────────────────────────────────────
// DAY SEQUENCE VALIDATION
// ─────────────────────────────────────────────────────────────────────────────────

describe('validateDaySequence', () => {
  it('should return no issues for valid sequence', () => {
    const days = [createMockDay(1), createMockDay(2), createMockDay(3)];
    const issues = validateDaySequence(days, defaultConfig);

    expect(issues.filter(i => i.severity === 'error')).toHaveLength(0);
  });

  it('should detect gap in day sequence', () => {
    const days = [createMockDay(1), createMockDay(3)]; // Missing day 2
    const issues = validateDaySequence(days, defaultConfig);

    const gapIssues = issues.filter(i => i.type === 'gap_in_day_sequence');
    expect(gapIssues).toHaveLength(1);
    expect(gapIssues[0]?.dayNumber).toBe(2);
  });

  it('should detect duplicate days', () => {
    const days = [createMockDay(1), createMockDay(2), createMockDay(2)];
    const issues = validateDaySequence(days, defaultConfig);

    const dupIssues = issues.filter(i => i.type === 'duplicate_day');
    expect(dupIssues).toHaveLength(1);
    expect(dupIssues[0]?.dayNumber).toBe(2);
  });

  it('should warn if sequence does not start at 1', () => {
    const days = [createMockDay(2), createMockDay(3)];
    const issues = validateDaySequence(days, defaultConfig);

    const invalidIssues = issues.filter(i => i.type === 'invalid_day_number');
    expect(invalidIssues.length).toBeGreaterThan(0);
  });

  it('should detect overloaded days', () => {
    const days = [createMockDay(1, 50)]; // 50min vs 30min target = 67% over
    const issues = validateDaySequence(days, defaultConfig);

    const overloadIssues = issues.filter(i => i.type === 'overloaded_day');
    expect(overloadIssues).toHaveLength(1);
  });

  it('should detect underloaded days', () => {
    const days = [createMockDay(1, 15)]; // 15min vs 30min target = 50% under
    const issues = validateDaySequence(days, defaultConfig);

    const underloadIssues = issues.filter(i => i.type === 'underloaded_day');
    expect(underloadIssues).toHaveLength(1);
  });

  it('should return error for empty days array', () => {
    const issues = validateDaySequence([], defaultConfig);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// STEP SEQUENCE VALIDATION
// ─────────────────────────────────────────────────────────────────────────────────

describe('validateStepSequence', () => {
  it('should return no issues for valid step sequence', () => {
    const steps = [
      createMockStep(1, '2025-01-06'),
      createMockStep(2, '2025-01-07'),
      createMockStep(3, '2025-01-08'),
    ];
    const issues = validateStepSequence(steps, defaultConfig);

    expect(issues.filter(i => i.severity === 'error')).toHaveLength(0);
  });

  it('should detect missing scheduled date', () => {
    const step = createMockStep(1, '');
    (step as any).scheduledDate = undefined;
    const issues = validateStepSequence([step], defaultConfig);

    const dateIssues = issues.filter(i => i.type === 'invalid_date');
    expect(dateIssues).toHaveLength(1);
  });

  it('should detect invalid date format', () => {
    const steps = [createMockStep(1, '01-06-2025')]; // Wrong format
    const issues = validateStepSequence(steps, defaultConfig);

    const dateIssues = issues.filter(i => i.type === 'invalid_date');
    expect(dateIssues).toHaveLength(1);
  });

  it('should warn on inactive day scheduling', () => {
    const steps = [createMockStep(1, '2025-01-11')]; // Saturday
    const issues = validateStepSequence(steps, defaultConfig);

    const inactiveIssues = issues.filter(i => i.type === 'inactive_day');
    expect(inactiveIssues).toHaveLength(1);
  });

  it('should detect duplicate scheduled dates', () => {
    const steps = [
      createMockStep(1, '2025-01-06'),
      createMockStep(2, '2025-01-06'), // Same date
    ];
    const issues = validateStepSequence(steps, defaultConfig);

    const dupIssues = issues.filter(i => i.type === 'duplicate_day');
    expect(dupIssues.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// DATE UTILITIES
// ─────────────────────────────────────────────────────────────────────────────────

describe('isValidDateString', () => {
  it('should accept valid YYYY-MM-DD format', () => {
    expect(isValidDateString('2025-01-15')).toBe(true);
    expect(isValidDateString('2025-12-31')).toBe(true);
  });

  it('should reject invalid formats', () => {
    expect(isValidDateString('01-15-2025')).toBe(false);
    expect(isValidDateString('2025/01/15')).toBe(false);
    expect(isValidDateString('2025-1-15')).toBe(false);
    expect(isValidDateString('invalid')).toBe(false);
  });

  it('should reject invalid dates', () => {
    expect(isValidDateString('2025-02-30')).toBe(false); // Feb 30 doesn't exist
    expect(isValidDateString('2025-13-01')).toBe(false); // No month 13
  });
});

describe('getDayOfWeek', () => {
  it('should return correct day of week', () => {
    expect(getDayOfWeek('2025-01-06')).toBe('monday');
    expect(getDayOfWeek('2025-01-07')).toBe('tuesday');
    expect(getDayOfWeek('2025-01-08')).toBe('wednesday');
    expect(getDayOfWeek('2025-01-09')).toBe('thursday');
    expect(getDayOfWeek('2025-01-10')).toBe('friday');
    expect(getDayOfWeek('2025-01-11')).toBe('saturday');
    expect(getDayOfWeek('2025-01-12')).toBe('sunday');
  });
});

describe('getNextActiveDate', () => {
  const activeDays = ['monday', 'wednesday', 'friday'] as const;

  it('should return same date if active', () => {
    const result = getNextActiveDate('2025-01-06', activeDays); // Monday
    expect(result).toBe('2025-01-06');
  });

  it('should skip to next active day', () => {
    const result = getNextActiveDate('2025-01-07', activeDays); // Tuesday -> Wednesday
    expect(result).toBe('2025-01-08');
  });

  it('should skip weekend to next week', () => {
    const result = getNextActiveDate('2025-01-11', activeDays); // Saturday -> Monday
    expect(result).toBe('2025-01-13');
  });

  it('should skip current when requested', () => {
    const result = getNextActiveDate('2025-01-06', activeDays, true); // Monday -> Wednesday
    expect(result).toBe('2025-01-08');
  });
});

describe('generateSchedule', () => {
  it('should generate correct number of days', () => {
    const schedule = generateSchedule('2025-01-06', 5, ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);

    expect(schedule).toHaveLength(5);
    expect(schedule[0]?.dayNumber).toBe(1);
    expect(schedule[4]?.dayNumber).toBe(5);
  });

  it('should skip inactive days', () => {
    const schedule = generateSchedule('2025-01-06', 3, ['monday', 'wednesday', 'friday']);

    expect(schedule[0]?.date).toBe('2025-01-06'); // Monday
    expect(schedule[1]?.date).toBe('2025-01-08'); // Wednesday
    expect(schedule[2]?.date).toBe('2025-01-10'); // Friday
  });

  it('should span multiple weeks', () => {
    const schedule = generateSchedule('2025-01-06', 10, ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);

    expect(schedule).toHaveLength(10);
    expect(schedule[9]?.date).toBe('2025-01-17'); // Second Friday
  });
});

describe('getTodayInTimezone', () => {
  it('should return YYYY-MM-DD format', () => {
    const today = getTodayInTimezone('UTC');
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('should handle different timezones', () => {
    // Just verify it doesn't throw
    expect(() => getTodayInTimezone('America/New_York')).not.toThrow();
    expect(() => getTodayInTimezone('Asia/Tokyo')).not.toThrow();
  });

  it('should fallback for invalid timezone', () => {
    const today = getTodayInTimezone('Invalid/Timezone');
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// ISSUE AGGREGATION
// ─────────────────────────────────────────────────────────────────────────────────

describe('countBySeverity', () => {
  it('should count issues by severity', () => {
    const issues = [
      { type: 'gap_in_day_sequence' as const, severity: 'error' as const, message: 'Gap' },
      { type: 'overloaded_day' as const, severity: 'warning' as const, message: 'Overload' },
      { type: 'underloaded_day' as const, severity: 'info' as const, message: 'Underload' },
      { type: 'duplicate_day' as const, severity: 'error' as const, message: 'Dup' },
    ];

    const counts = countBySeverity(issues);

    expect(counts.error).toBe(2);
    expect(counts.warning).toBe(1);
    expect(counts.info).toBe(1);
  });
});

describe('hasBlockingIssues', () => {
  it('should return true when errors exist', () => {
    const issues = [
      { type: 'gap_in_day_sequence' as const, severity: 'error' as const, message: 'Gap' },
    ];
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it('should return false when only warnings', () => {
    const issues = [
      { type: 'overloaded_day' as const, severity: 'warning' as const, message: 'Warn' },
    ];
    expect(hasBlockingIssues(issues)).toBe(false);
  });
});

describe('filterByType', () => {
  it('should filter issues by type', () => {
    const issues = [
      { type: 'gap_in_day_sequence' as const, severity: 'error' as const, message: 'Gap' },
      { type: 'overloaded_day' as const, severity: 'warning' as const, message: 'Overload' },
      { type: 'gap_in_day_sequence' as const, severity: 'error' as const, message: 'Gap 2' },
    ];

    const filtered = filterByType(issues, ['gap_in_day_sequence']);
    expect(filtered).toHaveLength(2);
  });
});

describe('getIssuesForDay', () => {
  it('should get issues for specific day', () => {
    const issues = [
      { type: 'gap_in_day_sequence' as const, severity: 'error' as const, message: 'Gap', dayNumber: 2 },
      { type: 'overloaded_day' as const, severity: 'warning' as const, message: 'Overload', dayNumber: 3 },
      { type: 'duplicate_day' as const, severity: 'error' as const, message: 'Dup', dayNumber: 2 },
    ];

    const day2Issues = getIssuesForDay(issues, 2);
    expect(day2Issues).toHaveLength(2);
  });
});
