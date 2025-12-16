// ═══════════════════════════════════════════════════════════════════════════════
// INVARIANT GATE — Fix C-2
// Enforces invariants BEFORE response is sent (not after)
// Critical invariant violations STOP the pipeline
// ═══════════════════════════════════════════════════════════════════════════════

import {
  PipelineState,
  GateResults,
  GateResult,
  GateId,
  Invariant,
  InvariantResult,
  RiskSummary,
  VerificationPlan,
  SparkDecision,
} from './types.js';
import { verifyCrisisResourcesPresent } from './safety-renderer.js';
import { detectDomain, isImmediateDomain } from './freshness-checker.js';

// ─────────────────────────────────────────────────────────────────────────────────
// INVARIANT DEFINITIONS
// Each invariant has:
// - id: Unique identifier
// - description: Human-readable description
// - critical: If true, violation stops pipeline
// - test: Function that returns true if invariant holds
// ─────────────────────────────────────────────────────────────────────────────────

interface EnforcedInvariant extends Invariant {
  critical: boolean;
}

const ENFORCED_INVARIANTS: EnforcedInvariant[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // CRITICAL INVARIANTS — Violation stops pipeline
  // ─────────────────────────────────────────────────────────────────────────
  
  {
    id: 'hard_veto_stops',
    description: 'If hard veto triggered, pipeline must have stopped at shield',
    critical: true,
    test: (state, results) => {
      const shield = results.shield?.output as RiskSummary | undefined;
      if (shield?.interventionLevel === 'veto' && shield?.vetoType === 'hard') {
        // This invariant should never fire in InvariantGate because
        // hard veto stops at ShieldGate. If we reach here, something is wrong.
        return state.stoppedAt === 'shield';
      }
      return true;
    },
  },

  {
    id: 'control_resources',
    description: 'If control trigger fired, crisis resources must be in output',
    critical: true,
    test: (state, results, response) => {
      const shield = results.shield?.output as RiskSummary | undefined;
      if (shield?.controlTrigger || shield?.requiredPrependResources) {
        // Response text must contain crisis resources
        if (!response?.text) return false;
        return verifyCrisisResourcesPresent(response.text);
      }
      return true;
    },
  },

  {
    id: 'soft_veto_requires_ack',
    description: 'Soft veto without ackToken must await acknowledgment',
    critical: true,
    test: (state, results) => {
      const shield = results.shield?.output as RiskSummary | undefined;
      if (shield?.interventionLevel === 'veto' && shield?.vetoType === 'soft') {
        // If no ackToken provided, action must be await_ack
        if (!state.input.ackToken) {
          return results.shield?.action === 'await_ack';
        }
        // If ackToken provided, override must be applied
        return shield.overrideApplied === true;
      }
      return true;
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // HIGH INVARIANTS — Violation degrades response
  // ─────────────────────────────────────────────────────────────────────────

  {
    id: 'sword_only_spark',
    description: 'Spark can only be generated in sword stance',
    critical: false,
    test: (state, results) => {
      if (state.stance !== 'sword') {
        const spark = results.spark?.output as SparkDecision | undefined;
        // Spark must be null if not in sword stance
        return spark?.spark === null || spark?.spark === undefined;
      }
      return true;
    },
  },

  {
    id: 'lens_degradation',
    description: 'If verification required but unavailable, must degrade',
    critical: false,
    test: (state, results) => {
      const lens = results.lens?.output as VerificationPlan | undefined;
      if (lens?.required && lens?.mode === 'degraded') {
        // Must have low confidence and verified=false
        return lens.plan?.confidence === 'low' && lens.plan?.verified === false;
      }
      return true;
    },
  },

  {
    id: 'regeneration_limit',
    description: 'Regeneration count must not exceed 2',
    critical: false,
    test: (state) => {
      return state.regenerationCount <= 2;
    },
  },

  {
    id: 'no_nl_actions',
    description: 'Actions must come from explicit sources only',
    critical: true, // SECURITY: Must stop on invalid action source
    test: (state) => {
      const actions = state.input.requestedActions || [];
      const validSources = ['ui_button', 'command_parser', 'api_field'];
      return actions.every(a => validSources.includes(a.source));
    },
  },

  {
    id: 'immediate_domain_numerics',
    description: 'Unverified immediate domain must not have precise numbers',
    critical: false,
    test: (state, results, response) => {
      const lens = results.lens?.output as VerificationPlan | undefined;
      
      // Only applies if verification was required but skipped/degraded
      if (lens?.required && 
          (lens?.plan?.verificationStatus === 'skipped' || lens?.mode === 'degraded')) {
        
        // Use unified domain detection from freshness-checker
        const domain = detectDomain(state.input.message);
        
        if (isImmediateDomain(domain) && response?.text) {
          // Should not contain precise financial numbers
          const hasPreciseNumbers = /\$[\d,]+\.\d{2}|\b\d+\.\d{2}%|\b\d{1,3}(?:,\d{3})+\.\d{2}\b/.test(response.text);
          return !hasPreciseNumbers;
        }
      }
      return true;
    },
  },

  {
    id: 'confidence_verification_alignment',
    description: 'High confidence requires verification',
    critical: false,
    test: (state, results) => {
      const lens = results.lens?.output as VerificationPlan | undefined;
      if (lens?.plan?.confidence === 'high') {
        // High confidence should only be assigned if verified
        return lens.plan?.verified === true;
      }
      return true;
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────────
// INVARIANT GATE
// ─────────────────────────────────────────────────────────────────────────────────

export interface InvariantGateInput {
  state: PipelineState;
  results: GateResults;
  responseText: string;
}

export interface InvariantGateOutput {
  violations: InvariantResult[];
  criticalViolations: InvariantResult[];
  nonCriticalViolations: InvariantResult[];
}

/**
 * Invariant Gate — runs AFTER SparkGate, BEFORE response is sent.
 * 
 * Critical violations: STOP pipeline, return error
 * Non-critical violations: LOG and continue (maybe degrade)
 */
export class InvariantGate {
  readonly gateId: GateId = 'invariant' as GateId;

  async execute(
    input: InvariantGateInput,
    context: any
  ): Promise<GateResult<InvariantGateOutput>> {
    const start = Date.now();
    const { state, results, responseText } = input;

    const response = { text: responseText };
    const allViolations: InvariantResult[] = [];
    const criticalViolations: InvariantResult[] = [];
    const nonCriticalViolations: InvariantResult[] = [];

    // Check all invariants
    for (const invariant of ENFORCED_INVARIANTS) {
      try {
        const passed = invariant.test(state, results, response);
        
        if (!passed) {
          const violation: InvariantResult = {
            invariantId: invariant.id,
            description: invariant.description,
            passed: false,
          };

          allViolations.push(violation);

          if (invariant.critical) {
            criticalViolations.push(violation);
          } else {
            nonCriticalViolations.push(violation);
          }
        }
      } catch (error) {
        // Invariant check threw — treat as violation
        console.error(`[INVARIANT] Check failed for ${invariant.id}:`, error);
        const violation: InvariantResult = {
          invariantId: invariant.id,
          description: `${invariant.description} (check error)`,
          passed: false,
        };
        allViolations.push(violation);
        if (invariant.critical) {
          criticalViolations.push(violation);
        }
      }
    }

    // Determine action based on violations
    if (criticalViolations.length > 0) {
      // CRITICAL: Stop pipeline
      return {
        gateId: this.gateId,
        status: 'hard_fail',
        output: {
          violations: allViolations,
          criticalViolations,
          nonCriticalViolations,
        },
        action: 'stop',
        failureReason: `Critical invariant violation: ${criticalViolations.map(v => v.invariantId).join(', ')}`,
        executionTimeMs: Date.now() - start,
      };
    }

    if (nonCriticalViolations.length > 0) {
      // NON-CRITICAL: Log and continue (could degrade)
      console.warn(
        `[INVARIANT] Non-critical violations: ${nonCriticalViolations.map(v => v.invariantId).join(', ')}`
      );
      
      return {
        gateId: this.gateId,
        status: 'soft_fail',
        output: {
          violations: allViolations,
          criticalViolations: [],
          nonCriticalViolations,
        },
        action: 'continue',
        failureReason: `Non-critical violations: ${nonCriticalViolations.map(v => v.invariantId).join(', ')}`,
        executionTimeMs: Date.now() - start,
      };
    }

    // All invariants passed
    return {
      gateId: this.gateId,
      status: 'pass',
      output: {
        violations: [],
        criticalViolations: [],
        nonCriticalViolations: [],
      },
      action: 'continue',
      executionTimeMs: Date.now() - start,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// HELPER: Check all invariants (for testing)
// ─────────────────────────────────────────────────────────────────────────────────

export function checkAllInvariants(
  state: PipelineState,
  results: GateResults,
  response?: { text: string }
): InvariantResult[] {
  const violations: InvariantResult[] = [];

  for (const invariant of ENFORCED_INVARIANTS) {
    try {
      const passed = invariant.test(state, results, response);
      if (!passed) {
        violations.push({
          invariantId: invariant.id,
          description: invariant.description,
          passed: false,
        });
      }
    } catch {
      violations.push({
        invariantId: invariant.id,
        description: `${invariant.description} (check error)`,
        passed: false,
      });
    }
  }

  return violations;
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export { ENFORCED_INVARIANTS };
