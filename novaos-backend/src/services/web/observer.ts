// ═══════════════════════════════════════════════════════════════════════════════
// WEB OBSERVER — Observability Without PII Leakage
// ═══════════════════════════════════════════════════════════════════════════════

import { loadConfig } from '../../config/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface WebEvent {
  type: 'fetch' | 'verification' | 'dns' | 'error';
  timestamp: number;
  duration: number;
  domain: string;           // Domain only, not full URL
  success: boolean;
  statusCode?: number;
  errorType?: string;       // Categorized error, not raw message
  cached?: boolean;
  metadata?: {
    redirectCount?: number;
    contentSizeCategory?: 'small' | 'medium' | 'large';  // Not exact size
    trustLevel?: string;
  };
}

export interface WebMetrics {
  // Counters
  totalFetches: number;
  successfulFetches: number;
  failedFetches: number;
  cacheHits: number;
  cacheMisses: number;
  
  // By category
  errorsByType: Record<string, number>;
  fetchesByDomain: Record<string, number>;  // Top-level domain only
  
  // Timing
  avgFetchDurationMs: number;
  maxFetchDurationMs: number;
  p95FetchDurationMs: number;
  
  // Verification
  verificationsAttempted: number;
  verificationsSuccessful: number;
  verificationStatuses: Record<string, number>;
  
  // Security
  ssrfBlockedCount: number;
  redirectBlockedCount: number;
  
  // Period
  windowStartTime: number;
  windowDurationMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// PII REDACTION
// ─────────────────────────────────────────────────────────────────────────────────

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Return only protocol + host, no path/query
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '[invalid-url]';
  }
}

function extractTopLevelDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    const parts = hostname.split('.');
    // Return last two parts (e.g., example.com)
    if (parts.length >= 2) {
      return parts.slice(-2).join('.');
    }
    return hostname;
  } catch {
    return 'unknown';
  }
}

function categorizeSize(bytes: number): 'small' | 'medium' | 'large' {
  if (bytes < 10000) return 'small';
  if (bytes < 100000) return 'medium';
  return 'large';
}

function categorizeError(error: string): string {
  const lower = error.toLowerCase();
  
  if (lower.includes('timeout')) return 'timeout';
  if (lower.includes('dns')) return 'dns_error';
  if (lower.includes('ssrf') || lower.includes('private ip')) return 'ssrf_blocked';
  if (lower.includes('redirect')) return 'redirect_error';
  if (lower.includes('certificate') || lower.includes('ssl')) return 'ssl_error';
  if (lower.includes('blocked')) return 'blocked';
  if (lower.includes('not found')) return 'not_found';
  if (lower.includes('allowlist')) return 'not_allowed';
  
  return 'other';
}

// ─────────────────────────────────────────────────────────────────────────────────
// WEB OBSERVER
// ─────────────────────────────────────────────────────────────────────────────────

export class WebObserver {
  private events: WebEvent[] = [];
  private maxEvents: number = 10000;
  private windowStartTime: number = Date.now();
  private fetchDurations: number[] = [];
  
  // Counters
  private totalFetches = 0;
  private successfulFetches = 0;
  private failedFetches = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private ssrfBlockedCount = 0;
  private redirectBlockedCount = 0;
  private verificationsAttempted = 0;
  private verificationsSuccessful = 0;
  
  // Maps
  private errorsByType = new Map<string, number>();
  private fetchesByDomain = new Map<string, number>();
  private verificationStatuses = new Map<string, number>();
  
  // ─────────────────────────────────────────────────────────────────────────────
  // EVENT RECORDING
  // ─────────────────────────────────────────────────────────────────────────────
  
  recordFetch(
    url: string,
    success: boolean,
    durationMs: number,
    options?: {
      statusCode?: number;
      error?: string;
      redirectCount?: number;
      contentSize?: number;
    }
  ): void {
    const config = loadConfig();
    const domain = extractTopLevelDomain(url);
    
    this.totalFetches++;
    if (success) {
      this.successfulFetches++;
    } else {
      this.failedFetches++;
      
      if (options?.error) {
        const errorType = categorizeError(options.error);
        this.errorsByType.set(errorType, (this.errorsByType.get(errorType) ?? 0) + 1);
        
        if (errorType === 'ssrf_blocked') {
          this.ssrfBlockedCount++;
        }
        if (errorType === 'redirect_error') {
          this.redirectBlockedCount++;
        }
      }
    }
    
    // Track by domain
    this.fetchesByDomain.set(domain, (this.fetchesByDomain.get(domain) ?? 0) + 1);
    
    // Track timing
    this.fetchDurations.push(durationMs);
    if (this.fetchDurations.length > 1000) {
      this.fetchDurations.shift();
    }
    
    // Record event (redacted)
    const event: WebEvent = {
      type: 'fetch',
      timestamp: Date.now(),
      duration: durationMs,
      domain: config.features.redactPII ? domain : redactUrl(url),
      success,
      statusCode: options?.statusCode,
      errorType: options?.error ? categorizeError(options.error) : undefined,
      metadata: {
        redirectCount: options?.redirectCount,
        contentSizeCategory: options?.contentSize ? categorizeSize(options.contentSize) : undefined,
      },
    };
    
    this.addEvent(event);
    
    // Log if debug mode
    if (config.features.debugMode) {
      console.log('[WEB_FETCH]', JSON.stringify(event));
    }
  }
  
