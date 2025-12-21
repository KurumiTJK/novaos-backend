// ═══════════════════════════════════════════════════════════════════════════════
// IP VALIDATOR — IPv4 and IPv6 Address Validation
// NovaOS Security — Phase 5: SSRF Protection Layer
// ═══════════════════════════════════════════════════════════════════════════════
//
// This module validates IP addresses and classifies them by type:
// - Private networks (RFC 1918)
// - Loopback addresses
// - Link-local addresses
// - Multicast addresses
// - Reserved/special-use addresses
//
// CRITICAL: This is the core security check that prevents SSRF attacks.
//
// ═══════════════════════════════════════════════════════════════════════════════

import {
  type IPClassification,
  type IPValidationResult,
  type IPUnsafeReason,
} from './types.js';
import {
  isIPv4,
  parseIPv4ToNumber,
  isIPv6,
  isIPv4MappedIPv6,
  extractIPv4FromMapped,
} from './url-parser.js';

// ─────────────────────────────────────────────────────────────────────────────────
// IPv4 CIDR RANGE DEFINITION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * IPv4 CIDR range definition.
 */
interface IPv4Range {
  /** Network address as 32-bit number */
  readonly network: number;
  /** Subnet mask as 32-bit number */
  readonly mask: number;
  /** CIDR prefix length */
  readonly prefix: number;
  /** Classification for this range */
  readonly classification: IPClassification;
  /** Reason IP is unsafe (if applicable) */
  readonly unsafeReason?: IPUnsafeReason;
  /** Human-readable description */
  readonly description: string;
}

/**
 * Parse a CIDR string to network and mask.
 */
function parseCIDR(cidr: string): { network: number; mask: number; prefix: number } {
  const [ip, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr!, 10);
  
  // Parse IP to number
  const parts = ip!.split('.').map(p => parseInt(p, 10));
  const network = ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
  
  // Create mask
  const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
  
  return { network: (network & mask) >>> 0, mask, prefix };
}

/**
 * Create an IPv4 range definition.
 */
function createRange(
  cidr: string,
  classification: IPClassification,
  description: string,
  unsafeReason?: IPUnsafeReason
): IPv4Range {
  const { network, mask, prefix } = parseCIDR(cidr);
  return { network, mask, prefix, classification, description, unsafeReason };
}

// ─────────────────────────────────────────────────────────────────────────────────
// IPv4 RANGES — Ordered by specificity (most specific first)
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * All IPv4 ranges to check, ordered by specificity.
 * More specific ranges are checked first.
 */
