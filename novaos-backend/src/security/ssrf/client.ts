// ═══════════════════════════════════════════════════════════════════════════════
// REDIRECT GUARD & SSRF-SAFE CLIENT
// NovaOS Security — Phase 5: SSRF Protection Layer
// ═══════════════════════════════════════════════════════════════════════════════
//
// This module provides:
// 1. RedirectGuard — Safely follows HTTP redirects with SSRF checks at each hop
// 2. SSRFSafeClient — High-level client combining guard + transport + redirects
//
// CRITICAL: Every redirect is validated through SSRFGuard before following.
// This prevents redirect-based SSRF attacks.
//
// ═══════════════════════════════════════════════════════════════════════════════

import {
  type SSRFDecision,
  type RedirectHop,
  type RedirectChainResult,
  type RedirectChainError,
  isAllowed,
} from './types.js';
import { SSRFGuard, createSSRFGuard, type SSRFGuardOptions } from './guard.js';
import {
  SecureTransport,
  createSecureTransport,
  type TransportResponse,
  type TransportRequestOptions,
  TransportError,
} from './transport.js';
import { getLogger } from '../../observability/logging/index.js';
import { incCounter, observeHistogram } from '../../observability/metrics/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'redirect-guard' });

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Redirect guard configuration.
 */
export interface RedirectGuardConfig {
  /** Maximum number of redirects to follow */
  readonly maxRedirects: number;
  
  /** Whether to follow redirects automatically */
  readonly followRedirects: boolean;
  
  /** HTTP status codes considered as redirects */
  readonly redirectCodes: readonly number[];
  
  /** Whether to preserve method on 307/308 redirects */
  readonly preserveMethod: boolean;
  
  /** Whether to preserve body on 307/308 redirects */
  readonly preserveBody: boolean;
}

/**
 * Default redirect configuration.
 */
export const DEFAULT_REDIRECT_CONFIG: RedirectGuardConfig = {
  maxRedirects: 5,
  followRedirects: true,
  redirectCodes: [301, 302, 303, 307, 308],
  preserveMethod: true,
  preserveBody: false, // Usually unsafe to resend body
};

/**
 * Redirect follow options.
 */
export interface RedirectFollowOptions extends TransportRequestOptions {
  /** Maximum redirects for this request (overrides config) */
  readonly maxRedirects?: number;
}

/**
 * Final response with redirect chain info.
 */
export interface RedirectAwareResponse extends TransportResponse {
  /** Redirect chain taken to reach this response */
  readonly redirectChain: readonly RedirectHop[];
  
  /** Number of redirects followed */
  readonly redirectCount: number;
  
