# SSRF Protection Layer

NovaOS Security — Phase 5

## Overview

The SSRF Protection Layer provides comprehensive protection against Server-Side Request Forgery attacks. It implements defense-in-depth with multiple security checks at every stage of URL processing and HTTP requests.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SSRFSafeClient                                    │
│  High-level API combining all protection layers                             │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           RedirectGuard                                     │
│  Safely follows redirects with SSRF checks at each hop                      │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SecureTransport                                   │
│  Connects to pinned IP, enforces TLS, validates certificates                │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             SSRFGuard                                       │
│  Core orchestrator: URL parsing → Policy → DNS → IP validation              │
│  Produces SSRFDecision with TransportRequirements                           │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
        ▼                        ▼                        ▼
┌───────────────┐      ┌─────────────────┐      ┌─────────────────┐
│  PolicyChecker │      │   DNSResolver   │      │  IPValidator    │
│  Port/hostname │      │  With caching   │      │  IPv4/IPv6      │
│  restrictions  │      │  and timeout    │      │  classification │
└───────────────┘      └─────────────────┘      └─────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             URLParser                                       │
│  Parses URLs, detects IP literals, alternate encodings, embedded IPs        │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Quick Start

```typescript
import { SSRFSafeClient, createSSRFSafeClient } from './security/ssrf';

// Create client with default settings
const client = createSSRFSafeClient();

// Fetch a URL safely
const response = await client.fetch('https://api.example.com/data');
console.log(response.body.toString());

// Or use convenience functions
import { safeFetch, safeGet } from './security/ssrf';

const data = await safeGet('https://api.example.com/users');
```

## Security Features

### 1. URL Parsing & Validation
- Scheme restriction (http/https only)
- Userinfo (credentials) blocking
- Alternate IP encoding detection (octal, hex, decimal)
- Embedded IP detection in hostnames
- IDN/Punycode handling

### 2. Policy Enforcement
- Port allowlist (default: 80, 443)
- Hostname blocklist (localhost, metadata endpoints)
- Optional hostname allowlist for strict mode
- IP literal validation

### 3. DNS Resolution
- Configurable timeout (prevents hanging)
- Redis-backed caching with short TTL
- Both A (IPv4) and AAAA (IPv6) records
- DNS rebinding prevention (IP pinning)

### 4. IP Validation
- Private network blocking (RFC 1918)
- Loopback blocking (127.0.0.0/8, ::1)
- Link-local blocking (169.254.0.0/16, fe80::/10)
- Multicast blocking
- IPv4-mapped IPv6 validation
- Teredo/6to4 embedded IP extraction

### 5. Certificate Pinning
- SPKI pin format (SHA-256)
- Primary and backup pins
- Subdomain inheritance
- Expiration support
- Report-only mode

### 6. Redirect Handling
- SSRF check at every hop
- Loop detection
- Configurable limit
- Method preservation for 307/308

## Configuration

```typescript
const client = createSSRFSafeClient({
  // Port restrictions
  allowedPorts: [80, 443, 8080],
  
  // Hostname restrictions
  blockedDomains: ['internal.company.com'],
  allowedDomains: [], // Empty = all allowed (except blocked)
  
  // Timeouts
  dnsTimeoutMs: 3000,
  requestTimeoutMs: 30000,
  
  // Size limits
  maxResponseBytes: 10 * 1024 * 1024, // 10MB
  
  // Redirect handling
  maxRedirects: 5,
  
  // IP policy
  allowPrivateIps: false,
  allowLocalhost: false,
  
  // TLS
  validateCerts: true,
  
  // Security features
  preventDnsRebinding: true,
  blockAlternateEncodings: true,
  blockEmbeddedIPs: true,
});
```

## API Reference

### High-Level Client