const IPV4_RANGES: readonly IPv4Range[] = [
  // ═══════════════════════════════════════════════════════════════════════════════
  // LOOPBACK — Most critical to block
  // ═══════════════════════════════════════════════════════════════════════════════
  createRange(
    '127.0.0.0/8',
    'LOOPBACK_V4',
    'Loopback (localhost)',
    'LOOPBACK'
  ),
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // PRIVATE NETWORKS — RFC 1918
  // ═══════════════════════════════════════════════════════════════════════════════
  createRange(
    '10.0.0.0/8',
    'PRIVATE_10',
    'Private Network (Class A)',
    'PRIVATE_NETWORK'
  ),
  createRange(
    '172.16.0.0/12',
    'PRIVATE_172',
    'Private Network (Class B)',
    'PRIVATE_NETWORK'
  ),
  createRange(
    '192.168.0.0/16',
    'PRIVATE_192',
    'Private Network (Class C)',
    'PRIVATE_NETWORK'
  ),
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // LINK-LOCAL
  // ═══════════════════════════════════════════════════════════════════════════════
  createRange(
    '169.254.0.0/16',
    'LINK_LOCAL_V4',
    'Link-Local (APIPA)',
    'LINK_LOCAL'
  ),
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // CARRIER-GRADE NAT — RFC 6598
  // ═══════════════════════════════════════════════════════════════════════════════
  createRange(
    '100.64.0.0/10',
    'CARRIER_GRADE_NAT',
    'Carrier-Grade NAT (RFC 6598)',
    'CARRIER_GRADE_NAT'
  ),
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // MULTICAST
  // ═══════════════════════════════════════════════════════════════════════════════
  createRange(
    '224.0.0.0/4',
    'MULTICAST_V4',
    'Multicast',
    'MULTICAST'
  ),
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // DOCUMENTATION — RFC 5737
  // ═══════════════════════════════════════════════════════════════════════════════
  createRange(
    '192.0.2.0/24',
    'DOCUMENTATION_V4',
    'Documentation (TEST-NET-1)',
    'DOCUMENTATION'
  ),
  createRange(
    '198.51.100.0/24',
    'DOCUMENTATION_V4',
    'Documentation (TEST-NET-2)',
    'DOCUMENTATION'
  ),
  createRange(
    '203.0.113.0/24',
    'DOCUMENTATION_V4',
    'Documentation (TEST-NET-3)',
    'DOCUMENTATION'
  ),
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // BENCHMARKING — RFC 2544
  // ═══════════════════════════════════════════════════════════════════════════════
  createRange(
    '198.18.0.0/15',
    'BENCHMARKING',
    'Benchmarking (RFC 2544)',
    'RESERVED'
  ),
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // THIS NETWORK — RFC 1122
  // ═══════════════════════════════════════════════════════════════════════════════
  createRange(
    '0.0.0.0/8',
    'THIS_NETWORK',
    '"This" Network',
    'THIS_NETWORK'
  ),
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // RESERVED / FUTURE USE — RFC 1112
  // ═══════════════════════════════════════════════════════════════════════════════
  createRange(
    '240.0.0.0/4',
    'RESERVED',
    'Reserved for Future Use',
    'RESERVED'
  ),
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // BROADCAST
  // ═══════════════════════════════════════════════════════════════════════════════
  createRange(
    '255.255.255.255/32',
    'BROADCAST',
    'Limited Broadcast',
    'BROADCAST'
  ),
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // PROTOCOL ASSIGNMENTS — RFC 5765
  // ═══════════════════════════════════════════════════════════════════════════════
  createRange(
    '192.0.0.0/24',
    'RESERVED',
    'IETF Protocol Assignments',
    'RESERVED'
  ),
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // DS-LITE — RFC 6333
  // ═══════════════════════════════════════════════════════════════════════════════
  createRange(
    '192.0.0.0/29',
    'RESERVED',
    'DS-Lite (RFC 6333)',
    'RESERVED'
  ),
];

// ─────────────────────────────────────────────────────────────────────────────────
// IPv4 VALIDATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Check if an IPv4 address matches a CIDR range.
 */
function ipMatchesRange(ipNum: number, range: IPv4Range): boolean {
  return (ipNum & range.mask) >>> 0 === range.network;
}

/**
 * Classify an IPv4 address.
 */
function classifyIPv4(ipNum: number): { classification: IPClassification; range?: IPv4Range } {
  for (const range of IPV4_RANGES) {
    if (ipMatchesRange(ipNum, range)) {
      return { classification: range.classification, range };
    }
  }
  return { classification: 'PUBLIC' };
}

/**
 * Normalize an IPv4 address to standard form.
 */
function normalizeIPv4(ip: string): string {
  const num = parseIPv4ToNumber(ip);
  if (num === null) return ip;
  
  return [
    (num >>> 24) & 0xff,
    (num >>> 16) & 0xff,
    (num >>> 8) & 0xff,
    num & 0xff,
  ].join('.');
}

/**
 * Validate an IPv4 address.
 * 
 * @param ip - The IPv4 address to validate
 * @param allowPrivate - Whether to allow private IPs (default: false)
 * @param allowLoopback - Whether to allow loopback (default: false)
 * @returns Validation result with classification
 */
