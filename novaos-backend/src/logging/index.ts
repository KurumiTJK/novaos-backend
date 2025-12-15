// ═══════════════════════════════════════════════════════════════════════════════
// LOGGING MODULE — Structured Logs with Request Correlation
// ═══════════════════════════════════════════════════════════════════════════════

import { loadConfig } from '../config/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId?: string;
  userId?: string;
  component?: string;
  duration?: number;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface LogContext {
  requestId?: string;
  userId?: string;
  component?: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// PII REDACTION
// ─────────────────────────────────────────────────────────────────────────────────

const PII_PATTERNS = [
  // Email
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL]' },
  // Phone (various formats)
  { pattern: /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, replacement: '[PHONE]' },
  // SSN
  { pattern: /\d{3}-\d{2}-\d{4}/g, replacement: '[SSN]' },
  // Credit card (basic)
  { pattern: /\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}/g, replacement: '[CARD]' },
  // IP addresses (optional - might want to keep for debugging)
  // { pattern: /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, replacement: '[IP]' },
];

function redactPII(text: string): string {
  let result = text;
  for (const { pattern, replacement } of PII_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function redactObject(obj: unknown, depth = 0): unknown {
  if (depth > 5) return '[MAX_DEPTH]';
  
  if (typeof obj === 'string') {
    return redactPII(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => redactObject(item, depth + 1));
  }
  
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Redact sensitive field names
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes('password') || lowerKey.includes('secret') || 
          lowerKey.includes('token') || lowerKey.includes('key') ||
          lowerKey.includes('authorization')) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactObject(value, depth + 1);
      }
    }
    return result;
  }
  
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────────
// LOG LEVELS
// ─────────────────────────────────────────────────────────────────────────────────

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

function shouldLog(level: LogLevel, minLevel: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[minLevel];
}

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER CLASS
// ─────────────────────────────────────────────────────────────────────────────────

export class Logger {
  private context: LogContext;
  private minLevel: LogLevel;
  private redactPII: boolean;
  private jsonFormat: boolean;

  constructor(context: LogContext = {}) {
    this.context = context;
    const config = loadConfig();
    this.minLevel = config.features.debugMode ? 'debug' : 'info';
    this.redactPII = config.features.redactPII;
    this.jsonFormat = config.env.isProduction || config.env.isStaging;
  }

  private formatEntry(level: LogLevel, message: string, extra?: Partial<LogEntry>): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message: this.redactPII ? redactPII(message) : message,
      ...this.context,
      ...extra,
    };

    // Redact metadata if needed
    if (this.redactPII && entry.metadata) {
      entry.metadata = redactObject(entry.metadata) as Record<string, unknown>;
    }

    // Redact error stack in production
    if (this.redactPII && entry.error?.stack) {
      entry.error.stack = undefined;
    }

    return entry;
  }

  private output(entry: LogEntry): void {
    if (this.jsonFormat) {
      // Structured JSON for production log aggregation
      console.log(JSON.stringify(entry));
    } else {
      // Human-readable for development
      const prefix = entry.requestId ? `[${entry.requestId.slice(0, 8)}]` : '';
      const component = entry.component ? `[${entry.component}]` : '';
      const userId = entry.userId ? `(${entry.userId.slice(0, 8)})` : '';
      const duration = entry.duration !== undefined ? ` ${entry.duration}ms` : '';
      
      const levelColors: Record<LogLevel, string> = {
        debug: '\x1b[36m', // cyan
        info: '\x1b[32m',  // green
        warn: '\x1b[33m',  // yellow
        error: '\x1b[31m', // red
        fatal: '\x1b[35m', // magenta
      };
      const reset = '\x1b[0m';
      const color = levelColors[entry.level];
      
      console.log(
        `${entry.timestamp} ${color}${entry.level.toUpperCase().padEnd(5)}${reset} ${prefix}${component}${userId} ${entry.message}${duration}`
      );
      
      if (entry.metadata && Object.keys(entry.metadata).length > 0) {
        console.log('  ', JSON.stringify(entry.metadata));
      }
      
      if (entry.error) {
        console.log(`  Error: ${entry.error.name}: ${entry.error.message}`);
        if (entry.error.stack) {
          console.log('  ', entry.error.stack.split('\n').slice(1, 4).join('\n  '));
        }
      }
    }
  }

  private log(level: LogLevel, message: string, extra?: Partial<LogEntry>): void {
    if (!shouldLog(level, this.minLevel)) return;
    const entry = this.formatEntry(level, message, extra);
    this.output(entry);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────────

  debug(message: string, metadata?: Record<string, unknown>): void {
    this.log('debug', message, { metadata });
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    this.log('info', message, { metadata });
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    this.log('warn', message, { metadata });
  }

  error(message: string, error?: Error, metadata?: Record<string, unknown>): void {
    this.log('error', message, {
      metadata,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : undefined,
    });
  }

  fatal(message: string, error?: Error, metadata?: Record<string, unknown>): void {
    this.log('fatal', message, {
      metadata,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : undefined,
    });
  }

  // Request timing
  time(message: string, startTime: number, metadata?: Record<string, unknown>): void {
    const duration = Date.now() - startTime;
    this.log('info', message, { duration, metadata });
  }

  // Create child logger with additional context
  child(context: Partial<LogContext>): Logger {
    const childLogger = new Logger({ ...this.context, ...context });
    return childLogger;
  }

  // Set context for this logger
  setContext(context: Partial<LogContext>): void {
    Object.assign(this.context, context);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// REQUEST LOGGER (for HTTP requests)
// ─────────────────────────────────────────────────────────────────────────────────

export interface RequestLogData {
  method: string;
  path: string;
  statusCode: number;
  duration: number;
  requestId: string;
  userId?: string;
  userAgent?: string;
  ip?: string;
  error?: Error;
}

export function logRequest(data: RequestLogData): void {
  const logger = new Logger({
    requestId: data.requestId,
    userId: data.userId,
    component: 'http',
  });

  const message = `${data.method} ${data.path} ${data.statusCode}`;
  const metadata = {
    userAgent: data.userAgent,
    duration: data.duration,
  };
  
  if (data.statusCode >= 500) {
    logger.error(message, data.error, metadata);
  } else if (data.statusCode >= 400) {
    logger.warn(message, metadata);
  } else {
    logger.time(message, Date.now() - data.duration, metadata);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON ROOT LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

let rootLogger: Logger | null = null;

export function getLogger(context?: LogContext): Logger {
  if (!rootLogger) {
    rootLogger = new Logger();
  }
  if (context) {
    return rootLogger.child(context);
  }
  return rootLogger;
}

// Component-specific loggers
export const loggers = {
  http: () => getLogger({ component: 'http' }),
  auth: () => getLogger({ component: 'auth' }),
  pipeline: () => getLogger({ component: 'pipeline' }),
  storage: () => getLogger({ component: 'storage' }),
  verification: () => getLogger({ component: 'verification' }),
  web: () => getLogger({ component: 'web' }),
};