```typescript
// SSRFSafeClient
client.fetch(url, options?) → Promise<RedirectAwareResponse>
client.get(url, headers?) → Promise<RedirectAwareResponse>
client.post(url, body, headers?) → Promise<RedirectAwareResponse>
client.put(url, body, headers?) → Promise<RedirectAwareResponse>
client.delete(url, headers?) → Promise<RedirectAwareResponse>
client.quickCheck(url) → { allowed: boolean; reason?: string }
client.check(url) → Promise<SSRFDecision>

// Convenience functions
safeFetch(url, options?) → Promise<RedirectAwareResponse>
safeGet(url, headers?) → Promise<RedirectAwareResponse>
safePost(url, body, headers?) → Promise<RedirectAwareResponse>
```

### SSRF Guard

```typescript
// Direct guard usage
const guard = createSSRFGuard(options);
const decision = await guard.check(url);

if (isAllowed(decision)) {
  // Use decision.transport for secure request
  const { connectToIP, hostname, port } = decision.transport;
}
```

### Policy Checker

```typescript
// Check policies without DNS
const checker = createPolicyChecker(config);
const result = checker.check(parsedURL);

// Quick checks
isPortAllowed(port, scheme) → boolean
isHostnameBlocked(hostname) → boolean
```

### IP Validator

```typescript
// Validate any IP
const result = validateIP('192.168.1.1');
console.log(result.classification); // 'PRIVATE_192'
console.log(result.isSafe); // false

// Convenience checks
isPrivateIP(ip) → boolean
isLoopbackIP(ip) → boolean
isLinkLocalIP(ip) → boolean
isSafeIP(ip) → boolean
```

### Certificate Pinning

```typescript
// Add pins
pinHostname('api.example.com', [
  'sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
], {
  backupPins: ['sha256/BBB...'],
  includeSubdomains: true,
  expiresAt: new Date('2025-12-31'),
});

// Check pins
hasPinsForHostname('api.example.com') → boolean
```

## SSRFDecision

The `SSRFDecision` is the single source of truth for transport:

```typescript
interface SSRFDecision {
  allowed: boolean;
  reason?: SSRFDenyReason;
  message?: string;
  checks: SSRFCheck[];
  durationMs: number;
  timestamp: Date;
  requestId?: string;
  
  // Only present when allowed
  transport?: TransportRequirements;
}

interface TransportRequirements {
  originalUrl: string;
  connectToIP: string;    // CRITICAL: Connect to this IP
  port: number;
  useTLS: boolean;
  hostname: string;       // For Host header and SNI
  requestPath: string;
  maxResponseBytes: number;
  connectionTimeoutMs: number;
  readTimeoutMs: number;
  allowRedirects: boolean;
  maxRedirects: number;
  certificatePins?: SPKIPin[];
}
```

## Files

| File | Description | Lines |
|------|-------------|-------|
| `types.ts` | Type definitions, constants, factories | ~800 |
| `url-parser.ts` | URL parsing, IP detection | ~450 |
| `ip-validator.ts` | IPv4/IPv6 validation | ~550 |
| `dns-resolver.ts` | DNS with caching | ~400 |
| `policy.ts` | Port/hostname policies | ~380 |
| `cert-pinning.ts` | Certificate pinning | ~470 |
| `guard.ts` | Core orchestrator | ~420 |
| `transport.ts` | Secure HTTP transport | ~420 |
| `client.ts` | Redirect guard & client | ~480 |
| `index.ts` | Module exports | ~300 |
| **Total** | | **~4,700** |

## Testing

```bash
# Run tests
npm test src/security/ssrf

# Or with Vitest directly
npx vitest src/security/ssrf
```

## Blocked by Default

- Localhost (127.0.0.0/8, ::1)
- Private networks (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
- Link-local (169.254.0.0/16, fe80::/10)
- Cloud metadata endpoints:
  - AWS: 169.254.169.254
  - GCP: metadata.google.internal
  - Azure: 169.254.169.254
  - Alibaba: 100.100.100.200
- Non-standard ports (anything except 80, 443)
- URLs with credentials (user:pass@host)
- Alternate IP encodings (octal, hex, decimal)