export function validateIPv4(
  ip: string,
  options: { allowPrivate?: boolean; allowLoopback?: boolean } = {}
): IPValidationResult {
  const { allowPrivate = false, allowLoopback = false } = options;
  
  // Basic format validation
  if (!isIPv4(ip)) {
    return {
      ip,
      valid: false,
      version: null,
      classification: 'UNKNOWN',
      isSafe: false,
      unsafeReason: 'INVALID_FORMAT',
      normalized: ip,
    };
  }
  
  // Parse to number
  const ipNum = parseIPv4ToNumber(ip);
  if (ipNum === null) {
    return {
      ip,
      valid: false,
      version: null,
      classification: 'UNKNOWN',
      isSafe: false,
      unsafeReason: 'INVALID_FORMAT',
      normalized: ip,
    };
  }
  
  // Classify
  const { classification, range } = classifyIPv4(ipNum);
  const normalized = normalizeIPv4(ip);
  
  // Determine if safe
  let isSafe = true;
  let unsafeReason: IPUnsafeReason | undefined;
  
  if (range?.unsafeReason) {
    // Check if this unsafe category is allowed
    switch (range.unsafeReason) {
      case 'LOOPBACK':
        if (!allowLoopback) {
          isSafe = false;
          unsafeReason = 'LOOPBACK';
        }
        break;
      
      case 'PRIVATE_NETWORK':
        if (!allowPrivate) {
          isSafe = false;
          unsafeReason = 'PRIVATE_NETWORK';
        }
        break;
      
      case 'LINK_LOCAL':
        if (!allowPrivate) {
          isSafe = false;
          unsafeReason = 'LINK_LOCAL';
        }
        break;
      
      case 'CARRIER_GRADE_NAT':
        if (!allowPrivate) {
          isSafe = false;
          unsafeReason = 'CARRIER_GRADE_NAT';
        }
        break;
      
      default:
        // All other unsafe reasons are always blocked
        isSafe = false;
        unsafeReason = range.unsafeReason;
    }
  }
  
  return {
    ip,
    valid: true,
    version: 4,
    classification,
    isSafe,
    unsafeReason,
    normalized,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// IPv6 RANGES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * IPv6 range check function type.
 */
type IPv6RangeCheck = (segments: number[]) => boolean;

/**
 * IPv6 range definition.
 */
interface IPv6Range {
  readonly name: string;
  readonly check: IPv6RangeCheck;
  readonly classification: IPClassification;
  readonly unsafeReason?: IPUnsafeReason;
  readonly description: string;
}

/**
 * Parse IPv6 to 8 segments (16-bit each).
 */
function parseIPv6Segments(ip: string): number[] | null {
  // Remove brackets
  let cleaned = ip;
  if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
    cleaned = cleaned.slice(1, -1);
  }
  
  // Remove zone ID
  const zoneIndex = cleaned.indexOf('%');
  if (zoneIndex !== -1) {
    cleaned = cleaned.substring(0, zoneIndex);
  }
  
  // Handle :: expansion
  const parts = cleaned.split('::');
  if (parts.length > 2) return null;
  
  let left: string[] = [];
  let right: string[] = [];
  
  if (parts.length === 2) {
    left = parts[0] === '' ? [] : parts[0]!.split(':');
    right = parts[1] === '' ? [] : parts[1]!.split(':');
  } else {
    left = cleaned.split(':');
  }
  
  // Handle IPv4 suffix
  const lastPart = (right.length > 0 ? right : left).slice(-1)[0];
  if (lastPart && lastPart.includes('.')) {
    // IPv4-mapped/compatible
    const ipv4Parts = lastPart.split('.').map(p => parseInt(p, 10));
    if (ipv4Parts.length !== 4 || ipv4Parts.some(p => isNaN(p) || p < 0 || p > 255)) {
      return null;
    }
    
    // Convert IPv4 to two 16-bit segments
    const ipv4Segments = [
      (ipv4Parts[0]! << 8) | ipv4Parts[1]!,
      (ipv4Parts[2]! << 8) | ipv4Parts[3]!,
    ];
    
    if (right.length > 0) {
      right = [...right.slice(0, -1), ...ipv4Segments.map(s => s.toString(16))];
    } else {
      left = [...left.slice(0, -1), ...ipv4Segments.map(s => s.toString(16))];
    }
  }
  
  // Calculate number of zero segments to insert
  const totalSegments = left.length + right.length;
  if (parts.length === 2) {
    // Has ::
    const zerosNeeded = 8 - totalSegments;
    if (zerosNeeded < 0) return null;
    
    const zeros = new Array(zerosNeeded).fill('0');
    const allParts = [...left, ...zeros, ...right];
    
    if (allParts.length !== 8) return null;
    
    return allParts.map(p => parseInt(p, 16));
  } else {
    if (left.length !== 8) return null;
    return left.map(p => parseInt(p, 16));
  }
}

/**
 * IPv6 ranges to check.
 */
const IPV6_RANGES: readonly IPv6Range[] = [
  // ═══════════════════════════════════════════════════════════════════════════════
  // LOOPBACK — ::1
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    name: 'Loopback',
    check: (s) => s[0] === 0 && s[1] === 0 && s[2] === 0 && s[3] === 0 &&
                  s[4] === 0 && s[5] === 0 && s[6] === 0 && s[7] === 1,
    classification: 'LOOPBACK_V6',
    unsafeReason: 'LOOPBACK',
    description: 'IPv6 Loopback (::1)',
  },
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // UNSPECIFIED — ::
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    name: 'Unspecified',
    check: (s) => s.every(seg => seg === 0),
    classification: 'THIS_NETWORK',
    unsafeReason: 'THIS_NETWORK',
    description: 'IPv6 Unspecified (::)',
  },
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // IPv4-MAPPED — ::ffff:0:0/96
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    name: 'IPv4-Mapped',
    check: (s) => s[0] === 0 && s[1] === 0 && s[2] === 0 && s[3] === 0 &&
                  s[4] === 0 && s[5] === 0xffff,
    classification: 'IPV4_MAPPED',
    // Note: Safety depends on the embedded IPv4 - checked separately
    description: 'IPv4-Mapped IPv6 (::ffff:0:0/96)',
  },
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // IPv4-TRANSLATED — ::ffff:0:0:0/96
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    name: 'IPv4-Translated',
    check: (s) => s[0] === 0 && s[1] === 0 && s[2] === 0 && s[3] === 0 &&
                  s[4] === 0xffff && s[5] === 0,
    classification: 'IPV4_TRANSLATED',
    unsafeReason: 'RESERVED',
    description: 'IPv4-Translated (::ffff:0:0:0/96)',
  },
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // LINK-LOCAL — fe80::/10
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    name: 'Link-Local',
    check: (s) => (s[0]! & 0xffc0) === 0xfe80,
    classification: 'LINK_LOCAL_V6',
    unsafeReason: 'LINK_LOCAL',
    description: 'IPv6 Link-Local (fe80::/10)',
  },
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // UNIQUE LOCAL — fc00::/7 (includes fd00::/8)
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    name: 'Unique Local',
    check: (s) => (s[0]! & 0xfe00) === 0xfc00,
    classification: 'PRIVATE_FC',
    unsafeReason: 'PRIVATE_NETWORK',
    description: 'IPv6 Unique Local (fc00::/7)',
  },
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // MULTICAST — ff00::/8
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    name: 'Multicast',
    check: (s) => (s[0]! & 0xff00) === 0xff00,
    classification: 'MULTICAST_V6',
    unsafeReason: 'MULTICAST',
    description: 'IPv6 Multicast (ff00::/8)',
  },
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // DOCUMENTATION — 2001:db8::/32
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    name: 'Documentation',
    check: (s) => s[0] === 0x2001 && s[1] === 0x0db8,
    classification: 'DOCUMENTATION_V6',
    unsafeReason: 'DOCUMENTATION',
    description: 'IPv6 Documentation (2001:db8::/32)',
  },
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // TEREDO — 2001::/32
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    name: 'Teredo',
    check: (s) => s[0] === 0x2001 && s[1] === 0,
    classification: 'TEREDO',
    // Teredo embeds IPv4 - needs special handling
    description: 'Teredo Tunneling (2001::/32)',
  },
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // 6TO4 — 2002::/16
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    name: '6to4',
    check: (s) => s[0] === 0x2002,
    classification: '6TO4',
    // 6to4 embeds IPv4 in bits 16-47 - needs special handling
    description: '6to4 Tunneling (2002::/16)',
  },
];

