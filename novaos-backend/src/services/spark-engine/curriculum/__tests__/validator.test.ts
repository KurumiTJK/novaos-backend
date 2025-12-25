// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATOR TESTS — Curriculum Output Validation Tests
// NovaOS Spark Engine — Phase 7: LLM Security & Curriculum
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  validateCurriculumOutput,
  validateSchema,
  validateStructure,
  validateContent,
} from '../validator.js';
import {
  validateResourceIndices,
  validateDaySequence,
  validateMinutesSum,
} from '../schemas.js';
import type { RawCurriculumOutput } from '../types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────────────────────────────────────────

function createValidCurriculum(): RawCurriculumOutput {
  return {
    title: 'TypeScript Fundamentals',
    description: 'Learn TypeScript basics',
    days: [
      {
        day: 1,
        theme: 'Introduction to TypeScript',
        resources: [
          { index: 1, minutes: 30 },
          { index: 2, minutes: 25 },
        ],
        exercises: [
          { type: 'quiz', description: 'Test your knowledge', minutes: 5 },
        ],
        totalMinutes: 60,
        difficulty: 'beginner',
      },
      {
        day: 2,
        theme: 'Types and Interfaces',
        resources: [
          { index: 3, minutes: 45 },
        ],
        exercises: [
          { type: 'practice', description: 'Build a typed component', minutes: 15 },
        ],
        totalMinutes: 60,
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// SCHEMA VALIDATION TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('validateSchema', () => {
  it('should pass valid curriculum', () => {
    const curriculum = createValidCurriculum();
    const result = validateSchema(curriculum);
    
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.data).toBeDefined();
  });

  it('should fail for missing days', () => {
    const curriculum = { title: 'Test' };
    const result = validateSchema(curriculum);
    
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('should fail for empty days array', () => {
    const curriculum = { days: [] };
    const result = validateSchema(curriculum);
    
    expect(result.valid).toBe(false);
  });

  it('should fail for invalid day structure', () => {
    const curriculum = {
      days: [
        { day: 'one', theme: 123 }, // Invalid types
      ],
    };
    const result = validateSchema(curriculum);
    
    expect(result.valid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// STRUCTURAL VALIDATION TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('validateStructure', () => {
  it('should pass valid structure', () => {
    const curriculum = createValidCurriculum();
    const issues = validateStructure(curriculum, 10);
    
    const errors = issues.filter(i => i.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('should detect invalid resource indices', () => {
    const curriculum: RawCurriculumOutput = {
      days: [
        {
          day: 1,
          theme: 'Test',
          resources: [{ index: 99, minutes: 30 }], // Invalid
          totalMinutes: 30,
        },
      ],
    };
    
    const issues = validateStructure(curriculum, 5);
    
    expect(issues.some(i => i.code === 'INVALID_RESOURCE_INDEX')).toBe(true);
  });

  it('should detect day sequence gaps', () => {
    const curriculum: RawCurriculumOutput = {
      days: [
        { day: 1, theme: 'One', resources: [{ index: 1, minutes: 30 }], totalMinutes: 30 },
        { day: 3, theme: 'Three', resources: [{ index: 2, minutes: 30 }], totalMinutes: 30 }, // Gap!
      ],
    };
    
    const issues = validateStructure(curriculum, 5);
    
    expect(issues.some(i => i.code === 'DAY_SEQUENCE_GAPS')).toBe(true);
  });

  it('should detect duplicate days', () => {
    const curriculum: RawCurriculumOutput = {
      days: [
        { day: 1, theme: 'One', resources: [{ index: 1, minutes: 30 }], totalMinutes: 30 },
        { day: 1, theme: 'Also One', resources: [{ index: 2, minutes: 30 }], totalMinutes: 30 }, // Duplicate!
      ],
    };
    
    const issues = validateStructure(curriculum, 5);
    
    expect(issues.some(i => i.code === 'DAY_SEQUENCE_DUPLICATES')).toBe(true);
  });

  it('should warn about minutes mismatch', () => {
    const curriculum: RawCurriculumOutput = {
      days: [
        {
          day: 1,
          theme: 'Test',
          resources: [{ index: 1, minutes: 30 }],
          totalMinutes: 100, // Mismatch!
        },
      ],
    };
    
    const issues = validateStructure(curriculum, 5);
    
    expect(issues.some(i => i.code === 'MINUTES_MISMATCH')).toBe(true);
  });

  it('should detect invalid prerequisites', () => {
    const curriculum: RawCurriculumOutput = {
      days: [
        {
          day: 1,
          theme: 'One',
          resources: [{ index: 1, minutes: 30 }],
          totalMinutes: 30,
          prerequisiteDays: [2], // Invalid: day 2 comes after day 1
        },
        {
          day: 2,
          theme: 'Two',
          resources: [{ index: 2, minutes: 30 }],
          totalMinutes: 30,
        },
      ],
    };
    
    const issues = validateStructure(curriculum, 5);
    
    expect(issues.some(i => i.code === 'INVALID_PREREQUISITE')).toBe(true);
  });

  it('should warn about too many resources per day', () => {
    const curriculum: RawCurriculumOutput = {
      days: [
        {
          day: 1,
          theme: 'Test',
          resources: Array.from({ length: 15 }, (_, i) => ({
            index: i + 1,
            minutes: 5,
          })),
          totalMinutes: 75,
        },
      ],
    };
    
    const issues = validateStructure(curriculum, 20);
    
    expect(issues.some(i => i.code === 'TOO_MANY_RESOURCES')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// CONTENT VALIDATION TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('validateContent', () => {
  it('should pass ASCII content', () => {
    const curriculum = createValidCurriculum();
    const issues = validateContent(curriculum);
    
    expect(issues).toHaveLength(0);
  });

  it('should warn about non-ASCII in title', () => {
    const curriculum: RawCurriculumOutput = {
      title: 'Test 日本語', // Non-ASCII
      days: [
        {
          day: 1,
          theme: 'Test',
          resources: [{ index: 1, minutes: 30 }],
          totalMinutes: 30,
        },
      ],
    };
    
    const issues = validateContent(curriculum);
    
    expect(issues.some(i => i.code === 'NON_ASCII_CONTENT')).toBe(true);
  });

  it('should warn about non-ASCII in theme', () => {
    const curriculum: RawCurriculumOutput = {
      days: [
        {
          day: 1,
          theme: 'Tëst wïth äccents', // Non-ASCII
          resources: [{ index: 1, minutes: 30 }],
          totalMinutes: 30,
        },
      ],
    };
    
    const issues = validateContent(curriculum);
    
    expect(issues.some(i => i.path.includes('theme'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTION TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('validateResourceIndices', () => {
  it('should pass valid indices', () => {
    const days = [
      { resources: [{ index: 1 }, { index: 2 }] },
      { resources: [{ index: 3 }] },
    ];
    
    const result = validateResourceIndices(days, 5);
    
    expect(result.valid).toBe(true);
    expect(result.invalidIndices).toHaveLength(0);
  });

  it('should detect index 0', () => {
    const days = [
      { resources: [{ index: 0 }] },
    ];
    
    const result = validateResourceIndices(days, 5);
    
    expect(result.valid).toBe(false);
    expect(result.invalidIndices).toContainEqual({ day: 1, index: 0 });
  });

  it('should detect index above max', () => {
    const days = [
      { day: 1, resources: [{ index: 10 }] },
    ];
    
    const result = validateResourceIndices(days as any, 5);
    
    expect(result.valid).toBe(false);
  });
});

describe('validateDaySequence', () => {
  it('should pass sequential days', () => {
    const days = [{ day: 1 }, { day: 2 }, { day: 3 }];
    const result = validateDaySequence(days);
    
    expect(result.valid).toBe(true);
    expect(result.gaps).toHaveLength(0);
    expect(result.duplicates).toHaveLength(0);
  });

  it('should detect gaps', () => {
    const days = [{ day: 1 }, { day: 3 }];
    const result = validateDaySequence(days);
    
    expect(result.valid).toBe(false);
    expect(result.gaps).toContain(2);
  });

  it('should detect duplicates', () => {
    const days = [{ day: 1 }, { day: 1 }, { day: 2 }];
    const result = validateDaySequence(days);
    
    expect(result.valid).toBe(false);
    expect(result.duplicates).toContain(1);
  });

  it('should handle unordered days', () => {
    const days = [{ day: 3 }, { day: 1 }, { day: 2 }];
    const result = validateDaySequence(days);
    
    expect(result.valid).toBe(true);
  });
});

describe('validateMinutesSum', () => {
  it('should pass matching minutes', () => {
    const day = {
      resources: [{ minutes: 30 }, { minutes: 20 }],
      exercises: [{ minutes: 10 }],
      totalMinutes: 60,
    };
    
    const result = validateMinutesSum(day);
    
    expect(result.valid).toBe(true);
    expect(result.computed).toBe(60);
  });

  it('should allow tolerance', () => {
    const day = {
      resources: [{ minutes: 30 }],
      exercises: [{ minutes: 10 }],
      totalMinutes: 45, // Off by 5, but within 20%
    };
    
    const result = validateMinutesSum(day);
    
    expect(result.valid).toBe(true);
  });

  it('should fail large mismatch', () => {
    const day = {
      resources: [{ minutes: 30 }],
      exercises: [],
      totalMinutes: 100, // Way off
    };
    
    const result = validateMinutesSum(day);
    
    expect(result.valid).toBe(false);
    expect(result.difference).toBe(70);
  });

  it('should handle missing exercises', () => {
    const day = {
      resources: [{ minutes: 30 }],
      totalMinutes: 30,
    };
    
    const result = validateMinutesSum(day);
    
    expect(result.valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// MAIN VALIDATOR TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('validateCurriculumOutput', () => {
  it('should pass valid curriculum', () => {
    const curriculum = createValidCurriculum();
    const result = validateCurriculumOutput(curriculum, 10);
    
    expect(result.valid).toBe(true);
    expect(result.errorCount).toBe(0);
  });

  it('should aggregate all issues', () => {
    const curriculum: RawCurriculumOutput = {
      title: 'Tëst', // Non-ASCII
      days: [
        {
          day: 1,
          theme: 'Test',
          resources: [{ index: 99, minutes: 30 }], // Invalid index
          totalMinutes: 100, // Mismatch
        },
      ],
    };
    
    const result = validateCurriculumOutput(curriculum, 5);
    
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(1);
    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.warningCount).toBeGreaterThan(0);
  });

  it('should return invalid for schema failures', () => {
    const result = validateCurriculumOutput({ invalid: true }, 5);
    
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.code === 'SCHEMA_ERROR')).toBe(true);
  });
});
