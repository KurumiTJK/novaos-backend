// ═══════════════════════════════════════════════════════════════════════════════
// OBSERVABILITY — Barrel Export
// ═══════════════════════════════════════════════════════════════════════════════

export {
  // Event types
  type LensEventName,
  type AlertLevel,
  type LensOutcome,
  type LensOperationalEvent,
  type OperationalEvent,
  
  // Invalid state detection
  type InvalidStateCondition,
  INVALID_STATE_CONDITIONS,
  detectInvalidState,
  
  // Alert level
  determineAlertLevel,
  
  // Configuration
  type EventHandler,
  type PagerFunction,
  type EventEmitterConfig,
  type EmitterConfig,
  configure,
  getConfig,
  
  // Event creation and emission
  createEvent,
  emitLensEvent,
  
  // Convenience emitters
  emitRequestEvent,
  emitSuccessEvent,
  emitFailureEvent,
  emitDegradedEvent,
  emitBlockedEvent,
  emitInvalidStateEvent,
  emitResultEvent,
} from './operational-events.js';