  /** Whether any redirects were followed */
  readonly wasRedirected: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────
// REDIRECT STATUS HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Check if a status code is a redirect.
 */
function isRedirectStatus(status: number, codes: readonly number[]): boolean {
  return codes.includes(status);
}

/**
 * Determine if method should be preserved for this redirect.
 */
function shouldPreserveMethod(status: number, preserveMethod: boolean): boolean {
  // 307 and 308 should preserve method per spec
  if (status === 307 || status === 308) {
    return preserveMethod;
  }
  // 301, 302, 303 traditionally change to GET
  return false;
}

/**
 * Resolve a redirect URL relative to the current URL.
 */
function resolveRedirectUrl(currentUrl: string, location: string): string {
  try {
    // Handle absolute URLs
    if (location.startsWith('http://') || location.startsWith('https://')) {
      return location;
    }
    
    // Handle protocol-relative URLs
    if (location.startsWith('//')) {
      const currentProtocol = new URL(currentUrl).protocol;
      return `${currentProtocol}${location}`;
    }
    
    // Handle relative URLs
    return new URL(location, currentUrl).href;
  } catch {
    return location;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// REDIRECT GUARD CLASS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Redirect Guard — Safely follows HTTP redirects with SSRF checks.
 */
export class RedirectGuard {
  private readonly config: RedirectGuardConfig;
  private readonly guard: SSRFGuard;
  private readonly transport: SecureTransport;
  
  constructor(
    config: Partial<RedirectGuardConfig> = {},
    guard?: SSRFGuard,
    transport?: SecureTransport
  ) {
    this.config = { ...DEFAULT_REDIRECT_CONFIG, ...config };
    this.guard = guard ?? createSSRFGuard({ maxRedirects: this.config.maxRedirects });
    this.transport = transport ?? createSecureTransport();
  }
  
  /**
   * Follow redirects from an initial SSRFDecision.
   * 
   * @param initialDecision - The initial allowed SSRFDecision
   * @param options - Request options
   * @returns Redirect chain result
   */
  async followRedirects(
    initialDecision: SSRFDecision,
    options: RedirectFollowOptions = {}
  ): Promise<RedirectChainResult> {
    const startTime = Date.now();
    const hops: RedirectHop[] = [];
    const seenUrls = new Set<string>();
    
    const maxRedirects = options.maxRedirects ?? this.config.maxRedirects;
    
    if (!isAllowed(initialDecision) || !initialDecision.transport) {
      return {
        success: false,
        hops,
        redirectCount: 0,
        totalDurationMs: Date.now() - startTime,
        error: 'INVALID_INITIAL_DECISION',
      };
    }
    
    let currentDecision = initialDecision;
    let currentUrl = initialDecision.transport.originalUrl;
    let currentMethod = options.method ?? 'GET';
    let currentBody = options.body;
    let redirectCount = 0;
    
    seenUrls.add(currentUrl);
    
    while (true) {
      const hopStartTime = Date.now();
      
      try {
        // Make request
        const response = await this.transport.request(currentDecision, {
          ...options,
          method: currentMethod,
          body: currentBody,
        });
        
        // Record hop
        const hop: RedirectHop = {
          hopNumber: redirectCount + 1,
          url: currentUrl,
          statusCode: response.statusCode,
          location: this.getLocationHeader(response.headers),
          connectedIP: response.evidence.connectedIP,
          decision: currentDecision,
          headers: response.headers as Record<string, string>,
          durationMs: Date.now() - hopStartTime,
        };
        hops.push(hop);
        
        // Check if this is a redirect
        if (!isRedirectStatus(response.statusCode, this.config.redirectCodes)) {
          // Not a redirect — we're done
          incCounter('redirect_chains_total', { result: 'success' });
          observeHistogram('redirect_chain_duration_seconds', (Date.now() - startTime) / 1000);
          
          return {
            success: true,
            finalUrl: currentUrl,
            finalDecision: currentDecision,
            hops,
            redirectCount,
            totalDurationMs: Date.now() - startTime,
          };
        }
        
        // It's a redirect — check limits
        redirectCount++;
        
        if (redirectCount > maxRedirects) {
          logger.warn('Too many redirects', { redirectCount, maxRedirects, url: currentUrl });
          
          incCounter('redirect_chains_total', { result: 'too_many_redirects' });
          
          return {
            success: false,
            hops,
            redirectCount,
            totalDurationMs: Date.now() - startTime,
            error: 'TOO_MANY_REDIRECTS',
          };
        }
        
        // Get redirect location
        const location = hop.location;
        
        if (!location) {
          logger.warn('Redirect without Location header', { statusCode: response.statusCode, url: currentUrl });
          
          return {
            success: false,
            hops,
            redirectCount,
            totalDurationMs: Date.now() - startTime,
            error: 'MISSING_LOCATION',
          };
        }
        
        // Resolve the redirect URL
        const nextUrl = resolveRedirectUrl(currentUrl, location);
        
        // Check for redirect loops
        if (seenUrls.has(nextUrl)) {
          logger.warn('Redirect loop detected', { url: nextUrl, chain: Array.from(seenUrls) });
          
          incCounter('redirect_chains_total', { result: 'loop' });
          
          return {
            success: false,
            hops,
            redirectCount,
            totalDurationMs: Date.now() - startTime,
            error: 'REDIRECT_LOOP',
          };
        }
        
        seenUrls.add(nextUrl);
        
        // CRITICAL: Check the redirect URL through SSRF guard
        logger.debug('Checking redirect destination', { from: currentUrl, to: nextUrl });
        
        const nextDecision = await this.guard.check(nextUrl, currentDecision.requestId);
        
        if (!isAllowed(nextDecision)) {
          logger.warn('Redirect destination blocked', {
            url: nextUrl,
            reason: nextDecision.reason,
          });
          
          incCounter('redirect_chains_total', { result: 'blocked_destination' });
          
          // Record the blocked hop
          hops.push({
            hopNumber: redirectCount + 1,
            url: nextUrl,
            statusCode: 0,
            decision: nextDecision,
            durationMs: Date.now() - hopStartTime,
          });
          
          return {
            success: false,
            hops,
            redirectCount,
            totalDurationMs: Date.now() - startTime,
            error: 'REDIRECT_TO_BLOCKED',
          };
        }
        
        // Update for next iteration
        currentUrl = nextUrl;
        currentDecision = nextDecision;
        
        // Handle method changes
        if (!shouldPreserveMethod(response.statusCode, this.config.preserveMethod)) {
          currentMethod = 'GET';
          currentBody = undefined;
        } else if (!this.config.preserveBody) {
          currentBody = undefined;
        }
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        logger.error('Error during redirect chain', {
          url: currentUrl,
          error: errorMessage,
          redirectCount,
        });
        
        incCounter('redirect_chains_total', { result: 'error' });
        
        return {
          success: false,
          hops,
          redirectCount,
          totalDurationMs: Date.now() - startTime,
          error: 'TRANSPORT_ERROR',
        };
      }
    }
  }
  
  /**
   * Get Location header from response headers.
   */
  private getLocationHeader(headers: Record<string, string | string[] | undefined>): string | undefined {
    const location = headers['location'] ?? headers['Location'];
    
    if (Array.isArray(location)) {
      return location[0];
    }
    
    return location;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SSRF-SAFE CLIENT
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * High-level SSRF-safe HTTP client.
 * 
 * Combines SSRFGuard + SecureTransport + RedirectGuard into a simple API.
 * 
 * Usage:
 * ```typescript
 * const client = new SSRFSafeClient();
 * const response = await client.fetch('https://example.com/api');
 * console.log(response.body.toString());
 * ```
 */
export class SSRFSafeClient {
  private readonly guard: SSRFGuard;
  private readonly transport: SecureTransport;
  private readonly redirectGuard: RedirectGuard;
  private readonly followRedirects: boolean;
  
  constructor(options: SSRFGuardOptions & Partial<RedirectGuardConfig> = {}) {
    this.guard = createSSRFGuard(options);
    this.transport = createSecureTransport();
    this.redirectGuard = new RedirectGuard(
      {
        maxRedirects: options.maxRedirects ?? DEFAULT_REDIRECT_CONFIG.maxRedirects,
        followRedirects: options.followRedirects ?? true,
      },
      this.guard,
      this.transport
    );
    this.followRedirects = options.followRedirects ?? true;
  }
  
  /**
   * Fetch a URL safely.
   * 
   * @param url - The URL to fetch
   * @param options - Request options
   * @returns Response with redirect chain info
   */
  async fetch(
    url: string,
    options: TransportRequestOptions = {}
  ): Promise<RedirectAwareResponse> {
    const startTime = Date.now();
    
    logger.debug('Starting SSRF-safe fetch', { url });
    
    // Check URL through guard
    const decision = await this.guard.check(url);
    
    if (!isAllowed(decision)) {
      throw new TransportError(
        `URL blocked: ${decision.reason} - ${decision.message}`,
        'INVALID_DECISION'
      );
    }
    
    // If following redirects, use redirect guard
    if (this.followRedirects) {
      const result = await this.redirectGuard.followRedirects(decision, options);
      
      if (!result.success) {
        throw new TransportError(
          `Redirect chain failed: ${result.error}`,
          result.error === 'TOO_MANY_REDIRECTS' ? 'PROTOCOL_ERROR' :
          result.error === 'REDIRECT_LOOP' ? 'PROTOCOL_ERROR' :
          result.error === 'REDIRECT_TO_BLOCKED' ? 'INVALID_DECISION' :
          'CONNECTION_FAILED'
        );
      }
      
      // Make final request
      const response = await this.transport.request(result.finalDecision!, options);
      
      return {
        ...response,
        redirectChain: result.hops,
        redirectCount: result.redirectCount,
        wasRedirected: result.redirectCount > 0,
      };
    }
    
    // No redirects — single request
    const response = await this.transport.request(decision, options);
    
    return {
      ...response,
      redirectChain: [],
      redirectCount: 0,
      wasRedirected: false,
    };
  }
  
  /**
   * GET request.
   */
  async get(
    url: string,
    headers?: Record<string, string>
  ): Promise<RedirectAwareResponse> {
    return this.fetch(url, { method: 'GET', headers });
  }
  
  /**
   * POST request.
   */
  async post(
    url: string,
    body: Buffer | string,
    headers?: Record<string, string>
  ): Promise<RedirectAwareResponse> {
    return this.fetch(url, { method: 'POST', body, headers });
  }
  
  /**
   * PUT request.
   */
  async put(
    url: string,
    body: Buffer | string,
    headers?: Record<string, string>
  ): Promise<RedirectAwareResponse> {
    return this.fetch(url, { method: 'PUT', body, headers });
  }
  
  /**
   * DELETE request.
   */
  async delete(
    url: string,
    headers?: Record<string, string>
  ): Promise<RedirectAwareResponse> {
    return this.fetch(url, { method: 'DELETE', headers });
  }
  
  /**
   * HEAD request.
   */
  async head(
    url: string,
    headers?: Record<string, string>
  ): Promise<RedirectAwareResponse> {
    return this.fetch(url, { method: 'HEAD', headers });
  }
  
  /**
   * Quick check if a URL would be allowed.
   */
  quickCheck(url: string): { allowed: boolean; reason?: string } {
    return this.guard.quickCheck(url);
  }
  
  /**
   * Full check a URL (with DNS resolution).
   */
  async check(url: string): Promise<SSRFDecision> {
    return this.guard.check(url);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON INSTANCES
// ─────────────────────────────────────────────────────────────────────────────────

let redirectGuardInstance: RedirectGuard | null = null;
let clientInstance: SSRFSafeClient | null = null;

/**
 * Get or create the global redirect guard.
 */
export function getRedirectGuard(config?: Partial<RedirectGuardConfig>): RedirectGuard {
  if (!redirectGuardInstance) {
    redirectGuardInstance = new RedirectGuard(config);
  }
  return redirectGuardInstance;
}

/**
 * Create a new redirect guard.
 */
export function createRedirectGuard(
  config?: Partial<RedirectGuardConfig>,
  guard?: SSRFGuard,
  transport?: SecureTransport
): RedirectGuard {
  return new RedirectGuard(config, guard, transport);
}

/**
 * Reset the global redirect guard (for testing).
 */
export function resetRedirectGuard(): void {
  redirectGuardInstance = null;
}

/**
 * Get or create the global SSRF-safe client.
 */
export function getSSRFSafeClient(options?: SSRFGuardOptions & Partial<RedirectGuardConfig>): SSRFSafeClient {
  if (!clientInstance) {
    clientInstance = new SSRFSafeClient(options);
  }
  return clientInstance;
}

/**
 * Create a new SSRF-safe client.
 */
export function createSSRFSafeClient(options?: SSRFGuardOptions & Partial<RedirectGuardConfig>): SSRFSafeClient {
  return new SSRFSafeClient(options);
}

/**
 * Reset the global SSRF-safe client (for testing).
 */
export function resetSSRFSafeClient(): void {
  clientInstance = null;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONVENIENCE FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Safely fetch a URL using the global client.
 */
export async function safeFetch(
  url: string,
  options?: TransportRequestOptions
): Promise<RedirectAwareResponse> {
  return getSSRFSafeClient().fetch(url, options);
}

/**
 * Safely GET a URL using the global client.
 */
export async function safeGet(
  url: string,
  headers?: Record<string, string>
): Promise<RedirectAwareResponse> {
  return getSSRFSafeClient().get(url, headers);
}

/**
 * Safely POST to a URL using the global client.
 */
export async function safePost(
  url: string,
  body: Buffer | string,
  headers?: Record<string, string>
): Promise<RedirectAwareResponse> {
  return getSSRFSafeClient().post(url, body, headers);
}

/**
 * Follow redirects from a decision.
 */
export async function followRedirects(
  decision: SSRFDecision,
  options?: RedirectFollowOptions
): Promise<RedirectChainResult> {
  return getRedirectGuard().followRedirects(decision, options);
}
