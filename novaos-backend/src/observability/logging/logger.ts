// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTURED LOGGER — Pino-Based Logging with Context & Redaction
// NovaOS Observability — Phase 3
// ═══════════════════════════════════════════════════════════════════════════════
//
// Production-grade structured logging with:
// - JSON output for production, pretty-print for development
// - Automatic correlation ID injection from AsyncLocalStorage
// - PII redaction
// - Component-based child loggers
// - Request logging helpers
//
// Usage:
//   import { getLogger, logRequest } from './logging/index.js';
//
//   const logger = getLogger({ component: 'auth' });
//   logger.info('User logged in', { userId: '123' });
//
// ═══════════════════════════════════════════════════════════════════════════════

import { getLoggingContext, getRequestId, getCorrelationId } from './context.js';
import { redact, getPinoRedactConfig, type RedactionOptions } from './redaction.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Log levels in order of severity.
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Numeric log level values (Pino-compatible).
 */
export const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/**
 * Logger configuration options.
 */
export interface LoggerConfig {
  /** Minimum log level */
  level?: LogLevel;
  
  /** Enable pretty printing (development) */
  pretty?: boolean;
  
  /** Enable PII redaction */
  redactPII?: boolean;
  
  /** Additional redaction options */
  redactionOptions?: RedactionOptions;
  
  /** Service name for logs */
  serviceName?: string;
  
  /** Environment name */
  environment?: string;
  
  /** Enable timestamp */
  timestamp?: boolean;
  
  /** Custom base context added to all logs */
  base?: Record<string, unknown>;
}

/**
 * Options for creating a child logger.
 */
export interface LoggerOptions {
  /** Component name */
  component?: string;
  
  /** Request ID (auto-injected from context if not provided) */
  requestId?: string;
  
  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * Logger interface matching existing usage patterns.
 */
export interface ILogger {
  trace(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: Error | unknown, context?: Record<string, unknown>): void;
  fatal(message: string, error?: Error | unknown, context?: Record<string, unknown>): void;
  
  /** Create a child logger with additional context */
  child(options: LoggerOptions): ILogger;
  
  /** Check if a level is enabled */
  isLevelEnabled(level: LogLevel): boolean;
  
  /** Log with timing (for backward compatibility) */
  time?(message: string, startTime: number, context?: Record<string, unknown>): void;
}

/**
 * Request log data.
 */
export interface RequestLogData {
  method: string;
  path: string;
  statusCode: number;
  duration: number;
  requestId?: string;
  correlationId?: string;
  userId?: string;
  userAgent?: string;
  ip?: string;
  contentLength?: number;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────────

let globalConfig: LoggerConfig = {
  level: 'info',
  pretty: process.env.NODE_ENV !== 'production',
  redactPII: true,
  serviceName: 'novaos',
  environment: process.env.NODE_ENV ?? 'development',
  timestamp: true,
};

/**
 * Configure the global logger settings.
 */
export function configureLogger(config: Partial<LoggerConfig>): void {
  globalConfig = { ...globalConfig, ...config };
}

/**
 * Get the current logger configuration.
 */
export function getLoggerConfig(): LoggerConfig {
  return { ...globalConfig };
}

/**
 * Get log level from environment or config.
 */
function getEffectiveLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined;
  if (envLevel && envLevel in LOG_LEVELS) {
    return envLevel;
  }
  return globalConfig.level ?? 'info';
}

// ─────────────────────────────────────────────────────────────────────────────────
// FORMATTERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Format timestamp for logs.
 */
function formatTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Format error for logging.
 */
function formatError(error: Error | unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack?.split('\n').slice(0, 10).join('\n'),
      ...(error.cause ? { errorCause: String(error.cause) } : {}),
    };
  }
  
  if (typeof error === 'string') {
    return { errorMessage: error };
  }
  
  return { errorMessage: String(error) };
}

/**
 * Format log entry for output.
 */
