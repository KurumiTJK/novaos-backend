// ═══════════════════════════════════════════════════════════════════════════════
// SSRF PROTECTION TYPES — Complete Type Definitions
// NovaOS Security — Phase 5: SSRF Protection Layer
// ═══════════════════════════════════════════════════════════════════════════════
//
// This module defines all types for the SSRF protection system:
// - URL parsing and validation
// - DNS resolution with rebinding protection
// - IP address validation (IPv4/IPv6)
// - Transport requirements and evidence
// - Redirect chain tracking
//
// The SSRFDecision is the SINGLE SOURCE OF TRUTH for transport layer.
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { Brand } from '../../types/branded.js';

// ─────────────────────────────────────────────────────────────────────────────────
// BRANDED TYPES FOR SSRF
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Validated URL string that has passed initial parsing.
 */
export type ValidatedUrl = Brand<string, 'ValidatedUrl'>;

/**
 * Validated IPv4 address string.
 */
export type IPv4Address = Brand<string, 'IPv4Address'>;

/**
 * Validated IPv6 address string.
 */
export type IPv6Address = Brand<string, 'IPv6Address'>;

/**
 * Either IPv4 or IPv6 address.
 */
export type IPAddress = IPv4Address | IPv6Address;

/**
 * Hostname that has been validated (not an IP literal).
 */
export type ValidatedHostname = Brand<string, 'ValidatedHostname'>;

/**
 * SPKI pin hash (base64-encoded SHA-256).
 */
export type SPKIPin = Brand<string, 'SPKIPin'>;

// ─────────────────────────────────────────────────────────────────────────────────
// URL PARSING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * IP address type classification.
 */
export type IPType = 'ipv4' | 'ipv6' | 'ipv4-mapped-ipv6' | 'none';

/**
 * Result of parsing a URL.
 */
export interface ParsedURL {
  /** Original URL string */
  readonly original: string;
  
  /** Protocol/scheme (e.g., 'https') */
  readonly scheme: string;
  
  /** Username from URL (security concern) */
  readonly username: string | null;
  
  /** Password from URL (security concern) */
  readonly password: string | null;
  
  /** Hostname (may be IDN/punycode) */
  readonly hostname: string;
  
  /** Port number (null = default for scheme) */
  readonly port: number | null;
  
  /** Effective port (resolves default) */
  readonly effectivePort: number;
  
  /** Path component */
  readonly path: string;
  
  /** Query string (without ?) */
  readonly query: string | null;
  
  /** Fragment (without #) */
  readonly fragment: string | null;
  
  /** Whether hostname is an IP address literal */
  readonly isIPLiteral: boolean;
  
  /** Type of IP if literal */
  readonly ipType: IPType;
  
  /** Whether hostname uses IDN (internationalized) */
  readonly isIDN: boolean;
  
  /** ASCII/punycode version of hostname */
  readonly hostnameASCII: string;
  
  /** Whether hostname contains a zone ID (IPv6) */
  readonly hasZoneId: boolean;
  
  /** Zone ID if present */
  readonly zoneId: string | null;
}

/**
 * Reasons URL parsing can fail.
 */
export type URLParseError =
  | 'INVALID_URL'
  | 'UNSUPPORTED_SCHEME'
  | 'EMPTY_HOSTNAME'
  | 'INVALID_PORT'
  | 'PORT_OUT_OF_RANGE'
  | 'INVALID_IPV6'
  | 'INVALID_ENCODING';

/**
 * URL parse result.
 */
export interface URLParseResult {
  readonly success: boolean;
  readonly url?: ParsedURL;
  readonly error?: URLParseError;
  readonly message?: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// DNS RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Single DNS record.
 */
export interface DNSRecord {
  /** IP address */
  readonly address: string;
  
  /** Address family (4 or 6) */
  readonly family: 4 | 6;
  
  /** TTL in seconds (if available) */
  readonly ttl?: number;
}

/**
 * DNS resolution result.
 */
export interface DNSResolutionResult {
  /** Hostname that was resolved */
  readonly hostname: string;
  
  /** Whether resolution succeeded */
  readonly success: boolean;
  
