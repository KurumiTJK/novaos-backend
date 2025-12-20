// ═══════════════════════════════════════════════════════════════════════════════
// ORCHESTRATION INDEX — Barrel Export for Orchestration Module
// Phase 7: Lens Gate
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// MAIN ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Main async orchestration function
  orchestrate,
  
  // Synchronous orchestration (pattern-only, no fetching)
  orchestrateSync,
  
  // Helper functions
  requiresLiveData,
  generateCorrelationId,
  
  // Constants
  DEFAULT_PROVIDER_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  
  // Types
  type OrchestrationOptions,
} from './orchestrator.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TIME HANDLER
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Main time handling function
  handleTimeData,
  
  // Batch handling
  handleMultipleTimeQueries,
  
  // Evidence building
  buildTimeEvidence,
  buildTimeResponse,
  
  // Validation helpers
  isValidTimezone,
  isTimeCategory,
  hasTimeEntity,
  extractTimeEntities,
  getTimezoneFromEntity,
  
  // Refusal creation
  createInvalidTimezoneRefusal,
  
  // Constants
  TIME_REFUSAL_MESSAGE,
  INVALID_TIMEZONE_MESSAGE,
  FALLBACK_TIMEZONE,
  
  // Types
  type TimeHandlerResult,
  type TimeHandlerOptions,
} from './time-handler.js';
