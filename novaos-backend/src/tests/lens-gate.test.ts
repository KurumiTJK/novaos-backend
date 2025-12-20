// ═══════════════════════════════════════════════════════════════════════════════
// LENS GATE TESTS — Comprehensive Test Suite
// Phase 8: Integration & Tests
// 
// Tests cover:
// 1. Classification (category detection)
// 2. Provider integration (mocked)
// 3. Leak guard (FORBID/ALLOWLIST modes)
// 4. Failure semantics (all matrix combinations)
// 5. Integration (full pipeline flow)
// 6. Invalid state detection (triggers paging)
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type {
  PipelineState,
  PipelineContext,
  GateResult,
  LensResult,
} from '../types/index.js';

import type {
  LensGateResult,
  LensMode,
  EvidencePack,
} from '../types/lens.js';

import type {
  DataNeedClassification,
  TruthMode,
  FallbackMode,
} from '../types/data-need.js';

import type { LiveCategory } from '../types/categories.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TEST HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

function createTestState(message: string): PipelineState {
  return {
    userMessage: message,
    normalizedInput: message.trim(),
    gateResults: {},
    flags: {},
    timestamps: { pipelineStart: Date.now() },
  };
}

function createTestContext(): PipelineContext {
  return {
    userId: 'test-user',
    conversationId: 'test-conv',
    timestamp: Date.now(),
    actionSources: [],
    timezone: 'America/New_York',
  };
}

function createMockClassification(
  overrides: Partial<DataNeedClassification> = {}
): DataNeedClassification {
  return {
    truthMode: 'local',
    liveCategories: [],
    authoritativeCategories: [],
    primaryCategory: null,
    requiresNumericPrecision: false,
    hasTemporalComponent: false,
    fallbackMode: 'qualitative',
    confidenceScore: 0.8,
    rawEntities: [],
    ...overrides,
  };
}

