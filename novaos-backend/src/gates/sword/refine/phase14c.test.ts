// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 14C TESTS — Web Search Enrichment + Path Recommender
// NovaOS Gates — Phase 14C: SwordGate Refine Expansion
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  WebSearchEnricher,
  createWebSearchEnricher,
  DEFAULT_ENRICHER_CONFIG,
} from './web-search-enricher.js';

import {
  PathRecommender,
  createPathRecommender,
  DEFAULT_RECOMMENDER_CONFIG,
} from './path-recommender.js';

import type {
  TopicLandscape,
  VolatilityAssessment,
  LearningPath,
  Prerequisite,
  IWebSearchService,
  WebSearchRequest,
  WebSearchResponse,
  WebSearchResult,
} from './types.js';

import type { ExploreContext } from '../explore/types.js';
import type { PathMatchContext, PathRecommendation } from './path-recommender.js';

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
function createMockWebSearchService(
  results: WebSearchResult[] = []
): IWebSearchService {
  return {
    search: vi.fn().mockResolvedValue({
      results,
      query: 'test query',
      totalResults: results.length,
      searchedAt: createTimestamp(),
    } as WebSearchResponse),
    isAvailable: vi.fn().mockReturnValue(true),
  };
}

/**
 * Create a mock volatility assessment.
 */
function createMockVolatility(
  score: number,
  needsFreshness: boolean,
  suggestedSearchTopics?: string[]
): VolatilityAssessment {
  return {
    score,
    needsFreshness,
    signals: [{ signal: 'test', weight: score, category: 'tool_specific' }],
    confidence: 'high',
    method: 'pattern',
    suggestedSearchTopics,
    assessedAt: createTimestamp(),
  };
}

/**
 * Create a mock topic landscape.
 */
function createMockLandscape(
  volatility: VolatilityAssessment,
  paths: LearningPath[] = [],
  prerequisites: Prerequisite[] = []
): TopicLandscape {
  return {
    primaryTopic: 'Test Topic',
    overview: 'Test overview',
    subtopics: [],
    prerequisites,
    learningPaths: paths,
    scopeAssessment: 'moderate',
    volatility,
    deprecations: [],
    relatedTopics: [],
    generatedAt: createTimestamp(),
    method: 'template',
  };
}

/**
 * Create a mock learning path.
 */