  /** All resolved addresses */
  readonly addresses: readonly DNSRecord[];
  
  /** IPv4 addresses only */
  readonly ipv4Addresses: readonly string[];
  
  /** IPv6 addresses only */
  readonly ipv6Addresses: readonly string[];
  
  /** Resolution time in milliseconds */
  readonly durationMs: number;
  
  /** Whether result came from cache */
  readonly fromCache: boolean;
  
  /** Cache TTL remaining (if cached) */
  readonly cacheTTL?: number;
  
  /** Error if resolution failed */
  readonly error?: DNSError;
}

/**
 * DNS resolution errors.
 */
export type DNSError =
  | 'TIMEOUT'
  | 'NXDOMAIN'
  | 'SERVFAIL'
  | 'REFUSED'
  | 'NO_DATA'
  | 'NETWORK_ERROR'
  | 'INVALID_HOSTNAME';

// ─────────────────────────────────────────────────────────────────────────────────
// IP VALIDATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * IP address classification.
 */
export type IPClassification =
  // Public/routable
  | 'PUBLIC'
  
  // Private ranges
  | 'PRIVATE_10'        // 10.0.0.0/8
  | 'PRIVATE_172'       // 172.16.0.0/12
  | 'PRIVATE_192'       // 192.168.0.0/16
  | 'PRIVATE_FC'        // fc00::/7 (unique local)
  
  // Loopback
  | 'LOOPBACK_V4'       // 127.0.0.0/8
  | 'LOOPBACK_V6'       // ::1/128
  
  // Link-local
  | 'LINK_LOCAL_V4'     // 169.254.0.0/16
  | 'LINK_LOCAL_V6'     // fe80::/10
  
  // Multicast
  | 'MULTICAST_V4'      // 224.0.0.0/4
  | 'MULTICAST_V6'      // ff00::/8
  
  // Special
  | 'CARRIER_GRADE_NAT' // 100.64.0.0/10
  | 'DOCUMENTATION_V4'  // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24
  | 'DOCUMENTATION_V6'  // 2001:db8::/32
  | 'BENCHMARKING'      // 198.18.0.0/15
  | 'RESERVED'          // 240.0.0.0/4
  | 'BROADCAST'         // 255.255.255.255
  | 'THIS_NETWORK'      // 0.0.0.0/8
  | 'IPV4_MAPPED'       // ::ffff:0:0/96
  | 'IPV4_TRANSLATED'   // ::ffff:0:0:0/96
  | 'TEREDO'            // 2001::/32
  | '6TO4'              // 2002::/16
  
  // Unknown/unclassified
  | 'UNKNOWN';

/**
 * Result of IP address validation.
 */
export interface IPValidationResult {
  /** Original IP string */
  readonly ip: string;
  
  /** Whether the IP is valid */
  readonly valid: boolean;
  
  /** IP version (4 or 6) */
  readonly version: 4 | 6 | null;
  
  /** Classification of the IP */
  readonly classification: IPClassification;
  
  /** Whether this IP is safe to connect to */
  readonly isSafe: boolean;
  
  /** Reason if not safe */
  readonly unsafeReason?: IPUnsafeReason;
  
  /** For IPv4-mapped IPv6, the embedded IPv4 */
  readonly embeddedIPv4?: string;
  
  /** For IPv4-mapped, the embedded IP's classification */
  readonly embeddedClassification?: IPClassification;
  
  /** Normalized form of the IP */
  readonly normalized: string;
}

/**
 * Reasons an IP is considered unsafe.
 */
export type IPUnsafeReason =
  | 'PRIVATE_NETWORK'
  | 'LOOPBACK'
  | 'LINK_LOCAL'
  | 'MULTICAST'
  | 'BROADCAST'
  | 'RESERVED'
  | 'DOCUMENTATION'
  | 'CARRIER_GRADE_NAT'
  | 'THIS_NETWORK'
  | 'IPV4_MAPPED_PRIVATE'
  | 'INVALID_FORMAT'
  | 'ALTERNATE_ENCODING';

// ─────────────────────────────────────────────────────────────────────────────────
// SSRF CHECK RESULTS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Individual check performed during SSRF validation.
 */
export interface SSRFCheck {
  /** Check identifier */
  readonly check: SSRFCheckType;
  