function formatLogEntry(
  level: LogLevel,
  message: string,
  context: Record<string, unknown>,
  component?: string
): Record<string, unknown> {
  const requestContext = getLoggingContext();
  
  const entry: Record<string, unknown> = {
    level,
    levelNum: LOG_LEVELS[level],
    time: globalConfig.timestamp ? formatTimestamp() : undefined,
    msg: message,
    ...globalConfig.base,
    service: globalConfig.serviceName,
    env: globalConfig.environment,
    ...(component && { component }),
    ...requestContext,
    ...context,
  };
  
  // Apply redaction if enabled
  if (globalConfig.redactPII) {
    return redact(entry, globalConfig.redactionOptions);
  }
  
  return entry;
}

/**
 * Pretty print a log entry (for development).
 */
function prettyPrint(entry: Record<string, unknown>): string {
  const level = entry.level as LogLevel;
  const time = entry.time as string | undefined;
  const msg = entry.msg as string;
  const component = entry.component as string | undefined;
  const requestId = entry.requestId as string | undefined;
  
  // Color codes
  const colors: Record<LogLevel, string> = {
    trace: '\x1b[90m',  // Gray
    debug: '\x1b[36m',  // Cyan
    info: '\x1b[32m',   // Green
    warn: '\x1b[33m',   // Yellow
    error: '\x1b[31m',  // Red
    fatal: '\x1b[35m',  // Magenta
  };
  const reset = '\x1b[0m';
  const dim = '\x1b[2m';
  
  const color = colors[level] ?? '';
  const levelStr = level.toUpperCase().padEnd(5);
  const timeStr = time ? time.split('T')[1]?.replace('Z', '') ?? '' : '';
  const componentStr = component ? `[${component}]` : '';
  // Include truncated requestId for correlation
  const requestIdStr = requestId ? `[${requestId.slice(0, 8)}]` : '';
  
  // Build context string (excluding standard fields)
  const contextFields = { ...entry };
  delete contextFields.level;
  delete contextFields.levelNum;
  delete contextFields.time;
  delete contextFields.msg;
  delete contextFields.service;
  delete contextFields.env;
  delete contextFields.component;
  delete contextFields.requestId;
  
  let contextStr = '';
  if (Object.keys(contextFields).length > 0) {
    contextStr = ` ${dim}${JSON.stringify(contextFields)}${reset}`;
  }
  
  return `${dim}${timeStr}${reset} ${color}${levelStr}${reset} ${requestIdStr}${componentStr} ${msg}${contextStr}`;
}

// ─────────────────────────────────────────────────────────────────────────────────
// OUTPUT
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Write a log entry to output.
 */
