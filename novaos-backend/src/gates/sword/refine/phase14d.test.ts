// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 14D TESTS — Prerequisite Assessor
// NovaOS Gates — Phase 14D: SwordGate Refine Expansion
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  PrerequisiteAssessor,
  createPrerequisiteAssessor,
  DEFAULT_ASSESSOR_CONFIG,
} from './prerequisite-assessor.js';

import type {
  ProficiencyLevel,
  AssessmentQuestion,
  AssessmentState,
} from './prerequisite-assessor.js';

import type {
  Prerequisite,
  PrerequisiteAssessmentResult,
} from './types.js';

import { createUserId } from '../../../types/branded.js';

// ═══════════════════════════════════════════════════════════════════════════════
// MOCKS
// ═══════════════════════════════════════════════════════════════════════════════

// Mock OpenAI
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  })),
}));

/**
 * Create mock prerequisites.
 */
function createMockPrerequisites(): Prerequisite[] {
  return [
    {
      topic: 'Python',
      importance: 'required',
      reason: 'Need Python for data manipulation',
      estimatedWeeks: 4,
      assessmentQuestion: 'How familiar are you with Python programming?',
    },
    {
      topic: 'SQL',
      importance: 'required',
      reason: 'Need SQL for database queries',
      estimatedWeeks: 2,
      assessmentQuestion: 'Can you write basic SQL queries?',
    },
    {
      topic: 'Statistics',
      importance: 'recommended',
      reason: 'Statistics helps with data analysis',
      estimatedWeeks: 3,
    },
    {
      topic: 'Linear Algebra',
      importance: 'helpful',
      reason: 'Useful for understanding ML algorithms',
      estimatedWeeks: 2,
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// PREREQUISITE ASSESSOR TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('PrerequisiteAssessor', () => {
  let assessor: PrerequisiteAssessor;
  const userId = createUserId('test-user');

  beforeEach(() => {
    assessor = createPrerequisiteAssessor(undefined, { useLlm: false });
  });

  describe('startAssessment', () => {
    it('should start assessment with first question', () => {
      const prereqs = createMockPrerequisites();
      const question = assessor.startAssessment(userId, prereqs);

      expect(question).not.toBeNull();
      expect(question!.index).toBe(1);
      expect(question!.total).toBe(3); // Only required + recommended
      expect(question!.prerequisite.topic).toBe('Python');
    });

    it('should filter out helpful prerequisites', () => {
      const prereqs = createMockPrerequisites();
      const question = assessor.startAssessment(userId, prereqs);

      // Should only include required (2) + recommended (1) = 3
      expect(question!.total).toBe(3);
    });

    it('should return null for empty prerequisites', () => {
      const question = assessor.startAssessment(userId, []);

      expect(question).toBeNull();
    });

    it('should use custom assessment question if provided', () => {
      const prereqs = createMockPrerequisites();
      const question = assessor.startAssessment(userId, prereqs);

      expect(question!.question).toBe('How familiar are you with Python programming?');
    });

    it('should generate default question if none provided', () => {
      const prereqs: Prerequisite[] = [
        {
          topic: 'Docker',
          importance: 'required',
          reason: 'Need for deployment',
        },
      ];
      const question = assessor.startAssessment(userId, prereqs);

      expect(question!.question).toContain('Docker');
      expect(question!.question).toContain('deployment');
    });
  });

  describe('processResponse - Pattern Matching', () => {
    beforeEach(() => {
      const prereqs = createMockPrerequisites();
      assessor.startAssessment(userId, prereqs);
    });

    it('should detect proficient from "expert" response', async () => {
      const result = await assessor.processResponse(userId, "I'm an expert in Python, been using it for 5 years");

      expect(result.ok).toBe(true);
      if (result.ok) {
        const state = assessor.getState(userId);
        expect(state!.assessments[0]?.status).toBe('proficient');
      }
    });

    it('should detect proficient from "use it daily" response', async () => {
      const result = await assessor.processResponse(userId, "Yes, I use Python daily at work");

      expect(result.ok).toBe(true);
      if (result.ok) {
        const state = assessor.getState(userId);
        expect(state!.assessments[0]?.status).toBe('proficient');
      }
    });

    it('should detect familiar from "know the basics" response', async () => {
      const result = await assessor.processResponse(userId, "I know the basics of Python");

      expect(result.ok).toBe(true);
      if (result.ok) {
        const state = assessor.getState(userId);
        expect(state!.assessments[0]?.status).toBe('familiar');
      }
    });

    it('should detect needs_review from "rusty" response', async () => {
      const result = await assessor.processResponse(userId, "I learned Python years ago but I'm a bit rusty");

      expect(result.ok).toBe(true);
      if (result.ok) {
        const state = assessor.getState(userId);
        expect(state!.assessments[0]?.status).toBe('needs_review');
      }
    });

    it('should detect needs_learning from "never used" response', async () => {
      const result = await assessor.processResponse(userId, "Never used Python before");

      expect(result.ok).toBe(true);
      if (result.ok) {
        const state = assessor.getState(userId);
        expect(state!.assessments[0]?.status).toBe('needs_learning');
      }
    });

    it('should detect skipped from "skip" response', async () => {
      const result = await assessor.processResponse(userId, "Skip this one please");

      expect(result.ok).toBe(true);
      if (result.ok) {
        const state = assessor.getState(userId);
        expect(state!.assessments[0]?.status).toBe('skipped');
      }
    });
  });

  describe('processResponse - Flow', () => {
    it('should progress through questions', async () => {
      const prereqs = createMockPrerequisites();
      assessor.startAssessment(userId, prereqs);

      // First question
      let result = await assessor.processResponse(userId, "I'm proficient in Python");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.nextQuestion).not.toBeNull();
        expect(result.value.nextQuestion!.index).toBe(2);
        expect(result.value.nextQuestion!.prerequisite.topic).toBe('SQL');
        expect(result.value.result).toBeNull();
      }

      // Second question
      result = await assessor.processResponse(userId, "I know SQL basics");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.nextQuestion).not.toBeNull();
        expect(result.value.nextQuestion!.index).toBe(3);
      }

      // Third question (last)
      result = await assessor.processResponse(userId, "Statistics is new to me");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.nextQuestion).toBeNull();
        expect(result.value.result).not.toBeNull();
      }
    });

    it('should return error for unknown user', async () => {
      const unknownUserId = createUserId('unknown');
      const result = await assessor.processResponse(unknownUserId, "test");

      expect(result.ok).toBe(false);
    });
  });

  describe('skipRemaining', () => {
    it('should mark remaining as skipped', () => {
      const prereqs = createMockPrerequisites();
      assessor.startAssessment(userId, prereqs);

      const result = assessor.skipRemaining(userId);

      expect(result).not.toBeNull();
      expect(result!.assessments.length).toBe(3);
      expect(result!.assessments.every(a => a.status === 'skipped')).toBe(true);
    });

    it('should return null for unknown user', () => {
      const result = assessor.skipRemaining(createUserId('unknown'));

      expect(result).toBeNull();
    });
  });

  describe('quickAssess', () => {
    it('should create result from self-report', () => {
      const prereqs = createMockPrerequisites();
      const selfReport: Record<string, ProficiencyLevel> = {
        'Python': 'proficient',
        'SQL': 'familiar',
        'Statistics': 'needs_learning',
        'Linear Algebra': 'needs_review',
      };

      const result = assessor.quickAssess(prereqs, selfReport);

      expect(result.assessments.length).toBe(4);
      expect(result.assessments.find(a => a.prerequisite.topic === 'Python')?.status).toBe('proficient');
      expect(result.assessments.find(a => a.prerequisite.topic === 'SQL')?.status).toBe('familiar');
    });

    it('should calculate additional weeks correctly', () => {
      const prereqs = createMockPrerequisites();
      const selfReport: Record<string, ProficiencyLevel> = {
        'Python': 'needs_learning',    // 4 weeks
        'SQL': 'needs_learning',       // 2 weeks
        'Statistics': 'proficient',    // 0 weeks
        'Linear Algebra': 'familiar',  // 0 weeks
      };

      const result = assessor.quickAssess(prereqs, selfReport);

      expect(result.additionalWeeksNeeded).toBe(6);
    });

    it('should determine readyToStart correctly', () => {
      const prereqs = createMockPrerequisites();

      // All required proficient
      const readyReport: Record<string, ProficiencyLevel> = {
        'Python': 'proficient',
        'SQL': 'familiar',
        'Statistics': 'needs_learning',
        'Linear Algebra': 'needs_learning',
      };
      const readyResult = assessor.quickAssess(prereqs, readyReport);
      expect(readyResult.readyToStart).toBe(true);

      // Required needs learning
      const notReadyReport: Record<string, ProficiencyLevel> = {
        'Python': 'needs_learning',
        'SQL': 'familiar',
        'Statistics': 'proficient',
        'Linear Algebra': 'proficient',
      };
      const notReadyResult = assessor.quickAssess(prereqs, notReadyReport);
      expect(notReadyResult.readyToStart).toBe(false);
    });
  });

  describe('generateQuestions', () => {
    it('should generate all questions', () => {
      const prereqs = createMockPrerequisites();
      const questions = assessor.generateQuestions(prereqs);

      expect(questions.length).toBe(4);
      expect(questions[0]!.index).toBe(1);
      expect(questions[3]!.index).toBe(4);
    });
  });

  describe('getQuickAssessmentPrompt', () => {
    it('should generate prompt with all prerequisites', () => {
      const prereqs = createMockPrerequisites();
      const prompt = assessor.getQuickAssessmentPrompt(prereqs);

      expect(prompt).toContain('Python');
      expect(prompt).toContain('SQL');
      expect(prompt).toContain('Statistics');
      expect(prompt).toContain('proficient');
    });
  });

  describe('parseQuickAssessment', () => {
    it('should parse topic-level pairs from response', () => {
      const prereqs = createMockPrerequisites();
      const response = "Python - proficient, SQL - familiar, Statistics - new to this";

      const result = assessor.parseQuickAssessment(prereqs, response);

      expect(result['Python']).toBe('proficient');
      expect(result['SQL']).toBe('familiar');
      expect(result['Statistics']).toBe('needs_learning');
    });

    it('should handle varied formats', () => {
      const prereqs: Prerequisite[] = [
        { topic: 'Python', importance: 'required', reason: '' },
        { topic: 'Git', importance: 'required', reason: '' },
      ];
      const response = "I'm an expert in Python but I've never used Git";

      const result = assessor.parseQuickAssessment(prereqs, response);

      expect(result['Python']).toBe('proficient');
      expect(result['Git']).toBe('needs_learning');
    });
  });

  describe('clearState', () => {
    it('should remove user state', () => {
      const prereqs = createMockPrerequisites();
      assessor.startAssessment(userId, prereqs);

      expect(assessor.getState(userId)).not.toBeNull();

      assessor.clearState(userId);

      expect(assessor.getState(userId)).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RESULT CALCULATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Result Calculation', () => {
  let assessor: PrerequisiteAssessor;

  beforeEach(() => {
    assessor = createPrerequisiteAssessor(undefined, { 
      useLlm: false,
      defaultLearningWeeks: 2,
      defaultReviewWeeks: 0.5,
    });
  });

  it('should calculate 0 weeks for all proficient', () => {
    const prereqs: Prerequisite[] = [
      { topic: 'A', importance: 'required', reason: '' },
      { topic: 'B', importance: 'required', reason: '' },
    ];
    const selfReport: Record<string, ProficiencyLevel> = {
      'A': 'proficient',
      'B': 'proficient',
    };

    const result = assessor.quickAssess(prereqs, selfReport);

    expect(result.additionalWeeksNeeded).toBe(0);
    expect(result.readyToStart).toBe(true);
  });

  it('should use prerequisite estimatedWeeks when available', () => {
    const prereqs: Prerequisite[] = [
      { topic: 'A', importance: 'required', reason: '', estimatedWeeks: 5 },
    ];
    const selfReport: Record<string, ProficiencyLevel> = {
      'A': 'needs_learning',
    };

    const result = assessor.quickAssess(prereqs, selfReport);

    expect(result.additionalWeeksNeeded).toBe(5);
  });

  it('should use default weeks when not specified', () => {
    const prereqs: Prerequisite[] = [
      { topic: 'A', importance: 'required', reason: '' }, // No estimatedWeeks
    ];
    const selfReport: Record<string, ProficiencyLevel> = {
      'A': 'needs_learning',
    };

    const result = assessor.quickAssess(prereqs, selfReport);

    expect(result.additionalWeeksNeeded).toBe(2); // defaultLearningWeeks
  });

  it('should add review time for needs_review', () => {
    const prereqs: Prerequisite[] = [
      { topic: 'A', importance: 'required', reason: '' },
    ];
    const selfReport: Record<string, ProficiencyLevel> = {
      'A': 'needs_review',
    };

    const result = assessor.quickAssess(prereqs, selfReport);

    expect(result.additionalWeeksNeeded).toBe(0.5); // defaultReviewWeeks
  });

  it('should generate appropriate summary', () => {
    const prereqs: Prerequisite[] = [
      { topic: 'A', importance: 'required', reason: '' },
      { topic: 'B', importance: 'required', reason: '' },
    ];
    const selfReport: Record<string, ProficiencyLevel> = {
      'A': 'proficient',
      'B': 'needs_learning',
    };

    const result = assessor.quickAssess(prereqs, selfReport);

    expect(result.summary).toContain('Proficient in 1');
    expect(result.summary).toContain('1 needs learning');
    expect(result.summary).toContain('additional week');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Configuration', () => {
  it('should have valid default config', () => {
    expect(DEFAULT_ASSESSOR_CONFIG.useLlm).toBe(true);
    expect(DEFAULT_ASSESSOR_CONFIG.llmModel).toBe('gpt-4o-mini');
    expect(DEFAULT_ASSESSOR_CONFIG.defaultLearningWeeks).toBe(2);
    expect(DEFAULT_ASSESSOR_CONFIG.defaultReviewWeeks).toBe(0.5);
    expect(DEFAULT_ASSESSOR_CONFIG.enableQuickMode).toBe(true);
  });

  it('should allow custom config', () => {
    const assessor = createPrerequisiteAssessor(undefined, {
      defaultLearningWeeks: 4,
      defaultReviewWeeks: 1,
    });

    const prereqs: Prerequisite[] = [
      { topic: 'A', importance: 'required', reason: '' },
    ];
    const result = assessor.quickAssess(prereqs, { 'A': 'needs_learning' });

    expect(result.additionalWeeksNeeded).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════════

describe('Edge Cases', () => {
  let assessor: PrerequisiteAssessor;
  const userId = createUserId('test');

  beforeEach(() => {
    assessor = createPrerequisiteAssessor(undefined, { useLlm: false });
  });

  it('should handle empty response', async () => {
    const prereqs = createMockPrerequisites();
    assessor.startAssessment(userId, prereqs);

    const result = await assessor.processResponse(userId, '');

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Empty response should default to needs_review
      const state = assessor.getState(userId);
      expect(state!.assessments[0]?.status).toBe('needs_review');
    }
  });

  it('should handle ambiguous response', async () => {
    const prereqs = createMockPrerequisites();
    assessor.startAssessment(userId, prereqs);

    const result = await assessor.processResponse(userId, 'I guess so maybe');

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Ambiguous should default to needs_review
      const state = assessor.getState(userId);
      expect(state!.assessments[0]?.status).toBe('needs_review');
    }
  });

  it('should handle only helpful prerequisites', () => {
    const prereqs: Prerequisite[] = [
      { topic: 'A', importance: 'helpful', reason: '' },
      { topic: 'B', importance: 'helpful', reason: '' },
    ];

    const question = assessor.startAssessment(userId, prereqs);

    expect(question).toBeNull(); // No required/recommended
  });

  it('should handle very long responses', async () => {
    const prereqs = createMockPrerequisites();
    assessor.startAssessment(userId, prereqs);

    const longResponse = 'I have been working with Python for many years now. '.repeat(50);
    const result = await assessor.processResponse(userId, longResponse);

    expect(result.ok).toBe(true);
  });

  it('should handle special characters in response', async () => {
    const prereqs = createMockPrerequisites();
    assessor.startAssessment(userId, prereqs);

    const result = await assessor.processResponse(userId, "I'm proficient! 👍 #python @expert");

    expect(result.ok).toBe(true);
    if (result.ok) {
      const state = assessor.getState(userId);
      expect(state!.assessments[0]?.status).toBe('proficient');
    }
  });
});