  /** Whether check passed */
  readonly passed: boolean;
  
  /** Details about the check */
  readonly details?: string;
  
  /** Duration of check in ms */
  readonly durationMs?: number;
}

/**
 * Types of SSRF checks performed.
 */
export type SSRFCheckType =
  | 'RATE_LIMIT'
  | 'URL_PARSE'
  | 'SCHEME'
  | 'USERINFO'
  | 'PORT'
  | 'HOSTNAME_BLOCKLIST'
  | 'HOSTNAME_ALLOWLIST'
  | 'IDN'
  | 'ALTERNATE_ENCODING'
  | 'EMBEDDED_IP'
  | 'DNS_RESOLUTION'
  | 'IP_VALIDATION'
  | 'CERTIFICATE_PINNING'
  | 'REDIRECT_LIMIT'
  | 'REDIRECT_CHAIN';

// ─────────────────────────────────────────════════════════════════════════════════
// SSRF DECISION — THE SINGLE SOURCE OF TRUTH
// ─────────────────────────────────────════════════════════════════════════════════

/**
 * Reasons a request can be denied.
 */
export type SSRFDenyReason =
  // Rate limiting
  | 'RATE_LIMITED'
  
  // URL parsing
  | 'INVALID_URL'
  | 'UNSUPPORTED_SCHEME'
  | 'USERINFO_PRESENT'
  | 'PORT_NOT_ALLOWED'
  | 'EMPTY_HOSTNAME'
  
  // Hostname checks
  | 'HOSTNAME_BLOCKED'
  | 'HOSTNAME_NOT_IN_ALLOWLIST'
  | 'IDN_HOMOGRAPH'
  | 'ALTERNATE_IP_ENCODING'
  | 'EMBEDDED_IP_IN_HOSTNAME'
  
  // DNS
  | 'DNS_TIMEOUT'
  | 'DNS_RESOLUTION_FAILED'
  | 'DNS_NO_RECORDS'
  
  // IP validation
  | 'PRIVATE_IP'
  | 'LOOPBACK_IP'
  | 'LINK_LOCAL_IP'
  | 'MULTICAST_IP'
  | 'RESERVED_IP'
  | 'IPV4_MAPPED_PRIVATE'
  
  // TLS
  | 'CERTIFICATE_PIN_MISMATCH'
  | 'CERTIFICATE_INVALID'
  
  // Redirects
  | 'TOO_MANY_REDIRECTS'
  | 'REDIRECT_TO_PRIVATE'
  | 'REDIRECT_LOOP'
  
  // Transport
  | 'CONNECTION_TIMEOUT'
  | 'RESPONSE_TOO_LARGE'
  | 'DNS_REBINDING_DETECTED'
  
  // General
  | 'INTERNAL_ERROR';

/**
 * The SSRF Decision — Single source of truth for transport.
 * 
 * This is the ONLY type the transport layer should trust.
 * It contains everything needed to make a safe connection.
 */
export interface SSRFDecision {
  /** Whether the request is allowed */
  readonly allowed: boolean;
  
  /** Denial reason (if not allowed) */
  readonly reason?: SSRFDenyReason;
  
  /** Human-readable message */
  readonly message: string;
  
  /** All checks performed */
  readonly checks: readonly SSRFCheck[];
  
  /** Total decision time in ms */
  readonly durationMs: number;
  
  /** Timestamp of decision */
  readonly timestamp: number;
  
  /** Request ID for correlation */
  readonly requestId?: string;
  
  /** Transport requirements (only if allowed) */
  readonly transport?: TransportRequirements;
}

// ─────────────────────────────────────────────────────────────────────────────────
// TRANSPORT REQUIREMENTS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Requirements for the transport layer.
 * 
 * The transport MUST use these values — not re-resolve DNS or trust redirects.
 */
export interface TransportRequirements {
  /** Original URL (for reference only) */
  readonly originalUrl: string;
  
  /** The SPECIFIC IP to connect to (DNS rebinding prevention) */
  readonly connectToIP: string;
  
