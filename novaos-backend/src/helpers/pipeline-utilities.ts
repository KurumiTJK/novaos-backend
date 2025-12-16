// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE UTILITIES — Fixes E-3, F-1, F-2
// State isolation, timeout handling, and error sanitization
// ═══════════════════════════════════════════════════════════════════════════════

import { PipelineState, PipelineResult } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// FIX E-3: STATE ISOLATION
// Ensures regeneration doesn't corrupt state
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Deep clone a pipeline state for isolated mutation.
 * Uses structuredClone for proper deep copy.
 * 
 * @param state - State to clone
 * @returns Deep cloned state
 */
export function cloneState(state: PipelineState): PipelineState {
  // structuredClone handles Date objects, nested objects, etc.
  // It's available in Node 17+ and modern browsers
  return structuredClone(state);
}

/**
 * Fallback deep clone for environments without structuredClone.
 */
export function cloneStateCompat(state: PipelineState): PipelineState {
  // Handle Date objects specially
  const replacer = (key: string, value: any) => {
    if (value instanceof Date) {
      return { __type: 'Date', value: value.toISOString() };
    }
    return value;
  };

  const reviver = (key: string, value: any) => {
    if (value && typeof value === 'object' && value.__type === 'Date') {
      return new Date(value.value);
    }
    return value;
  };

  return JSON.parse(JSON.stringify(state, replacer), reviver);
}

/**
 * Create an immutable state update.
 * Returns new state without mutating original.
 */
export function updateState<K extends keyof PipelineState>(
  state: PipelineState,
  key: K,
  value: PipelineState[K]
): PipelineState {
  return {
    ...state,
    [key]: value,
  };
}

/**
 * Increment regeneration count immutably.
 */
