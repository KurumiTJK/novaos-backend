// ═══════════════════════════════════════════════════════════════════════════════
// URL PARSER — Safe URL Parsing with Security Checks
// NovaOS Security — Phase 5: SSRF Protection Layer
// ═══════════════════════════════════════════════════════════════════════════════
//
// This module provides secure URL parsing with:
// - IP address literal detection (IPv4 and IPv6)
// - IDN/Punycode detection and normalization
// - Userinfo (credentials in URL) detection
// - Zone ID detection for IPv6
// - Alternate IP encoding detection (octal, hex, decimal)
//
// ═══════════════════════════════════════════════════════════════════════════════

import {
  type ParsedURL,
  type URLParseResult,
  type URLParseError,
  type IPType,
  SCHEME_DEFAULT_PORTS,
  SUPPORTED_SCHEMES,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// IPv4 DETECTION & PARSING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Standard IPv4 regex (decimal dotted notation only).
 * Does NOT match octal (0177) or hex (0x7f) notations.
 */
const IPV4_STANDARD_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Check if a string is a valid standard IPv4 address.
 * Only accepts decimal dotted notation (e.g., 192.168.1.1).
 */
export function isIPv4(value: string): boolean {
  const match = IPV4_STANDARD_REGEX.exec(value);
  if (!match) return false;
  
  // Validate each octet is 0-255
  for (let i = 1; i <= 4; i++) {
    const octet = parseInt(match[i]!, 10);
    if (octet < 0 || octet > 255) return false;
    
    // Reject leading zeros (potential octal confusion)
    // "01.02.03.04" should be rejected
    if (match[i]!.length > 1 && match[i]![0] === '0') {
      return false;
    }
  }
  
  return true;
}

/**
 * Parse an IPv4 address to its numeric value.
 * Returns null if invalid.
 */
export function parseIPv4ToNumber(ip: string): number | null {
  const match = IPV4_STANDARD_REGEX.exec(ip);
  if (!match) return null;
  
  let result = 0;
  for (let i = 1; i <= 4; i++) {
    const octet = parseInt(match[i]!, 10);
    if (octet < 0 || octet > 255) return null;
    if (match[i]!.length > 1 && match[i]![0] === '0') return null;
    result = (result << 8) | octet;
  }
  
  return result >>> 0; // Convert to unsigned 32-bit
}

/**
 * Convert a numeric IP to dotted decimal string.
 */
export function numberToIPv4(num: number): string {
  return [
    (num >>> 24) & 0xff,
    (num >>> 16) & 0xff,
    (num >>> 8) & 0xff,
    num & 0xff,
  ].join('.');
}

// ─────────────────────────────────────────────────────────────────────────────────
// ALTERNATE IP ENCODING DETECTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Result of alternate encoding detection.
 */
export interface AlternateEncodingResult {
  /** Whether alternate encoding was detected */
  detected: boolean;
  /** Type of encoding detected */
  type?: 'octal' | 'hex' | 'decimal' | 'mixed';
  /** Decoded IPv4 address (if detected) */
  decodedIP?: string;
  /** Original value */
  original: string;
}

/**
 * Detect and decode alternate IP address encodings.
 * 
 * Attackers use these to bypass filters:
 * - Octal: 0177.0.0.1 (= 127.0.0.1)
 * - Hex: 0x7f.0x0.0x0.0x1 (= 127.0.0.1)
 * - Decimal: 2130706433 (= 127.0.0.1)
 * - Mixed: 0x7f.0.0.1
 */
export function detectAlternateEncoding(value: string): AlternateEncodingResult {
  const original = value.trim();
  
  // Check for single decimal number (e.g., 2130706433)
  if (/^\d+$/.test(original)) {
    const num = parseInt(original, 10);
    // Valid IPv4 range: 0 to 4294967295 (0xFFFFFFFF)
    if (num >= 0 && num <= 0xFFFFFFFF) {
      return {
        detected: true,
        type: 'decimal',
        decodedIP: numberToIPv4(num),
        original,
      };
    }
  }
  
  // Check for dotted notation with alternate encoding
  const parts = original.split('.');
  if (parts.length >= 1 && parts.length <= 4) {
    let hasOctal = false;
    let hasHex = false;
    let hasDecimal = false;
    const octets: number[] = [];
    
    for (const part of parts) {
      let value: number;
      
      if (/^0x[0-9a-fA-F]+$/i.test(part)) {
        // Hex notation
        hasHex = true;
        value = parseInt(part, 16);
      } else if (/^0[0-7]+$/.test(part) && part.length > 1) {
        // Octal notation (starts with 0, followed by octal digits)
        hasOctal = true;
        value = parseInt(part, 8);
      } else if (/^\d+$/.test(part)) {
        // Decimal notation
        hasDecimal = true;
        value = parseInt(part, 10);
      } else {
        // Not a valid encoding
        return { detected: false, original };
      }
      
      if (isNaN(value) || value < 0) {
        return { detected: false, original };
      }
      
      octets.push(value);
    }
    
    // If we have alternate encoding (octal or hex), decode it
    if (hasOctal || hasHex) {
      // Handle different number of parts (IPv4 allows 1-4 parts)
      let ip: number;
      
      if (octets.length === 1) {
        // Single value represents entire IP
        ip = octets[0]!;
      } else if (octets.length === 2) {
        // a.b = a.0.0.b (first octet, then 24-bit value)
        if (octets[0]! > 255 || octets[1]! > 0xFFFFFF) {
          return { detected: false, original };
        }
        ip = (octets[0]! << 24) | octets[1]!;
      } else if (octets.length === 3) {
        // a.b.c = a.b.0.c (two octets, then 16-bit value)
        if (octets[0]! > 255 || octets[1]! > 255 || octets[2]! > 0xFFFF) {
          return { detected: false, original };
        }
        ip = (octets[0]! << 24) | (octets[1]! << 16) | octets[2]!;
      } else {
        // Standard 4-part notation
        if (octets.some(o => o > 255)) {
          return { detected: false, original };
        }
        ip = (octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!;
      }
      
      if (ip > 0xFFFFFFFF) {
        return { detected: false, original };
      }
      
      const type = hasOctal && hasHex ? 'mixed' : hasOctal ? 'octal' : 'hex';
      
      return {
        detected: true,
        type,
        decodedIP: numberToIPv4(ip >>> 0),
        original,
      };
    }
  }
  
  return { detected: false, original };
}

// ─────────────────────────────────────────────────────────────────────────────────
// IPv6 DETECTION & PARSING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * IPv6 regex pattern (simplified, handles most cases).
 * Full IPv6 validation is complex; we use a permissive regex then validate.
 */
const IPV6_PATTERN = /^(?:\[)?([a-fA-F0-9:]+(?:%[a-zA-Z0-9._~-]+)?)(?:\])?$/;

/**
 * Check if a string is a valid IPv6 address.
 */
export function isIPv6(value: string): boolean {
  // Remove brackets if present
  let ip = value;
  if (ip.startsWith('[') && ip.endsWith(']')) {
    ip = ip.slice(1, -1);
  }
  
  // Remove zone ID if present
  const zoneIndex = ip.indexOf('%');
  if (zoneIndex !== -1) {
    ip = ip.substring(0, zoneIndex);
  }
  
  // Empty check
  if (!ip) return false;
  
  // Check for IPv4-mapped IPv6 (::ffff:192.168.1.1)
  const lastColon = ip.lastIndexOf(':');
  if (lastColon !== -1) {
    const possibleIPv4 = ip.substring(lastColon + 1);
    if (isIPv4(possibleIPv4)) {
      // Validate the IPv6 prefix part
      const prefix = ip.substring(0, lastColon);
      // For mapped addresses, prefix should be valid
      if (prefix === ':' || prefix.endsWith(':')) {
        return validateIPv6Prefix(prefix);
      }
    }
  }
  
  // Split by ::
  const doubleColonParts = ip.split('::');
  if (doubleColonParts.length > 2) {
    // Only one :: allowed
    return false;
  }
  
  if (doubleColonParts.length === 2) {
    // Has ::
    const left = doubleColonParts[0] === '' ? [] : doubleColonParts[0]!.split(':');
    const right = doubleColonParts[1] === '' ? [] : doubleColonParts[1]!.split(':');
    
    // Total groups must be <= 8
    if (left.length + right.length > 7) {
      return false;
    }
    
    // Validate each group
    return [...left, ...right].every(isValidIPv6Group);
  } else {
    // No ::, must have exactly 8 groups
    const groups = ip.split(':');
    if (groups.length !== 8) {
      return false;
    }
    
    return groups.every(isValidIPv6Group);
  }
}

/**
 * Validate a single IPv6 group (1-4 hex digits).
 */
function isValidIPv6Group(group: string): boolean {
  if (group.length === 0 || group.length > 4) {
    return false;
  }
  return /^[a-fA-F0-9]{1,4}$/.test(group);
}

/**
 * Validate IPv6 prefix (for IPv4-mapped addresses).
 */
function validateIPv6Prefix(prefix: string): boolean {
  // Remove trailing colons
  const cleaned = prefix.replace(/:+$/, '');
  if (cleaned === '') return true;
  
  const groups = cleaned.split(':').filter(g => g !== '');
  return groups.every(isValidIPv6Group);
}

/**
 * Check if an IPv6 address is IPv4-mapped (::ffff:x.x.x.x).
 */
export function isIPv4MappedIPv6(value: string): boolean {
  let ip = value;
  if (ip.startsWith('[') && ip.endsWith(']')) {
    ip = ip.slice(1, -1);
  }
  
  // Remove zone ID
  const zoneIndex = ip.indexOf('%');
  if (zoneIndex !== -1) {
    ip = ip.substring(0, zoneIndex);
  }
  
  // Normalize
  const lower = ip.toLowerCase();
  
  // Check for ::ffff: prefix with IPv4
  const ipv4MappedPrefixes = [
    '::ffff:',
    '0:0:0:0:0:ffff:',
    '0000:0000:0000:0000:0000:ffff:',
  ];
  
  for (const prefix of ipv4MappedPrefixes) {
    if (lower.startsWith(prefix)) {
      const rest = ip.substring(prefix.length);
      return isIPv4(rest);
    }
  }
  
  return false;
}

/**
 * Extract IPv4 address from IPv4-mapped IPv6.
 */
export function extractIPv4FromMapped(value: string): string | null {
  let ip = value;
  if (ip.startsWith('[') && ip.endsWith(']')) {
    ip = ip.slice(1, -1);
  }
  
  const zoneIndex = ip.indexOf('%');
  if (zoneIndex !== -1) {
    ip = ip.substring(0, zoneIndex);
  }
  
  const lower = ip.toLowerCase();
  
  const prefixes = [
    '::ffff:',
    '0:0:0:0:0:ffff:',
    '0000:0000:0000:0000:0000:ffff:',
  ];
  
  for (const prefix of prefixes) {
    if (lower.startsWith(prefix)) {
      const rest = ip.substring(prefix.length);
      if (isIPv4(rest)) {
        return rest;
      }
    }
  }
  
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────────
// IP TYPE DETECTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Detect the type of IP address in a string.
 */
export function detectIPType(value: string): IPType {
  if (isIPv4(value)) {
    return 'ipv4';
  }
  
  if (isIPv6(value)) {
    if (isIPv4MappedIPv6(value)) {
      return 'ipv4-mapped-ipv6';
    }
    return 'ipv6';
  }
  
  return 'none';
}

// ─────────────────────────────────────────────────────────────────────────────────
// IDN / PUNYCODE DETECTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Check if a hostname uses IDN (internationalized domain name).
 */
export function isIDN(hostname: string): boolean {
  // Check for non-ASCII characters
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7F]/.test(hostname)) {
    return true;
  }
  
  // Check for punycode prefix in any label
  const labels = hostname.split('.');
  return labels.some(label => label.toLowerCase().startsWith('xn--'));
}

/**
 * Convert hostname to ASCII (punycode) form.
 * Uses the built-in URL API for conversion.
 */
export function toASCII(hostname: string): string {
  try {
    // Use URL API to handle punycode conversion
    const url = new URL(`http://${hostname}`);
    return url.hostname;
  } catch {
    // If URL parsing fails, return original
    return hostname.toLowerCase();
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// ZONE ID DETECTION (IPv6)
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Extract zone ID from IPv6 address.
 */
export function extractZoneId(value: string): { ip: string; zoneId: string | null } {
  let ip = value;
  if (ip.startsWith('[') && ip.endsWith(']')) {
    ip = ip.slice(1, -1);
  }
  
  const zoneIndex = ip.indexOf('%');
  if (zoneIndex !== -1) {
    return {
      ip: ip.substring(0, zoneIndex),
      zoneId: ip.substring(zoneIndex + 1),
    };
  }
  
  return { ip, zoneId: null };
}

// ─────────────────────────────────────────────────────────────────────────────────
// EMBEDDED IP DETECTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Patterns that might contain embedded IPs in hostnames.
 */
const EMBEDDED_IP_PATTERNS = [
  // Direct decimal: evil.com.2130706433
  /(?:^|\.)(\d{8,10})(?:\.|$)/,
  
  // Hex encoded: evil.com.0x7f000001
  /(?:^|\.)(0x[0-9a-fA-F]{8})(?:\.|$)/,
  
  // IP in subdomain: 192-168-1-1.evil.com
  /^(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})\./,
  
  // IP with underscores: 192_168_1_1.evil.com
  /^(\d{1,3})_(\d{1,3})_(\d{1,3})_(\d{1,3})\./,
];

/**
 * Result of embedded IP detection.
 */
export interface EmbeddedIPResult {
  detected: boolean;
  ip?: string;
  pattern?: string;
}

/**
 * Detect embedded IP addresses in hostnames.
 */
export function detectEmbeddedIP(hostname: string): EmbeddedIPResult {
  // Check for decimal IP
  const decimalMatch = hostname.match(/(?:^|\.)(\d{8,10})(?:\.|$)/);
  if (decimalMatch) {
    const num = parseInt(decimalMatch[1]!, 10);
    if (num <= 0xFFFFFFFF) {
      return {
        detected: true,
        ip: numberToIPv4(num),
        pattern: 'decimal',
      };
    }
  }
  
  // Check for hex IP
  const hexMatch = hostname.match(/(?:^|\.)(0x[0-9a-fA-F]{8})(?:\.|$)/i);
  if (hexMatch) {
    const num = parseInt(hexMatch[1]!, 16);
    if (num <= 0xFFFFFFFF) {
      return {
        detected: true,
        ip: numberToIPv4(num),
        pattern: 'hex',
      };
    }
  }
  
  // Check for dashed IP (192-168-1-1.evil.com)
  const dashedMatch = hostname.match(/^(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})\./);
  if (dashedMatch) {
    const octets = [
      parseInt(dashedMatch[1]!, 10),
      parseInt(dashedMatch[2]!, 10),
      parseInt(dashedMatch[3]!, 10),
      parseInt(dashedMatch[4]!, 10),
    ];
    if (octets.every(o => o >= 0 && o <= 255)) {
      return {
        detected: true,
        ip: octets.join('.'),
        pattern: 'dashed',
      };
    }
  }
  
  // Check for underscored IP
  const underscoreMatch = hostname.match(/^(\d{1,3})_(\d{1,3})_(\d{1,3})_(\d{1,3})\./);
  if (underscoreMatch) {
    const octets = [
      parseInt(underscoreMatch[1]!, 10),
      parseInt(underscoreMatch[2]!, 10),
      parseInt(underscoreMatch[3]!, 10),
      parseInt(underscoreMatch[4]!, 10),
    ];
    if (octets.every(o => o >= 0 && o <= 255)) {
      return {
        detected: true,
        ip: octets.join('.'),
        pattern: 'underscore',
      };
    }
  }
  
  return { detected: false };
}

// ─────────────────────────────────────────────────────────────────────────────────
// URL PARSER
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Parse a URL safely with comprehensive security checks.
 * 
 * @param urlString - The URL to parse
 * @returns Parsed URL result with all metadata
 */
export function parseURL(urlString: string): URLParseResult {
  // Trim whitespace
  const trimmed = urlString.trim();
  
  if (!trimmed) {
    return {
      success: false,
      error: 'INVALID_URL',
      message: 'Empty URL',
    };
  }
  
  // Try to parse with URL API
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch (e) {
    return {
      success: false,
      error: 'INVALID_URL',
      message: `Failed to parse URL: ${e instanceof Error ? e.message : 'Unknown error'}`,
    };
  }
  
  // Extract scheme (without colon)
  const scheme = url.protocol.replace(/:$/, '').toLowerCase();
  
  // Check supported schemes
  if (!SUPPORTED_SCHEMES.includes(scheme as any)) {
    return {
      success: false,
      error: 'UNSUPPORTED_SCHEME',
      message: `Unsupported scheme: ${scheme}. Only ${SUPPORTED_SCHEMES.join(', ')} are allowed.`,
    };
  }
  
  // Extract hostname
  const hostname = url.hostname;
  if (!hostname) {
    return {
      success: false,
      error: 'EMPTY_HOSTNAME',
      message: 'URL has no hostname',
    };
  }
  
  // Extract userinfo
  const username = url.username || null;
  const password = url.password || null;
  
  // Extract port
  let port: number | null = null;
  let effectivePort: number;
  
  if (url.port) {
    port = parseInt(url.port, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      return {
        success: false,
        error: 'PORT_OUT_OF_RANGE',
        message: `Invalid port: ${url.port}`,
      };
    }
    effectivePort = port;
  } else {
    // Use default port for scheme
    effectivePort = SCHEME_DEFAULT_PORTS[scheme] ?? 80;
  }
  
  // Detect IP type
  const ipType = detectIPType(hostname);
  const isIPLiteral = ipType !== 'none';
  
  // Check for IDN
  const hostnameIsIDN = isIDN(hostname);
  const hostnameASCII = toASCII(hostname);
  
  // Check for zone ID (IPv6)
  let hasZoneId = false;
  let zoneId: string | null = null;
  
  if (ipType === 'ipv6' || ipType === 'ipv4-mapped-ipv6') {
    const zoneResult = extractZoneId(hostname);
    hasZoneId = zoneResult.zoneId !== null;
    zoneId = zoneResult.zoneId;
  }
  
  // Build path + query for request
  const path = url.pathname || '/';
  const query = url.search ? url.search.substring(1) : null;
  const fragment = url.hash ? url.hash.substring(1) : null;
  
  const parsed: ParsedURL = {
    original: trimmed,
    scheme,
    username,
    password,
    hostname,
    port,
    effectivePort,
    path,
    query,
    fragment,
    isIPLiteral,
    ipType,
    isIDN: hostnameIsIDN,
    hostnameASCII,
    hasZoneId,
    zoneId,
  };
  
  return {
    success: true,
    url: parsed,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Check if a hostname matches a pattern (exact or suffix match).
 * 
 * Examples:
 * - "example.com" matches "example.com"
 * - "sub.example.com" matches "example.com" (suffix)
 * - "example.com" matches ".example.com" (pattern with leading dot)
 */
export function hostnameMatches(hostname: string, pattern: string): boolean {
  const h = hostname.toLowerCase();
  const p = pattern.toLowerCase();
  
  // Exact match
  if (h === p) {
    return true;
  }
  
  // Pattern with leading dot matches subdomains
  if (p.startsWith('.')) {
    return h.endsWith(p) || h === p.substring(1);
  }
  
  // Hostname is subdomain of pattern
  return h.endsWith('.' + p);
}

/**
 * Build the request path from URL components.
 */
export function buildRequestPath(parsed: ParsedURL): string {
  let requestPath = parsed.path || '/';
  
  if (parsed.query) {
    requestPath += '?' + parsed.query;
  }
  
  return requestPath;
}

/**
 * Normalize a URL for comparison.
 */
export function normalizeURL(urlString: string): string | null {
  const result = parseURL(urlString);
  if (!result.success || !result.url) {
    return null;
  }
  
  const u = result.url;
  let normalized = `${u.scheme}://${u.hostnameASCII}`;
  
  // Add port only if non-default
  if (u.port !== null && u.port !== SCHEME_DEFAULT_PORTS[u.scheme]) {
    normalized += `:${u.port}`;
  }
  
  normalized += u.path;
  
  if (u.query) {
    normalized += `?${u.query}`;
  }
  
  return normalized;
}
