// ═══════════════════════════════════════════════════════════════════════════════
// SHUTDOWN MODULE INDEX — Graceful Shutdown Exports
// NovaOS Infrastructure — Phase 4
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// HOOKS
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Types
  type ShutdownPriority,
  PRIORITY_VALUES,
  type ShutdownHookFn,
  type ShutdownHook,
  type HookResult,
  type ShutdownResult,
  
  // Configuration
  setDefaultHookTimeout,
  isShutdownInProgress,
  
  // Registration
  registerShutdownHook,
  unregisterShutdownHook,
  setHookEnabled,
  getRegisteredHooks,
  getHooksByPriority,
  clearShutdownHooks,
  
  // Execution
  executeShutdownHooks,
  
  // Common hooks
  createServerCloseHook,
  createDisconnectHook,
  createLoggerFlushHook,
} from './hooks.js';

// ─────────────────────────────────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Types
  type ShutdownConfig,
  DEFAULT_SHUTDOWN_CONFIG,
  type ShutdownState,
  
  // Configuration
  configureShutdown,
  getShutdownState,
  
  // Signal handlers
  installSignalHandlers,
  removeSignalHandlers,
  
  // Shutdown
  initiateShutdown,
  shouldAcceptRequests,
  getShutdownTimeRemaining,
  
  // Testing
  resetShutdownState,
  simulateShutdown,
} from './handler.js';
