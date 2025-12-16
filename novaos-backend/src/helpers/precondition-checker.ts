// ═══════════════════════════════════════════════════════════════════════════════
// PRECONDITION CHECKER — Fix A-4
// Implements missing checkPrecondition that would cause silent failures
// ═══════════════════════════════════════════════════════════════════════════════

import { PipelineState } from './types.js';

/**
 * Known preconditions that can be checked.
 * Adding new preconditions requires explicit implementation.
 */
type KnownPrecondition = 
  | 'resources_provided'
  | 'verification_complete'
  | 'user_authenticated'
  | 'session_active'
  | 'no_pending_veto';

/**
 * Check if a precondition is met given the current pipeline state.
 * 
 * SECURITY: Unknown preconditions FAIL CLOSED (return false).
 * This prevents bypasses via undefined precondition strings.
 * 
 * @param precondition - The precondition identifier to check
 * @param state - Current pipeline state
 * @returns true if precondition is met, false otherwise
 */
export function checkPrecondition(precondition: string, state: PipelineState): boolean {
  switch (precondition as KnownPrecondition) {
    
    // ─────────────────────────────────────────────────────────────────────────
    // resources_provided
    // Used by: Control mode end_conversation
    // Ensures crisis resources have been rendered before allowing exit
    // ─────────────────────────────────────────────────────────────────────────
    case 'resources_provided':
      // Check both the flag and that resources actually exist
      if (!state.risk?.requiredPrependResources) {
        // Resources weren't required, precondition is met
        return true;
      }
      // Resources were required, check if they were provided
      // This flag should be set by SafetyRenderer after hard-rendering resources
      return state.crisisResourcesProvided === true;

    // ─────────────────────────────────────────────────────────────────────────
    // verification_complete
    // Used by: High-stakes actions that require verified data
    // ─────────────────────────────────────────────────────────────────────────
    case 'verification_complete':
      return state.verification?.plan?.verificationStatus === 'complete' &&
             state.verification?.plan?.verified === true;

    // ─────────────────────────────────────────────────────────────────────────
    // user_authenticated
    // Used by: Actions that require confirmed identity
    // ─────────────────────────────────────────────────────────────────────────
    case 'user_authenticated':
      // Check userId is present and not a guest/anonymous ID
      return Boolean(state.input.userId) && 
             !state.input.userId.startsWith('guest_') &&
             !state.input.userId.startsWith('anon_');

    // ─────────────────────────────────────────────────────────────────────────
    // session_active
    // Used by: Actions that require an active conversation session
    // ─────────────────────────────────────────────────────────────────────────
    case 'session_active':
      return Boolean(state.input.sessionId) &&
             !state.sessionEnded;

    // ─────────────────────────────────────────────────────────────────────────
    // no_pending_veto
    // Used by: Actions that cannot proceed if a veto is pending
    // ─────────────────────────────────────────────────────────────────────────
    case 'no_pending_veto':
      return !state.pendingAck;

    // ─────────────────────────────────────────────────────────────────────────
    // UNKNOWN PRECONDITION — FAIL CLOSED
    // ─────────────────────────────────────────────────────────────────────────
    default:
      console.error(`[SECURITY] Unknown precondition requested: "${precondition}". Failing closed.`);
      return false;
  }
}

/**
 * Check multiple preconditions, returning details about which failed.
 * Useful for generating informative error messages.
 */
export function checkPreconditions(
  preconditions: string[],
  state: PipelineState
): { allMet: boolean; failed: string[] } {
  const failed: string[] = [];
  
  for (const precondition of preconditions) {
    if (!checkPrecondition(precondition, state)) {
      failed.push(precondition);
    }
  }
  
  return {
    allMet: failed.length === 0,
    failed,
  };
}

/**
 * Type guard to check if a string is a known precondition.
 * Useful for validation at API boundaries.
 */
export function isKnownPrecondition(value: string): value is KnownPrecondition {
  const known: string[] = [
    'resources_provided',
    'verification_complete', 
    'user_authenticated',
    'session_active',
    'no_pending_veto',
  ];
  return known.includes(value);
}