// ─────────────────────────────────────────────────────────────────────────────────
// IPv6 VALIDATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Classify an IPv6 address.
 */
function classifyIPv6(segments: number[]): { classification: IPClassification; range?: IPv6Range } {
  for (const range of IPV6_RANGES) {
    if (range.check(segments)) {
      return { classification: range.classification, range };
    }
  }
  return { classification: 'PUBLIC' };
}

/**
 * Normalize IPv6 to canonical form.
 */
function normalizeIPv6(segments: number[]): string {
  // Find longest run of zeros for ::
  let longestStart = -1;
  let longestLen = 0;
  let currentStart = -1;
  let currentLen = 0;
  
  for (let i = 0; i < 8; i++) {
    if (segments[i] === 0) {
      if (currentStart === -1) {
        currentStart = i;
        currentLen = 1;
      } else {
        currentLen++;
      }
    } else {
      if (currentLen > longestLen) {
        longestStart = currentStart;
        longestLen = currentLen;
      }
      currentStart = -1;
      currentLen = 0;
    }
  }
  
  if (currentLen > longestLen) {
    longestStart = currentStart;
    longestLen = currentLen;
  }
  
  // Build string
  const parts: string[] = [];
  let i = 0;
  
  while (i < 8) {
    if (longestLen >= 2 && i === longestStart) {
      parts.push(i === 0 ? ':' : '');
      i += longestLen;
      if (i === 8) parts.push(':');
    } else {
      parts.push(segments[i]!.toString(16));
      i++;
    }
  }
  
  return parts.join(':').replace(/:{3,}/, '::');
}

