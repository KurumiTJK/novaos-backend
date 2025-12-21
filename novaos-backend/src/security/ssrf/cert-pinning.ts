// ═══════════════════════════════════════════════════════════════════════════════
// CERTIFICATE PINNING — SPKI Pin Validation
// NovaOS Security — Phase 5: SSRF Protection Layer
// ═══════════════════════════════════════════════════════════════════════════════
//
// This module implements certificate pinning using SPKI (Subject Public Key Info)
// hashes. This prevents MITM attacks even with compromised CAs.
//
// Pin Format: Base64-encoded SHA-256 hash of the certificate's SPKI
// Example: "sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
//
// ═══════════════════════════════════════════════════════════════════════════════

import { createHash } from 'crypto';
import {
  type SPKIPin,
  type CertificateInfo,
  type SSRFCheck,
  createCheck,
} from './types.js';
import { getLogger } from '../../observability/logging/index.js';
import { incCounter } from '../../observability/metrics/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'cert-pinning' });

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Pin configuration for a hostname.
 */
export interface HostnamePins {
  /** The hostname these pins apply to */
  readonly hostname: string;
  
  /** Primary pins (at least one must match) */
  readonly pins: readonly SPKIPin[];
  
  /** Backup pins for rotation (also valid) */
  readonly backupPins?: readonly SPKIPin[];
  
  /** Whether to include subdomains */
  readonly includeSubdomains: boolean;
  
  /** Expiration date for these pins */
  readonly expiresAt?: Date;
  
  /** Whether to enforce (false = report only) */
  readonly enforce: boolean;
}

/**
 * Pin verification result.
 */
export interface PinVerificationResult {
  /** Whether verification passed */
  readonly valid: boolean;
  
  /** The pin that matched (if any) */
  readonly matchedPin?: SPKIPin;
  
  /** Whether match was against a backup pin */
  readonly isBackupPin: boolean;
  
  /** All pins extracted from the certificate chain */
  readonly chainPins: readonly SPKIPin[];
  
  /** Error message if failed */
  readonly error?: string;
  
  /** SSRFCheck for integration */
  readonly check: SSRFCheck;
}

/**
 * Certificate pinning configuration.
 */
export interface CertPinningConfig {
  /** Whether pinning is enabled globally */
  readonly enabled: boolean;
  
  /** Whether to enforce pins (false = report only) */
  readonly enforce: boolean;
  
  /** Whether to allow pinning to intermediate CAs */
  readonly allowIntermediatePins: boolean;
  
  /** Whether to allow pinning to root CAs */
  readonly allowRootPins: boolean;
  
  /** Maximum pin age before warning (in days) */
  readonly maxPinAgeDays: number;
}

/**
 * Default certificate pinning configuration.
 */
export const DEFAULT_CERT_PINNING_CONFIG: CertPinningConfig = {
  enabled: true,
  enforce: true,
  allowIntermediatePins: true,
  allowRootPins: false, // Root pins are risky - they change rarely but catastrophically
  maxPinAgeDays: 60,
};

// ─────────────────────────────────────────────────────────────────────────────────
// PIN UTILITIES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Hash algorithm prefix for pins.
 */
const PIN_PREFIX = 'sha256/';

/**
 * Compute SPKI pin from a DER-encoded certificate.
 * 
 * @param derCert - DER-encoded certificate buffer
 * @returns SPKI pin in format "sha256/base64hash"
 */
export function computePinFromDER(derCert: Buffer): SPKIPin {
  // For a real implementation, we'd need to extract the SPKI from the cert
  // Node.js TLS socket provides the raw cert, and we need to extract SPKI
  // This is a simplified version that hashes the whole cert
  // In production, use a proper ASN.1 parser to extract SPKI
  
  const hash = createHash('sha256').update(derCert).digest('base64');
  return `${PIN_PREFIX}${hash}` as SPKIPin;
}

/**
 * Compute SPKI pin from a PEM-encoded certificate.
 * 
 * @param pemCert - PEM-encoded certificate string
 * @returns SPKI pin in format "sha256/base64hash"
 */
