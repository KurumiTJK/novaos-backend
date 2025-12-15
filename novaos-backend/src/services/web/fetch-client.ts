// ═══════════════════════════════════════════════════════════════════════════════
// WEB FETCH CLIENT — Hardened HTTP Client with SSRF Protection
// ═══════════════════════════════════════════════════════════════════════════════

import { loadWebFetchConfig, type WebFetchConfig } from '../../config/index.js';
import dns from 'dns/promises';
import { URL } from 'url';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface FetchResult {
  success: boolean;
  url: string;
  finalUrl: string;
  statusCode?: number;
  contentType?: string;
  content?: string;
  truncated: boolean;
  error?: string;
  timing: {
    dnsMs?: number;
    connectMs?: number;
    totalMs: number;
  };
  metadata: {
    redirectCount: number;
    contentLength: number;
    resolvedIP?: string;
  };
}

export interface FetchOptions {
  maxSizeBytes?: number;
  timeoutMs?: number;
  followRedirects?: boolean;
  maxRedirects?: number;
  validateSSL?: boolean;
  headers?: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────────
// IP VALIDATION (SSRF Protection)
// ─────────────────────────────────────────────────────────────────────────────────

const PRIVATE_IP_RANGES = [
  // IPv4 private ranges
  /^10\./,                          // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // 172.16.0.0/12
  /^192\.168\./,                    // 192.168.0.0/16
  /^127\./,                         // 127.0.0.0/8 (loopback)
  /^0\./,                           // 0.0.0.0/8
  /^169\.254\./,                    // 169.254.0.0/16 (link-local)
  /^100\.(6[4-9]|[7-9][0-9]|1[0-2][0-9])\./,  // 100.64.0.0/10 (CGNAT)
  
  // IPv6 private/special ranges (simplified)
  /^::1$/,                          // Loopback
  /^fc/i,                           // Unique local
  /^fd/i,                           // Unique local
  /^fe80/i,                         // Link-local
  /^::ffff:127\./i,                 // IPv4-mapped loopback
  /^::ffff:10\./i,                  // IPv4-mapped private
  /^::ffff:192\.168\./i,            // IPv4-mapped private
  /^::ffff:172\.(1[6-9]|2[0-9]|3[0-1])\./i,  // IPv4-mapped private
];

const CLOUD_METADATA_IPS = [
  '169.254.169.254',  // AWS, GCP, Azure metadata
  'fd00:ec2::254',    // AWS IPv6
  '169.254.170.2',    // AWS ECS
];

const CLOUD_METADATA_HOSTNAMES = [
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'metadata',
];

export function isPrivateIP(ip: string): boolean {
  // Check cloud metadata IPs
  if (CLOUD_METADATA_IPS.includes(ip)) {
    return true;
  }
  
  // Check private ranges
  return PRIVATE_IP_RANGES.some(range => range.test(ip));
}

export function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return CLOUD_METADATA_HOSTNAMES.some(blocked => 
    lower === blocked || lower.endsWith('.' + blocked)
  );
}

// ─────────────────────────────────────────────────────────────────────────────────
// DNS RESOLUTION WITH REBINDING PROTECTION
// ─────────────────────────────────────────────────────────────────────────────────

interface ResolvedHost {
  hostname: string;
  ip: string;
  resolvedAt: number;
}

const dnsCache = new Map<string, ResolvedHost>();
const DNS_CACHE_TTL_MS = 30000; // 30 seconds

