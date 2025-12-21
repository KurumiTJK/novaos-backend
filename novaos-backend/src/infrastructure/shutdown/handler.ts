// ═══════════════════════════════════════════════════════════════════════════════
// SHUTDOWN HANDLER — Graceful Shutdown Coordinator
// NovaOS Infrastructure — Phase 4
// ═══════════════════════════════════════════════════════════════════════════════
//
// Handles graceful shutdown:
// - Signal handlers (SIGTERM, SIGINT, SIGHUP)
// - Timeout enforcement
// - Health endpoint coordination
// - Exit code management
//
// ═══════════════════════════════════════════════════════════════════════════════

import { getLogger } from '../../observability/logging/index.js';
import {
  executeShutdownHooks,
  isShutdownInProgress,
  type ShutdownResult,
} from './hooks.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Shutdown configuration.
 */
export interface ShutdownConfig {
  /** Total timeout for shutdown in ms */
  readonly timeoutMs: number;
  
  /** Signals to handle */
  readonly signals: NodeJS.Signals[];
  
  /** Exit code on success */
  readonly exitCodeSuccess: number;
  
  /** Exit code on failure */
  readonly exitCodeFailure: number;
  
  /** Exit code on timeout */
  readonly exitCodeTimeout: number;
  
  /** Whether to call process.exit() */
  readonly exitProcess: boolean;
  
  /** Delay before starting shutdown (drain period) */
  readonly drainDelayMs: number;
  
  /** Called when shutdown starts */
  readonly onShutdownStart?: (signal: string) => void;
  
  /** Called when shutdown completes */
  readonly onShutdownComplete?: (result: ShutdownResult) => void;
  
  /** Called on forced exit */
  readonly onForcedExit?: (reason: string) => void;
}

/**
 * Default shutdown configuration.
 */
export const DEFAULT_SHUTDOWN_CONFIG: ShutdownConfig = {
  timeoutMs: 30000,
  signals: ['SIGTERM', 'SIGINT'],
  exitCodeSuccess: 0,
  exitCodeFailure: 1,
  exitCodeTimeout: 124,
  exitProcess: true,
  drainDelayMs: 0,
};

/**
 * Shutdown state.
 */
export interface ShutdownState {
  readonly isShuttingDown: boolean;
  readonly shutdownStartedAt?: number;
  readonly signal?: string;
  readonly result?: ShutdownResult;
}

// ─────────────────────────────────────────────────────────────────────────────────
// HANDLER STATE
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'shutdown' });

// Internal mutable config type
type MutableShutdownConfig = {
  -readonly [K in keyof ShutdownConfig]: ShutdownConfig[K];
};

let config: MutableShutdownConfig = { ...DEFAULT_SHUTDOWN_CONFIG };
let state: ShutdownState = { isShuttingDown: false };
let handlersInstalled = false;
let shutdownPromise: Promise<ShutdownResult> | null = null;

// ─────────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Configure the shutdown handler.
 */
export function configureShutdown(options: Partial<ShutdownConfig>): void {
  config = { ...config, ...options };
}

/**
 * Get current shutdown state.
 */
export function getShutdownState(): ShutdownState {
  return { ...state };
}

// ─────────────────────────────────────────────────────────────────────────────────
// SIGNAL HANDLERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Install signal handlers.
 */
export function installSignalHandlers(): void {
  if (handlersInstalled) {
    logger.warn('Signal handlers already installed');
    return;
  }
  
  for (const signal of config.signals) {
    process.on(signal, () => handleSignal(signal));
  }
  
  // Handle uncaught exceptions during shutdown
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception during shutdown', error);
    if (state.isShuttingDown) {
      forceExit('uncaught_exception');
    }
  });
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection during shutdown', reason as Error);
    if (state.isShuttingDown) {
      forceExit('unhandled_rejection');
    }
  });
  
  handlersInstalled = true;
  logger.debug('Signal handlers installed', { signals: config.signals });
}

/**
 * Remove signal handlers.
 */
export function removeSignalHandlers(): void {
  for (const signal of config.signals) {
    process.removeAllListeners(signal);
  }
  handlersInstalled = false;
  logger.debug('Signal handlers removed');
}

/**
 * Handle a shutdown signal.
 */
