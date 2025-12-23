// ═══════════════════════════════════════════════════════════════════════════════
// SCHEMA TESTS — Validation Schema Unit Tests
// NovaOS API Layer — Phase 14
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  // Common
  IdSchema,
  GoalIdSchema,
  CursorPaginationSchema,
  TitleSchema,
  TimezoneSchema,
  TimeSchema,
  createCursor,
  parseCursor,
  
  // Goals
  CreateGoalSchema,
  UpdateGoalSchema,
  ListGoalsQuerySchema,
  GoalTransitionSchema,
  DeleteGoalSchema,
  
  // Sparks
  GenerateSparkSchema,
  CompleteSparkSchema,
  SkipSparkSchema,
  
  // Reminders
  ReminderScheduleSchema,
  UpdateReminderConfigSchema,
  PauseRemindersSchema,
  DaysOfWeekSchema,
} from '../schemas/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// COMMON SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Common Schemas', () => {
  describe('IdSchema', () => {
    it('should accept valid IDs', () => {
      expect(IdSchema.safeParse('abc123').success).toBe(true);
      expect(IdSchema.safeParse('goal_abc123').success).toBe(true);
      expect(IdSchema.safeParse('lxyz-abc123').success).toBe(true);
      expect(IdSchema.safeParse('ABC-123_xyz').success).toBe(true);
    });

    it('should reject empty IDs', () => {
      const result = IdSchema.safeParse('');
      expect(result.success).toBe(false);
    });

    it('should reject IDs with invalid characters', () => {
      expect(IdSchema.safeParse('abc 123').success).toBe(false);
      expect(IdSchema.safeParse('abc/123').success).toBe(false);
      expect(IdSchema.safeParse('abc@123').success).toBe(false);
    });

    it('should reject IDs exceeding max length', () => {
      const longId = 'a'.repeat(129);
      expect(IdSchema.safeParse(longId).success).toBe(false);
    });
  });

  describe('GoalIdSchema', () => {
    it('should transform to GoalId branded type', () => {
      const result = GoalIdSchema.safeParse('goal_123');
      expect(result.success).toBe(true);
      if (result.success) {
        // TypeScript should recognize this as GoalId
        expect(result.data).toBe('goal_123');
      }
    });
  });

  describe('TitleSchema', () => {
    it('should accept valid titles', () => {
      expect(TitleSchema.safeParse('Learn TypeScript').success).toBe(true);
      expect(TitleSchema.safeParse('A').success).toBe(true);
    });

    it('should trim whitespace', () => {
      const result = TitleSchema.safeParse('  Learn TypeScript  ');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('Learn TypeScript');
      }
    });

    it('should reject empty titles', () => {
      expect(TitleSchema.safeParse('').success).toBe(false);
      expect(TitleSchema.safeParse('   ').success).toBe(false);
    });

    it('should reject titles exceeding max length', () => {
      const longTitle = 'a'.repeat(501);
      expect(TitleSchema.safeParse(longTitle).success).toBe(false);
    });
  });

  describe('TimezoneSchema', () => {
    it('should accept valid IANA timezones', () => {
      expect(TimezoneSchema.safeParse('America/New_York').success).toBe(true);
      expect(TimezoneSchema.safeParse('Europe/London').success).toBe(true);
      expect(TimezoneSchema.safeParse('Asia/Tokyo').success).toBe(true);
      expect(TimezoneSchema.safeParse('UTC').success).toBe(true);
    });

    it('should reject invalid timezones', () => {
      expect(TimezoneSchema.safeParse('Invalid/Timezone').success).toBe(false);
      expect(TimezoneSchema.safeParse('EST').success).toBe(false);
      expect(TimezoneSchema.safeParse('').success).toBe(false);
    });
  });

  describe('TimeSchema', () => {
    it('should accept valid 24-hour time formats', () => {
      expect(TimeSchema.safeParse('00:00').success).toBe(true);
      expect(TimeSchema.safeParse('09:30').success).toBe(true);
      expect(TimeSchema.safeParse('23:59').success).toBe(true);
    });

    it('should reject invalid time formats', () => {
      expect(TimeSchema.safeParse('9:30').success).toBe(false);
      expect(TimeSchema.safeParse('24:00').success).toBe(false);
      expect(TimeSchema.safeParse('12:60').success).toBe(false);
      expect(TimeSchema.safeParse('12:00 PM').success).toBe(false);
    });
  });

  describe('CursorPaginationSchema', () => {
    it('should use defaults when no params provided', () => {
      const result = CursorPaginationSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(20);
        expect(result.data.direction).toBe('forward');
        expect(result.data.cursor).toBeUndefined();
      }
    });

    it('should parse limit from string', () => {
      const result = CursorPaginationSchema.safeParse({ limit: '10' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(10);
      }
    });

    it('should cap limit at max', () => {
      const result = CursorPaginationSchema.safeParse({ limit: '999' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(100);
      }
    });

    it('should validate cursor format', () => {
      const validCursor = createCursor('abc123');
      expect(CursorPaginationSchema.safeParse({ cursor: validCursor }).success).toBe(true);
      expect(CursorPaginationSchema.safeParse({ cursor: 'invalid' }).success).toBe(false);
    });
  });

  describe('Cursor utilities', () => {
    it('should create and parse cursors', () => {
      const cursor = createCursor('abc123', '2025-01-01T00:00:00Z');
      const parsed = parseCursor(cursor);
      
      expect(parsed).not.toBeNull();
      expect(parsed?.id).toBe('abc123');
      expect(parsed?.ts).toBe('2025-01-01T00:00:00Z');
    });

    it('should handle cursor without timestamp', () => {
      const cursor = createCursor('abc123');
      const parsed = parseCursor(cursor);
      
      expect(parsed).not.toBeNull();
      expect(parsed?.id).toBe('abc123');
      expect(parsed?.ts).toBeUndefined();
    });

    it('should return null for invalid cursors', () => {
      expect(parseCursor('invalid')).toBeNull();
      expect(parseCursor('')).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// GOAL SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Goal Schemas', () => {
  describe('CreateGoalSchema', () => {
    it('should accept valid goal creation request', () => {
      const result = CreateGoalSchema.safeParse({
        title: 'Learn TypeScript',
        description: 'Master TypeScript for backend development',
        desiredOutcome: 'Build production-ready applications',
      });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.interestLevel).toBe('career_capital'); // default
      }
    });

    it('should accept all optional fields', () => {
      const result = CreateGoalSchema.safeParse({
        title: 'Learn TypeScript',
        description: 'Master TypeScript',
        desiredOutcome: 'Build apps',
        interestLevel: 'financial_stability',
        targetDate: '2025-06-01',
        motivations: ['Career growth', 'Better code'],
        constraints: ['Limited time'],
        successCriteria: ['Complete a project'],
        tags: ['programming', 'typescript'],
      });
      
      expect(result.success).toBe(true);
    });

    it('should reject missing required fields', () => {
      expect(CreateGoalSchema.safeParse({}).success).toBe(false);
      expect(CreateGoalSchema.safeParse({ title: 'Test' }).success).toBe(false);
      expect(CreateGoalSchema.safeParse({ 
        title: 'Test', 
        description: 'Test' 
      }).success).toBe(false);
    });

    it('should reject invalid interest level', () => {
      const result = CreateGoalSchema.safeParse({
        title: 'Test',
        description: 'Test',
        desiredOutcome: 'Test',
        interestLevel: 'invalid',
      });
      expect(result.success).toBe(false);
    });

    it('should limit array sizes', () => {
      const result = CreateGoalSchema.safeParse({
        title: 'Test',
        description: 'Test',
        desiredOutcome: 'Test',
        motivations: Array(11).fill('motivation'),
      });
      expect(result.success).toBe(false);
    });
  });

  describe('UpdateGoalSchema', () => {
    it('should accept partial updates', () => {
      expect(UpdateGoalSchema.safeParse({ title: 'New Title' }).success).toBe(true);
      expect(UpdateGoalSchema.safeParse({ targetDate: '2025-12-01' }).success).toBe(true);
    });

    it('should reject empty updates', () => {
      expect(UpdateGoalSchema.safeParse({}).success).toBe(false);
    });

    it('should allow null for clearable fields', () => {
      const result = UpdateGoalSchema.safeParse({ targetDate: null });
      expect(result.success).toBe(true);
    });
  });

  describe('ListGoalsQuerySchema', () => {
    it('should accept status filter', () => {
      const result = ListGoalsQuerySchema.safeParse({ status: 'active' });
      expect(result.success).toBe(true);
    });

    it('should reject invalid status', () => {
      expect(ListGoalsQuerySchema.safeParse({ status: 'invalid' }).success).toBe(false);
    });
  });

  describe('GoalTransitionSchema', () => {
    it('should accept valid transitions', () => {
      expect(GoalTransitionSchema.safeParse({ type: 'start' }).success).toBe(true);
      expect(GoalTransitionSchema.safeParse({ type: 'complete' }).success).toBe(true);
      expect(GoalTransitionSchema.safeParse({ type: 'pause' }).success).toBe(true);
    });

    it('should accept optional reason', () => {
      const result = GoalTransitionSchema.safeParse({ 
        type: 'abandon', 
        reason: 'Changed priorities' 
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid type', () => {
      expect(GoalTransitionSchema.safeParse({ type: 'invalid' }).success).toBe(false);
    });
  });

  describe('DeleteGoalSchema', () => {
    it('should require explicit confirmation', () => {
      expect(DeleteGoalSchema.safeParse({ confirm: true }).success).toBe(true);
      expect(DeleteGoalSchema.safeParse({ confirm: false }).success).toBe(false);
      expect(DeleteGoalSchema.safeParse({}).success).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// SPARK SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Spark Schemas', () => {
  describe('GenerateSparkSchema', () => {
    it('should require at least one ID', () => {
      expect(GenerateSparkSchema.safeParse({}).success).toBe(false);
      expect(GenerateSparkSchema.safeParse({ stepId: 'step_123' }).success).toBe(true);
      expect(GenerateSparkSchema.safeParse({ questId: 'quest_123' }).success).toBe(true);
      expect(GenerateSparkSchema.safeParse({ goalId: 'goal_123' }).success).toBe(true);
    });

    it('should use defaults', () => {
      const result = GenerateSparkSchema.safeParse({ stepId: 'step_123' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxMinutes).toBe(15);
        expect(result.data.frictionLevel).toBe('minimal');
      }
    });

    it('should validate maxMinutes range', () => {
      expect(GenerateSparkSchema.safeParse({ 
        stepId: 'step_123', 
        maxMinutes: 0 
      }).success).toBe(false);
      expect(GenerateSparkSchema.safeParse({ 
        stepId: 'step_123', 
        maxMinutes: 121 
      }).success).toBe(false);
    });
  });

  describe('CompleteSparkSchema', () => {
    it('should accept empty body', () => {
      expect(CompleteSparkSchema.safeParse({}).success).toBe(true);
    });

    it('should accept all optional fields', () => {
      const result = CompleteSparkSchema.safeParse({
        notes: 'Completed successfully',
        actualMinutes: 12,
        satisfactionRating: 4,
      });
      expect(result.success).toBe(true);
    });

    it('should validate satisfactionRating range', () => {
      expect(CompleteSparkSchema.safeParse({ satisfactionRating: 0 }).success).toBe(false);
      expect(CompleteSparkSchema.safeParse({ satisfactionRating: 6 }).success).toBe(false);
      expect(CompleteSparkSchema.safeParse({ satisfactionRating: 5 }).success).toBe(true);
    });
  });

  describe('SkipSparkSchema', () => {
    it('should require reason', () => {
      expect(SkipSparkSchema.safeParse({}).success).toBe(false);
      expect(SkipSparkSchema.safeParse({ reason: 'no_time' }).success).toBe(true);
    });

    it('should validate reason enum', () => {
      expect(SkipSparkSchema.safeParse({ reason: 'invalid' }).success).toBe(false);
      expect(SkipSparkSchema.safeParse({ reason: 'too_hard' }).success).toBe(true);
      expect(SkipSparkSchema.safeParse({ reason: 'blocked' }).success).toBe(true);
    });

    it('should default reschedule to false', () => {
      const result = SkipSparkSchema.safeParse({ reason: 'no_time' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.reschedule).toBe(false);
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// REMINDER SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Reminder Schemas', () => {
  describe('DaysOfWeekSchema', () => {
    it('should accept valid days', () => {
      expect(DaysOfWeekSchema.safeParse(['monday', 'wednesday', 'friday']).success).toBe(true);
    });

    it('should require at least one day', () => {
      expect(DaysOfWeekSchema.safeParse([]).success).toBe(false);
    });

    it('should reject duplicates', () => {
      expect(DaysOfWeekSchema.safeParse(['monday', 'monday']).success).toBe(false);
    });

    it('should reject invalid days', () => {
      expect(DaysOfWeekSchema.safeParse(['monday', 'funday']).success).toBe(false);
    });
  });

  describe('ReminderScheduleSchema', () => {
    it('should accept valid schedule', () => {
      const result = ReminderScheduleSchema.safeParse({
        time: '09:00',
        timezone: 'America/New_York',
      });
      expect(result.success).toBe(true);
    });

    it('should use default active days', () => {
      const result = ReminderScheduleSchema.safeParse({
        time: '09:00',
        timezone: 'America/New_York',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.activeDays).toEqual([
          'monday', 'tuesday', 'wednesday', 'thursday', 'friday'
        ]);
      }
    });
  });

  describe('UpdateReminderConfigSchema', () => {
    it('should accept partial updates', () => {
      expect(UpdateReminderConfigSchema.safeParse({ enabled: false }).success).toBe(true);
      expect(UpdateReminderConfigSchema.safeParse({ 
        schedule: { time: '10:00' } 
      }).success).toBe(true);
    });

    it('should reject empty updates', () => {
      expect(UpdateReminderConfigSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('PauseRemindersSchema', () => {
    it('should require future date', () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      expect(PauseRemindersSchema.safeParse({ until: futureDate }).success).toBe(true);
      
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      expect(PauseRemindersSchema.safeParse({ until: pastDate }).success).toBe(false);
    });
  });
});
