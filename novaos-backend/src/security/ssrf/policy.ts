// ═══════════════════════════════════════════════════════════════════════════════
// POLICY — Port and Hostname Validation
// NovaOS Security — Phase 5: SSRF Protection Layer
// ═══════════════════════════════════════════════════════════════════════════════
//
// This module enforces security policies for:
// - Port restrictions (allowlist)
// - Hostname blocklists (localhost, metadata endpoints, etc.)
// - Hostname allowlists (optional, for strict mode)
// - Embedded IP detection in hostnames
// - Alternate IP encoding detection
//
// ═══════════════════════════════════════════════════════════════════════════════

import {
  type SSRFCheck,
  type SSRFDenyReason,
  type ParsedURL,
  DEFAULT_ALLOWED_PORTS,
  DEFAULT_BLOCKED_DOMAINS,
  SCHEME_DEFAULT_PORTS,
  createCheck,
} from './types.js';
import {
  hostnameMatches,
  detectAlternateEncoding,
  detectEmbeddedIP,
  isIPv4,
  isIPv6,
} from './url-parser.js';
import { validateIP } from './ip-validator.js';
import { getLogger } from '../../observability/logging/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'ssrf-policy' });

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Policy configuration.
 */
export interface PolicyConfig {
  /** Allowed ports (empty = all ports allowed) */
  readonly allowedPorts: readonly number[];
  
  /** Blocked hostname patterns */
  readonly blockedDomains: readonly string[];
  
  /** Allowed hostname patterns (empty = all allowed except blocked) */
  readonly allowedDomains: readonly string[];
  
  /** Whether to allow IP literals in URLs */
  readonly allowIPLiterals: boolean;
  
  /** Whether to allow private IPs */
  readonly allowPrivateIPs: boolean;
  
  /** Whether to allow localhost */
  readonly allowLocalhost: boolean;
  
  /** Whether to allow userinfo in URLs (user:pass@host) */
  readonly allowUserinfo: boolean;
  
  /** Whether to block IDN (internationalized domain names) */
  readonly blockIDN: boolean;
  
  /** Whether to detect and block alternate IP encodings */
  readonly blockAlternateEncodings: boolean;
  
  /** Whether to detect and block embedded IPs in hostnames */
  readonly blockEmbeddedIPs: boolean;
}

/**
 * Default policy configuration.
 */
export const DEFAULT_POLICY_CONFIG: PolicyConfig = {
  allowedPorts: DEFAULT_ALLOWED_PORTS,
  blockedDomains: DEFAULT_BLOCKED_DOMAINS,
  allowedDomains: [], // Empty = all allowed (except blocked)
  allowIPLiterals: true,
  allowPrivateIPs: false,
  allowLocalhost: false,
  allowUserinfo: false,
  blockIDN: false, // IDN is legitimate, but can be used for homograph attacks
  blockAlternateEncodings: true,
  blockEmbeddedIPs: true,
};

/**
 * Policy check result.
 */
export interface PolicyResult {
  /** Whether the URL passes all policy checks */
  readonly allowed: boolean;
  
  /** Reason for denial (if not allowed) */
  readonly reason?: SSRFDenyReason;
  
  /** Human-readable message */
  readonly message?: string;
  