/**
 * Extract embedded IPv4 from 6to4 address (2002::/16).
 */
function extract6to4IPv4(segments: number[]): string | null {
  if (segments[0] !== 0x2002) return null;
  
  const octet1 = (segments[1]! >> 8) & 0xff;
  const octet2 = segments[1]! & 0xff;
  const octet3 = (segments[2]! >> 8) & 0xff;
  const octet4 = segments[2]! & 0xff;
  
  return `${octet1}.${octet2}.${octet3}.${octet4}`;
}

/**
 * Extract embedded IPv4 from Teredo address (2001::/32).
 */
function extractTeredoIPv4(segments: number[]): string | null {
  if (segments[0] !== 0x2001 || segments[1] !== 0) return null;
  
  // Teredo embeds the IPv4 XORed with 0xFFFFFFFF in the last 32 bits
  const xored = ((segments[6]! << 16) | segments[7]!) >>> 0;
  const ip = (xored ^ 0xFFFFFFFF) >>> 0;
  
  return [
    (ip >>> 24) & 0xff,
    (ip >>> 16) & 0xff,
    (ip >>> 8) & 0xff,
    ip & 0xff,
  ].join('.');
}

/**
 * Validate an IPv6 address.
 * 
 * @param ip - The IPv6 address to validate
 * @param options - Validation options
 * @returns Validation result with classification
 */