function createMockPath(
  id: string,
  name: string,
  options: Partial<LearningPath> = {}
): LearningPath {
  return {
    id,
    name,
    description: options.description || `${name} description`,
    targetRole: options.targetRole,
    topicSequence: options.topicSequence || ['topic-1', 'topic-2'],
    estimatedWeeks: options.estimatedWeeks || 8,
    difficulty: options.difficulty || 'gradual',
    bestFor: options.bestFor || ['beginners'],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEB SEARCH ENRICHER TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('WebSearchEnricher', () => {
  describe('shouldEnrich', () => {
    it('should return true for high volatility', () => {
      const mockService = createMockWebSearchService();
      const enricher = createWebSearchEnricher(mockService);
      const volatility = createMockVolatility(0.8, true);

      expect(enricher.shouldEnrich(volatility)).toBe(true);
    });

    it('should return true when needsFreshness is true', () => {
      const mockService = createMockWebSearchService();
      const enricher = createWebSearchEnricher(mockService);
      const volatility = createMockVolatility(0.5, true);

      expect(enricher.shouldEnrich(volatility)).toBe(true);
    });

    it('should return false for low volatility', () => {
      const mockService = createMockWebSearchService();
      const enricher = createWebSearchEnricher(mockService);
      const volatility = createMockVolatility(0.3, false);

      expect(enricher.shouldEnrich(volatility)).toBe(false);
    });

    it('should respect custom threshold', () => {
      const mockService = createMockWebSearchService();
      const enricher = createWebSearchEnricher(mockService, { volatilityThreshold: 0.4 });
      const volatility = createMockVolatility(0.5, false);

      expect(enricher.shouldEnrich(volatility)).toBe(true);
    });
  });

  describe('enrich', () => {
    it('should skip enrichment for low volatility', async () => {
      const mockService = createMockWebSearchService();
      const enricher = createWebSearchEnricher(mockService);
      const volatility = createMockVolatility(0.2, false);
      const landscape = createMockLandscape(volatility);

      const result = await enricher.enrich(landscape);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.freshness).toBeUndefined();
        expect(mockService.search).not.toHaveBeenCalled();
      }
    });

    it('should enrich for high volatility', async () => {
      const mockResults: WebSearchResult[] = [
        {
          title: 'React 18 Release Notes',
          url: 'https://react.dev/blog',
          snippet: 'React 18 introduces concurrent rendering and new hooks',
          domain: 'react.dev',
        },
      ];
      const mockService = createMockWebSearchService(mockResults);
      const enricher = createWebSearchEnricher(mockService);
      const volatility = createMockVolatility(0.8, true, ['React 18 changes']);
      const landscape = createMockLandscape(volatility);

      const result = await enricher.enrich(landscape);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.freshness).toBeDefined();
        expect(result.value.freshness?.sources).toContain('react.dev');
        expect(mockService.search).toHaveBeenCalled();
      }
    });

    it('should extract deprecations from search results', async () => {
      const mockResults: WebSearchResult[] = [
        {
          title: 'componentWillMount is deprecated',
          url: 'https://react.dev/docs',
          snippet: 'componentWillMount is deprecated. Use useEffect instead.',
          domain: 'react.dev',
        },
      ];
      const mockService = createMockWebSearchService(mockResults);
      const enricher = createWebSearchEnricher(mockService);
      const volatility = createMockVolatility(0.8, true);
      const landscape = createMockLandscape(volatility);

      const result = await enricher.enrich(landscape);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.deprecations.length).toBeGreaterThan(0);
        expect(result.value.deprecations.some(d => 
          d.reason.toLowerCase().includes('deprecated')
        )).toBe(true);
      }
    });

    it('should extract version information', async () => {
      const mockResults: WebSearchResult[] = [
        {
          title: 'React v18.2.0 Released',
          url: 'https://react.dev/blog',
          snippet: 'We are excited to announce version 18.2.0 of React',
          domain: 'react.dev',
        },
      ];
      const mockService = createMockWebSearchService(mockResults);
      const enricher = createWebSearchEnricher(mockService);
      const volatility = createMockVolatility(0.8, true);
      const landscape = createMockLandscape(volatility);

      const result = await enricher.enrich(landscape);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.freshness?.latestVersion).toBe('18.2.0');
      }
    });

    it('should handle unavailable service gracefully', async () => {
      const mockService: IWebSearchService = {
        search: vi.fn(),
        isAvailable: vi.fn().mockReturnValue(false),
      };
      const enricher = createWebSearchEnricher(mockService);
      const volatility = createMockVolatility(0.8, true);
      const landscape = createMockLandscape(volatility);

      const result = await enricher.enrich(landscape);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.freshness).toBeUndefined();
        expect(mockService.search).not.toHaveBeenCalled();
      }
    });
  });

  describe('isAvailable', () => {
    it('should reflect service availability', () => {
      const availableService: IWebSearchService = {
        search: vi.fn(),
        isAvailable: vi.fn().mockReturnValue(true),
      };
      const unavailableService: IWebSearchService = {
        search: vi.fn(),
        isAvailable: vi.fn().mockReturnValue(false),
      };

      expect(createWebSearchEnricher(availableService).isAvailable()).toBe(true);
      expect(createWebSearchEnricher(unavailableService).isAvailable()).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PATH RECOMMENDER TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('PathRecommender', () => {
  let recommender: PathRecommender;

  beforeEach(() => {
    recommender = createPathRecommender(undefined, { useLlm: false });
  });

  describe('recommendSync', () => {
    it('should return null for landscape with no paths', () => {
      const volatility = createMockVolatility(0.5, false);
      const landscape = createMockLandscape(volatility, []);

      const result = recommender.recommendSync(landscape, {});

      expect(result).toBeNull();
    });

    it('should recommend single path with high confidence', () => {
      const path = createMockPath('path-1', 'Only Path');
      const volatility = createMockVolatility(0.5, false);
      const landscape = createMockLandscape(volatility, [path]);

      const result = recommender.recommendSync(landscape, {});

      expect(result).not.toBeNull();
      expect(result!.recommendedPath.id).toBe('path-1');
      expect(result!.confidence).toBe(0.8);
      expect(result!.alternatives).toHaveLength(0);
    });

    it('should match gradual path to beginners', () => {
      const gradualPath = createMockPath('gradual', 'Beginner Path', {
        difficulty: 'gradual',
        bestFor: ['beginners', 'first-time learners'],
      });
      const intensivePath = createMockPath('intensive', 'Fast Track', {
        difficulty: 'intensive',
        bestFor: ['experienced developers'],
      });
      const volatility = createMockVolatility(0.5, false);
      const landscape = createMockLandscape(volatility, [gradualPath, intensivePath]);

      const result = recommender.recommendSync(landscape, { userLevel: 'beginner' });

      expect(result).not.toBeNull();
      expect(result!.recommendedPath.id).toBe('gradual');
    });

    it('should match intensive path to advanced users', () => {
      const gradualPath = createMockPath('gradual', 'Beginner Path', {
        difficulty: 'gradual',
        bestFor: ['beginners'],
      });
      const intensivePath = createMockPath('intensive', 'Fast Track', {
        difficulty: 'intensive',
        bestFor: ['experienced developers'],
      });
      const volatility = createMockVolatility(0.5, false);
      const landscape = createMockLandscape(volatility, [gradualPath, intensivePath]);

      const result = recommender.recommendSync(landscape, { userLevel: 'advanced' });

      expect(result).not.toBeNull();
      expect(result!.recommendedPath.id).toBe('intensive');
    });

    it('should consider user interests from explore context', () => {
      const webPath = createMockPath('web', 'Web Developer Path', {
        description: 'Focus on web development and frontend',
        targetRole: 'Frontend Developer',
      });
      const systemsPath = createMockPath('systems', 'Systems Path', {
        description: 'Focus on systems programming and backend',
        targetRole: 'Backend Developer',
      });
      const volatility = createMockVolatility(0.5, false);
      const landscape = createMockLandscape(volatility, [webPath, systemsPath]);

      const exploreContext: Partial<ExploreContext> = {
        interests: ['web development', 'frontend'],
        originalStatement: '',
        crystallizedGoal: '',
        turnCount: 0,
        clarityScore: 0.8,
      };

      const result = recommender.recommendSync(landscape, { 
        exploreContext: exploreContext as ExploreContext 
      });

      expect(result).not.toBeNull();
      expect(result!.recommendedPath.id).toBe('web');
      expect(result!.matchedSignals).toContain('web development');
    });

    it('should calculate adjusted duration for different time commitments', () => {
      const path = createMockPath('standard', 'Standard Path', {
        estimatedWeeks: 8,
      });
      const volatility = createMockVolatility(0.5, false);
      const landscape = createMockLandscape(volatility, [path]);

      // Half the time commitment should double the duration
      const result = recommender.recommendSync(landscape, { 
        dailyTimeCommitment: 30 // Assumes 60 is standard
      });

      expect(result).not.toBeNull();
      expect(result!.adjustedWeeks).toBe(16); // 8 * 2
    });

    it('should identify prerequisite gaps', () => {
      const path = createMockPath('advanced', 'Advanced Path');
      const prereqs: Prerequisite[] = [
        {
          topic: 'Python',
          importance: 'required',
          reason: 'Need Python basics',
        },
        {
          topic: 'Git',
          importance: 'recommended',
          reason: 'Version control is helpful',
        },
      ];
      const volatility = createMockVolatility(0.5, false);
      const landscape = createMockLandscape(volatility, [path], prereqs);

      // User has no background
      const result = recommender.recommendSync(landscape, {});

      expect(result).not.toBeNull();
      expect(result!.prerequisiteGaps).toBeDefined();
      expect(result!.prerequisiteGaps!.some(p => p.topic === 'Python')).toBe(true);
    });

    it('should not flag prerequisites user already has', () => {
      const path = createMockPath('advanced', 'Advanced Path');
      const prereqs: Prerequisite[] = [
        {
          topic: 'Python',
          importance: 'required',
          reason: 'Need Python basics',
        },
      ];
      const volatility = createMockVolatility(0.5, false);
      const landscape = createMockLandscape(volatility, [path], prereqs);

      const exploreContext: Partial<ExploreContext> = {
        background: ['Python', 'JavaScript'],
        originalStatement: '',
        crystallizedGoal: '',
        turnCount: 0,
        clarityScore: 0.8,
      };

      const result = recommender.recommendSync(landscape, { 
        exploreContext: exploreContext as ExploreContext 
      });

      expect(result).not.toBeNull();
      expect(result!.prerequisiteGaps).toBeUndefined();
    });

    it('should provide alternatives', () => {
      const path1 = createMockPath('path-1', 'Path 1');
      const path2 = createMockPath('path-2', 'Path 2');
      const path3 = createMockPath('path-3', 'Path 3');
      const volatility = createMockVolatility(0.5, false);
      const landscape = createMockLandscape(volatility, [path1, path2, path3]);

      const result = recommender.recommendSync(landscape, {});

      expect(result).not.toBeNull();
      expect(result!.alternatives.length).toBe(2);
      expect(result!.alternatives.some(p => p.id !== result!.recommendedPath.id)).toBe(true);
    });
  });

  describe('recommend (async)', () => {
    it('should work without LLM', async () => {
      const path = createMockPath('path-1', 'Test Path');
      const volatility = createMockVolatility(0.5, false);
      const landscape = createMockLandscape(volatility, [path]);

      const result = await recommender.recommend(landscape, {});

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.method).toBe('heuristic');
      }
    });

    it('should return error for empty paths', async () => {
      const volatility = createMockVolatility(0.5, false);
      const landscape = createMockLandscape(volatility, []);

      const result = await recommender.recommend(landscape, {});

      expect(result.ok).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Configuration', () => {
  it('should have valid default enricher config', () => {
    expect(DEFAULT_ENRICHER_CONFIG.maxResultsPerQuery).toBe(5);
    expect(DEFAULT_ENRICHER_CONFIG.maxQueries).toBe(3);
    expect(DEFAULT_ENRICHER_CONFIG.volatilityThreshold).toBe(0.6);
    expect(DEFAULT_ENRICHER_CONFIG.preferredDomains.length).toBeGreaterThan(0);
  });

  it('should have valid default recommender config', () => {
    expect(DEFAULT_RECOMMENDER_CONFIG.useLlm).toBe(true);
    expect(DEFAULT_RECOMMENDER_CONFIG.llmModel).toBe('gpt-4o-mini');
    expect(DEFAULT_RECOMMENDER_CONFIG.heuristicConfidenceThreshold).toBe(0.75);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════════

describe('Edge Cases', () => {
  describe('WebSearchEnricher', () => {
    it('should handle empty search results', async () => {
      const mockService = createMockWebSearchService([]);
      const enricher = createWebSearchEnricher(mockService);
      const volatility = createMockVolatility(0.8, true);
      const landscape = createMockLandscape(volatility);

      const result = await enricher.enrich(landscape);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.freshness).toBeDefined();
        expect(result.value.freshness?.findings).toHaveLength(0);
      }
    });

    it('should handle search errors gracefully', async () => {
      const mockService: IWebSearchService = {
        search: vi.fn().mockRejectedValue(new Error('Search failed')),
        isAvailable: vi.fn().mockReturnValue(true),
      };
      const enricher = createWebSearchEnricher(mockService);
      const volatility = createMockVolatility(0.8, true);
      const landscape = createMockLandscape(volatility);

      const result = await enricher.enrich(landscape);

      // Enricher gracefully continues with empty results when searches fail
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Freshness info is created but with no findings from failed searches
        expect(result.value.freshness).toBeDefined();
        expect(result.value.freshness?.findings).toHaveLength(0);
      }
    });
  });

  describe('PathRecommender', () => {
    it('should handle paths with missing optional fields', () => {
      const recommender = createPathRecommender(undefined, { useLlm: false });
      const path: LearningPath = {
        id: 'minimal',
        name: 'Minimal Path',
        description: 'Minimal',
        topicSequence: [],
        estimatedWeeks: 4,
        difficulty: 'gradual',
        bestFor: [],
        // No targetRole or focusAreas
      };
      const volatility = createMockVolatility(0.5, false);
      const landscape = createMockLandscape(volatility, [path]);

      const result = recommender.recommendSync(landscape, {});

      expect(result).not.toBeNull();
    });

    it('should handle empty explore context', () => {
      const recommender = createPathRecommender(undefined, { useLlm: false });
      const path = createMockPath('path-1', 'Test Path');
      const volatility = createMockVolatility(0.5, false);
      const landscape = createMockLandscape(volatility, [path]);

      const emptyContext: Partial<ExploreContext> = {
        originalStatement: '',
        crystallizedGoal: '',
        turnCount: 0,
        clarityScore: 0,
        interests: [],
        constraints: [],
        background: [],
        motivations: [],
      };

      const result = recommender.recommendSync(landscape, { 
        exploreContext: emptyContext as ExploreContext 
      });

      expect(result).not.toBeNull();
    });
  });
});
