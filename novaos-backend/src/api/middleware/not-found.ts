// ═══════════════════════════════════════════════════════════════════════════════
// NOT FOUND MIDDLEWARE — 404 Handler for Unmatched Routes
// NovaOS API Layer — Phase 14
// ═══════════════════════════════════════════════════════════════════════════════

import type { Request, Response, NextFunction } from 'express';
import { getLogger } from '../../logging/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'api-not-found' });

// ─────────────────────────────────────────────────────────────────────────────────
// RESPONSE FORMAT
// ─────────────────────────────────────────────────────────────────────────────────

interface NotFoundResponse {
  readonly error: string;
  readonly code: 'NOT_FOUND';
  readonly path: string;
  readonly method: string;
  readonly requestId?: string;
  readonly timestamp: string;
  readonly suggestion?: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// ROUTE SUGGESTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Known API route prefixes for suggestions.
 */
const KNOWN_PREFIXES = [
  '/api/v1/goals',
  '/api/v1/quests',
  '/api/v1/steps',
  '/api/v1/sparks',
  '/api/v1/reminders',
  '/api/v1/path',
  '/api/v1/today',
  '/api/v1/progress',
  '/api/v1/me',
  '/health',
];

/**
 * Find a suggestion for a mistyped route.
 */
function findSuggestion(path: string): string | undefined {
  const lowerPath = path.toLowerCase();
  
  // Check for common typos
  for (const prefix of KNOWN_PREFIXES) {
    // Exact prefix match without trailing segment
    if (lowerPath.startsWith(prefix.toLowerCase())) {
      return undefined; // Valid prefix, no suggestion needed
    }
    
    // Check for similar prefixes (1-2 char difference)
    const similarity = calculateSimilarity(lowerPath.split('/').slice(0, 4).join('/'), prefix);
    if (similarity > 0.8) {
      return `Did you mean ${prefix}?`;
    }
  }
  
  // Check for missing /api/v1 prefix
  if (!lowerPath.startsWith('/api/') && !lowerPath.startsWith('/health')) {
    const withPrefix = `/api/v1${path}`;
    for (const prefix of KNOWN_PREFIXES) {
      if (withPrefix.toLowerCase().startsWith(prefix.toLowerCase())) {
        return `Did you mean ${withPrefix}?`;
      }
    }
  }
  
  return undefined;
}

/**
 * Calculate string similarity (Jaccard index on character bigrams).
 */
function calculateSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  
  const getBigrams = (s: string): Set<string> => {
    const bigrams = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) {
      bigrams.add(s.substring(i, i + 2));
    }
    return bigrams;
  };
  
  const aBigrams = getBigrams(a);
  const bBigrams = getBigrams(b);
  
  let intersection = 0;
  for (const bigram of aBigrams) {
    if (bBigrams.has(bigram)) intersection++;
  }
  
  return intersection / (aBigrams.size + bBigrams.size - intersection);
}

// ─────────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Not found handler middleware.
 * 
 * Register AFTER all routes but BEFORE error handler.
 * 
 * @example
 * app.use('/api', router);
 * app.use(notFound());
 * app.use(errorHandler);
 */
export function notFound() {
  return (req: Request, res: Response, _next: NextFunction): void => {
    const requestId = (req as any).requestId ?? req.headers['x-request-id'] as string;
    
    // Log at debug level (expected behavior, not an error)
    logger.debug('Route not found', {
      path: req.path,
      method: req.method,
      requestId,
      userAgent: req.headers['user-agent'],
    });
    
    const suggestion = findSuggestion(req.path);
    
    const response: NotFoundResponse = {
      error: `Cannot ${req.method} ${req.path}`,
      code: 'NOT_FOUND',
      path: req.path,
      method: req.method,
      requestId,
      timestamp: new Date().toISOString(),
      suggestion,
    };
    
    // Remove undefined fields
    if (!response.requestId) delete (response as any).requestId;
    if (!response.suggestion) delete (response as any).suggestion;
    
    res.status(404).json(response);
  };
}

/**
 * Alias for backward compatibility.
 */
export const notFoundHandler = notFound;
