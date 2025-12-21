// ═══════════════════════════════════════════════════════════════════════════════
// SSRF GUARD — Core Orchestrator
// NovaOS Security — Phase 5: SSRF Protection Layer
// ═══════════════════════════════════════════════════════════════════════════════
//
// This is the main entry point for SSRF protection. It orchestrates:
// 1. URL parsing and validation
// 2. Policy enforcement (port, hostname, encoding checks)
// 3. DNS resolution with IP validation
// 4. Certificate pinning coordination
// 5. Production of SSRFDecision with TransportRequirements
//
// The SSRFDecision is the SINGLE SOURCE OF TRUTH for the transport layer.
// It tells the transport exactly which IP to connect to, preventing DNS rebinding.
//
// ═══════════════════════════════════════════════════════════════════════════════

import {
  type SSRFDecision,
  type SSRFCheck,
  type SSRFGuardConfig,
  type TransportRequirements,
  type ParsedURL,
  type SPKIPin,
  createAllowedDecision,
  createDeniedDecision,
  createCheck,
  SCHEME_DEFAULT_PORTS,
  SUPPORTED_SCHEMES,
} from './types.js';
import { parseURL, buildRequestPath } from './url-parser.js';
import { validateIP } from './ip-validator.js';
import { createDNSResolver, type DNSResolver, type DNSResolverConfig } from './dns-resolver.js';
import { createPolicyChecker, type PolicyChecker, type PolicyConfig } from './policy.js';
import { getPinStore, type CertificatePinStore } from './cert-pinning.js';
import { getLogger } from '../../observability/logging/index.js';
import { incCounter, observeHistogram } from '../../observability/metrics/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'ssrf-guard' });

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * SSRF Guard configuration.
 */
export interface SSRFGuardOptions {
  /** Allowed ports (empty = all allowed) */
  readonly allowedPorts?: readonly number[];
  
  /** Blocked hostname patterns */
  readonly blockedDomains?: readonly string[];
  
  /** Allowed hostname patterns (empty = all except blocked) */
  readonly allowedDomains?: readonly string[];
  
  /** DNS resolution timeout in milliseconds */
  readonly dnsTimeoutMs?: number;
  
  /** Request timeout in milliseconds */
  readonly requestTimeoutMs?: number;
  
  /** Maximum response size in bytes */
  readonly maxResponseBytes?: number;
  
  /** Maximum redirects to follow */
  readonly maxRedirects?: number;
  
  /** Whether to allow private IPs */
  readonly allowPrivateIps?: boolean;
  
  /** Whether to allow localhost */
  readonly allowLocalhost?: boolean;
  
  /** Whether to validate TLS certificates */
  readonly validateCerts?: boolean;
  
  /** Whether to prevent DNS rebinding attacks */
  readonly preventDnsRebinding?: boolean;
  
  /** Whether to allow userinfo in URLs */
  readonly allowUserinfo?: boolean;
  
  /** Whether to block alternate IP encodings */
  readonly blockAlternateEncodings?: boolean;
  
  /** Whether to block embedded IPs in hostnames */
  readonly blockEmbeddedIPs?: boolean;
  
  /** Custom certificate pin store */
  readonly pinStore?: CertificatePinStore;
  
  /** Custom DNS resolver */
  readonly dnsResolver?: DNSResolver;
  
  /** Custom policy checker */
  readonly policyChecker?: PolicyChecker;
}

/**
 * Default SSRF Guard options.
 */
export const DEFAULT_SSRF_GUARD_OPTIONS: Required<Omit<SSRFGuardOptions, 'pinStore' | 'dnsResolver' | 'policyChecker'>> = {
  allowedPorts: [80, 443],
  blockedDomains: [],
  allowedDomains: [],
  dnsTimeoutMs: 3000,
  requestTimeoutMs: 30000,
  maxResponseBytes: 10 * 1024 * 1024, // 10MB
  maxRedirects: 5,
  allowPrivateIps: false,
  allowLocalhost: false,
  validateCerts: true,
  preventDnsRebinding: true,
  allowUserinfo: false,
  blockAlternateEncodings: true,
  blockEmbeddedIPs: true,
};

// ─────────────────────────────────────────────────────────────────────────────────
// SSRF GUARD CLASS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * SSRF Guard — The core orchestrator for SSRF protection.
 * 
 * Usage:
 * ```typescript
 * const guard = new SSRFGuard();
 * const decision = await guard.check('https://example.com/api');
 * 
 * if (decision.allowed) {
 *   // Use decision.transport to make the request
 *   const { connectToIP, port, hostname } = decision.transport;
 * } else {
 *   console.error(`Blocked: ${decision.reason}`);
 * }
 * ```
 */