  /** Port to connect to */
  readonly port: number;
  
  /** Whether to use TLS */
  readonly useTLS: boolean;
  
  /** Hostname for TLS SNI and Host header */
  readonly hostname: string;
  
  /** Full URL path + query for request */
  readonly requestPath: string;
  
  /** Maximum response size in bytes */
  readonly maxResponseBytes: number;
  
  /** Connection timeout in ms */
  readonly connectionTimeoutMs: number;
  
  /** Read timeout in ms */
  readonly readTimeoutMs: number;
  
  /** Whether redirects are allowed */
  readonly allowRedirects: boolean;
  
  /** Maximum redirects (if allowed) */
  readonly maxRedirects: number;
  
  /** Certificate pins (if any) */
  readonly certificatePins?: readonly SPKIPin[];
  
  /** Headers to send */
  readonly headers: Readonly<Record<string, string>>;
  
  /** User agent to use */
  readonly userAgent: string;
}

/**
 * Evidence that transport followed requirements.
 * 
 * This proves the transport layer connected to the correct IP.
 */
export interface TransportEvidence {
  /** IP address actually connected to */
  readonly connectedIP: string;
  
  /** Port actually connected to */
  readonly connectedPort: number;
  
  /** Whether TLS was used */
  readonly tlsUsed: boolean;
  
  /** TLS version (if used) */
  readonly tlsVersion?: string;
  
  /** Certificate chain (if TLS) */
  readonly certificateChain?: readonly CertificateInfo[];
  
  /** Whether certificate pins were verified */
  readonly pinsVerified?: boolean;
  
  /** Connection establishment time in ms */
  readonly connectionTimeMs: number;
  
  /** Total request time in ms */
  readonly totalTimeMs: number;
  
  /** Response size in bytes */
  readonly responseBytes: number;
  
  /** Whether response was truncated */
  readonly truncated: boolean;
}

/**
 * Certificate information for evidence.
 */
export interface CertificateInfo {
  /** Certificate subject */
  readonly subject: string;
  
  /** Certificate issuer */
  readonly issuer: string;
  
  /** Valid from date */
  readonly validFrom: string;
  
  /** Valid to date */
  readonly validTo: string;
  
  /** SPKI fingerprint (SHA-256, base64) */
  readonly spkiHash: string;
  
  /** Serial number */
  readonly serialNumber: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// REDIRECT TRACKING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Single hop in a redirect chain.
 */
export interface RedirectHop {
  /** Hop number (0 = original request) */
  readonly hopNumber: number;
  
  /** URL that was requested */
  readonly url: string;
  
  /** HTTP status code */
  readonly statusCode: number;
  
  /** Location header value */
  readonly location: string;
  
  /** IP that was connected to */
  readonly connectedIP: string;
  
  /** SSRF decision for this hop */
  readonly decision: SSRFDecision;
  
  /** Response headers (selected) */
  readonly headers: Readonly<Record<string, string>>;
  
  /** Time for this hop in ms */
  readonly durationMs: number;
}

/**
 * Complete redirect chain result.
 */
export interface RedirectChainResult {
  /** Whether the chain completed successfully */
  readonly success: boolean;
  
  /** Final URL reached */
  readonly finalUrl: string;
  
  /** Final SSRF decision */
  readonly finalDecision: SSRFDecision;
  
  /** All hops in the chain */
  readonly hops: readonly RedirectHop[];
  
  /** Total number of redirects */
  readonly redirectCount: number;
  
  /** Total time for all hops in ms */
  readonly totalDurationMs: number;
  
  /** Error if chain failed */
  readonly error?: RedirectChainError;
}

/**
 * Redirect chain errors.
 */
export type RedirectChainError =
  | 'MAX_REDIRECTS_EXCEEDED'
  | 'REDIRECT_LOOP'
  | 'INVALID_LOCATION'
  | 'SSRF_BLOCKED'
  | 'CONNECTION_ERROR'
  | 'TIMEOUT';

// ─────────────────────────────────────────────────────────────────────────────────
// SSRF GUARD CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Configuration for the SSRF Guard.
 */
export interface SSRFGuardConfig {
  /** Allowed ports (default: [80, 443]) */
  readonly allowedPorts: readonly number[];
  