export function incrementRegeneration(state: PipelineState): PipelineState {
  return {
    ...state,
    regenerationCount: state.regenerationCount + 1,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// FIX F-1: TIMEOUT HANDLING
// Prevents hanging requests from blocking workers
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Custom error for pipeline timeouts.
 */
export class PipelineTimeoutError extends Error {
  readonly code = 'PIPELINE_TIMEOUT';
  readonly requestId?: string;
  readonly gateId?: string;

  constructor(message: string, requestId?: string, gateId?: string) {
    super(message);
    this.name = 'PipelineTimeoutError';
    this.requestId = requestId;
    this.gateId = gateId;
  }
}

/**
 * Wrap a promise with a timeout.
 * 
 * @param promise - Promise to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param context - Context for error message
 * @returns Promise that rejects on timeout
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  context?: { requestId?: string; gateId?: string }
): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new PipelineTimeoutError(
        `Operation timed out after ${timeoutMs}ms`,
        context?.requestId,
        context?.gateId
      ));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

/**
 * Default timeouts for different operations.
 */
export const TIMEOUTS = {
  PIPELINE_TOTAL: 30000,    // 30 seconds total
  GATE_DEFAULT: 5000,       // 5 seconds per gate
  MODEL_GENERATION: 15000,  // 15 seconds for model
  VERIFICATION: 10000,      // 10 seconds for web verification
  NONCE_CHECK: 1000,        // 1 second for nonce store
} as const;

/**
 * Gate-specific timeouts.
 */
export const GATE_TIMEOUTS: Record<string, number> = {
  intent: 2000,
  shield: 3000,
  lens: TIMEOUTS.VERIFICATION,
  stance: 1000,
  capability: 1000,
  model: TIMEOUTS.MODEL_GENERATION,
  personality: 3000,
  spark: 2000,
  invariant: 2000,
};

// ─────────────────────────────────────────────────────────────────────────────────
// FIX F-2: ERROR SANITIZATION
// Prevents internal details from leaking to clients
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Error types that can be safely shown to clients.
 */
export type ClientErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'SERVICE_ERROR'
  | 'TIMEOUT'
  | 'CONTENT_BLOCKED'
  | 'VERIFICATION_REQUIRED'
  | 'ACKNOWLEDGMENT_REQUIRED';

/**
 * Client-safe error structure.
 */
export interface ClientError {
  code: ClientErrorCode;
  message: string;
  requestId?: string;
  retryable: boolean;
  retryAfterMs?: number;
}

/**
 * Error message mapping type.
 */
interface ErrorMapping {
  code: ClientErrorCode;
  message: string;
  retryable: boolean;
}

/**
 * Default error for unknown cases.
 */
const DEFAULT_ERROR: ErrorMapping = {
  code: 'SERVICE_ERROR',
  message: 'An unexpected error occurred',
  retryable: true,
};

/**
 * Map internal error codes to client-safe messages.
 */
const ERROR_MESSAGES: Record<string, ErrorMapping> = {
  // Validation errors
  INVALID_TYPE: {
    code: 'INVALID_REQUEST',
    message: 'Invalid request format',
    retryable: false,
  },
  INVALID_PARAMS: {
    code: 'INVALID_REQUEST',
    message: 'Invalid parameters provided',
    retryable: false,
  },
  INVALID_STATE: {
    code: 'INVALID_REQUEST',
    message: 'Action not valid in current state',
    retryable: false,
  },
  
  // Auth errors
  UNAUTHORIZED: {
    code: 'UNAUTHORIZED',
    message: 'Authentication required',
    retryable: false,
  },
  
  // Veto errors
  HARD_VETO: {
    code: 'CONTENT_BLOCKED',
    message: 'This request cannot be processed due to content policies',
    retryable: false,
  },
  SOFT_VETO: {
    code: 'ACKNOWLEDGMENT_REQUIRED',
    message: 'This request requires acknowledgment to proceed',
    retryable: true,
  },
  
  // Verification errors
  VERIFICATION_UNAVAILABLE: {
    code: 'VERIFICATION_REQUIRED',
    message: 'Unable to verify information. Please try again or provide a source.',
    retryable: true,
  },
  
  // System errors
  PIPELINE_TIMEOUT: {
    code: 'TIMEOUT',
    message: 'Request timed out. Please try again.',
    retryable: true,
  },
  MODEL_UNAVAILABLE: {
    code: 'SERVICE_ERROR',
    message: 'Service temporarily unavailable. Please try again.',
    retryable: true,
  },
  INVARIANT_VIOLATION: {
    code: 'SERVICE_ERROR',
    message: 'Unable to process request safely. Please try again.',
    retryable: true,
  },
  
  // Default
  UNKNOWN: {
    code: 'SERVICE_ERROR',
    message: 'An unexpected error occurred',
    retryable: true,
  },
};

/**
 * Get error mapping with guaranteed fallback.
 */
function getErrorMapping(errorCode: string): ErrorMapping {
  return ERROR_MESSAGES[errorCode] ?? DEFAULT_ERROR;
}

/**
 * Sanitize an internal error for client response.
 * NEVER expose internal details like gate names, policy versions, stack traces.
 * 
 * @param error - Internal error
 * @param requestId - Request ID for client reference
 * @returns Client-safe error
 */
export function sanitizeError(error: unknown, requestId?: string): ClientError {
  // Handle known error types
  if (error instanceof PipelineTimeoutError) {
    return {
      code: 'TIMEOUT',
      message: 'Request timed out. Please try again.',
      requestId,
      retryable: true,
      retryAfterMs: 1000,
    };
  }

  // Handle errors with codes
  if (error && typeof error === 'object' && 'code' in error) {
    const errorCode = String((error as { code: unknown }).code);
    const mapping = getErrorMapping(errorCode);
    
    return {
      code: mapping.code,
      message: mapping.message,
      requestId,
      retryable: mapping.retryable,
    };
  }

  // Handle generic errors
  if (error instanceof Error) {
    // Check message for known patterns (but don't expose the actual message)
    const msg = error.message.toLowerCase();
    
    if (msg.includes('timeout')) {
      const mapping = getErrorMapping('PIPELINE_TIMEOUT');
      return {
        code: mapping.code,
        message: mapping.message,
        requestId,
        retryable: mapping.retryable,
      };
    }
    if (msg.includes('unauthorized') || msg.includes('authentication')) {
      const mapping = getErrorMapping('UNAUTHORIZED');
      return {
        code: mapping.code,
        message: mapping.message,
        requestId,
        retryable: mapping.retryable,
      };
    }
    if (msg.includes('veto')) {
      const mapping = getErrorMapping('HARD_VETO');
      return {
        code: mapping.code,
        message: mapping.message,
        requestId,
        retryable: mapping.retryable,
      };
    }
  }

  // Default fallback — never expose internal details
  return {
    code: 'SERVICE_ERROR',
    message: 'An unexpected error occurred',
    requestId,
    retryable: true,
  };
}

/**
 * Log error with full details for debugging.
 * Call this BEFORE sanitizing for client response.
 */
export function logInternalError(
  error: unknown,
  context: {
    requestId?: string;
    userId?: string;
    gateId?: string;
    operation?: string;
  }
): void {
  const errorDetails = {
    timestamp: new Date().toISOString(),
    ...context,
    error: error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack,
    } : String(error),
  };

  // In production, send to logging service
  console.error('[PIPELINE_ERROR]', JSON.stringify(errorDetails));
}

// ─────────────────────────────────────────────────────────────────────────────────
// PIPELINE WRAPPER
// Combines timeout + error handling
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Wrap pipeline execution with timeout and error handling.
 */
export async function executeWithSafety<T>(
  operation: () => Promise<T>,
  context: {
    requestId: string;
    userId?: string;
    gateId?: string;
    timeoutMs?: number;
  }
): Promise<{ success: true; result: T } | { success: false; error: ClientError }> {
  const timeoutMs = context.timeoutMs ?? TIMEOUTS.PIPELINE_TOTAL;

  try {
    const result = await withTimeout(
      operation(),
      timeoutMs,
      context
    );
    return { success: true, result };
  } catch (error) {
    // Log full error internally
    logInternalError(error, context);
    
    // Return sanitized error to client
    const clientError = sanitizeError(error, context.requestId);
    return { success: false, error: clientError };
  }
}