  recordVerification(
    status: string,
    success: boolean,
    durationMs: number,
    cached: boolean,
    options?: {
      sourcesChecked?: number;
      trustLevel?: string;
    }
  ): void {
    const config = loadConfig();
    
    this.verificationsAttempted++;
    if (success) {
      this.verificationsSuccessful++;
    }
    
    if (cached) {
      this.cacheHits++;
    } else {
      this.cacheMisses++;
    }
    
    this.verificationStatuses.set(status, (this.verificationStatuses.get(status) ?? 0) + 1);
    
    const event: WebEvent = {
      type: 'verification',
      timestamp: Date.now(),
      duration: durationMs,
      domain: '[verification]',
      success,
      cached,
      metadata: {
        trustLevel: options?.trustLevel,
      },
    };
    
    this.addEvent(event);
    
    if (config.features.debugMode) {
      console.log('[WEB_VERIFY]', JSON.stringify(event));
    }
  }
  
  recordDnsResolution(
    hostname: string,
    success: boolean,
    durationMs: number,
    error?: string
  ): void {
    const config = loadConfig();
    const domain = extractTopLevelDomain(`https://${hostname}`);
    
    const event: WebEvent = {
      type: 'dns',
      timestamp: Date.now(),
      duration: durationMs,
      domain: config.features.redactPII ? domain : hostname,
      success,
      errorType: error ? categorizeError(error) : undefined,
    };
    
    this.addEvent(event);
  }
  
  recordError(
    type: string,
    domain: string,
    error: string
  ): void {
    const config = loadConfig();
    const tld = extractTopLevelDomain(`https://${domain}`);
    const errorType = categorizeError(error);
    
    this.errorsByType.set(errorType, (this.errorsByType.get(errorType) ?? 0) + 1);
    
    const event: WebEvent = {
      type: 'error',
      timestamp: Date.now(),
      duration: 0,
      domain: config.features.redactPII ? tld : domain,
      success: false,
      errorType,
    };
    
    this.addEvent(event);
    
    if (config.features.debugMode) {
      console.log('[WEB_ERROR]', JSON.stringify(event));
    }
  }
  
  private addEvent(event: WebEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // METRICS RETRIEVAL
  // ─────────────────────────────────────────────────────────────────────────────
  
  getMetrics(): WebMetrics {
    const sorted = [...this.fetchDurations].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    
    return {
      totalFetches: this.totalFetches,
      successfulFetches: this.successfulFetches,
      failedFetches: this.failedFetches,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      
      errorsByType: Object.fromEntries(this.errorsByType),
      fetchesByDomain: Object.fromEntries(
        // Only top 10 domains
        [...this.fetchesByDomain.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
      ),
      
      avgFetchDurationMs: sorted.length > 0 
        ? sorted.reduce((a, b) => a + b, 0) / sorted.length 
        : 0,
      maxFetchDurationMs: sorted.length > 0 ? (sorted[sorted.length - 1] ?? 0) : 0,
      p95FetchDurationMs: sorted.length > 0 ? (sorted[p95Index] ?? 0) : 0,
      
      verificationsAttempted: this.verificationsAttempted,
      verificationsSuccessful: this.verificationsSuccessful,
      verificationStatuses: Object.fromEntries(this.verificationStatuses),
      
      ssrfBlockedCount: this.ssrfBlockedCount,
      redirectBlockedCount: this.redirectBlockedCount,
      
      windowStartTime: this.windowStartTime,
      windowDurationMs: Date.now() - this.windowStartTime,
    };
  }
  
  getRecentEvents(limit: number = 100): WebEvent[] {
    return this.events.slice(-limit);
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // RESET
  // ─────────────────────────────────────────────────────────────────────────────
  
  reset(): void {
    this.events = [];
    this.fetchDurations = [];
    this.windowStartTime = Date.now();
    this.totalFetches = 0;
    this.successfulFetches = 0;
    this.failedFetches = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.ssrfBlockedCount = 0;
    this.redirectBlockedCount = 0;
    this.verificationsAttempted = 0;
    this.verificationsSuccessful = 0;
    this.errorsByType.clear();
    this.fetchesByDomain.clear();
    this.verificationStatuses.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let webObserver: WebObserver | null = null;

export function getWebObserver(): WebObserver {
  if (!webObserver) {
    webObserver = new WebObserver();
  }
  return webObserver;
}
