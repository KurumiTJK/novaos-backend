// ═══════════════════════════════════════════════════════════════════════════════
// RESPONSE BUILDERS — Fixes A-1, A-2, A-3
// Implements missing response builder methods that would crash at runtime
// ═══════════════════════════════════════════════════════════════════════════════

import {
  PipelineState,
  GateResults,
  PipelineContext,
  PipelineResult,
  TransparencyInfo,
  DebugInfo,
  GateDebugInfo,
  UserOption,
  Stance,
  ConfidenceLevel,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

function buildTransparency(state: PipelineState, results: GateResults): TransparencyInfo {
  return {
    modelUsed: state.generation?.model ?? 'none',
    fallbackUsed: state.generation?.fallbackUsed ?? false,
    verificationStatus: state.verification?.plan?.verificationStatus ?? 'skipped',
    regenerationCount: state.regenerationCount,
    degraded: state.degraded,
    violations: state.validated?.violations ?? [],
  };
}

function buildDebugInfo(results: GateResults, context: PipelineContext, totalMs: number): DebugInfo {
  const gates: GateDebugInfo[] = [];
  
  for (const [gateId, result] of Object.entries(results)) {
    if (result) {
      gates.push({
        gateId: gateId as any,
        status: result.status,
        action: result.action,
        executionTimeMs: result.executionTimeMs,
      });
    }
  }

  return {
    gates,
    policyVersions: {
      policy: context.policyVersion,
      capability: context.capabilityMatrixVersion,
      constraints: context.constraintsVersion,
      verification: context.verificationPolicyVersion,
      freshness: context.freshnessPolicyVersion,
    },
    totalLatencyMs: totalMs,
  };
}

/**
 * Sanitize internal failure reasons for user-facing display.
 * Never expose gate names, policy versions, or internal state.
 */
function sanitizeReasonForUser(reason: string | undefined): string {
  if (!reason) return 'This request could not be completed.';
  
  // Map internal reasons to user-safe messages
  const mappings: Record<string, string> = {
    'hard_veto': 'This request cannot be processed due to safety guidelines.',
    'illegal_content': 'This request cannot be processed due to content policies.',
    'child_safety': 'This request cannot be processed due to safety policies.',
    'violence_promotion': 'This request cannot be processed due to content policies.',
    'self_harm_instructions': 'This request cannot be processed. If you need support, resources are available.',
    'weapons_creation': 'This request cannot be processed due to safety guidelines.',
    'verification_unavailable': 'This request requires verification that is currently unavailable.',
    'capability_blocked': 'This action is not available in the current context.',
    'invariant_violation': 'This request could not be completed safely.',
  };

  // Check if reason contains any mapped key
  for (const [key, message] of Object.entries(mappings)) {
    if (reason.toLowerCase().includes(key.toLowerCase())) {
      return message;
    }
  }

  // Default safe message
  return 'This request could not be completed.';
}

// ─────────────────────────────────────────────────────────────────────────────────
// FIX A-1: buildStoppedResponse
// Called when pipeline hard-stops (hard veto, capability block, etc.)
// ─────────────────────────────────────────────────────────────────────────────────

export function buildStoppedResponse(
  state: PipelineState,
  results: GateResults,
  context: PipelineContext,
  startTime: number = Date.now()
): PipelineResult {
  const totalMs = Date.now() - startTime;

  // Extract user options if LensGate stopped with options
  let userOptions: UserOption[] | undefined;
  if (state.stoppedAt === 'lens' && state.verification?.userOptions) {
    userOptions = state.verification.userOptions;
  }

  return {
    success: false,
    stopped: true,
    message: sanitizeReasonForUser(state.stoppedReason),
    stoppedReason: state.stoppedReason, // Internal, for logging only
    stoppedAt: state.stoppedAt,
    userOptions,
    transparency: buildTransparency(state, results),
    debug: buildDebugInfo(results, context, totalMs),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// FIX A-2: buildAwaitAckResponse
// Called when soft veto requires user acknowledgment
// ─────────────────────────────────────────────────────────────────────────────────

export function buildAwaitAckResponse(
  state: PipelineState,
  results: GateResults,
  context: PipelineContext,
  startTime: number = Date.now()
): PipelineResult {
  const totalMs = Date.now() - startTime;
  
  if (!state.pendingAck) {
    // Should never happen, but fail safely
    return buildStoppedResponse(
      { ...state, stoppedAt: 'shield', stoppedReason: 'Missing acknowledgment data' },
      results,
      context,
      startTime
    );
  }

  return {
    success: false,
    stopped: false,
    message: sanitizeReasonForUser(state.risk?.reason),
    pendingAck: {
      ackToken: state.pendingAck.ackToken,
      requiredText: state.pendingAck.requiredText,
      expiresAt: state.pendingAck.expiresAt,
    },
    // Include audit ID so user can reference in support
    auditId: state.pendingAck.auditId,
    transparency: buildTransparency(state, results),
    debug: buildDebugInfo(results, context, totalMs),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// FIX A-3: buildDegradedResponse
// Called when pipeline completes but in degraded mode
// ─────────────────────────────────────────────────────────────────────────────────

export function buildDegradedResponse(
  state: PipelineState,
  results: GateResults,
  context: PipelineContext,
  degradeReason: string,
  startTime: number = Date.now()
): PipelineResult {
  const totalMs = Date.now() - startTime;

  // Degraded responses always have low confidence
  const confidence: ConfidenceLevel = 'low';
  
  // Build freshness warning if applicable
  let freshnessWarning: string | undefined;
  if (state.verification?.plan?.freshnessWarning) {
    freshnessWarning = state.verification.plan.freshnessWarning;
  } else if (degradeReason === 'max_regenerations') {
    freshnessWarning = 'Response quality may be reduced due to content constraints.';
  } else if (degradeReason === 'verification_unavailable') {
    freshnessWarning = 'Could not verify against current sources. Treat with caution.';
  }

  return {
    success: true, // Degraded is still a "success" from API perspective
    message: state.validated?.text ?? state.generation?.text ?? '',
    stance: state.stance,
    confidence,
    verified: false, // Degraded = never verified
    freshnessWarning,
    spark: state.spark?.spark ?? undefined,
    transparency: {
      ...buildTransparency(state, results),
      degraded: true,
      degradeReason,
    },
    debug: buildDebugInfo(results, context, totalMs),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// buildResponse (successful, non-degraded)
// For completeness — the normal success path
// ─────────────────────────────────────────────────────────────────────────────────

export function buildResponse(
  state: PipelineState,
  results: GateResults,
  context: PipelineContext,
  startTime: number = Date.now()
): PipelineResult {
  const totalMs = Date.now() - startTime;

  return {
    success: true,
    message: state.validated?.text ?? state.generation?.text ?? '',
    stance: state.stance,
    confidence: state.verification?.plan?.confidence ?? 'medium',
    verified: state.verification?.plan?.verified ?? false,
    freshnessWarning: state.verification?.plan?.freshnessWarning,
    spark: state.spark?.spark ?? undefined,
    transparency: buildTransparency(state, results),
    debug: buildDebugInfo(results, context, totalMs),
  };
}