function writeLog(entry: Record<string, unknown>): void {
  const level = entry.level as LogLevel;
  
  if (globalConfig.pretty) {
    const output = prettyPrint(entry);
    
    if (level === 'error' || level === 'fatal') {
      console.error(output);
    } else if (level === 'warn') {
      console.warn(output);
    } else {
      console.log(output);
    }
  } else {
    // JSON output for production
    const json = JSON.stringify(entry);
    
    if (level === 'error' || level === 'fatal') {
      console.error(json);
    } else if (level === 'warn') {
      console.warn(json);
    } else {
      console.log(json);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create a logger instance.
 */
function createLoggerImpl(options: LoggerOptions = {}): ILogger {
  const { component, requestId: optionsRequestId, context: baseContext = {} } = options;
  
  const effectiveLevel = getEffectiveLevel();
  const levelNum = LOG_LEVELS[effectiveLevel];
  
  const log = (level: LogLevel, message: string, context: Record<string, unknown> = {}): void => {
    if (LOG_LEVELS[level] < levelNum) {
      return;
    }
    
    // Include requestId in context if provided in options
    const fullContext = optionsRequestId 
      ? { requestId: optionsRequestId, ...baseContext, ...context }
      : { ...baseContext, ...context };
    
    const entry = formatLogEntry(level, message, fullContext, component);
    writeLog(entry);
  };
  
  const logWithError = (
    level: LogLevel,
    message: string,
    error?: Error | unknown,
    context: Record<string, unknown> = {}
  ): void => {
    if (LOG_LEVELS[level] < levelNum) {
      return;
    }
    
    const errorContext = error ? formatError(error) : {};
    const fullContext = optionsRequestId 
      ? { requestId: optionsRequestId, ...baseContext, ...context, ...errorContext }
      : { ...baseContext, ...context, ...errorContext };
    
    const entry = formatLogEntry(level, message, fullContext, component);
    writeLog(entry);
  };
  
  return {
    trace: (message, context) => log('trace', message, context),
    debug: (message, context) => log('debug', message, context),
    info: (message, context) => log('info', message, context),
    warn: (message, context) => log('warn', message, context),
    error: (message, error, context) => logWithError('error', message, error, context),
    fatal: (message, error, context) => logWithError('fatal', message, error, context),
    
    child: (childOptions: LoggerOptions): ILogger => {
      return createLoggerImpl({
        component: childOptions.component ?? component,
        requestId: childOptions.requestId ?? optionsRequestId,
        context: { ...baseContext, ...childOptions.context },
      });
    },
    
    isLevelEnabled: (level: LogLevel): boolean => {
      return LOG_LEVELS[level] >= levelNum;
    },
    
    // Backward compatibility: time method
    time: (message: string, startTime: number, context?: Record<string, unknown>): void => {
      const duration = Date.now() - startTime;
      log('info', message, { ...context, durationMs: duration });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER CLASS — Backward Compatible
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Logger class for backward compatibility with `new Logger()` usage.
 * Wraps the functional logger implementation.
 */
export class Logger implements ILogger {
  private impl: ILogger;
  
  constructor(options: LoggerOptions = {}) {
    this.impl = createLoggerImpl(options);
  }
  
  trace(message: string, context?: Record<string, unknown>): void {
    this.impl.trace(message, context);
  }
  
  debug(message: string, context?: Record<string, unknown>): void {
    this.impl.debug(message, context);
  }
  
  info(message: string, context?: Record<string, unknown>): void {
    this.impl.info(message, context);
  }
  
  warn(message: string, context?: Record<string, unknown>): void {
    this.impl.warn(message, context);
  }
  
  error(message: string, error?: Error | unknown, context?: Record<string, unknown>): void {
    this.impl.error(message, error, context);
  }
  
  fatal(message: string, error?: Error | unknown, context?: Record<string, unknown>): void {
    this.impl.fatal(message, error, context);
  }
  
  child(options: LoggerOptions): Logger {
    const childLogger = new Logger();
    childLogger.impl = this.impl.child(options);
    return childLogger;
  }
  
  isLevelEnabled(level: LogLevel): boolean {
    return this.impl.isLevelEnabled(level);
  }
  
  /**
   * Log with timing information.
   */
  time(message: string, startTime: number, context?: Record<string, unknown>): void {
    if (this.impl.time) {
      this.impl.time(message, startTime, context);
    } else {
      const duration = Date.now() - startTime;
      this.impl.info(message, { ...context, durationMs: duration });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Root logger instance.
 */
let rootLogger: ILogger | null = null;

/**
 * Get the root logger or create a child logger.
 */
export function getLogger(options?: LoggerOptions): ILogger {
  if (!rootLogger) {
    rootLogger = createLoggerImpl();
  }
  
  if (options) {
    return rootLogger.child(options);
  }
  
  return rootLogger;
}

/**
 * Reset the root logger (for testing).
 */
export function resetLogger(): void {
  rootLogger = null;
}

// ─────────────────────────────────────────────────────────────────────────────────
// PRE-CREATED COMPONENT LOGGERS — Backward Compatible
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Pre-created component-specific loggers for convenience.
 * Usage: import { loggers } from './logging/index.js';
 *        loggers.http.info('Request received');
 */
export const loggers = {
  get http(): ILogger { return getLogger({ component: 'http' }); },
  get auth(): ILogger { return getLogger({ component: 'auth' }); },
  get pipeline(): ILogger { return getLogger({ component: 'pipeline' }); },
  get storage(): ILogger { return getLogger({ component: 'storage' }); },
  get verification(): ILogger { return getLogger({ component: 'verification' }); },
  get web(): ILogger { return getLogger({ component: 'web' }); },
  get security(): ILogger { return getLogger({ component: 'security' }); },
  get perf(): ILogger { return getLogger({ component: 'perf' }); },
  get llm(): ILogger { return getLogger({ component: 'llm' }); },
  get db(): ILogger { return getLogger({ component: 'db' }); },
};

// ─────────────────────────────────────────────────────────────────────────────────
// REQUEST LOGGING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Log an HTTP request.
 */
export function logRequest(data: RequestLogData): void {
  const logger = getLogger({ component: 'http' });
  
  const context: Record<string, unknown> = {
    method: data.method,
    path: data.path,
    statusCode: data.statusCode,
    duration: data.duration,
    durationMs: `${data.duration}ms`,
  };
  
  if (data.requestId) context.requestId = data.requestId;
  if (data.correlationId) context.correlationId = data.correlationId;
  if (data.userId) context.userId = data.userId;
  if (data.userAgent) context.userAgent = data.userAgent;
  if (data.ip) context.ip = data.ip;
  if (data.contentLength) context.contentLength = data.contentLength;
  if (data.error) context.error = data.error;
  
  // Determine log level based on status code
  if (data.statusCode >= 500) {
    logger.error(`${data.method} ${data.path} ${data.statusCode}`, undefined, context);
  } else if (data.statusCode >= 400) {
    logger.warn(`${data.method} ${data.path} ${data.statusCode}`, context);
  } else {
    logger.info(`${data.method} ${data.path} ${data.statusCode}`, context);
  }
}

/**
 * Log request start (for debugging).
 */
export function logRequestStart(method: string, path: string): void {
  const logger = getLogger({ component: 'http' });
  
  if (!logger.isLevelEnabled('debug')) {
    return;
  }
  
  logger.debug(`→ ${method} ${path}`, {
    requestId: getRequestId(),
    correlationId: getCorrelationId(),
  });
}

/**
 * Log request end (for debugging).
 */
export function logRequestEnd(method: string, path: string, statusCode: number, durationMs: number): void {
  const logger = getLogger({ component: 'http' });
  
  if (!logger.isLevelEnabled('debug')) {
    return;
  }
  
  logger.debug(`← ${method} ${path} ${statusCode} (${durationMs}ms)`, {
    requestId: getRequestId(),
    statusCode,
    durationMs,
  });
}

// ─────────────────────────────────────────────────────────────────────────────────
// SPECIALIZED LOGGERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create a security audit logger.
 */
export function getSecurityLogger(): ILogger {
  return getLogger({ component: 'security' });
}

/**
 * Create a performance logger.
 */
export function getPerformanceLogger(): ILogger {
  return getLogger({ component: 'perf' });
}

/**
 * Create an LLM logger.
 */
export function getLLMLogger(): ILogger {
  return getLogger({ component: 'llm' });
}

/**
 * Create a database logger.
 */
export function getDBLogger(): ILogger {
  return getLogger({ component: 'db' });
}

// ─────────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Measure and log execution time.
 */
export async function withTiming<T>(
  name: string,
  fn: () => Promise<T>,
  logger?: ILogger
): Promise<T> {
  const log = logger ?? getLogger({ component: 'perf' });
  const start = performance.now();
  
  try {
    const result = await fn();
    const duration = performance.now() - start;
    
    log.debug(`${name} completed`, { durationMs: duration.toFixed(2) });
    
    return result;
  } catch (error) {
    const duration = performance.now() - start;
    
    log.error(`${name} failed`, error, { durationMs: duration.toFixed(2) });
    
    throw error;
  }
}

/**
 * Log and rethrow an error.
 */
export function logAndThrow(message: string, error: Error, context?: Record<string, unknown>): never {
  const logger = getLogger();
  logger.error(message, error, context);
  throw error;
}

/**
 * Create a scoped logger that includes timing.
 */
export function createScopedLogger(scope: string): ILogger & { elapsed: () => number } {
  const start = performance.now();
  const logger = getLogger({ component: scope });
  
  return {
    ...logger,
    elapsed: () => performance.now() - start,
  };
}