export function validateIPv6(
  ip: string,
  options: { allowPrivate?: boolean; allowLoopback?: boolean } = {}
): IPValidationResult {
  const { allowPrivate = false, allowLoopback = false } = options;
  
  // Basic format validation
  if (!isIPv6(ip)) {
    return {
      ip,
      valid: false,
      version: null,
      classification: 'UNKNOWN',
      isSafe: false,
      unsafeReason: 'INVALID_FORMAT',
      normalized: ip,
    };
  }
  
  // Parse to segments
  const segments = parseIPv6Segments(ip);
  if (!segments) {
    return {
      ip,
      valid: false,
      version: null,
      classification: 'UNKNOWN',
      isSafe: false,
      unsafeReason: 'INVALID_FORMAT',
      normalized: ip,
    };
  }
  
  // Classify
  const { classification, range } = classifyIPv6(segments);
  const normalized = normalizeIPv6(segments);
  
  // Handle IPv4-mapped addresses specially
  if (classification === 'IPV4_MAPPED') {
    const embeddedIPv4 = extractIPv4FromMapped(ip);
    if (embeddedIPv4) {
      // Validate the embedded IPv4
      const ipv4Result = validateIPv4(embeddedIPv4, options);
      
      return {
        ip,
        valid: true,
        version: 6,
        classification: 'IPV4_MAPPED',
        isSafe: ipv4Result.isSafe,
        unsafeReason: ipv4Result.isSafe ? undefined : 'IPV4_MAPPED_PRIVATE',
        embeddedIPv4,
        embeddedClassification: ipv4Result.classification,
        normalized,
      };
    }
  }
  
  // Handle 6to4 addresses
  if (classification === '6TO4') {
    const embeddedIPv4 = extract6to4IPv4(segments);
    if (embeddedIPv4) {
      const ipv4Result = validateIPv4(embeddedIPv4, options);
      
      return {
        ip,
        valid: true,
        version: 6,
        classification: '6TO4',
        isSafe: ipv4Result.isSafe,
        unsafeReason: ipv4Result.isSafe ? undefined : 'IPV4_MAPPED_PRIVATE',
        embeddedIPv4,
        embeddedClassification: ipv4Result.classification,
        normalized,
      };
    }
  }
  
  // Handle Teredo addresses
  if (classification === 'TEREDO') {
    const embeddedIPv4 = extractTeredoIPv4(segments);
    if (embeddedIPv4) {
      const ipv4Result = validateIPv4(embeddedIPv4, options);
      
      return {
        ip,
        valid: true,
        version: 6,
        classification: 'TEREDO',
        isSafe: ipv4Result.isSafe,
        unsafeReason: ipv4Result.isSafe ? undefined : 'IPV4_MAPPED_PRIVATE',
        embeddedIPv4,
        embeddedClassification: ipv4Result.classification,
        normalized,
      };
    }
  }
  
  // Determine if safe
  let isSafe = true;
  let unsafeReason: IPUnsafeReason | undefined;
  
  if (range?.unsafeReason) {
    switch (range.unsafeReason) {
      case 'LOOPBACK':
        if (!allowLoopback) {
          isSafe = false;
          unsafeReason = 'LOOPBACK';
        }
        break;
      
      case 'PRIVATE_NETWORK':
        if (!allowPrivate) {
          isSafe = false;
          unsafeReason = 'PRIVATE_NETWORK';
        }
        break;
      
      case 'LINK_LOCAL':
        if (!allowPrivate) {
          isSafe = false;
          unsafeReason = 'LINK_LOCAL';
        }
        break;
      
      default:
        isSafe = false;
        unsafeReason = range.unsafeReason;
    }
  }
  
  return {
    ip,
    valid: true,
    version: 6,
    classification,
    isSafe,
    unsafeReason,
    normalized,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// UNIFIED VALIDATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Validate any IP address (IPv4 or IPv6).
 * 
 * @param ip - The IP address to validate
 * @param options - Validation options
 * @returns Validation result with classification
 */
export function validateIP(
  ip: string,
  options: { allowPrivate?: boolean; allowLoopback?: boolean } = {}
): IPValidationResult {
  // Try IPv4 first
  if (isIPv4(ip)) {
    return validateIPv4(ip, options);
  }
  
  // Try IPv6
  if (isIPv6(ip)) {
    return validateIPv6(ip, options);
  }
  
  // Invalid format
  return {
    ip,
    valid: false,
    version: null,
    classification: 'UNKNOWN',
    isSafe: false,
    unsafeReason: 'INVALID_FORMAT',
    normalized: ip,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONVENIENCE FUNCTIONS
// ─────────────────────────────────────────────────────════════════════════════════

/**
 * Quick check if an IP is private (RFC 1918 or IPv6 equivalent).
 */
export function isPrivateIP(ip: string): boolean {
  const result = validateIP(ip);
  if (!result.valid) return false;
  
  const privateClassifications: IPClassification[] = [
    'PRIVATE_10',
    'PRIVATE_172',
    'PRIVATE_192',
    'PRIVATE_FC',
    'CARRIER_GRADE_NAT',
  ];
  
  return privateClassifications.includes(result.classification);
}

/**
 * Quick check if an IP is loopback.
 */
export function isLoopbackIP(ip: string): boolean {
  const result = validateIP(ip);
  if (!result.valid) return false;
  
  return result.classification === 'LOOPBACK_V4' || result.classification === 'LOOPBACK_V6';
}

/**
 * Quick check if an IP is link-local.
 */
export function isLinkLocalIP(ip: string): boolean {
  const result = validateIP(ip);
  if (!result.valid) return false;
  
  return result.classification === 'LINK_LOCAL_V4' || result.classification === 'LINK_LOCAL_V6';
}

/**
 * Quick check if an IP is safe for external connections.
 */
export function isSafeIP(ip: string): boolean {
  const result = validateIP(ip);
  return result.valid && result.isSafe;
}

/**
 * Get a human-readable description of why an IP is unsafe.
 */
export function getUnsafeIPReason(ip: string): string | null {
  const result = validateIP(ip);
  
  if (!result.valid) {
    return 'Invalid IP address format';
  }
  
  if (result.isSafe) {
    return null;
  }
  
  switch (result.unsafeReason) {
    case 'PRIVATE_NETWORK':
      return 'Private network address (RFC 1918)';
    case 'LOOPBACK':
      return 'Loopback address (localhost)';
    case 'LINK_LOCAL':
      return 'Link-local address';
    case 'MULTICAST':
      return 'Multicast address';
    case 'BROADCAST':
      return 'Broadcast address';
    case 'RESERVED':
      return 'Reserved address';
    case 'DOCUMENTATION':
      return 'Documentation address';
    case 'CARRIER_GRADE_NAT':
      return 'Carrier-grade NAT address';
    case 'THIS_NETWORK':
      return '"This network" address';
    case 'IPV4_MAPPED_PRIVATE':
      return 'IPv4-mapped address with private IPv4';
    case 'ALTERNATE_ENCODING':
      return 'Alternate IP encoding detected';
    default:
      return 'Address not allowed';
  }
}