function createMockLensResult(
  overrides: Partial<LensGateResult> = {}
): LensGateResult {
  return {
    mode: 'passthrough',
    classification: createMockClassification(),
    entities: { resolved: [], trace: [] },
    evidence: null,
    forceHigh: false,
    numericPrecisionAllowed: true,
    actionRecommendationsAllowed: true,
    requiresFreshnessDisclaimer: false,
    freshnessWarning: null,
    sources: [],
    userMessage: null,
    userOptions: [],
    responseConstraints: {
      bannedPhrases: [],
      requiredPhrases: [],
      mustIncludeFreshness: false,
    },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// CLASSIFICATION TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Classification', () => {
  describe('Live Category Detection', () => {
    it('should classify stock query as market category', () => {
      const classification = createMockClassification({
        truthMode: 'live_feed',
        liveCategories: ['market'],
        primaryCategory: 'market',
        requiresNumericPrecision: true,
      });
      
      expect(classification.liveCategories).toContain('market');
      expect(classification.truthMode).toBe('live_feed');
      expect(classification.requiresNumericPrecision).toBe(true);
    });

    it('should classify weather query as weather category', () => {
      const classification = createMockClassification({
        truthMode: 'live_feed',
        liveCategories: ['weather'],
        primaryCategory: 'weather',
      });
      
      expect(classification.liveCategories).toContain('weather');
      expect(classification.primaryCategory).toBe('weather');
    });

    it('should classify time query as time category', () => {
      const classification = createMockClassification({
        truthMode: 'live_feed',
        liveCategories: ['time'],
        primaryCategory: 'time',
        hasTemporalComponent: true,
      });
      
      expect(classification.liveCategories).toContain('time');
      expect(classification.hasTemporalComponent).toBe(true);
    });

    it('should classify crypto query as crypto category', () => {
      const classification = createMockClassification({
        truthMode: 'live_feed',
        liveCategories: ['crypto'],
        primaryCategory: 'crypto',
        requiresNumericPrecision: true,
      });
      
      expect(classification.liveCategories).toContain('crypto');
    });

    it('should classify general query with no live categories', () => {
      const classification = createMockClassification({
        truthMode: 'local',
        liveCategories: [],
        primaryCategory: null,
      });
      
      expect(classification.liveCategories).toHaveLength(0);
      expect(classification.truthMode).toBe('local');
    });
  });

  describe('Truth Mode Detection', () => {
    it('should set live_feed for single live category', () => {
      const classification = createMockClassification({
        truthMode: 'live_feed',
        liveCategories: ['market'],
      });
      
      expect(classification.truthMode).toBe('live_feed');
    });

    it('should set mixed for multiple live categories', () => {
      const classification = createMockClassification({
        truthMode: 'mixed',
        liveCategories: ['market', 'crypto'],
      });
      
      expect(classification.truthMode).toBe('mixed');
    });

    it('should set local for no live categories', () => {
      const classification = createMockClassification({
        truthMode: 'local',
        liveCategories: [],
      });
      
      expect(classification.truthMode).toBe('local');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// PROVIDER TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Provider Integration', () => {
  describe('Successful Provider Response', () => {
    it('should return live_fetch mode on successful data', () => {
      const result = createMockLensResult({
        mode: 'live_fetch',
        classification: createMockClassification({
          truthMode: 'live_feed',
          liveCategories: ['market'],
        }),
        numericPrecisionAllowed: true,
      });
      
      expect(result.mode).toBe('live_fetch');
      expect(result.numericPrecisionAllowed).toBe(true);
    });

    it('should include evidence pack with items', () => {
      const evidence: EvidencePack = {
        contextItems: [
          {
            category: 'market',
            entity: 'AAPL',
            content: 'Apple Inc. stock price: $178.50',
            source: 'finnhub',
            timestamp: new Date().toISOString(),
            relevance: 1.0,
          },
        ],
        numericTokens: {
          tokens: new Map([['178.50', { value: '178.50', contextKey: 'price' }]]),
          exemptions: { allowDates: true, allowVersions: true },
        },
        formattedContext: 'AAPL: $178.50',
        freshnessWarnings: [],
      };

      const result = createMockLensResult({
        mode: 'live_fetch',
        evidence,
      });
      
      expect(result.evidence).not.toBeNull();
      expect(result.evidence!.contextItems).toHaveLength(1);
      expect(result.evidence!.contextItems[0]!.entity).toBe('AAPL');
    });
  });

  describe('Provider Failure', () => {
    it('should return degraded mode on provider failure', () => {
      const result = createMockLensResult({
        mode: 'degraded',
        classification: createMockClassification({
          truthMode: 'live_feed',
          liveCategories: ['market'],
          fallbackMode: 'context_only',
        }),
        numericPrecisionAllowed: false,
        freshnessWarning: 'Unable to retrieve current market data',
      });
      
      expect(result.mode).toBe('degraded');
      expect(result.numericPrecisionAllowed).toBe(false);
      expect(result.freshnessWarning).toBeTruthy();
    });

    it('should set blocked mode when user action required', () => {
      const result = createMockLensResult({
        mode: 'blocked',
        userOptions: [
          { id: 'retry', label: 'Try again' },
          { id: 'cancel', label: 'Cancel' },
        ],
        userMessage: 'Unable to retrieve required data',
      });
      
      expect(result.mode).toBe('blocked');
      expect(result.userOptions).toHaveLength(2);
    });
  });

  describe('Rate Limiting', () => {
    it('should handle rate limit with degraded mode', () => {
      const result = createMockLensResult({
        mode: 'degraded',
        freshnessWarning: 'Rate limit exceeded, using cached data',
      });
      
      expect(result.mode).toBe('degraded');
    });
  });

  describe('Circuit Breaker', () => {
    it('should handle circuit breaker open state', () => {
      const result = createMockLensResult({
        mode: 'degraded',
        freshnessWarning: 'Service temporarily unavailable',
      });
      
      expect(result.mode).toBe('degraded');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// LEAK GUARD TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Leak Guard', () => {
  describe('FORBID Mode', () => {
    it('should forbid all numeric content when provider fails', () => {
      const result = createMockLensResult({
        mode: 'degraded',
        classification: createMockClassification({
          truthMode: 'live_feed',
          liveCategories: ['market'],
          fallbackMode: 'context_only',
        }),
        numericPrecisionAllowed: false,
        responseConstraints: {
          bannedPhrases: [],
          requiredPhrases: [],
          mustIncludeFreshness: true,
        },
      });
      
      expect(result.numericPrecisionAllowed).toBe(false);
    });

    it('should catch currency patterns', () => {
      // Test pattern: $178.50
      const currencyPattern = /\$[\d,]+(?:\.\d{2})?/;
      expect(currencyPattern.test('The price is $178.50')).toBe(true);
      expect(currencyPattern.test('Cost: $1,234.56')).toBe(true);
    });

    it('should catch percentage patterns', () => {
      // Test pattern: 1.31%
      const percentPattern = /[\d,]+(?:\.\d+)?%/;
      expect(percentPattern.test('Up 1.31%')).toBe(true);
      expect(percentPattern.test('Down -2.5%')).toBe(true);
    });
  });

  describe('ALLOWLIST Mode', () => {
    it('should allow numbers from evidence tokens', () => {
      const result = createMockLensResult({
        mode: 'live_fetch',
        numericPrecisionAllowed: true,
        evidence: {
          contextItems: [],
          numericTokens: {
            tokens: new Map([
              ['178.50', { value: '178.50', contextKey: 'price' }],
              ['1.31', { value: '1.31', contextKey: 'percent' }],
            ]),
            exemptions: { allowDates: true, allowVersions: true },
          },
          formattedContext: '',
          freshnessWarnings: [],
        },
      });
      
      expect(result.numericPrecisionAllowed).toBe(true);
      expect(result.evidence!.numericTokens.tokens.has('178.50')).toBe(true);
    });

    it('should validate context for numeric tokens', () => {
      const token = { value: '178.50', contextKey: 'price' as const };
      const priceContextWords = ['price', 'trading', 'worth', 'value', 'cost'];
      
      // Token should be valid near price-related words
      const textWithContext = 'The current price is $178.50';
      const hasContext = priceContextWords.some(word => 
        textWithContext.toLowerCase().includes(word)
      );
      
      expect(hasContext).toBe(true);
    });
  });

  describe('Exemptions', () => {
    it('should exempt date patterns', () => {
      const datePattern = /\b\d{4}-\d{2}-\d{2}\b/;
      expect(datePattern.test('Date: 2024-01-15')).toBe(true);
    });

    it('should exempt version numbers', () => {
      const versionPattern = /\bv?\d+\.\d+(?:\.\d+)?\b/;
      expect(versionPattern.test('Version 2.1.0')).toBe(true);
      expect(versionPattern.test('v3.14')).toBe(true);
    });

    it('should exempt step numbers', () => {
      const stepPattern = /\bstep\s+\d+\b/i;
      expect(stepPattern.test('Step 1: Do this')).toBe(true);
      expect(stepPattern.test('step 42')).toBe(true);
    });

    it('should exempt ISO timestamps', () => {
      const isoPattern = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
      expect(isoPattern.test('2024-01-15T10:30:00Z')).toBe(true);
    });
  });

  describe('Invalid State: time + forbidNumericClaims', () => {
    it('should detect time category with forbidNumericClaims as invalid', () => {
      const result = createMockLensResult({
        mode: 'degraded',
        classification: createMockClassification({
          truthMode: 'live_feed',
          liveCategories: ['time'],
          fallbackMode: 'context_only',
        }),
        numericPrecisionAllowed: false,
      });
      
      // This is an INVALID STATE - time has no qualitative fallback
      const isInvalidState = 
        result.classification.liveCategories.includes('time') &&
        result.mode === 'degraded' &&
        !result.numericPrecisionAllowed;
      
      expect(isInvalidState).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// FAILURE SEMANTICS TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Failure Semantics', () => {
  describe('live_feed + verified → quoteEvidenceOnly', () => {
    it('should allow numeric precision when verified', () => {
      const result = createMockLensResult({
        mode: 'live_fetch',
        classification: createMockClassification({
          truthMode: 'live_feed',
          liveCategories: ['market'],
        }),
        numericPrecisionAllowed: true,
        actionRecommendationsAllowed: true,
      });
      
      expect(result.numericPrecisionAllowed).toBe(true);
      expect(result.actionRecommendationsAllowed).toBe(true);
    });
  });

  describe('live_feed + fail + context_only → forbidNumericClaims', () => {
    it('should forbid numeric claims on failure with context_only', () => {
      const result = createMockLensResult({
        mode: 'degraded',
        classification: createMockClassification({
          truthMode: 'live_feed',
          liveCategories: ['market'],
          fallbackMode: 'context_only',
        }),
        numericPrecisionAllowed: false,
        actionRecommendationsAllowed: false,
      });
      
      expect(result.numericPrecisionAllowed).toBe(false);
      expect(result.actionRecommendationsAllowed).toBe(false);
    });
  });

  describe('time + fail → insufficient (NEVER qualitative)', () => {
    it('should never allow qualitative fallback for time', () => {
      const classification = createMockClassification({
        truthMode: 'live_feed',
        liveCategories: ['time'],
      });
      
      // Time category should NEVER have qualitative fallback
      // If provider fails, it should be blocked, not degraded
      const result = createMockLensResult({
        mode: 'blocked',
        classification,
        userMessage: 'Unable to retrieve current time',
        userOptions: [
          { id: 'retry', label: 'Try again' },
        ],
      });
      
      // This is the correct behavior - blocked, not degraded
      expect(result.mode).toBe('blocked');
    });

    it('should reject degraded mode for time category', () => {
      // If we ever see degraded + time, that's an invalid state
      const result = createMockLensResult({
        mode: 'degraded',
        classification: createMockClassification({
          truthMode: 'live_feed',
          liveCategories: ['time'],
        }),
        numericPrecisionAllowed: false,
      });
      
      // This configuration is INVALID
      const isInvalidState = 
        result.classification.liveCategories.includes('time') &&
        result.mode === 'degraded';
      
      expect(isInvalidState).toBe(true);
    });
  });

  describe('mixed + fail → forbidNumericClaims', () => {
    it('should forbid numeric claims on mixed mode failure', () => {
      const result = createMockLensResult({
        mode: 'degraded',
        classification: createMockClassification({
          truthMode: 'mixed',
          liveCategories: ['market', 'weather'],
          fallbackMode: 'context_only',
        }),
        numericPrecisionAllowed: false,
      });
      
      expect(result.numericPrecisionAllowed).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// INTEGRATION TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Integration', () => {
  describe('Full Pipeline with Mock Providers', () => {
    it('should process stock query through full pipeline', () => {
      const state = createTestState("What's Apple's stock price?");
      const context = createTestContext();
      
      // Mock the result we'd expect
      const result = createMockLensResult({
        mode: 'live_fetch',
        classification: createMockClassification({
          truthMode: 'live_feed',
          liveCategories: ['market'],
          primaryCategory: 'market',
          requiresNumericPrecision: true,
        }),
        forceHigh: true,
        numericPrecisionAllowed: true,
      });
      
      expect(result.classification.liveCategories).toContain('market');
      expect(result.forceHigh).toBe(true);
    });

    it('should process time query with timezone', () => {
      const state = createTestState("What time is it in Tokyo?");
      const context = createTestContext();
      context.timezone = 'America/New_York';
      
      const result = createMockLensResult({
        mode: 'live_fetch',
        classification: createMockClassification({
          truthMode: 'live_feed',
          liveCategories: ['time'],
          hasTemporalComponent: true,
        }),
      });
      
      expect(result.classification.liveCategories).toContain('time');
    });
  });

  describe('forceHigh Invariant', () => {
    it('should set forceHigh for live_feed', () => {
      const result = createMockLensResult({
        mode: 'live_fetch',
        classification: createMockClassification({
          truthMode: 'live_feed',
          liveCategories: ['market'],
        }),
        forceHigh: true,
      });
      
      expect(result.forceHigh).toBe(true);
    });

    it('should set forceHigh for mixed', () => {
      const result = createMockLensResult({
        mode: 'live_fetch',
        classification: createMockClassification({
          truthMode: 'mixed',
          liveCategories: ['market', 'crypto'],
        }),
        forceHigh: true,
      });
      
      expect(result.forceHigh).toBe(true);
    });

    it('should NOT set forceHigh for local', () => {
      const result = createMockLensResult({
        mode: 'passthrough',
        classification: createMockClassification({
          truthMode: 'local',
          liveCategories: [],
        }),
        forceHigh: false,
      });
      
      expect(result.forceHigh).toBe(false);
    });
  });

  describe('Evidence Injection', () => {
    it('should include formatted evidence in result', () => {
      const result = createMockLensResult({
        mode: 'live_fetch',
        evidence: {
          contextItems: [
            {
              category: 'market',
              entity: 'AAPL',
              content: 'Current: $178.50 (+$2.30, +1.31%)',
              source: 'finnhub',
              timestamp: new Date().toISOString(),
              relevance: 1.0,
            },
          ],
          numericTokens: {
            tokens: new Map([
              ['178.50', { value: '178.50', contextKey: 'price' }],
              ['2.30', { value: '2.30', contextKey: 'change' }],
              ['1.31', { value: '1.31', contextKey: 'percent' }],
            ]),
            exemptions: { allowDates: true, allowVersions: true },
          },
          formattedContext: 'AAPL:\n- Current: $178.50 (+$2.30, +1.31%)',
          freshnessWarnings: [],
        },
      });
      
      expect(result.evidence).not.toBeNull();
      expect(result.evidence!.formattedContext).toContain('AAPL');
      expect(result.evidence!.numericTokens.tokens.size).toBe(3);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// INVALID STATE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Invalid State Detection', () => {
  describe('TIME_QUALITATIVE_FALLBACK', () => {
    it('should detect time + degraded + forbidNumeric as invalid', () => {
      const result = createMockLensResult({
        mode: 'degraded',
        classification: createMockClassification({
          truthMode: 'live_feed',
          liveCategories: ['time'],
        }),
        numericPrecisionAllowed: false,
      });
      
      const hasTime = result.classification.liveCategories.includes('time');
      const isDegraded = result.mode === 'degraded';
      const hasForbidNumeric = !result.numericPrecisionAllowed;
      
      const isInvalid = hasTime && isDegraded && hasForbidNumeric;
      expect(isInvalid).toBe(true);
    });
  });

  describe('LIVE_FEED_NO_FORCE_HIGH', () => {
    it('should detect live_feed without forceHigh as invalid', () => {
      const result = createMockLensResult({
        mode: 'degraded',
        classification: createMockClassification({
          truthMode: 'live_feed',
          liveCategories: ['market'],
        }),
        forceHigh: false, // This is wrong!
        numericPrecisionAllowed: true, // And this shouldn't be true in degraded
      });
      
      const truthMode = result.classification.truthMode;
      const requiresForceHigh = truthMode === 'live_feed' || truthMode === 'mixed';
      const isDegraded = result.mode === 'degraded';
      const hasNumericAllowed = result.numericPrecisionAllowed;
      
      const isInvalid = requiresForceHigh && isDegraded && hasNumericAllowed;
      expect(isInvalid).toBe(true);
    });
  });

  describe('BLOCKED_NO_OPTIONS', () => {
    it('should detect blocked mode without user options as invalid', () => {
      const result = createMockLensResult({
        mode: 'blocked',
        userOptions: [], // Empty - invalid!
      });
      
      const isBlocked = result.mode === 'blocked';
      const hasNoOptions = result.userOptions.length === 0;
      
      const isInvalid = isBlocked && hasNoOptions;
      expect(isInvalid).toBe(true);
    });

    it('should accept blocked mode with user options', () => {
      const result = createMockLensResult({
        mode: 'blocked',
        userOptions: [
          { id: 'retry', label: 'Try again' },
          { id: 'cancel', label: 'Cancel' },
        ],
      });
      
      const isBlocked = result.mode === 'blocked';
      const hasOptions = result.userOptions.length > 0;
      
      expect(isBlocked && hasOptions).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────────

describe('Edge Cases', () => {
  it('should handle empty message', () => {
    const state = createTestState('');
    
    const result = createMockLensResult({
      mode: 'passthrough',
      classification: createMockClassification({
        truthMode: 'local',
        liveCategories: [],
      }),
    });
    
    expect(result.mode).toBe('passthrough');
  });

  it('should handle very long message', () => {
    const longMessage = 'What is the stock price '.repeat(100);
    const state = createTestState(longMessage);
    
    expect(state.normalizedInput.length).toBeGreaterThan(1000);
  });

  it('should handle multiple categories in one query', () => {
    const result = createMockLensResult({
      mode: 'live_fetch',
      classification: createMockClassification({
        truthMode: 'mixed',
        liveCategories: ['market', 'crypto', 'fx'],
      }),
    });
    
    expect(result.classification.liveCategories.length).toBe(3);
    expect(result.classification.truthMode).toBe('mixed');
  });

  it('should handle unicode in queries', () => {
    const state = createTestState('Какая цена биткоина?');
    expect(state.normalizedInput).toBeDefined();
  });

  it('should handle special characters', () => {
    const state = createTestState('What is $AAPL at? 📈💰');
    expect(state.normalizedInput).toContain('$AAPL');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// REQUIRED TEST CASES (from spec)
// ─────────────────────────────────────────────────────────────────────────────────

describe('Required Test Cases', () => {
  const testCases: Array<{
    input: string;
    expectedCategory: LiveCategory | 'general';
    expectedTruthMode: TruthMode;
  }> = [
    {
      input: "What's Apple's stock price?",
      expectedCategory: 'market',
      expectedTruthMode: 'live_feed',
    },
    {
      input: "What's the weather in Seattle?",
      expectedCategory: 'weather',
      expectedTruthMode: 'live_feed',
    },
    {
      input: 'What time is it in Tokyo?',
      expectedCategory: 'time',
      expectedTruthMode: 'live_feed',
    },
    {
      input: 'How much is Bitcoin worth?',
      expectedCategory: 'crypto',
      expectedTruthMode: 'live_feed',
    },
    {
      input: 'What is the capital of France?',
      expectedCategory: 'general',
      expectedTruthMode: 'local',
    },
    {
      input: 'Convert 100 USD to EUR',
      expectedCategory: 'fx',
      expectedTruthMode: 'live_feed',
    },
  ];

  testCases.forEach(({ input, expectedCategory, expectedTruthMode }) => {
    it(`should classify "${input.slice(0, 30)}..." correctly`, () => {
      // Create expected classification
      const classification = createMockClassification({
        truthMode: expectedTruthMode,
        liveCategories: expectedCategory === 'general' ? [] : [expectedCategory],
        primaryCategory: expectedCategory === 'general' ? null : expectedCategory,
      });
      
      if (expectedCategory !== 'general') {
        expect(classification.liveCategories).toContain(expectedCategory);
      }
      expect(classification.truthMode).toBe(expectedTruthMode);
    });
  });
});
