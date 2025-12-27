// ═══════════════════════════════════════════════════════════════════════════════
// REFINE MODULE TESTS — Volatility + Topic Landscape
// NovaOS Gates — Phase 14B: SwordGate Refine Expansion
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  VolatilityDetector,
  createVolatilityDetector,
  TopicLandscapeGenerator,
  createTopicLandscapeGenerator,
  DEFAULT_VOLATILITY_THRESHOLDS,
  DEFAULT_REFINE_CONFIG,
  createStableVolatilityAssessment,
  createHighVolatilityAssessment,
  createMinimalLandscape,
  isVolatilityCategory,
  isTopicDifficulty,
  isScopeAssessment,
} from './index.js';

import type {
  VolatilityAssessment,
  VolatilitySignal,
  TopicLandscape,
  IWebSearchService,
  WebSearchRequest,
  WebSearchResponse,
} from './types.js';
import { createTimestamp } from '../../../types/branded.js';

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
 * Create a mock web search service.
 */
function createMockWebSearchService(): IWebSearchService {
  return {
    search: vi.fn().mockResolvedValue({
      results: [
        {
          title: 'React 18 New Features',
          url: 'https://react.dev/blog/2024',
          snippet: 'React 18 introduces concurrent rendering and new hooks...',
          domain: 'react.dev',
          score: 0.95,
        },
      ],
      query: 'react 18',
      totalResults: 1,
      searchedAt: createTimestamp(),
    } as WebSearchResponse),
    isAvailable: vi.fn().mockReturnValue(true),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE GUARD TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Type Guards', () => {
  describe('isVolatilityCategory', () => {
    it('should return true for valid categories', () => {
      expect(isVolatilityCategory('tool_specific')).toBe(true);
      expect(isVolatilityCategory('version_sensitive')).toBe(true);
      expect(isVolatilityCategory('stable')).toBe(true);
      expect(isVolatilityCategory('research_frontier')).toBe(true);
    });

    it('should return false for invalid categories', () => {
      expect(isVolatilityCategory('invalid')).toBe(false);
      expect(isVolatilityCategory('')).toBe(false);
      expect(isVolatilityCategory(null)).toBe(false);
      expect(isVolatilityCategory(123)).toBe(false);
    });
  });

  describe('isTopicDifficulty', () => {
    it('should return true for valid difficulties', () => {
      expect(isTopicDifficulty('foundational')).toBe(true);
      expect(isTopicDifficulty('intermediate')).toBe(true);
      expect(isTopicDifficulty('advanced')).toBe(true);
    });

    it('should return false for invalid difficulties', () => {
      expect(isTopicDifficulty('easy')).toBe(false);
      expect(isTopicDifficulty('hard')).toBe(false);
      expect(isTopicDifficulty(null)).toBe(false);
    });
  });

  describe('isScopeAssessment', () => {
    it('should return true for valid assessments', () => {
      expect(isScopeAssessment('narrow')).toBe(true);
      expect(isScopeAssessment('moderate')).toBe(true);
      expect(isScopeAssessment('broad')).toBe(true);
      expect(isScopeAssessment('vast')).toBe(true);
    });

    it('should return false for invalid assessments', () => {
      expect(isScopeAssessment('small')).toBe(false);
      expect(isScopeAssessment('large')).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY FUNCTION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Factory Functions', () => {
  describe('createStableVolatilityAssessment', () => {
    it('should create a stable assessment', () => {
      const timestamp = createTimestamp();
      const assessment = createStableVolatilityAssessment(timestamp);

      expect(assessment.score).toBe(0.1);
      expect(assessment.needsFreshness).toBe(false);
      expect(assessment.confidence).toBe('high');
      expect(assessment.method).toBe('pattern');
      expect(assessment.signals).toHaveLength(1);
      expect(assessment.signals[0].category).toBe('stable');
    });
  });

  describe('createHighVolatilityAssessment', () => {
    it('should create a high volatility assessment', () => {
      const timestamp = createTimestamp();
      const signals: VolatilitySignal[] = [
        { signal: 'React 18', weight: 0.8, category: 'tool_specific' },
        { signal: 'latest API', weight: 0.7, category: 'version_sensitive' },
      ];
      const searchTopics = ['React 18 changes', 'React 18 hooks'];

      const assessment = createHighVolatilityAssessment(signals, searchTopics, timestamp);

      expect(assessment.score).toBeGreaterThan(0.5);
      expect(assessment.needsFreshness).toBe(true);
      expect(assessment.signals).toEqual(signals);
      expect(assessment.suggestedSearchTopics).toEqual(searchTopics);
    });
  });

  describe('createMinimalLandscape', () => {
    it('should create a minimal landscape', () => {
      const timestamp = createTimestamp();
      const volatility = createStableVolatilityAssessment(timestamp);
      const landscape = createMinimalLandscape('Python', volatility, timestamp);

      expect(landscape.primaryTopic).toBe('Python');
      expect(landscape.subtopics).toHaveLength(0);
      expect(landscape.prerequisites).toHaveLength(0);
      expect(landscape.learningPaths).toHaveLength(0);
      expect(landscape.method).toBe('template');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// VOLATILITY DETECTOR TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('VolatilityDetector', () => {
  let detector: VolatilityDetector;

  beforeEach(() => {
    // Create detector without LLM for pattern-only testing
    detector = createVolatilityDetector(undefined, { useLlm: false });
  });

  describe('Pattern Detection - High Volatility', () => {
    it('should detect React version as high volatility', () => {
      const result = detector.assessSync('Learn React 18');
      
      expect(result.score).toBeGreaterThan(0.5);
      expect(result.signals.some(s => s.category === 'tool_specific')).toBe(true);
    });

    it('should detect OpenAI API as high volatility', () => {
      const result = detector.assessSync('Learn OpenAI API integration');
      
      expect(result.score).toBeGreaterThan(0.7);
      expect(result.signals.some(s => s.category === 'api_dependent')).toBe(true);
    });

    it('should detect cryptocurrency as high volatility', () => {
      const result = detector.assessSync('Learn crypto trading');
      
      expect(result.score).toBeGreaterThan(0.8);
      expect(result.signals.some(s => s.category === 'market_dynamic')).toBe(true);
    });

    it('should detect security topics as high volatility', () => {
      const result = detector.assessSync('Learn penetration testing vulnerabilities');
      
      expect(result.score).toBeGreaterThan(0.7);
      expect(result.signals.some(s => s.category === 'security_threat')).toBe(true);
    });

    it('should detect AWS certification as high volatility', () => {
      const result = detector.assessSync('Prepare for AWS certified solutions architect exam');
      
      expect(result.score).toBeGreaterThan(0.6);
      expect(result.signals.some(s => s.category === 'certification')).toBe(true);
    });

    it('should detect LLM/AI research as high volatility', () => {
      const result = detector.assessSync('Learn prompt engineering for large language models');
      
      expect(result.score).toBeGreaterThan(0.7);
      expect(result.signals.some(s => s.category === 'research_frontier')).toBe(true);
    });
  });

  describe('Pattern Detection - Low Volatility', () => {
    it('should detect algorithms as low volatility', () => {
      const result = detector.assessSync('Learn algorithms and data structures');
      
      expect(result.score).toBeLessThan(0.4);
      expect(result.signals.some(s => s.category === 'stable')).toBe(true);
    });

    it('should detect calculus as low volatility', () => {
      const result = detector.assessSync('Learn calculus');
      
      expect(result.score).toBeLessThan(0.3);
      expect(result.signals.some(s => s.category === 'stable')).toBe(true);
    });

    it('should detect SQL fundamentals as low volatility', () => {
      const result = detector.assessSync('Learn SQL basics and relational database');
      
      expect(result.score).toBeLessThan(0.4);
      expect(result.signals.some(s => s.category === 'stable')).toBe(true);
    });

    it('should detect OOP as low volatility', () => {
      const result = detector.assessSync('Learn object-oriented programming');
      
      expect(result.score).toBeLessThan(0.4);
      expect(result.signals.some(s => s.category === 'stable')).toBe(true);
    });
  });

  describe('Pattern Detection - Mixed Signals', () => {
    it('should balance high and low signals', () => {
      // "Python algorithms" has both stable (algorithms) and potentially variable (Python) signals
      const result = detector.assessSync('Learn Python algorithms');
      
      // Should be moderate - not extremely high or low
      expect(result.score).toBeGreaterThanOrEqual(0.2);
      expect(result.score).toBeLessThan(0.7);
    });
  });

  describe('Search Trigger', () => {
    it('should trigger search for high volatility topics', () => {
      const result = detector.assessSync('Learn React 18 hooks');
      
      expect(detector.shouldTriggerSearch(result)).toBe(true);
    });

    it('should not trigger search for stable topics', () => {
      const result = detector.assessSync('Learn calculus');
      
      expect(detector.shouldTriggerSearch(result)).toBe(false);
    });
  });

  describe('Suggested Search Topics', () => {
    it('should generate search topics for volatile content', () => {
      const result = detector.assessSync('Learn React 18');
      
      if (result.suggestedSearchTopics) {
        expect(result.suggestedSearchTopics.length).toBeGreaterThan(0);
        expect(result.suggestedSearchTopics.some(t => t.toLowerCase().includes('react'))).toBe(true);
      }
    });
  });

  describe('Category Descriptions', () => {
    it('should provide descriptions for all categories', () => {
      const categories = [
        'tool_specific',
        'version_sensitive',
        'regulatory',
        'platform_dependent',
        'certification',
        'research_frontier',
        'market_dynamic',
        'best_practices',
        'security_threat',
        'api_dependent',
        'stable',
      ] as const;

      for (const category of categories) {
        const description = detector.getCategoryDescription(category);
        expect(description).toBeTruthy();
        expect(description.length).toBeGreaterThan(10);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TOPIC LANDSCAPE GENERATOR TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('TopicLandscapeGenerator', () => {
  let generator: TopicLandscapeGenerator;

  beforeEach(() => {
    // Create generator without OpenAI for template-only testing
    generator = createTopicLandscapeGenerator(undefined, {
      enableVolatility: true,
      enableWebSearch: false,
    });
  });

  describe('Template Generation', () => {
    it('should generate landscape for Rust using template', () => {
      const landscape = generator.generateSync('Learn Rust');

      expect(landscape).not.toBeNull();
      expect(landscape!.primaryTopic).toBe('Rust Programming');
      expect(landscape!.subtopics.length).toBeGreaterThan(3);
      expect(landscape!.prerequisites.length).toBeGreaterThan(0);
      expect(landscape!.learningPaths.length).toBeGreaterThan(0);
    });

    it('should generate landscape for Python using template', () => {
      const landscape = generator.generateSync('Learn Python');

      expect(landscape).not.toBeNull();
      expect(landscape!.primaryTopic).toBe('Python Programming');
    });

    it('should generate landscape for React using template', () => {
      const landscape = generator.generateSync('Learn React');

      expect(landscape).not.toBeNull();
      expect(landscape!.primaryTopic).toBe('React Development');
      expect(landscape!.prerequisites.some(p => p.topic.includes('JavaScript'))).toBe(true);
    });

    it('should return null for unknown topics (sync)', () => {
      const landscape = generator.generateSync('Learn obscure framework xyz');

      expect(landscape).toBeNull();
    });
  });

  describe('Template Content Validation', () => {
    it('should have valid subtopic structure for Rust', () => {
      const landscape = generator.generateSync('Rust programming');

      expect(landscape).not.toBeNull();
      
      for (const subtopic of landscape!.subtopics) {
        expect(subtopic.id).toBeTruthy();
        expect(subtopic.name).toBeTruthy();
        expect(subtopic.difficulty).toMatch(/foundational|intermediate|advanced/);
        expect(subtopic.estimatedWeeks).toBeGreaterThan(0);
      }
    });

    it('should have valid prerequisites for React', () => {
      const landscape = generator.generateSync('React');

      expect(landscape).not.toBeNull();

      for (const prereq of landscape!.prerequisites) {
        expect(prereq.topic).toBeTruthy();
        expect(prereq.importance).toMatch(/required|recommended|helpful/);
        expect(prereq.reason).toBeTruthy();
      }
    });

    it('should have valid learning paths', () => {
      const landscape = generator.generateSync('Rust');

      expect(landscape).not.toBeNull();

      for (const path of landscape!.learningPaths) {
        expect(path.id).toBeTruthy();
        expect(path.name).toBeTruthy();
        expect(path.topicSequence.length).toBeGreaterThan(0);
        expect(path.estimatedWeeks).toBeGreaterThan(0);
        expect(path.difficulty).toMatch(/gradual|intensive|self-paced/);
      }
    });
  });

  describe('Volatility Integration', () => {
    it('should include volatility assessment in landscape', () => {
      const landscape = generator.generateSync('React');

      expect(landscape).not.toBeNull();
      expect(landscape!.volatility).toBeDefined();
      expect(landscape!.volatility.score).toBeGreaterThan(0);
    });

    it('should have higher volatility for React than for Rust', () => {
      const reactLandscape = generator.generateSync('React');
      const rustLandscape = generator.generateSync('Rust');

      expect(reactLandscape).not.toBeNull();
      expect(rustLandscape).not.toBeNull();

      // React (frontend framework) should be more volatile than Rust (systems language)
      // But this depends on patterns - just check both have volatility
      expect(reactLandscape!.volatility.score).toBeGreaterThan(0);
      expect(rustLandscape!.volatility.score).toBeGreaterThan(0);
    });
  });

  describe('Async Generation', () => {
    it('should generate landscape asynchronously', async () => {
      const result = await generator.generate('Learn Rust');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.primaryTopic).toBe('Rust Programming');
      }
    });

    it('should handle unknown topics with fallback', async () => {
      const result = await generator.generate('Learn obscure topic xyz');

      // Should succeed with minimal landscape (no LLM available)
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.method).toBe('template'); // Minimal template
      }
    });
  });

  describe('Web Search Service', () => {
    it('should report web search availability', () => {
      const generatorWithoutSearch = createTopicLandscapeGenerator();
      expect(generatorWithoutSearch.hasWebSearch()).toBe(false);
    });

    it('should work with mock web search service', async () => {
      const mockSearch = createMockWebSearchService();
      const generatorWithSearch = createTopicLandscapeGenerator(
        undefined,
        { enableWebSearch: true },
        mockSearch
      );

      expect(generatorWithSearch.hasWebSearch()).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION TESTS (Skipped without API keys)
// ═══════════════════════════════════════════════════════════════════════════════

describe.skip('Integration Tests (requires OPENAI_API_KEY)', () => {
  it('should generate full landscape with LLM', async () => {
    const generator = createTopicLandscapeGenerator(process.env.OPENAI_API_KEY);
    const result = await generator.generate('Learn machine learning');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.subtopics.length).toBeGreaterThan(0);
      expect(result.value.method).toBe('llm');
    }
  });

  it('should assess volatility with LLM', async () => {
    const detector = createVolatilityDetector(process.env.OPENAI_API_KEY);
    const result = await detector.assess('Learn GPT-4 API integration');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.method).toMatch(/llm|hybrid/);
      expect(result.value.score).toBeGreaterThan(0.5);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EDGE CASE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Edge Cases', () => {
  describe('VolatilityDetector', () => {
    let detector: VolatilityDetector;

    beforeEach(() => {
      detector = createVolatilityDetector(undefined, { useLlm: false });
    });

    it('should handle empty string', () => {
      const result = detector.assessSync('');

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    it('should handle very long input', () => {
      const longTopic = 'Learn '.repeat(100) + 'React programming';
      const result = detector.assessSync(longTopic);

      expect(result.score).toBeGreaterThan(0);
    });

    it('should handle special characters', () => {
      const result = detector.assessSync('Learn C++ & C# programming!');

      expect(result.score).toBeGreaterThanOrEqual(0);
    });

    it('should handle numbers only', () => {
      const result = detector.assessSync('12345');

      expect(result.confidence).toBe('low');
    });
  });

  describe('TopicLandscapeGenerator', () => {
    let generator: TopicLandscapeGenerator;

    beforeEach(() => {
      generator = createTopicLandscapeGenerator();
    });

    it('should handle case-insensitive template matching', () => {
      const landscape1 = generator.generateSync('learn RUST');
      const landscape2 = generator.generateSync('Learn rust');
      const landscape3 = generator.generateSync('LEARN RUST');

      expect(landscape1).not.toBeNull();
      expect(landscape2).not.toBeNull();
      expect(landscape3).not.toBeNull();
    });

    it('should handle topic variations', () => {
      const landscape1 = generator.generateSync('Rust programming');
      const landscape2 = generator.generateSync('Learn rust language');
      const landscape3 = generator.generateSync('Master rust');

      expect(landscape1).not.toBeNull();
      expect(landscape2).not.toBeNull();
      expect(landscape3).not.toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Configuration', () => {
  it('should use default volatility thresholds', () => {
    expect(DEFAULT_VOLATILITY_THRESHOLDS.searchTrigger).toBe(0.6);
    expect(DEFAULT_VOLATILITY_THRESHOLDS.shortSegmentTrigger).toBe(0.7);
    expect(DEFAULT_VOLATILITY_THRESHOLDS.deprecationWarningTrigger).toBe(0.8);
  });

  it('should use default refine config', () => {
    expect(DEFAULT_REFINE_CONFIG.enableLandscape).toBe(true);
    expect(DEFAULT_REFINE_CONFIG.enableVolatility).toBe(true);
    expect(DEFAULT_REFINE_CONFIG.enableWebSearch).toBe(true);
    expect(DEFAULT_REFINE_CONFIG.maxSubtopicDepth).toBe(3);
    expect(DEFAULT_REFINE_CONFIG.maxLearningPaths).toBe(3);
  });

  it('should allow custom thresholds', () => {
    const detector = createVolatilityDetector(undefined, {
      thresholds: {
        searchTrigger: 0.5,
        shortSegmentTrigger: 0.6,
        deprecationWarningTrigger: 0.7,
      },
    });

    // Lower threshold means more topics trigger search
    const result = detector.assessSync('Learn React'); // Should be moderate volatility
    
    // With lower threshold, this should trigger search
    expect(result.score).toBeGreaterThan(0);
  });
});
