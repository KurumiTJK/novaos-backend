// ═══════════════════════════════════════════════════════════════════════════════
// LOGGING MODULE INDEX — Structured Logging Exports
// NovaOS Observability — Phase 3
// ═══════════════════════════════════════════════════════════════════════════════
//
// This module provides production-grade structured logging with:
// - Pino-compatible JSON output
// - AsyncLocalStorage context propagation
// - Automatic PII redaction
// - Request correlation IDs
//
// Backward Compatible API:
//   import { Logger, getLogger, loggers } from './logging/index.js';
//
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// CONTEXT
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Types
  type RequestContext,
  type PartialContext,
  
  // ID generation
  generateRequestId,
  generateCorrelationId,
  generateSpanId,
  parseOrGenerateRequestId,
  parseOrGenerateCorrelationId,
  
  // Context management
  createContext,
  runWithContext,
  runWithNewContext,
  getContext,
  requireContext,
  getContextValue,
  
  // Context accessors
  getRequestId,
  getCorrelationId,
  getUserId,
  getSpanId,
  getRequestDuration,
  
  // Context modification
  extendContext,
  runWithChildContext,
  
  // Header propagation
  CONTEXT_HEADERS,
  extractContextFromHeaders,
  createContextHeaders,
  
  // Logging helpers
  getLoggingContext,
  getMinimalLoggingContext,
} from './context.js';

// ─────────────────────────────────────────────────────────────────────────────────
// REDACTION
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Constants
  FULL_REDACT_FIELDS,
  PARTIAL_REDACT_FIELDS,
  REDACTED,
  
  // Types
  type RedactionOptions,
  
  // Main function
  redact,
  
  // Partial redactors
  redactEmail,
  redactPhone,
  redactCreditCard,
  redactSSN,
  
  // Pino integration
  getPinoRedactPaths,
  getPinoRedactConfig,
  
  // Utilities
  shouldRedact,
  redactString$,
  createRedactor,
} from './redaction.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Types
  type LogLevel,
  type LoggerConfig,
  type LoggerOptions,
  type ILogger,
  type RequestLogData,
  
  // Class (for `new Logger()` usage)
  Logger,
  
  // Pre-created component loggers
  loggers,
  
  // Constants
  LOG_LEVELS,
  
  // Configuration
  configureLogger,
  getLoggerConfig,
  
  // Main API
  getLogger,
  resetLogger,
  
  // Request logging
  logRequest,
  logRequestStart,
  logRequestEnd,
  
  // Specialized loggers
  getSecurityLogger,
  getPerformanceLogger,
  getLLMLogger,
  getDBLogger,
  
  // Utilities
  withTiming,
  logAndThrow,
  createScopedLogger,
} from './logger.js';

// ─────────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Types
  type RequestContextMiddlewareOptions,
  type RequestLoggingMiddlewareOptions,
  
  // Middleware
  requestContextMiddleware,
  requestLoggingMiddleware,
  requestMiddleware,
  errorLoggingMiddleware,
  slowRequestMiddleware,
} from './middleware.js';
