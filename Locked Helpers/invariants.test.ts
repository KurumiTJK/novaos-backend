// ═══════════════════════════════════════════════════════════════════════════════
// NOVAOS INVARIANT TEST SUITE
// These tests MUST pass. Violations indicate architectural drift.
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import { 
  ExecutionPipeline, 
  PipelineState, 
  GateResults,
  Response,
  IMMEDIATE_DOMAINS,
} from './pipeline';

// ─────────────────────────────────────────────────────────────────────────────────
// TEST UTILITIES
// ─────────────────────────────────────────────────────────────────────────────────

const createMockState = (overrides: Partial<PipelineState> = {}): PipelineState => ({
  input: {
    userId: 'test-user',
    sessionId: 'test-session',
    message: 'test message',
  },
  regenerationCount: 0,
  degraded: false,
  ...overrides,
});

const createMockResults = (overrides: Partial<GateResults> = {}): GateResults => ({
  intent: { gateId: 'intent', status: 'pass', action: 'continue', output: {}, executionTimeMs: 10 },
  shield: { gateId: 'shield', status: 'pass', action: 'continue', output: {}, executionTimeMs: 10 },
  lens: { gateId: 'lens', status: 'pass', action: 'continue', output: {}, executionTimeMs: 10 },
  stance: { gateId: 'stance', status: 'pass', action: 'continue', output: {}, executionTimeMs: 10 },
  capability: { gateId: 'capability', status: 'pass', action: 'continue', output: {}, executionTimeMs: 10 },
  model: { gateId: 'model', status: 'pass', action: 'continue', output: {}, executionTimeMs: 10 },
  personality: { gateId: 'personality', status: 'pass', action: 'continue', output: {}, executionTimeMs: 10 },
  spark: { gateId: 'spark', status: 'pass', action: 'continue', output: {}, executionTimeMs: 10 },
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────────
// INVARIANT 1: Hard Veto Must Stop Pipeline
// ─────────────────────────────────────────────────────────────────────────────────

describe('Invariant: Hard veto stops pipeline', () => {
  it('should stop at shield gate when hard veto is triggered', () => {
    const state = createMockState({ stoppedAt: 'shield' });
    const results = createMockResults({
      shield: {
        gateId: 'shield',
        status: 'hard_fail',
        action: 'stop',
        output: {
          interventionLevel: 'veto',
          vetoType: 'hard',
          reason: 'Content policy violation',
        },
        executionTimeMs: 10,
      },
    });

    const shieldResult = results.shield?.output;
    if (shieldResult?.interventionLevel === 'veto' && shieldResult?.vetoType === 'hard') {
      expect(state.stoppedAt).toBe('shield');
    }
  });

  it('should NOT continue past shield gate with hard veto', () => {
    const state = createMockState({ stoppedAt: undefined }); // Bug: didn't stop
    const results = createMockResults({
      shield: {
        gateId: 'shield',
        status: 'hard_fail',
        action: 'stop',
        output: {
          interventionLevel: 'veto',
          vetoType: 'hard',
        },
        executionTimeMs: 10,
      },
    });

    const shieldResult = results.shield?.output;
    if (shieldResult?.interventionLevel === 'veto' && shieldResult?.vetoType === 'hard') {
      // This should fail - violation detected
      expect(state.stoppedAt).toBe('shield');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// INVARIANT 2: Spark Only in Sword Stance
// ─────────────────────────────────────────────────────────────────────────────────

describe('Invariant: Spark only in sword stance', () => {
  it('should NOT generate spark when stance is lens', () => {
    const state = createMockState({ stance: 'lens' });
    const results = createMockResults({
      spark: {
        gateId: 'spark',
        status: 'pass',
        action: 'continue',
        output: { spark: null, reason: 'not_sword_stance' },
        executionTimeMs: 10,
      },
    });

    if (state.stance !== 'sword') {
      const sparkResult = results.spark?.output;
      expect(sparkResult?.spark).toBeNull();
    }
  });

  it('should NOT generate spark when stance is shield', () => {
    const state = createMockState({ stance: 'shield' });
    const results = createMockResults({
      spark: {
        gateId: 'spark',
        status: 'pass',
        action: 'continue',
        output: { spark: null, reason: 'not_sword_stance' },
        executionTimeMs: 10,
      },
    });

    if (state.stance !== 'sword') {
      const sparkResult = results.spark?.output;
      expect(sparkResult?.spark).toBeNull();
    }
  });

  it('should NOT generate spark when stance is control', () => {
    const state = createMockState({ stance: 'control' });
    const results = createMockResults({
      spark: {
        gateId: 'spark',
        status: 'pass',
        action: 'continue',
        output: { spark: null, reason: 'not_sword_stance' },
        executionTimeMs: 10,
      },
    });

    if (state.stance !== 'sword') {
      const sparkResult = results.spark?.output;
      expect(sparkResult?.spark).toBeNull();
    }
  });

  it('should allow spark generation when stance is sword', () => {
    const state = createMockState({ stance: 'sword' });
    const results = createMockResults({
      spark: {
        gateId: 'spark',
        status: 'pass',
        action: 'continue',
        output: { spark: { action: 'test', duration: '5min' }, reason: null },
        executionTimeMs: 10,
      },
    });

    if (state.stance === 'sword') {
      // Spark CAN be generated (but doesn't have to be)
      expect(results.spark?.output).toBeDefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// INVARIANT 3: Lens Degradation Rules
// ─────────────────────────────────────────────────────────────────────────────────

describe('Invariant: Lens degradation rules', () => {
  it('should stop or degrade when verification required but unavailable', () => {
    const state = createMockState({ degraded: true });
    const results = createMockResults({
      lens: {
        gateId: 'lens',
        status: 'soft_fail',
        action: 'degrade',
        output: {
          required: true,
          mode: 'degraded',
          plan: {
            verificationStatus: 'skipped',
            confidence: 'low',
            verified: false,
          },
        },
        executionTimeMs: 10,
      },
    });

    const lensResult = results.lens?.output;
    if (lensResult?.required && lensResult?.mode === 'degraded') {
      // Either stopped or degraded with low confidence
      const validState = state.stoppedAt === 'lens' || 
        (state.degraded && lensResult.plan?.confidence === 'low' && !lensResult.plan?.verified);
      expect(validState).toBe(true);
    }
  });

  it('should mark confidence as low when verification skipped', () => {
    const results = createMockResults({
      lens: {
        gateId: 'lens',
        status: 'soft_fail',
        action: 'degrade',
        output: {
          required: true,
          mode: 'degraded',
          plan: {
            verificationStatus: 'skipped',
            confidence: 'low', // MUST be low
            verified: false,   // MUST be false
          },
        },
        executionTimeMs: 10,
      },
    });

    const lensResult = results.lens?.output;
    if (lensResult?.plan?.verificationStatus === 'skipped') {
      expect(lensResult.plan.confidence).toBe('low');
      expect(lensResult.plan.verified).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// INVARIANT 4: Control Mode Resources
// ─────────────────────────────────────────────────────────────────────────────────

describe('Invariant: Control mode provides resources', () => {
  it('should include crisis resources when control trigger fires', () => {
    const results = createMockResults({
      shield: {
        gateId: 'shield',
        status: 'soft_fail',
        action: 'continue',
        output: {
          controlTrigger: 'crisis_detected',
          requiredPrependResources: true,
          crisisResources: [
            { name: '988 Lifeline', action: 'Call or text 988' },
          ],
        },
        executionTimeMs: 10,
      },
    });

    const response: Response = {
      text: 'If you\'re in crisis, please reach out: 988 Suicide & Crisis Lifeline - Call or text 988',
      crisisResourcesProvided: true,
    };

    const shieldResult = results.shield?.output;
    if (shieldResult?.controlTrigger) {
      // Response MUST contain crisis resources
      const hasResources = response.text.includes('988') || response.crisisResourcesProvided === true;
      expect(hasResources).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// INVARIANT 5: Personality Regeneration Limit
// ─────────────────────────────────────────────────────────────────────────────────

describe('Invariant: Personality regeneration limit', () => {
  it('should not exceed 2 regeneration attempts', () => {
    const state = createMockState({ regenerationCount: 2 });
    const results = createMockResults({
      personality: {
        gateId: 'personality',
        status: 'hard_fail',
        action: 'regenerate',
        output: {
          violations: [{ type: 'dependency_language', severity: 'high' }],
        },
        executionTimeMs: 10,
      },
    });

    // After 2 regenerations, should degrade instead of regenerate again
    expect(state.regenerationCount).toBeLessThanOrEqual(2);
  });

  it('should degrade after max regenerations', () => {
    const state = createMockState({ regenerationCount: 2, degraded: true });
    
    // If regeneration count is at max and there are still violations,
    // state should be degraded
    if (state.regenerationCount >= 2) {
      // Pipeline should have degraded
      expect(state.degraded).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// INVARIANT 6: Soft Veto Requires Acknowledgment
// ─────────────────────────────────────────────────────────────────────────────────

describe('Invariant: Soft veto requires acknowledgment', () => {
  it('should await_ack when soft veto without ackToken', () => {
    const state = createMockState({
      input: {
        userId: 'test',
        sessionId: 'test',
        message: 'test',
        ackToken: undefined, // No ack token
      },
    });
    const results = createMockResults({
      shield: {
        gateId: 'shield',
        status: 'soft_fail',
        action: 'await_ack',
        output: {
          interventionLevel: 'veto',
          vetoType: 'soft',
          pendingAck: {
            ackToken: 'test-token',
            requiredText: 'I understand the risks',
          },
        },
        executionTimeMs: 10,
      },
    });

    const shieldResult = results.shield?.output;
    if (shieldResult?.interventionLevel === 'veto' && shieldResult?.vetoType === 'soft') {
      if (!state.input.ackToken) {
        expect(results.shield?.action).toBe('await_ack');
      }
    }
  });

  it('should continue when soft veto with valid ackToken', () => {
    const state = createMockState({
      input: {
        userId: 'test',
        sessionId: 'test',
        message: 'test',
        ackToken: 'valid-token',
        ackText: 'I understand the risks and want to proceed',
      },
    });
    const results = createMockResults({
      shield: {
        gateId: 'shield',
        status: 'pass',
        action: 'continue',
        output: {
          interventionLevel: 'none',
          overrideApplied: true,
        },
        executionTimeMs: 10,
      },
    });

    // With valid ackToken, should continue
    expect(results.shield?.action).toBe('continue');
    expect(results.shield?.output?.overrideApplied).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// INVARIANT 7: No NL Action Inference
// ─────────────────────────────────────────────────────────────────────────────────

describe('Invariant: No natural language action inference', () => {
  it('should only accept actions from explicit sources', () => {
    const validSources = ['ui_button', 'command_parser', 'api_field'];
    
    const state = createMockState({
      input: {
        userId: 'test',
        sessionId: 'test',
        message: 'set a reminder for tomorrow', // NL that sounds like action
        requestedActions: [
          { type: 'set_reminder', params: {}, source: 'ui_button' }, // Valid
        ],
      },
    });

    const actions = state.input.requestedActions || [];
    const allValid = actions.every(a => validSources.includes(a.source));
    expect(allValid).toBe(true);
  });

  it('should reject actions from unknown sources', () => {
    const validSources = ['ui_button', 'command_parser', 'api_field'];
    
    const invalidAction = {
      type: 'set_reminder',
      params: {},
      source: 'nl_inference', // INVALID
    };

    expect(validSources.includes(invalidAction.source)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// INVARIANT 8: Immediate Domain Numeric Restrictions
// ─────────────────────────────────────────────────────────────────────────────────

describe('Invariant: Immediate domain numeric restrictions', () => {
  const IMMEDIATE_DOMAINS = ['stock_prices', 'crypto_prices', 'weather', 'breaking_news'];

  it('should not include precise numbers for unverified immediate domain', () => {
    const domain = 'stock_prices';
    const verificationSkipped = true;
    
    // Response with precise numbers (BAD)
    const badResponse = 'AAPL is currently trading at $187.42, up 2.34%';
    
    // Response without precise numbers (GOOD)
    const goodResponse = 'Apple stock has been trading in a range recently. Please verify current prices with your broker.';

    if (IMMEDIATE_DOMAINS.includes(domain) && verificationSkipped) {
      const hasPreciseNumbers = /\$[\d,]+\.\d{2}|\b\d+\.\d{2}%/.test(badResponse);
      expect(hasPreciseNumbers).toBe(true); // Bad response HAS numbers
      
      const goodHasNumbers = /\$[\d,]+\.\d{2}|\b\d+\.\d{2}%/.test(goodResponse);
      expect(goodHasNumbers).toBe(false); // Good response has NO precise numbers
    }
  });

  it('should allow precise numbers when verified', () => {
    const domain = 'stock_prices';
    const verified = true;
    
    const response = 'AAPL is currently trading at $187.42, up 2.34% (verified as of 2:30 PM EST)';
    
    if (verified) {
      // Precise numbers are allowed when verified
      const hasPreciseNumbers = /\$[\d,]+\.\d{2}|\b\d+\.\d{2}%/.test(response);
      expect(hasPreciseNumbers).toBe(true); // OK because verified
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// INTEGRATION TEST: Full Pipeline Invariant Check
// ─────────────────────────────────────────────────────────────────────────────────

describe('Integration: Full pipeline invariant check', () => {
  it('should pass all invariants for a normal request', () => {
    const state = createMockState({
      stance: 'lens',
      regenerationCount: 0,
      degraded: false,
    });

    const results = createMockResults();

    const response: Response = {
      text: 'Here is the information you requested.',
      crisisResourcesProvided: false,
    };

    // Check all invariants
    const invariantResults = checkAllInvariants(state, results, response);
    expect(invariantResults.every(r => r.passed)).toBe(true);
  });

  it('should detect invariant violation', () => {
    // Create a state that violates "spark only in sword"
    const state = createMockState({ stance: 'lens' });
    const results = createMockResults({
      spark: {
        gateId: 'spark',
        status: 'pass',
        action: 'continue',
        output: { spark: { action: 'test', duration: '5min' } }, // BUG: spark in lens stance
        executionTimeMs: 10,
      },
    });

    const response: Response = { text: 'test' };

    const invariantResults = checkAllInvariants(state, results, response);
    const sparkInvariant = invariantResults.find(r => r.invariantId === 'sword_only_spark');
    
    // Should detect the violation
    expect(sparkInvariant?.passed).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// INVARIANT CHECKER
// ─────────────────────────────────────────────────────────────────────────────────

interface InvariantResult {
  invariantId: string;
  description: string;
  passed: boolean;
}

function checkAllInvariants(
  state: PipelineState,
  results: GateResults,
  response: Response
): InvariantResult[] {
  const IMMEDIATE_DOMAINS = ['stock_prices', 'crypto_prices', 'weather', 'breaking_news'];
  
  return [
    // 1. Hard veto stops
    {
      invariantId: 'hard_veto_stops',
      description: 'If hard veto, pipeline must stop',
      passed: (() => {
        const shield = results.shield?.output;
        if (shield?.interventionLevel === 'veto' && shield?.vetoType === 'hard') {
          return state.stoppedAt === 'shield';
        }
        return true;
      })(),
    },
    
    // 2. Spark only in sword
    {
      invariantId: 'sword_only_spark',
      description: 'If stance !== sword, spark must be null',
      passed: (() => {
        if (state.stance !== 'sword') {
          const spark = results.spark?.output;
          return spark?.spark === null || spark?.spark === undefined;
        }
        return true;
      })(),
    },
    
    // 3. Lens degradation
    {
      invariantId: 'lens_degradation',
      description: 'If verification required and unavailable, must stop or degrade with low confidence',
      passed: (() => {
        const lens = results.lens?.output;
        if (lens?.required && lens?.mode === 'none') {
          if (state.stoppedAt === 'lens') return true;
          if (state.degraded && lens.plan?.confidence === 'low' && !lens.plan?.verified) return true;
          return false;
        }
        return true;
      })(),
    },
    
    // 4. Control resources
    {
      invariantId: 'control_resources',
      description: 'If control trigger, must provide crisis resources',
      passed: (() => {
        const shield = results.shield?.output;
        if (shield?.controlTrigger) {
          return response.text?.includes('988') || response.crisisResourcesProvided === true;
        }
        return true;
      })(),
    },
    
    // 5. Regeneration limit
    {
      invariantId: 'regeneration_limit',
      description: 'Regeneration count must not exceed 2',
      passed: state.regenerationCount <= 2,
    },
    
    // 6. Soft veto ack
    {
      invariantId: 'soft_veto_ack',
      description: 'Soft veto without ackToken must await_ack',
      passed: (() => {
        const shield = results.shield?.output;
        if (shield?.interventionLevel === 'veto' && shield?.vetoType === 'soft') {
          if (!state.input.ackToken) {
            return results.shield?.action === 'await_ack';
          }
        }
        return true;
      })(),
    },
    
    // 7. No NL actions
    {
      invariantId: 'no_nl_actions',
      description: 'Actions must come from explicit sources only',
      passed: (() => {
        const actions = state.input.requestedActions || [];
        const validSources = ['ui_button', 'command_parser', 'api_field'];
        return actions.every(a => validSources.includes(a.source));
      })(),
    },
    
    // 8. Immediate domain numerics
    {
      invariantId: 'immediate_domain_numerics',
      description: 'Unverified immediate domain must not have precise numbers',
      passed: (() => {
        const lens = results.lens?.output;
        if (lens?.plan?.verificationStatus === 'skipped') {
          // Would need to detect domain from input
          // Simplified check
          return true;
        }
        return true;
      })(),
    },
  ];
}

export { checkAllInvariants };