  /** All checks performed */
  readonly checks: readonly SSRFCheck[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// POLICY CHECKER CLASS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Policy enforcement for SSRF protection.
 */
export class PolicyChecker {
  private readonly config: PolicyConfig;
  
  constructor(config: Partial<PolicyConfig> = {}) {
    this.config = { ...DEFAULT_POLICY_CONFIG, ...config };
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Check a parsed URL against all policies.
   * 
   * @param parsed - The parsed URL to check
   * @returns Policy result with all checks
   */
  check(parsed: ParsedURL): PolicyResult {
    const checks: SSRFCheck[] = [];
    
    // Check userinfo (credentials in URL)
    const userinfoCheck = this.checkUserinfo(parsed);
    checks.push(userinfoCheck);
    if (!userinfoCheck.passed) {
      return this.deny('USERINFO_PRESENT', 'Credentials in URL not allowed', checks);
    }
    
    // Check port
    const portCheck = this.checkPort(parsed);
    checks.push(portCheck);
    if (!portCheck.passed) {
      return this.deny('PORT_NOT_ALLOWED', `Port ${parsed.port} is not allowed`, checks);
    }
    
    // Check for alternate IP encodings (before hostname checks)
    if (this.config.blockAlternateEncodings) {
      const encodingCheck = this.checkAlternateEncoding(parsed);
      checks.push(encodingCheck);
      if (!encodingCheck.passed) {
        return this.deny(
          'ALTERNATE_IP_ENCODING',
          `Alternate IP encoding detected: ${encodingCheck.details}`,
          checks
        );
      }
    }
    
    // Check for embedded IPs in hostname
    if (this.config.blockEmbeddedIPs) {
      const embeddedCheck = this.checkEmbeddedIP(parsed);
      checks.push(embeddedCheck);
      if (!embeddedCheck.passed) {
        return this.deny(
          'EMBEDDED_IP_IN_HOSTNAME',
          `Embedded IP pattern detected: ${embeddedCheck.details}`,
          checks
        );
      }
    }
    
    // Check IDN
    if (this.config.blockIDN && parsed.isIDN) {
      const idnCheck = createCheck('IDN', false, `IDN hostname: ${parsed.hostname}`);
      checks.push(idnCheck);
      return this.deny('IDN_HOMOGRAPH', 'Internationalized domain names not allowed', checks);
    }
    
    // Check hostname blocklist
    const blocklistCheck = this.checkBlocklist(parsed);
    checks.push(blocklistCheck);
    if (!blocklistCheck.passed) {
      return this.deny(
        'HOSTNAME_BLOCKED',
        `Hostname is blocked: ${parsed.hostname}`,
        checks
      );
    }
    
    // Check hostname allowlist (if configured)
    if (this.config.allowedDomains.length > 0) {
      const allowlistCheck = this.checkAllowlist(parsed);
      checks.push(allowlistCheck);
      if (!allowlistCheck.passed) {
        return this.deny(
          'HOSTNAME_NOT_IN_ALLOWLIST',
          `Hostname not in allowlist: ${parsed.hostname}`,
          checks
        );
      }
    }
    
    // Check IP literals
    if (parsed.isIPLiteral) {
      const ipCheck = this.checkIPLiteral(parsed);
      checks.push(ipCheck);
      if (!ipCheck.passed) {
        // Map details to specific deny reasons
        const denyReason: SSRFDenyReason = 
          ipCheck.details?.includes('private') ? 'PRIVATE_IP' :
          ipCheck.details?.includes('loopback') ? 'LOOPBACK_IP' :
          ipCheck.details?.includes('link-local') ? 'LINK_LOCAL_IP' :
          ipCheck.details?.includes('multicast') ? 'MULTICAST_IP' :
          'RESERVED_IP';
        
        return this.deny(
          denyReason,
          ipCheck.details ?? 'IP address not allowed',
          checks
        );
      }
    }
    
    // All checks passed
    return {
      allowed: true,
      checks,
    };
  }
  
  /**
   * Check only the port policy.
   */
  checkPortPolicy(port: number, scheme: string): SSRFCheck {
    // If no port restrictions, allow all
    if (this.config.allowedPorts.length === 0) {
      return createCheck('PORT', true, 'No port restrictions');
    }
    
    // Get effective port
    const effectivePort = port || SCHEME_DEFAULT_PORTS[scheme] || 80;
    
    // Check if allowed
    const allowed = this.config.allowedPorts.includes(effectivePort);
    return createCheck(
      'PORT',
      allowed,
      allowed ? `Port ${effectivePort} allowed` : `Port ${effectivePort} not in allowlist`
    );
  }
  
  /**
   * Check only the hostname blocklist.
   */
  checkHostnameBlocked(hostname: string): SSRFCheck {
    const normalizedHostname = hostname.toLowerCase();
    
    for (const pattern of this.config.blockedDomains) {
      if (hostnameMatches(normalizedHostname, pattern)) {
        return createCheck('HOSTNAME_BLOCKLIST', false, `Matches blocked pattern: ${pattern}`);
      }
    }
    
    return createCheck('HOSTNAME_BLOCKLIST', true, 'Not in blocklist');
  }
  
  /**
   * Check only the hostname allowlist.
   */
  checkHostnameAllowed(hostname: string): SSRFCheck {
    if (this.config.allowedDomains.length === 0) {
      return createCheck('HOSTNAME_ALLOWLIST', true, 'No allowlist configured');
    }
    
    const normalizedHostname = hostname.toLowerCase();
    
    for (const pattern of this.config.allowedDomains) {
      if (hostnameMatches(normalizedHostname, pattern)) {
        return createCheck('HOSTNAME_ALLOWLIST', true, `Matches allowed pattern: ${pattern}`);
      }
    }
    
    return createCheck('HOSTNAME_ALLOWLIST', false, 'Not in allowlist');
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE CHECK METHODS
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Check userinfo (credentials in URL).
   */
  private checkUserinfo(parsed: ParsedURL): SSRFCheck {
    if (!parsed.username && !parsed.password) {
      return createCheck('USERINFO', true, 'No credentials in URL');
    }
    
    if (this.config.allowUserinfo) {
      return createCheck('USERINFO', true, 'Credentials allowed by policy');
    }
    
    return createCheck('USERINFO', false, 'Credentials in URL not allowed');
  }
  
  /**
   * Check port against allowlist.
   */
  private checkPort(parsed: ParsedURL): SSRFCheck {
    // If no port restrictions, allow all
    if (this.config.allowedPorts.length === 0) {
      return createCheck('PORT', true, 'No port restrictions');
    }
    
    // Get effective port
    const effectivePort = parsed.port || SCHEME_DEFAULT_PORTS[parsed.scheme] || 80;
    
    // Check if allowed
    const allowed = this.config.allowedPorts.includes(effectivePort);
    return createCheck(
      'PORT',
      allowed,
      allowed ? `Port ${effectivePort} allowed` : `Port ${effectivePort} not in allowlist`
    );
  }
  
  /**
   * Check for alternate IP encodings.
   */
  private checkAlternateEncoding(parsed: ParsedURL): SSRFCheck {
    const result = detectAlternateEncoding(parsed.hostname);
    
    if (result.detected) {
      logger.warn('Alternate IP encoding detected', {
        hostname: parsed.hostname,
        type: result.type,
        decodedIP: result.decodedIP,
      });
      
      return createCheck(
        'ALTERNATE_ENCODING',
        false,
        `${result.type} encoding → ${result.decodedIP}`
      );
    }
    
    return createCheck('ALTERNATE_ENCODING', true, 'No alternate encoding');
  }
  
  /**
   * Check for embedded IPs in hostname.
   */
  private checkEmbeddedIP(parsed: ParsedURL): SSRFCheck {
    // Skip if already a pure IP literal
    if (isIPv4(parsed.hostname) || isIPv6(parsed.hostname)) {
      return createCheck('EMBEDDED_IP', true, 'Pure IP literal');
    }
    
    const result = detectEmbeddedIP(parsed.hostname);
    
    if (result.detected) {
      logger.warn('Embedded IP detected in hostname', {
        hostname: parsed.hostname,
        pattern: result.pattern,
        ip: result.ip,
      });
      
      return createCheck(
        'EMBEDDED_IP',
        false,
        `${result.pattern} pattern → ${result.ip}`
      );
    }
    
    return createCheck('EMBEDDED_IP', true, 'No embedded IP');
  }
  
  /**
   * Check hostname against blocklist.
   */
  private checkBlocklist(parsed: ParsedURL): SSRFCheck {
    const hostname = parsed.hostnameASCII || parsed.hostname;
    const normalizedHostname = hostname.toLowerCase();
    
    for (const pattern of this.config.blockedDomains) {
      if (hostnameMatches(normalizedHostname, pattern)) {
        logger.debug('Hostname blocked', { hostname, pattern });
        return createCheck('HOSTNAME_BLOCKLIST', false, `Matches blocked pattern: ${pattern}`);
      }
    }
    
    return createCheck('HOSTNAME_BLOCKLIST', true, 'Not in blocklist');
  }
  
  /**
   * Check hostname against allowlist.
   */
  private checkAllowlist(parsed: ParsedURL): SSRFCheck {
    const hostname = parsed.hostnameASCII || parsed.hostname;
    const normalizedHostname = hostname.toLowerCase();
    
    for (const pattern of this.config.allowedDomains) {
      if (hostnameMatches(normalizedHostname, pattern)) {
        return createCheck('HOSTNAME_ALLOWLIST', true, `Matches allowed pattern: ${pattern}`);
      }
    }
    
    return createCheck('HOSTNAME_ALLOWLIST', false, 'Not in allowlist');
  }
  
  /**
   * Check IP literal (when hostname is an IP address).
   */
  private checkIPLiteral(parsed: ParsedURL): SSRFCheck {
    // Check if IP literals are allowed
    if (!this.config.allowIPLiterals) {
      return createCheck('IP_VALIDATION', false, 'IP literals not allowed');
    }
    
    // Validate the IP
    const hostname = parsed.hostname;
    
    // Handle IPv6 with brackets
    let ip = hostname;
    if (ip.startsWith('[') && ip.endsWith(']')) {
      ip = ip.slice(1, -1);
    }
    
    // Remove zone ID for validation
    const zoneIndex = ip.indexOf('%');
    if (zoneIndex !== -1) {
      ip = ip.substring(0, zoneIndex);
    }
    
    const result = validateIP(ip, {
      allowPrivate: this.config.allowPrivateIPs,
      allowLoopback: this.config.allowLocalhost,
    });
    
    if (!result.valid) {
      return createCheck('IP_VALIDATION', false, `Invalid IP: ${ip}`);
    }
    
    if (!result.isSafe) {
      const reason = result.unsafeReason === 'LOOPBACK' ? 'loopback' :
                     result.unsafeReason === 'PRIVATE_NETWORK' ? 'private network' :
                     result.unsafeReason === 'LINK_LOCAL' ? 'link-local' :
                     result.unsafeReason;
      
      return createCheck('IP_VALIDATION', false, `IP is ${reason}: ${ip}`);
    }
    
    return createCheck(
      'IP_VALIDATION',
      true,
      `IP validated: ${result.classification}`
    );
  }
  
  /**
   * Create a denial result.
   */
  private deny(
    reason: SSRFDenyReason,
    message: string,
    checks: SSRFCheck[]
  ): PolicyResult {
    return {
      allowed: false,
      reason,
      message,
      checks,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON INSTANCE
// ─────────────────────────────────────────────────────────────────────────────────

let policyInstance: PolicyChecker | null = null;

/**
 * Get or create the global policy checker.
 */
export function getPolicyChecker(config?: Partial<PolicyConfig>): PolicyChecker {
  if (!policyInstance) {
    policyInstance = new PolicyChecker(config);
  }
  return policyInstance;
}

/**
 * Create a new policy checker with custom configuration.
 */
export function createPolicyChecker(config?: Partial<PolicyConfig>): PolicyChecker {
  return new PolicyChecker(config);
}

/**
 * Reset the global policy checker (for testing).
 */
export function resetPolicyChecker(): void {
  policyInstance = null;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONVENIENCE FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Quick check if a port is allowed.
 * 
 * @param port - The port to check
 * @param scheme - The URL scheme (for default port)
 * @returns Whether the port is allowed
 */
export function isPortAllowed(port: number, scheme: string = 'https'): boolean {
  return getPolicyChecker().checkPortPolicy(port, scheme).passed;
}

/**
 * Quick check if a hostname is blocked.
 * 
 * @param hostname - The hostname to check
 * @returns Whether the hostname is blocked
 */
export function isHostnameBlocked(hostname: string): boolean {
  return !getPolicyChecker().checkHostnameBlocked(hostname).passed;
}

/**
 * Check if a hostname matches any pattern in a list.
 * 
 * @param hostname - The hostname to check
 * @param patterns - The patterns to match against
 * @returns Whether any pattern matches
 */
export function matchesAnyPattern(hostname: string, patterns: readonly string[]): boolean {
  const normalized = hostname.toLowerCase();
  return patterns.some(pattern => hostnameMatches(normalized, pattern));
}

// ─────────────────────────────────────────────────────────────────────────────────
// WELL-KNOWN DANGEROUS HOSTNAMES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Cloud metadata service endpoints that should always be blocked.
 * These are included in DEFAULT_BLOCKED_DOMAINS but exported for reference.
 */
export const CLOUD_METADATA_HOSTNAMES = [
  // AWS
  '169.254.169.254',
  'fd00:ec2::254',
  
  // GCP
  'metadata.google.internal',
  
  // Azure
  '169.254.169.254',
  
  // DigitalOcean
  '169.254.169.254',
  
  // Oracle Cloud
  '169.254.169.254',
  
  // Alibaba Cloud
  '100.100.100.200',
] as const;

/**
 * Common localhost variations that should be blocked.
 */
export const LOCALHOST_HOSTNAMES = [
  'localhost',
  'localhost.localdomain',
  '127.0.0.1',
  '::1',
  '[::1]',
  '0.0.0.0',
  '0',
] as const;

/**
 * Common internal network hostnames.
 */
export const INTERNAL_HOSTNAMES = [
  'internal',
  'intranet',
  'corp',
  'private',
  'local',
] as const;