  /** DNS resolution timeout in ms */
  readonly dnsTimeoutMs: number;
  
  /** Request timeout in ms */
  readonly requestTimeoutMs: number;
  
  /** Maximum response size in bytes */
  readonly maxResponseBytes: number;
  
  /** Maximum redirects to follow */
  readonly maxRedirects: number;
  
  /** Allow private/internal IPs */
  readonly allowPrivateIPs: boolean;
  
  /** Allow localhost */
  readonly allowLocalhost: boolean;
  
  /** Validate TLS certificates */
  readonly validateCerts: boolean;
  
  /** Prevent DNS rebinding attacks */
  readonly preventDnsRebinding: boolean;
  
  /** Blocked domains/hostnames */
  readonly blockedDomains: readonly string[];
  
  /** Allowed domains (if set, only these allowed) */
  readonly allowedDomains?: readonly string[];
  
  /** Certificate pins by domain */
  readonly certificatePins?: Readonly<Record<string, readonly string[]>>;
  
  /** Rate limit config */
  readonly rateLimit?: {
    readonly windowMs: number;
    readonly maxRequests: number;
  };
  
  /** User agent for requests */
  readonly userAgent: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// HELPER TYPE GUARDS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Check if a decision allows the request.
 */
export function isAllowed(decision: SSRFDecision): decision is SSRFDecision & { allowed: true; transport: TransportRequirements } {
  return decision.allowed && decision.transport !== undefined;
}

/**
 * Check if a decision denies the request.
 */
export function isDenied(decision: SSRFDecision): decision is SSRFDecision & { allowed: false; reason: SSRFDenyReason } {
  return !decision.allowed && decision.reason !== undefined;
}

/**
 * Check if an IP validation result is safe.
 */
export function isSafeIPResult(result: IPValidationResult): boolean {
  return result.valid && result.isSafe;
}

/**
 * Check if a redirect chain succeeded.
 */
export function isRedirectSuccess(result: RedirectChainResult): boolean {
  return result.success && result.finalDecision.allowed;
}

// ─────────────────────────────────────────────────────────────────────────────────
// FACTORY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create an allowed SSRF decision.
 */
export function createAllowedDecision(
  transport: TransportRequirements,
  checks: readonly SSRFCheck[],
  durationMs: number,
  requestId?: string
): SSRFDecision {
  return {
    allowed: true,
    message: 'Request allowed',
    checks,
    durationMs,
    timestamp: Date.now(),
    requestId,
    transport,
  };
}

/**
 * Create a denied SSRF decision.
 */
export function createDeniedDecision(
  reason: SSRFDenyReason,
  message: string,
  checks: readonly SSRFCheck[],
  durationMs: number,
  requestId?: string
): SSRFDecision {
  return {
    allowed: false,
    reason,
    message,
    checks,
    durationMs,
    timestamp: Date.now(),
    requestId,
  };
}

/**
 * Create a check result.
 */
export function createCheck(
  check: SSRFCheckType,
  passed: boolean,
  details?: string,
  durationMs?: number
): SSRFCheck {
  return { check, passed, details, durationMs };
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Default allowed ports.
 */
export const DEFAULT_ALLOWED_PORTS = [80, 443] as const;

/**
 * Default blocked domains.
 */
export const DEFAULT_BLOCKED_DOMAINS = [
  'localhost',
  'localhost.localdomain',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  '169.254.169.254',           // AWS metadata
  'metadata.google.internal',   // GCP metadata
  'metadata.azure.internal',    // Azure metadata
  '100.100.100.200',            // Alibaba metadata
  'instance-data',              // Generic metadata
] as const;

/**
 * Default scheme to port mapping.
 */
export const SCHEME_DEFAULT_PORTS: Readonly<Record<string, number>> = {
  http: 80,
  https: 443,
  ftp: 21,
  ssh: 22,
};

/**
 * Supported schemes for SSRF guard.
 */
export const SUPPORTED_SCHEMES = ['http', 'https'] as const;

export type SupportedScheme = typeof SUPPORTED_SCHEMES[number];