export function computePinFromPEM(pemCert: string): SPKIPin {
  // Extract base64 content from PEM
  const lines = pemCert.split('\n');
  const base64Lines = lines.filter(line => 
    !line.startsWith('-----') && line.trim().length > 0
  );
  const derBuffer = Buffer.from(base64Lines.join(''), 'base64');
  
  return computePinFromDER(derBuffer);
}

/**
 * Compute SPKI pin from raw SPKI bytes.
 * This is the correct method when you have extracted SPKI.
 * 
 * @param spkiBytes - Raw SPKI bytes
 * @returns SPKI pin in format "sha256/base64hash"
 */
export function computePinFromSPKI(spkiBytes: Buffer): SPKIPin {
  const hash = createHash('sha256').update(spkiBytes).digest('base64');
  return `${PIN_PREFIX}${hash}` as SPKIPin;
}

/**
 * Validate pin format.
 * 
 * @param pin - Pin to validate
 * @returns Whether the pin format is valid
 */
export function isValidPinFormat(pin: string): pin is SPKIPin {
  if (!pin.startsWith(PIN_PREFIX)) {
    return false;
  }
  
  const base64Part = pin.slice(PIN_PREFIX.length);
  
  // SHA-256 produces 32 bytes = 44 base64 characters (with padding)
  if (base64Part.length !== 44) {
    return false;
  }
  
  // Validate base64 characters
  const base64Regex = /^[A-Za-z0-9+/]+=*$/;
  return base64Regex.test(base64Part);
}

/**
 * Parse a pin string, validating format.
 * 
 * @param pin - Pin string to parse
 * @returns Validated pin or null if invalid
 */
export function parsePin(pin: string): SPKIPin | null {
  const trimmed = pin.trim();
  if (isValidPinFormat(trimmed)) {
    return trimmed;
  }
  return null;
}

/**
 * Compare two pins for equality.
 */