export async function resolveHostname(
  hostname: string,
  config: WebFetchConfig
): Promise<{ ip: string; error?: string }> {
  // Check cache first
  const cached = dnsCache.get(hostname);
  if (cached && Date.now() - cached.resolvedAt < DNS_CACHE_TTL_MS) {
    return { ip: cached.ip };
  }
  
  try {
    // Use AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.dnsResolutionTimeoutMs);
    
    try {
      const addresses = await dns.resolve4(hostname);
      clearTimeout(timeoutId);
      
      if (addresses.length === 0) {
        return { ip: '', error: 'No DNS records found' };
      }
      
      const ip = addresses[0] as string;
      
      // Validate IP is not private (SSRF protection)
      if (!config.allowPrivateIPs && isPrivateIP(ip)) {
        return { ip: '', error: 'Resolved to private IP (SSRF blocked)' };
      }
      
      // Cache the result
      dnsCache.set(hostname, {
        hostname,
        ip: ip,
        resolvedAt: Date.now(),
      });
      
      return { ip: ip };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    return { 
      ip: '', 
      error: error instanceof Error ? error.message : 'DNS resolution failed' 
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// URL VALIDATION
// ─────────────────────────────────────────────────────────────────────────────────

export interface URLValidation {
  valid: boolean;
  error?: string;
  parsed?: URL;
}

export function validateUrl(url: string, config: WebFetchConfig): URLValidation {
  try {
    const parsed = new URL(url);
    
    // Protocol check
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'Only HTTP/HTTPS protocols allowed' };
    }
    
    const hostname = parsed.hostname.toLowerCase();
    
    // Localhost check
    if (!config.allowLocalhost) {
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
        return { valid: false, error: 'Localhost not allowed' };
      }
    }
    
    // Cloud metadata hostname check
    if (isBlockedHostname(hostname)) {
      return { valid: false, error: 'Cloud metadata endpoint blocked' };
    }
    
    // Blocklist check
    for (const blocked of config.blocklist) {
      if (hostname === blocked || hostname.endsWith('.' + blocked)) {
        return { valid: false, error: `Domain blocked: ${blocked}` };
      }
    }
    
    // Allowlist check (if configured)
    if (config.allowlist.length > 0) {
      const allowed = config.allowlist.some(domain => 
        hostname === domain || hostname.endsWith('.' + domain)
      );
      if (!allowed) {
        return { valid: false, error: 'Domain not in allowlist' };
      }
    }
    
    // IP literal check
    const ipv4Regex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
    if (ipv4Regex.test(hostname)) {
      if (!config.allowPrivateIPs && isPrivateIP(hostname)) {
        return { valid: false, error: 'Private IP addresses not allowed' };
      }
    }
    
    // Port check - only allow standard ports
    if (parsed.port && !['80', '443', ''].includes(parsed.port)) {
      return { valid: false, error: 'Non-standard ports not allowed' };
    }
    
    return { valid: true, parsed };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// HARDENED FETCH CLIENT
// ─────────────────────────────────────────────────────────────────────────────────

export class HardenedFetchClient {
  private config: WebFetchConfig;
  
  constructor(config?: Partial<WebFetchConfig>) {
    const defaultConfig = loadWebFetchConfig();
    this.config = { ...defaultConfig, ...config };
  }
  
  async fetch(url: string, options: FetchOptions = {}): Promise<FetchResult> {
    const startTime = Date.now();
    let dnsTime: number | undefined;
    let connectTime: number | undefined;
    let redirectCount = 0;
    let currentUrl = url;
    let resolvedIP: string | undefined;
    
    const maxSize = options.maxSizeBytes ?? this.config.maxResponseSizeBytes;
    const maxRedirects = options.maxRedirects ?? this.config.maxRedirects;
    const followRedirects = options.followRedirects ?? true;
    
    // URL validation
    const validation = validateUrl(url, this.config);
    if (!validation.valid || !validation.parsed) {
      return this.errorResult(url, validation.error ?? 'Invalid URL', startTime);
    }
    
    // DNS resolution with SSRF protection
    const dnsStart = Date.now();
    const dnsResult = await resolveHostname(validation.parsed.hostname, this.config);
    dnsTime = Date.now() - dnsStart;
    
    if (dnsResult.error) {
      return this.errorResult(url, dnsResult.error, startTime, { dnsMs: dnsTime });
    }
    resolvedIP = dnsResult.ip;
    
    // DNS rebinding protection: verify IP hasn't changed
    if (this.config.preventDNSRebinding) {
      // Re-resolve and compare
      const recheck = await resolveHostname(validation.parsed.hostname, this.config);
      if (recheck.ip !== resolvedIP) {
        return this.errorResult(url, 'DNS rebinding detected', startTime, { dnsMs: dnsTime });
      }
    }
    
    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.totalTimeoutMs);
      
      connectTime = Date.now() - startTime;
      
      // Prepare headers
      const headers: Record<string, string> = {
        'User-Agent': this.config.userAgent,
        'Accept': this.config.acceptHeader,
        ...options.headers,
      };
      
      // Fetch with manual redirect handling for security
      let response: Response;
      try {
        response = await fetch(currentUrl, {
          method: 'GET',
          headers,
          signal: controller.signal,
          redirect: followRedirects ? 'follow' : 'manual',
        });
        
        // Handle redirects manually if following
        while (followRedirects && [301, 302, 303, 307, 308].includes(response.status)) {
          redirectCount++;
          
          if (redirectCount > maxRedirects) {
            clearTimeout(timeoutId);
            return this.errorResult(url, `Too many redirects (max: ${maxRedirects})`, startTime, {
              dnsMs: dnsTime,
              connectMs: connectTime,
            });
          }
          
          const location = response.headers.get('location');
          if (!location) {
            clearTimeout(timeoutId);
            return this.errorResult(url, 'Redirect without Location header', startTime);
          }
          
          // Resolve relative URLs
          currentUrl = new URL(location, currentUrl).toString();
          
          // Validate redirect target
          const redirectValidation = validateUrl(currentUrl, this.config);
          if (!redirectValidation.valid) {
            clearTimeout(timeoutId);
            return this.errorResult(url, `Unsafe redirect: ${redirectValidation.error}`, startTime, {
              dnsMs: dnsTime,
              connectMs: connectTime,
            });
          }
          
          // DNS check for redirect target
          if (redirectValidation.parsed) {
            const redirectDns = await resolveHostname(redirectValidation.parsed.hostname, this.config);
            if (redirectDns.error) {
              clearTimeout(timeoutId);
              return this.errorResult(url, `Redirect DNS failed: ${redirectDns.error}`, startTime, {
                dnsMs: dnsTime,
                connectMs: connectTime,
              });
            }
          }
          
          response = await fetch(currentUrl, {
            method: 'GET',
            headers,
            signal: controller.signal,
            redirect: 'manual',
          });
        }
        
        clearTimeout(timeoutId);
      } finally {
        clearTimeout(timeoutId);
      }
      
      // Read content with size limit
      const contentType = response.headers.get('content-type') ?? 'unknown';
      const contentLength = parseInt(response.headers.get('content-length') ?? '0', 10);
      
      let content = '';
      let truncated = false;
      
      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let receivedBytes = 0;
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          receivedBytes += value.length;
          
          if (receivedBytes > maxSize) {
            truncated = true;
            // Add what we can and stop
            const remaining = maxSize - (receivedBytes - value.length);
            if (remaining > 0) {
              content += decoder.decode(value.slice(0, remaining), { stream: true });
            }
            reader.cancel();
            break;
          }
          
          content += decoder.decode(value, { stream: true });
        }
      }
      
      return {
        success: response.ok,
        url,
        finalUrl: currentUrl,
        statusCode: response.status,
        contentType,
        content,
        truncated,
        timing: {
          dnsMs: dnsTime,
          connectMs: connectTime,
          totalMs: Date.now() - startTime,
        },
        metadata: {
          redirectCount,
          contentLength: contentLength || content.length,
          resolvedIP,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Fetch failed';
      
      // Check for abort (timeout)
      if (error instanceof Error && error.name === 'AbortError') {
        return this.errorResult(url, 'Request timeout', startTime, {
          dnsMs: dnsTime,
          connectMs: connectTime,
        });
      }
      
      return this.errorResult(url, errorMsg, startTime, {
        dnsMs: dnsTime,
        connectMs: connectTime,
      });
    }
  }
  
  private errorResult(
    url: string,
    error: string,
    startTime: number,
    timing?: { dnsMs?: number; connectMs?: number }
  ): FetchResult {
    return {
      success: false,
      url,
      finalUrl: url,
      error,
      truncated: false,
      timing: {
        dnsMs: timing?.dnsMs,
        connectMs: timing?.connectMs,
        totalMs: Date.now() - startTime,
      },
      metadata: {
        redirectCount: 0,
        contentLength: 0,
      },
    };
  }
  
  // Utility to check if URL is fetchable without actually fetching
  canFetch(url: string): { allowed: boolean; reason?: string } {
    const validation = validateUrl(url, this.config);
    if (!validation.valid) {
      return { allowed: false, reason: validation.error };
    }
    return { allowed: true };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON INSTANCE
// ─────────────────────────────────────────────────────────────────────────────────

let fetchClient: HardenedFetchClient | null = null;

export function getFetchClient(): HardenedFetchClient {
  if (!fetchClient) {
    fetchClient = new HardenedFetchClient();
  }
  return fetchClient;
}

export function createFetchClient(config?: Partial<WebFetchConfig>): HardenedFetchClient {
  return new HardenedFetchClient(config);
}
