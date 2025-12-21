// ═══════════════════════════════════════════════════════════════════════════════
// SSRF PROTECTION MODULE — Exports
// NovaOS Security — Phase 5: SSRF Protection Layer
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Branded types
  type ValidatedUrl,
  type IPv4Address,
  type IPv6Address,
  type IPAddress,
  type ValidatedHostname,
  type SPKIPin,
  
  // URL parsing
  type IPType,
  type ParsedURL,
  type URLParseError,
  type URLParseResult,
  
  // DNS
  type DNSRecord,
  type DNSResolutionResult,
  type DNSError,
  
  // IP validation
  type IPClassification,
  type IPValidationResult,
  type IPUnsafeReason,
  
  // SSRF checks
  type SSRFCheck,
  type SSRFCheckType,
  
  // Core decision types
  type SSRFDenyReason,
  type SSRFDecision,
  
  // Transport
  type TransportRequirements,
  type TransportEvidence,
  type CertificateInfo,
  
  // Redirects
  type RedirectHop,
  type RedirectChainResult,
  type RedirectChainError,
  
  // Configuration
  type SSRFGuardConfig,
  type SupportedScheme,
  
  // Type guards
  isAllowed,
  isDenied,
  isSafeIPResult,
  isRedirectSuccess,
  
  // Factory functions
  createAllowedDecision,
  createDeniedDecision,
  createCheck,
  
  // Constants
  DEFAULT_ALLOWED_PORTS,
  DEFAULT_BLOCKED_DOMAINS,
  SCHEME_DEFAULT_PORTS,
  SUPPORTED_SCHEMES,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// URL PARSER (Step 3)
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Core parsing
  parseURL,
  normalizeURL,
  buildRequestPath,
  
  // IPv4
  isIPv4,
  parseIPv4ToNumber,
  numberToIPv4,
  
  // IPv6
  isIPv6,
  isIPv4MappedIPv6,
  extractIPv4FromMapped,
  extractZoneId,
  
  // IP detection
  detectIPType,
  
  // Alternate encoding detection
  detectAlternateEncoding,
  type AlternateEncodingResult,
  
  // IDN
  isIDN,
  toASCII,
  
  // Embedded IP detection
  detectEmbeddedIP,
  type EmbeddedIPResult,
  
  // Hostname matching
  hostnameMatches,
} from './url-parser.js';

// ─────────────────────────────────────────────────────────────────────────────────
// IP VALIDATOR (Steps 4-5)
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Core validation
  validateIPv4,
  validateIPv6,
  validateIP,
  
  // Convenience checks
  isPrivateIP,
  isLoopbackIP,
  isLinkLocalIP,
  isSafeIP,
  getUnsafeIPReason,
} from './ip-validator.js';

// ─────────────────────────────────────────────────────────────────────────────────
// DNS RESOLVER (Step 6)
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Types
  type DNSResolverConfig,
  DEFAULT_DNS_CONFIG,
  
  // Class
  DNSResolver,
  
  // Singleton
  getDNSResolver,
  createDNSResolver,
  resetDNSResolver,
  
  // Convenience functions
  resolveDNS,
  resolveToIPv4,
  resolveAll,
} from './dns-resolver.js';

// ─────────────────────────────────────────────────────────────────────────────────
// POLICY (Step 7)
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Types
  type PolicyConfig,
  type PolicyResult,
  DEFAULT_POLICY_CONFIG,
  
  // Class
  PolicyChecker,
  
  // Singleton
  getPolicyChecker,
  createPolicyChecker,
  resetPolicyChecker,
  
  // Convenience functions
  isPortAllowed,
  isHostnameBlocked,
  matchesAnyPattern,
  
  // Reference constants
  CLOUD_METADATA_HOSTNAMES,
  LOCALHOST_HOSTNAMES,
  INTERNAL_HOSTNAMES,
} from './policy.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CERTIFICATE PINNING (Step 8)
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Types
  type HostnamePins,
  type PinVerificationResult,
  type CertPinningConfig,
  DEFAULT_CERT_PINNING_CONFIG,
  
  // Pin utilities
  computePinFromDER,
  computePinFromPEM,
  computePinFromSPKI,
  isValidPinFormat,
  parsePin,
  pinsEqual,
  
  // Store class
  CertificatePinStore,
  
  // Verification
  verifyCertificatePins,
  extractCertificateChain,
  
  // Singleton
  getPinStore,
  createPinStore,
  resetPinStore,
  
  // Convenience functions
  hasPinsForHostname,
  pinHostname,
  unpinHostname,
} from './cert-pinning.js';

// ─────────────────────────────────────────────────────────────────────────────────
// SSRF GUARD (Step 9)
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Types
  type SSRFGuardOptions,
  DEFAULT_SSRF_GUARD_OPTIONS,
  
  // Class
  SSRFGuard,
  
  // Singleton
  getSSRFGuard,
  createSSRFGuard,
  resetSSRFGuard,
  
  // Convenience functions
  checkURL,
  quickCheckURL,
} from './guard.js';

// ─────────────────────────────────────────────────────────────────────────────────
// SECURE TRANSPORT (Step 10)
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Types
  type TransportResponse,
  type TransportRequestOptions,
  type TransportErrorCode,
  TransportError,
  
  // Class
  SecureTransport,
  
  // Singleton
  getSecureTransport,
  createSecureTransport,
  resetSecureTransport,
  
  // Convenience functions
  secureGet,
  securePost,
  secureRequest,
} from './transport.js';

// ─────────────────────────────────────────────────────────────────────────────────
// REDIRECT GUARD (Step 11)
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Types
  type RedirectGuardConfig,
  type RedirectFollowOptions,
  type RedirectAwareResponse,
  DEFAULT_REDIRECT_CONFIG,
  
  // Redirect Guard
  RedirectGuard,
  getRedirectGuard,
  createRedirectGuard,
  resetRedirectGuard,
  followRedirects,
} from './client.js';

// ─────────────────────────────────────────────────────────────────────────────────
// HIGH-LEVEL CLIENT (Step 11)
// ─────────────────────────────────────────────────────────────────────────────────

export {
  // Client class
  SSRFSafeClient,
  
  // Singleton
  getSSRFSafeClient,
  createSSRFSafeClient,
  resetSSRFSafeClient,
  
  // Convenience functions
  safeFetch,
  safeGet,
  safePost,
} from './client.js';