export class SSRFGuard {
  private readonly options: Required<Omit<SSRFGuardOptions, 'pinStore' | 'dnsResolver' | 'policyChecker'>>;
  private readonly dnsResolver: DNSResolver;
  private readonly policyChecker: PolicyChecker;
  private readonly pinStore: CertificatePinStore;
  
  constructor(options: SSRFGuardOptions = {}) {
    this.options = { ...DEFAULT_SSRF_GUARD_OPTIONS, ...options };
    
    // Initialize DNS resolver
    this.dnsResolver = options.dnsResolver ?? createDNSResolver({
      timeoutMs: this.options.dnsTimeoutMs,
    });
    
    // Initialize policy checker
    this.policyChecker = options.policyChecker ?? createPolicyChecker({
      allowedPorts: [...this.options.allowedPorts],
      blockedDomains: [...this.options.blockedDomains],
      allowedDomains: [...this.options.allowedDomains],
      allowPrivateIPs: this.options.allowPrivateIps,
      allowLocalhost: this.options.allowLocalhost,
      allowUserinfo: this.options.allowUserinfo,
      blockAlternateEncodings: this.options.blockAlternateEncodings,
      blockEmbeddedIPs: this.options.blockEmbeddedIPs,
    });
    
    // Initialize pin store
    this.pinStore = options.pinStore ?? getPinStore();
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Check a URL for SSRF vulnerabilities.
   * 
   * This is the main entry point. It performs all checks and returns
   * an SSRFDecision that tells the transport layer exactly what to do.
   * 
   * @param url - The URL to check
   * @param requestId - Optional request ID for correlation
   * @returns SSRFDecision with transport requirements if allowed
   */
  async check(url: string, requestId?: string): Promise<SSRFDecision> {
    const startTime = Date.now();
    const checks: SSRFCheck[] = [];
    
    const correlationId = requestId ?? this.generateRequestId();
    
    logger.debug('Starting SSRF check', { url, requestId: correlationId });
    
    try {
      // Step 1: Parse URL
      const parseResult = parseURL(url);
      
      if (!parseResult.success) {
        checks.push(createCheck('URL_PARSE', false, parseResult.error));
        return this.deny('INVALID_URL', parseResult.error, checks, startTime, correlationId);
      }
      
      const parsed = parseResult.url;
      checks.push(createCheck('URL_PARSE', true, 'URL parsed successfully'));
      
      // Step 2: Check scheme
      const schemeCheck = this.checkScheme(parsed.scheme);
      checks.push(schemeCheck);
      
      if (!schemeCheck.passed) {
        return this.deny('UNSUPPORTED_SCHEME', schemeCheck.details ?? 'Unsupported scheme', checks, startTime, correlationId);
      }
      
      // Step 3: Apply policy checks
      const policyResult = this.policyChecker.check(parsed);
      checks.push(...policyResult.checks);
      
      if (!policyResult.allowed) {
        return this.deny(
          policyResult.reason ?? 'HOSTNAME_BLOCKED',
          policyResult.message ?? 'Policy check failed',
          checks,
          startTime,
          correlationId
        );
      }
      
      // Step 4: Resolve DNS (if not already an IP)
      let connectToIP: string;
      
      if (parsed.isIPLiteral) {
        // Already an IP - use it directly
        connectToIP = this.normalizeIP(parsed.hostname);
        checks.push(createCheck('DNS_RESOLUTION', true, 'Using IP literal directly'));
      } else {
        // Resolve hostname
        const dnsResult = await this.dnsResolver.resolve(parsed.hostname);
        
        if (!dnsResult.success) {
          const dnsCheck = createCheck('DNS_RESOLUTION', false, dnsResult.error ?? 'DNS resolution failed');
          checks.push(dnsCheck);
          
          return this.deny(
            dnsResult.error === 'TIMEOUT' ? 'DNS_TIMEOUT' :
            dnsResult.error === 'NXDOMAIN' ? 'DNS_RESOLUTION_FAILED' :
            'DNS_RESOLUTION_FAILED',
            `DNS resolution failed: ${dnsResult.error}`,
            checks,
            startTime,
            correlationId
          );
        }
        
        if (dnsResult.addresses.length === 0) {
          checks.push(createCheck('DNS_RESOLUTION', false, 'No addresses returned'));
          return this.deny('DNS_NO_RECORDS', 'DNS returned no addresses', checks, startTime, correlationId);
        }
        
        checks.push(createCheck(
          'DNS_RESOLUTION',
          true,
          `Resolved to ${dnsResult.addresses.length} addresses`
        ));
        
        // Step 5: Validate resolved IPs
        const validatedIP = await this.validateResolvedIPs(dnsResult.ipv4Addresses, dnsResult.ipv6Addresses, checks);
        
        if (!validatedIP) {
          // Checks were added by validateResolvedIPs
          return this.deny('PRIVATE_IP', 'All resolved IPs are unsafe', checks, startTime, correlationId);
        }
        
        connectToIP = validatedIP;
      }
      
      // Step 6: Build transport requirements
      const transport = this.buildTransportRequirements(parsed, connectToIP);
      
      // Success!
      const decision = createAllowedDecision(checks, transport, Date.now() - startTime, correlationId);
      
      incCounter('ssrf_decisions_total', { result: 'allowed' });
      observeHistogram('ssrf_check_duration_seconds', (Date.now() - startTime) / 1000, { result: 'allowed' });
      
      logger.info('SSRF check passed', {
        url,
        connectToIP,
        requestId: correlationId,
        durationMs: Date.now() - startTime,
      });
      
      return decision;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      logger.error('SSRF check failed with error', {
        url,
        error: errorMessage,
        requestId: correlationId,
      });
      
      checks.push(createCheck('URL_PARSE', false, `Internal error: ${errorMessage}`));
      return this.deny('INTERNAL_ERROR', errorMessage, checks, startTime, correlationId);
    }
  }
  
  /**
   * Check multiple URLs and return decisions for all.
   */
  async checkBatch(urls: string[]): Promise<Map<string, SSRFDecision>> {
    const results = new Map<string, SSRFDecision>();
    
    // Process in parallel with concurrency limit
    const concurrency = 10;
    const chunks: string[][] = [];
    
    for (let i = 0; i < urls.length; i += concurrency) {
      chunks.push(urls.slice(i, i + concurrency));
    }
    
    for (const chunk of chunks) {
      const decisions = await Promise.all(chunk.map(url => this.check(url)));
      
      for (let i = 0; i < chunk.length; i++) {
        results.set(chunk[i]!, decisions[i]!);
      }
    }
    
    return results;
  }
  
  /**
   * Quick check if a URL would be allowed (without full DNS resolution).
   * Useful for pre-filtering URLs before expensive operations.
   */
  quickCheck(url: string): { allowed: boolean; reason?: string } {
    const parseResult = parseURL(url);
    
    if (!parseResult.success) {
      return { allowed: false, reason: parseResult.error };
    }
    
    const parsed = parseResult.url;
    
    // Check scheme
    if (!SUPPORTED_SCHEMES.includes(parsed.scheme as typeof SUPPORTED_SCHEMES[number])) {
      return { allowed: false, reason: `Unsupported scheme: ${parsed.scheme}` };
    }
    
    // Check policy (without DNS)
    const policyResult = this.policyChecker.check(parsed);
    
    if (!policyResult.allowed) {
      return { allowed: false, reason: policyResult.message };
    }
    
    return { allowed: true };
  }
  
  /**
   * Get the current configuration.
   */
  getOptions(): Readonly<typeof this.options> {
    return this.options;
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE METHODS
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Check if scheme is supported.
   */
  private checkScheme(scheme: string): SSRFCheck {
    const normalized = scheme.toLowerCase();
    const supported = SUPPORTED_SCHEMES.includes(normalized as typeof SUPPORTED_SCHEMES[number]);
    
    return createCheck(
      'SCHEME',
      supported,
      supported ? `Scheme ${normalized} is supported` : `Scheme ${normalized} is not supported`
    );
  }
  
  /**
   * Validate resolved IP addresses.
   * Returns the first safe IP, or null if all are unsafe.
   */
  private async validateResolvedIPs(
    ipv4Addresses: string[],
    ipv6Addresses: string[],
    checks: SSRFCheck[]
  ): Promise<string | null> {
    // Prefer IPv4 for compatibility
    const allIPs = [...ipv4Addresses, ...ipv6Addresses];
    
    for (const ip of allIPs) {
      const result = validateIP(ip, {
        allowPrivate: this.options.allowPrivateIps,
        allowLoopback: this.options.allowLocalhost,
      });
      
      if (result.isSafe) {
        checks.push(createCheck(
          'IP_VALIDATION',
          true,
          `IP ${ip} is safe (${result.classification})`
        ));
        return result.normalized;
      }
      
      checks.push(createCheck(
        'IP_VALIDATION',
        false,
        `IP ${ip} is unsafe: ${result.unsafeReason}`
      ));
    }
    
    return null;
  }
  
  /**
   * Normalize an IP address (remove brackets, zone IDs).
   */
  private normalizeIP(hostname: string): string {
    let ip = hostname;
    
    // Remove IPv6 brackets
    if (ip.startsWith('[') && ip.endsWith(']')) {
      ip = ip.slice(1, -1);
    }
    
    // Remove zone ID
    const zoneIndex = ip.indexOf('%');
    if (zoneIndex !== -1) {
      ip = ip.substring(0, zoneIndex);
    }
    
    return ip;
  }
  
  /**
   * Build transport requirements from parsed URL.
   */
  private buildTransportRequirements(parsed: ParsedURL, connectToIP: string): TransportRequirements {
    const useTLS = parsed.scheme === 'https';
    const defaultPort = SCHEME_DEFAULT_PORTS[parsed.scheme] ?? 80;
    const port = parsed.port || defaultPort;
    
    // Get certificate pins for hostname
    const hostnamePins = this.pinStore.getPins(parsed.hostname);
    const certificatePins: SPKIPin[] = hostnamePins ? [...hostnamePins.pins] : [];
    
    if (hostnamePins?.backupPins) {
      certificatePins.push(...hostnamePins.backupPins);
    }
    
    return {
      originalUrl: `${parsed.scheme}://${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}${parsed.path}${parsed.query ? `?${parsed.query}` : ''}`,
      connectToIP,
      port,
      useTLS,
      hostname: parsed.hostname, // For SNI and Host header
      requestPath: buildRequestPath(parsed),
      maxResponseBytes: this.options.maxResponseBytes,
      connectionTimeoutMs: this.options.requestTimeoutMs,
      readTimeoutMs: this.options.requestTimeoutMs,
      allowRedirects: this.options.maxRedirects > 0,
      maxRedirects: this.options.maxRedirects,
      certificatePins: certificatePins.length > 0 ? certificatePins : undefined,
    };
  }
  
  /**
   * Create a denial decision.
   */
  private deny(
    reason: Parameters<typeof createDeniedDecision>[0],
    message: string,
    checks: SSRFCheck[],
    startTime: number,
    requestId: string
  ): SSRFDecision {
    incCounter('ssrf_decisions_total', { result: 'denied', reason });
    observeHistogram('ssrf_check_duration_seconds', (Date.now() - startTime) / 1000, { result: 'denied' });
    
    logger.warn('SSRF check denied', {
      reason,
      message,
      requestId,
      durationMs: Date.now() - startTime,
    });
    
    return createDeniedDecision(reason, message, checks, Date.now() - startTime, requestId);
  }
  
  /**
   * Generate a unique request ID.
   */
  private generateRequestId(): string {
    return `ssrf-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON INSTANCE
// ─────────────────────────────────────────────────────────────────────────────────

let guardInstance: SSRFGuard | null = null;

/**
 * Get or create the global SSRF guard.
 */
export function getSSRFGuard(options?: SSRFGuardOptions): SSRFGuard {
  if (!guardInstance) {
    guardInstance = new SSRFGuard(options);
  }
  return guardInstance;
}

/**
 * Create a new SSRF guard with custom options.
 */
export function createSSRFGuard(options?: SSRFGuardOptions): SSRFGuard {
  return new SSRFGuard(options);
}

/**
 * Reset the global SSRF guard (for testing).
 */
export function resetSSRFGuard(): void {
  guardInstance = null;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONVENIENCE FUNCTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Check a URL using the global guard.
 * 
 * @param url - The URL to check
 * @returns SSRFDecision
 */
export async function checkURL(url: string): Promise<SSRFDecision> {
  return getSSRFGuard().check(url);
}

/**
 * Quick check a URL using the global guard (no DNS).
 * 
 * @param url - The URL to check
 * @returns Whether the URL would pass initial checks
 */
export function quickCheckURL(url: string): { allowed: boolean; reason?: string } {
  return getSSRFGuard().quickCheck(url);
}