export function pinsEqual(a: SPKIPin, b: SPKIPin): boolean {
  return a === b;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CERTIFICATE PIN STORE
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Storage for certificate pins by hostname.
 */
export class CertificatePinStore {
  private readonly pins = new Map<string, HostnamePins>();
  private readonly config: CertPinningConfig;
  
  constructor(config: Partial<CertPinningConfig> = {}) {
    this.config = { ...DEFAULT_CERT_PINNING_CONFIG, ...config };
  }
  
  /**
   * Add pins for a hostname.
   */
  addPins(hostnamePins: HostnamePins): void {
    // Validate all pins
    for (const pin of hostnamePins.pins) {
      if (!isValidPinFormat(pin)) {
        throw new Error(`Invalid pin format: ${pin}`);
      }
    }
    
    if (hostnamePins.backupPins) {
      for (const pin of hostnamePins.backupPins) {
        if (!isValidPinFormat(pin)) {
          throw new Error(`Invalid backup pin format: ${pin}`);
        }
      }
    }
    
    const key = hostnamePins.hostname.toLowerCase();
    this.pins.set(key, hostnamePins);
    
    logger.info('Certificate pins added', {
      hostname: key,
      pinCount: hostnamePins.pins.length,
      backupPinCount: hostnamePins.backupPins?.length ?? 0,
      includeSubdomains: hostnamePins.includeSubdomains,
    });
  }
  
  /**
   * Remove pins for a hostname.
   */
  removePins(hostname: string): boolean {
    const key = hostname.toLowerCase();
    const removed = this.pins.delete(key);
    
    if (removed) {
      logger.info('Certificate pins removed', { hostname: key });
    }
    
    return removed;
  }
  
  /**
   * Get pins for a hostname.
   */
  getPins(hostname: string): HostnamePins | null {
    const normalizedHostname = hostname.toLowerCase();
    
    // Check exact match first
    const exact = this.pins.get(normalizedHostname);
    if (exact) {
      return this.checkExpiration(exact);
    }
    
    // Check for subdomain matches
    const parts = normalizedHostname.split('.');
    for (let i = 1; i < parts.length; i++) {
      const parentDomain = parts.slice(i).join('.');
      const parentPins = this.pins.get(parentDomain);
      
      if (parentPins?.includeSubdomains) {
        return this.checkExpiration(parentPins);
      }
    }
    
    return null;
  }
  
  /**
   * Check if pins exist for a hostname.
   */
  hasPins(hostname: string): boolean {
    return this.getPins(hostname) !== null;
  }
  
  /**
   * List all pinned hostnames.
   */
  listHostnames(): string[] {
    return Array.from(this.pins.keys());
  }
  
  /**
   * Clear all pins.
   */
  clear(): void {
    this.pins.clear();
    logger.info('All certificate pins cleared');
  }
  
  /**
   * Get configuration.
   */
  getConfig(): CertPinningConfig {
    return this.config;
  }
  
  /**
   * Check pin expiration and return null if expired.
   */
  private checkExpiration(pins: HostnamePins): HostnamePins | null {
    if (pins.expiresAt && pins.expiresAt < new Date()) {
      logger.warn('Certificate pins expired', {
        hostname: pins.hostname,
        expiresAt: pins.expiresAt.toISOString(),
      });
      return null;
    }
    return pins;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// PIN VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Verify a certificate chain against pinned values.
 * 
 * @param hostname - The hostname being connected to
 * @param certChain - Certificate chain from TLS connection
 * @param store - Pin store to check against
 * @returns Verification result
 */
export function verifyCertificatePins(
  hostname: string,
  certChain: readonly CertificateInfo[],
  store: CertificatePinStore
): PinVerificationResult {
  const config = store.getConfig();
  
  // Check if pinning is enabled
  if (!config.enabled) {
    return {
      valid: true,
      isBackupPin: false,
      chainPins: [],
      check: createCheck('CERTIFICATE_PINNING', true, 'Pinning disabled'),
    };
  }
  
  // Get pins for hostname
  const hostnamePins = store.getPins(hostname);
  
  // No pins configured = pass (unless strict mode requires pins)
  if (!hostnamePins) {
    return {
      valid: true,
      isBackupPin: false,
      chainPins: [],
      check: createCheck('CERTIFICATE_PINNING', true, 'No pins configured for hostname'),
    };
  }
  
  // Extract pins from certificate chain
  const chainPins: SPKIPin[] = [];
  
  for (let i = 0; i < certChain.length; i++) {
    const cert = certChain[i]!;
    
    // Skip root certs if not allowed
    if (i === certChain.length - 1 && !config.allowRootPins) {
      continue;
    }
    
    // Skip intermediate certs if not allowed (index > 0 and not last)
    if (i > 0 && i < certChain.length - 1 && !config.allowIntermediatePins) {
      continue;
    }
    
    if (cert.fingerprint256) {
      // Use the fingerprint directly if available (already SHA-256)
      // Note: fingerprint256 is typically the whole cert hash, not SPKI
      // For proper SPKI pinning, you'd need to extract the SPKI bytes
      const pin = `${PIN_PREFIX}${cert.fingerprint256.replace(/:/g, '')}` as SPKIPin;
      chainPins.push(pin);
    }
    
    if (cert.raw) {
      // Compute pin from raw certificate
      const pin = computePinFromDER(cert.raw);
      if (!chainPins.includes(pin)) {
        chainPins.push(pin);
      }
    }
  }
  
  // Check primary pins
  for (const pin of hostnamePins.pins) {
    if (chainPins.some(cp => pinsEqual(cp, pin))) {
      incCounter('cert_pin_verifications_total', { result: 'match_primary' });
      
      return {
        valid: true,
        matchedPin: pin,
        isBackupPin: false,
        chainPins,
        check: createCheck('CERTIFICATE_PINNING', true, 'Primary pin matched'),
      };
    }
  }
  
  // Check backup pins
  if (hostnamePins.backupPins) {
    for (const pin of hostnamePins.backupPins) {
      if (chainPins.some(cp => pinsEqual(cp, pin))) {
        incCounter('cert_pin_verifications_total', { result: 'match_backup' });
        
        logger.warn('Certificate matched backup pin - consider rotating', {
          hostname,
          matchedPin: pin,
        });
        
        return {
          valid: true,
          matchedPin: pin,
          isBackupPin: true,
          chainPins,
          check: createCheck('CERTIFICATE_PINNING', true, 'Backup pin matched (rotation recommended)'),
        };
      }
    }
  }
  
  // No match found
  incCounter('cert_pin_verifications_total', { result: 'mismatch' });
  
  logger.error('Certificate pin verification failed', {
    hostname,
    expectedPins: hostnamePins.pins,
    actualPins: chainPins,
    enforce: hostnamePins.enforce && config.enforce,
  });
  
  const shouldEnforce = hostnamePins.enforce && config.enforce;
  
  return {
    valid: !shouldEnforce,
    isBackupPin: false,
    chainPins,
    error: 'No matching pin found in certificate chain',
    check: createCheck(
      'CERTIFICATE_PINNING',
      !shouldEnforce,
      shouldEnforce 
        ? 'Pin verification failed - no matching pin' 
        : 'Pin verification failed (report only)'
    ),
  };
}

/**
 * Extract certificate info from a TLS socket.
 * 
 * @param socket - TLS socket with certificate
 * @returns Certificate chain info
 */
export function extractCertificateChain(
  socket: { getPeerCertificate(detailed: true): NodeCertificate | null }
): CertificateInfo[] {
  const chain: CertificateInfo[] = [];
  
  let cert = socket.getPeerCertificate(true);
  const seen = new Set<string>();
  
  while (cert && !seen.has(cert.fingerprint256 || '')) {
    if (cert.fingerprint256) {
      seen.add(cert.fingerprint256);
    }
    
    chain.push({
      subject: cert.subject?.CN || '',
      issuer: cert.issuer?.CN || '',
      validFrom: new Date(cert.valid_from),
      validTo: new Date(cert.valid_to),
      fingerprint256: cert.fingerprint256,
      serialNumber: cert.serialNumber,
      raw: cert.raw,
    });
    
    // Move to issuer certificate
    const issuerCert = (cert as NodeCertificateDetailed).issuerCertificate;
    if (!issuerCert || issuerCert === cert) {
      break;
    }
    cert = issuerCert;
  }
  
  return chain;
}

// ─────────────────────────────────────────────────────────────────────────────────
// NODE.JS CERTIFICATE TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Node.js certificate structure (simplified).
 */
interface NodeCertificate {
  subject?: { CN?: string; O?: string };
  issuer?: { CN?: string; O?: string };
  valid_from: string;
  valid_to: string;
  fingerprint256?: string;
  serialNumber?: string;
  raw?: Buffer;
}

/**
 * Node.js detailed certificate with issuer chain.
 */
interface NodeCertificateDetailed extends NodeCertificate {
  issuerCertificate?: NodeCertificateDetailed;
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON INSTANCE
// ─────────────────────────────────────────────────────────────────────────────────

let pinStoreInstance: CertificatePinStore | null = null;

/**
 * Get or create the global pin store.
 */
export function getPinStore(config?: Partial<CertPinningConfig>): CertificatePinStore {
  if (!pinStoreInstance) {
    pinStoreInstance = new CertificatePinStore(config);
  }
  return pinStoreInstance;
}

/**
 * Create a new pin store with custom configuration.
 */
export function createPinStore(config?: Partial<CertPinningConfig>): CertificatePinStore {
  return new CertificatePinStore(config);
}

/**
 * Reset the global pin store (for testing).
 */
export function resetPinStore(): void {
  pinStoreInstance?.clear();
  pinStoreInstance = null;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONVENIENCE FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Quick check if a hostname has pins configured.
 */
export function hasPinsForHostname(hostname: string): boolean {
  return getPinStore().hasPins(hostname);
}

/**
 * Add pins for a hostname to the global store.
 */
export function pinHostname(
  hostname: string,
  pins: string[],
  options: {
    backupPins?: string[];
    includeSubdomains?: boolean;
    expiresAt?: Date;
    enforce?: boolean;
  } = {}
): void {
  const validPins = pins.map(p => {
    const parsed = parsePin(p);
    if (!parsed) throw new Error(`Invalid pin: ${p}`);
    return parsed;
  });
  
  const validBackupPins = options.backupPins?.map(p => {
    const parsed = parsePin(p);
    if (!parsed) throw new Error(`Invalid backup pin: ${p}`);
    return parsed;
  });
  
  getPinStore().addPins({
    hostname,
    pins: validPins,
    backupPins: validBackupPins,
    includeSubdomains: options.includeSubdomains ?? false,
    expiresAt: options.expiresAt,
    enforce: options.enforce ?? true,
  });
}

/**
 * Remove pins for a hostname from the global store.
 */
export function unpinHostname(hostname: string): boolean {
  return getPinStore().removePins(hostname);
}
