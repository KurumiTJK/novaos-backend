// ═══════════════════════════════════════════════════════════════════════════════
// WEB SERVICES TESTS — Fetch Client, Verification, Security
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import {
  HardenedFetchClient,
  isPrivateIP,
  isBlockedHostname,
  validateUrl,
  type URLValidation,
} from '../services/web/fetch-client.js';
import {
  VerificationExecutor,
  type VerificationResult,
} from '../services/web/verification-executor.js';
import {
  WebObserver,
} from '../services/web/observer.js';
import { MemoryStore } from '../storage/index.js';
import { loadWebFetchConfig } from '../config/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// IP VALIDATION TESTS (SSRF Protection)
// ─────────────────────────────────────────────────────────────────────────────────

describe('SSRF Protection - IP Validation', () => {
  describe('Private IP Detection', () => {
    it('should detect 10.x.x.x as private', () => {
      expect(isPrivateIP('10.0.0.1')).toBe(true);
      expect(isPrivateIP('10.255.255.255')).toBe(true);
    });

    it('should detect 172.16-31.x.x as private', () => {
      expect(isPrivateIP('172.16.0.1')).toBe(true);
      expect(isPrivateIP('172.31.255.255')).toBe(true);
      expect(isPrivateIP('172.15.0.1')).toBe(false);
      expect(isPrivateIP('172.32.0.1')).toBe(false);
    });

    it('should detect 192.168.x.x as private', () => {
      expect(isPrivateIP('192.168.0.1')).toBe(true);
      expect(isPrivateIP('192.168.255.255')).toBe(true);
    });

    it('should detect localhost/loopback as private', () => {
      expect(isPrivateIP('127.0.0.1')).toBe(true);
      expect(isPrivateIP('127.255.255.255')).toBe(true);
    });

    it('should detect link-local as private', () => {
      expect(isPrivateIP('169.254.1.1')).toBe(true);
    });

    it('should detect AWS metadata IP as private', () => {
      expect(isPrivateIP('169.254.169.254')).toBe(true);
    });

    it('should detect CGNAT range as private', () => {
      expect(isPrivateIP('100.64.0.1')).toBe(true);
      expect(isPrivateIP('100.127.255.255')).toBe(true);
    });

    it('should allow public IPs', () => {
      expect(isPrivateIP('8.8.8.8')).toBe(false);
      expect(isPrivateIP('1.1.1.1')).toBe(false);
      expect(isPrivateIP('104.26.10.229')).toBe(false);
    });
  });

  describe('Cloud Metadata Hostname Detection', () => {
    it('should block metadata.google.internal', () => {
      expect(isBlockedHostname('metadata.google.internal')).toBe(true);
    });

    it('should block metadata variations', () => {
      expect(isBlockedHostname('metadata')).toBe(true);
      expect(isBlockedHostname('instance-data')).toBe(true);
    });

    it('should allow normal hostnames', () => {
      expect(isBlockedHostname('google.com')).toBe(false);
      expect(isBlockedHostname('example.com')).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// URL VALIDATION TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('URL Validation', () => {
  const config = loadWebFetchConfig();

  it('should allow valid HTTPS URLs', () => {
    const result = validateUrl('https://example.com/page', config);
    expect(result.valid).toBe(true);
  });

  it('should allow valid HTTP URLs', () => {
    const result = validateUrl('http://example.com/page', config);
    expect(result.valid).toBe(true);
  });

  it('should reject non-HTTP protocols', () => {
    expect(validateUrl('file:///etc/passwd', config).valid).toBe(false);
    expect(validateUrl('ftp://example.com', config).valid).toBe(false);
    expect(validateUrl('javascript:alert(1)', config).valid).toBe(false);
  });

  it('should reject localhost by default', () => {
    const result = validateUrl('http://localhost/admin', config);
    expect(result.valid).toBe(false);
  });

  it('should reject 127.0.0.1 by default', () => {
    const result = validateUrl('http://127.0.0.1/admin', config);
    expect(result.valid).toBe(false);
  });

  it('should reject private IP literals', () => {
    expect(validateUrl('http://10.0.0.1/admin', config).valid).toBe(false);
    expect(validateUrl('http://192.168.1.1/admin', config).valid).toBe(false);
  });

  it('should reject metadata hostnames', () => {
    const result = validateUrl('http://metadata.google.internal/computeMetadata/v1/', config);
    expect(result.valid).toBe(false);
  });

  it('should reject non-standard ports by default', () => {
    const result = validateUrl('http://example.com:8080/api', config);
    expect(result.valid).toBe(false);
  });

  it('should allow standard ports', () => {
    expect(validateUrl('http://example.com:80/api', config).valid).toBe(true);
    expect(validateUrl('https://example.com:443/api', config).valid).toBe(true);
  });

  it('should reject invalid URLs', () => {
    expect(validateUrl('not-a-url', config).valid).toBe(false);
    expect(validateUrl('', config).valid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// HARDENED FETCH CLIENT TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('HardenedFetchClient', () => {
  let client: HardenedFetchClient;

  beforeEach(() => {
    client = new HardenedFetchClient({
      allowPrivateIPs: false,
      allowLocalhost: false,
      maxResponseSizeBytes: 10000,
      totalTimeoutMs: 5000,
    });
  });

  describe('canFetch', () => {
    it('should allow fetching public URLs', () => {
      const result = client.canFetch('https://example.com');
      expect(result.allowed).toBe(true);
    });

    it('should block private IPs', () => {
      const result = client.canFetch('http://192.168.1.1/admin');
      expect(result.allowed).toBe(false);
    });

    it('should block localhost', () => {
      const result = client.canFetch('http://localhost:3000');
      expect(result.allowed).toBe(false);
    });

    it('should block invalid protocols', () => {
      const result = client.canFetch('file:///etc/passwd');
      expect(result.allowed).toBe(false);
    });
  });

  describe('Allowlist mode', () => {
    it('should only allow domains in allowlist when configured', () => {
      const restrictedClient = new HardenedFetchClient({
        allowlist: ['example.com', 'trusted.org'],
      });

      expect(restrictedClient.canFetch('https://example.com/page').allowed).toBe(true);
      expect(restrictedClient.canFetch('https://sub.example.com/page').allowed).toBe(true);
      expect(restrictedClient.canFetch('https://untrusted.com/page').allowed).toBe(false);
    });
  });

  describe('Blocklist mode', () => {
    it('should block domains in blocklist', () => {
      const blockedClient = new HardenedFetchClient({
        blocklist: ['evil.com', 'localhost', '127.0.0.1'],
      });

      expect(blockedClient.canFetch('https://evil.com/malware').allowed).toBe(false);
      expect(blockedClient.canFetch('https://sub.evil.com/malware').allowed).toBe(false);
      expect(blockedClient.canFetch('https://good.com/page').allowed).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// VERIFICATION EXECUTOR TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('VerificationExecutor', () => {
  let executor: VerificationExecutor;
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
    // Create executor with verification disabled (for unit testing)
    executor = new VerificationExecutor(
      new HardenedFetchClient(),
      store,
      {
        enabled: false, // Disabled for unit tests
        required: false,
        cacheTTLSeconds: 60,
        maxCacheEntries: 100,
        maxVerificationsPerRequest: 3,
        maxConcurrentVerifications: 2,
        trustedDomains: ['wikipedia.org'],
      }
    );
  });

  it('should return unverifiable when disabled', async () => {
    const result = await executor.verify({ claim: 'Test claim' });
    
    expect(result.status).toBe('unverifiable');
    expect(result.explanation).toContain('disabled');
  });

  it('should generate consistent claim hashes', async () => {
    const result1 = await executor.verify({ claim: 'Test claim' });
    const result2 = await executor.verify({ claim: 'Test claim' });
    
    expect(result1.claimHash).toBe(result2.claimHash);
  });

  it('should normalize claims for hashing', async () => {
    const result1 = await executor.verify({ claim: 'Test claim' });
    const result2 = await executor.verify({ claim: '  test claim  ' });
    
    expect(result1.claimHash).toBe(result2.claimHash);
  });

  it('should include timing information', async () => {
    const result = await executor.verify({ claim: 'Test' });
    
    expect(result.timing.totalMs).toBeGreaterThanOrEqual(0);
  });

  describe('quickVerify', () => {
    it('should return simplified result', async () => {
      const result = await executor.quickVerify('Test claim');
      
      expect(typeof result.verified).toBe('boolean');
      expect(typeof result.confidence).toBe('number');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// WEB OBSERVER TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('WebObserver', () => {
  let observer: WebObserver;

  beforeEach(() => {
    observer = new WebObserver();
  });

  describe('Fetch Recording', () => {
    it('should track successful fetches', () => {
      observer.recordFetch('https://example.com/page', true, 100);
      
      const metrics = observer.getMetrics();
      expect(metrics.totalFetches).toBe(1);
      expect(metrics.successfulFetches).toBe(1);
      expect(metrics.failedFetches).toBe(0);
    });

    it('should track failed fetches', () => {
      observer.recordFetch('https://example.com/page', false, 100, {
        error: 'timeout'
      });
      
      const metrics = observer.getMetrics();
      expect(metrics.failedFetches).toBe(1);
      expect(metrics.errorsByType['timeout']).toBe(1);
    });

    it('should categorize errors', () => {
      observer.recordFetch('https://x.com', false, 0, { error: 'DNS resolution failed' });
      observer.recordFetch('https://y.com', false, 0, { error: 'SSRF blocked' });
      observer.recordFetch('https://z.com', false, 0, { error: 'Request timeout' });
      
      const metrics = observer.getMetrics();
      expect(metrics.errorsByType['dns_error']).toBe(1);
      expect(metrics.errorsByType['ssrf_blocked']).toBe(1);
      expect(metrics.errorsByType['timeout']).toBe(1);
    });

    it('should track SSRF blocks', () => {
      observer.recordFetch('http://192.168.1.1', false, 0, {
        error: 'Private IP (SSRF blocked)'
      });
      
      const metrics = observer.getMetrics();
      expect(metrics.ssrfBlockedCount).toBe(1);
    });

    it('should aggregate by domain (not full URL)', () => {
      observer.recordFetch('https://example.com/page1', true, 100);
      observer.recordFetch('https://example.com/page2', true, 100);
      observer.recordFetch('https://other.com/page', true, 100);
      
      const metrics = observer.getMetrics();
      expect(metrics.fetchesByDomain['example.com']).toBe(2);
      expect(metrics.fetchesByDomain['other.com']).toBe(1);
    });
  });

  describe('Verification Recording', () => {
    it('should track verification attempts', () => {
      observer.recordVerification('verified', true, 500, false);
      observer.recordVerification('uncertain', false, 300, true);
      
      const metrics = observer.getMetrics();
      expect(metrics.verificationsAttempted).toBe(2);
      expect(metrics.verificationsSuccessful).toBe(1);
    });

    it('should track cache hits/misses', () => {
      observer.recordVerification('verified', true, 10, true);  // cached
      observer.recordVerification('verified', true, 500, false); // not cached
      
      const metrics = observer.getMetrics();
      expect(metrics.cacheHits).toBe(1);
      expect(metrics.cacheMisses).toBe(1);
    });

    it('should track verification statuses', () => {
      observer.recordVerification('verified', true, 100, false);
      observer.recordVerification('likely_true', true, 100, false);
      observer.recordVerification('uncertain', false, 100, false);
      
      const metrics = observer.getMetrics();
      expect(metrics.verificationStatuses['verified']).toBe(1);
      expect(metrics.verificationStatuses['likely_true']).toBe(1);
      expect(metrics.verificationStatuses['uncertain']).toBe(1);
    });
  });

  describe('Timing Metrics', () => {
    it('should calculate average fetch duration', () => {
      observer.recordFetch('https://a.com', true, 100);
      observer.recordFetch('https://b.com', true, 200);
      observer.recordFetch('https://c.com', true, 300);
      
      const metrics = observer.getMetrics();
      expect(metrics.avgFetchDurationMs).toBe(200);
    });

    it('should track max fetch duration', () => {
      observer.recordFetch('https://a.com', true, 100);
      observer.recordFetch('https://b.com', true, 500);
      observer.recordFetch('https://c.com', true, 300);
      
      const metrics = observer.getMetrics();
      expect(metrics.maxFetchDurationMs).toBe(500);
    });
  });

  describe('Recent Events', () => {
    it('should return recent events', () => {
      observer.recordFetch('https://a.com', true, 100);
      observer.recordFetch('https://b.com', true, 100);
      
      const events = observer.getRecentEvents(10);
      expect(events.length).toBe(2);
      expect(events[0].type).toBe('fetch');
    });

    it('should limit returned events', () => {
      for (let i = 0; i < 20; i++) {
        observer.recordFetch(`https://site${i}.com`, true, 100);
      }
      
      const events = observer.getRecentEvents(5);
      expect(events.length).toBe(5);
    });
  });

  describe('Reset', () => {
    it('should reset all metrics', () => {
      observer.recordFetch('https://example.com', true, 100);
      observer.recordVerification('verified', true, 100, false);
      
      observer.reset();
      
      const metrics = observer.getMetrics();
      expect(metrics.totalFetches).toBe(0);
      expect(metrics.verificationsAttempted).toBe(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// CONFIGURATION TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Web Configuration', () => {
  it('should load default config', () => {
    const config = loadWebFetchConfig();
    
    expect(config.maxResponseSizeBytes).toBeGreaterThan(0);
    expect(config.totalTimeoutMs).toBeGreaterThan(0);
    expect(config.allowPrivateIPs).toBe(false);
    expect(config.allowLocalhost).toBe(false);
  });

  it('should have sensible defaults for security', () => {
    const config = loadWebFetchConfig();
    
    // Security defaults
    expect(config.validateCertificates).toBe(true);
    expect(config.preventDNSRebinding).toBe(true);
    expect(config.maxRedirects).toBeLessThanOrEqual(5);
  });
});