async function handleSignal(signal: string): Promise<void> {
  // Ignore if already shutting down (debounce repeated signals)
  if (state.isShuttingDown) {
    logger.warn('Received signal during shutdown, ignoring', { signal });
    return;
  }
  
  logger.info('Received shutdown signal', { signal });
  
  // Start shutdown
  await initiateShutdown(signal);
}

// ─────────────────────────────────────────────────────────────────────────────────
// SHUTDOWN EXECUTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Initiate graceful shutdown.
 */
export async function initiateShutdown(reason = 'manual'): Promise<ShutdownResult> {
  // Return existing promise if already shutting down
  if (shutdownPromise) {
    return shutdownPromise;
  }
  
  shutdownPromise = performShutdown(reason);
  return shutdownPromise;
}

/**
 * Perform the actual shutdown.
 */
async function performShutdown(reason: string): Promise<ShutdownResult> {
  state = {
    isShuttingDown: true,
    shutdownStartedAt: Date.now(),
    signal: reason,
  };
  
  logger.info('Starting graceful shutdown', {
    reason,
    timeoutMs: config.timeoutMs,
    drainDelayMs: config.drainDelayMs,
  });
  
  config.onShutdownStart?.(reason);
  
  // Drain delay (allow in-flight requests to complete)
  if (config.drainDelayMs > 0) {
    logger.debug('Drain period started', { delayMs: config.drainDelayMs });
    await sleep(config.drainDelayMs);
  }
  
  // Set up timeout
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    setTimeout(() => resolve('timeout'), config.timeoutMs);
  });
  
  // Execute hooks with timeout
  const result = await Promise.race([
    executeShutdownHooks(),
    timeoutPromise.then((): ShutdownResult => ({
      success: false,
      totalDurationMs: config.timeoutMs,
      hooks: [],
      failed: ['timeout'],
      timedOut: ['global'],
    })),
  ]);
  
  const isTimeout = result.failed.includes('timeout') && result.timedOut.includes('global');
  
  state = {
    ...state,
    result,
  };
  
  // Determine exit code
  let exitCode: number;
  if (isTimeout) {
    exitCode = config.exitCodeTimeout;
    logger.error('Shutdown timed out', {
      timeoutMs: config.timeoutMs,
      totalDurationMs: result.totalDurationMs,
    });
  } else if (result.success) {
    exitCode = config.exitCodeSuccess;
    logger.info('Graceful shutdown completed', {
      totalDurationMs: result.totalDurationMs,
      hooksExecuted: result.hooks.length,
    });
  } else {
    exitCode = config.exitCodeFailure;
    logger.warn('Shutdown completed with failures', {
      totalDurationMs: result.totalDurationMs,
      failed: result.failed,
    });
  }
  
  config.onShutdownComplete?.(result);
  
  // Exit process if configured
  if (config.exitProcess) {
    // Small delay to allow logs to flush
    await sleep(100);
    process.exit(exitCode);
  }
  
  return result;
}

/**
 * Force immediate exit.
 */
function forceExit(reason: string): void {
  logger.error('Forcing exit', { reason });
  config.onForcedExit?.(reason);
  process.exit(config.exitCodeFailure);
}

// ─────────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Sleep helper.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if service should accept new requests.
 * Use this in health checks and request handlers.
 */
export function shouldAcceptRequests(): boolean {
  return !state.isShuttingDown;
}

/**
 * Get time remaining until shutdown timeout.
 */
export function getShutdownTimeRemaining(): number | null {
  if (!state.isShuttingDown || !state.shutdownStartedAt) {
    return null;
  }
  
  const elapsed = Date.now() - state.shutdownStartedAt;
  return Math.max(0, config.timeoutMs - elapsed);
}

// ─────────────────────────────────────────────────────────────────────────────────
// TESTING HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Reset shutdown state (for testing).
 */
export function resetShutdownState(): void {
  state = { isShuttingDown: false };
  shutdownPromise = null;
}

/**
 * Simulate shutdown without actually exiting (for testing).
 */
export async function simulateShutdown(reason = 'test'): Promise<ShutdownResult> {
  const originalExitProcess = config.exitProcess;
  config.exitProcess = false;
  
  try {
    return await initiateShutdown(reason);
  } finally {
    config.exitProcess = originalExitProcess;
    resetShutdownState();
  }
}
