// ═══════════════════════════════════════════════════════════════════════════════
// DNS RESOLVER — Secure DNS Resolution with Caching
// NovaOS Security — Phase 5: SSRF Protection Layer
// ═══════════════════════════════════════════════════════════════════════════════
//
// This module provides secure DNS resolution with:
// - Configurable timeout to prevent hanging
// - Redis-backed caching with short TTL
// - Both A (IPv4) and AAAA (IPv6) record resolution
// - Circuit breaker integration for resilience
// - Metrics and logging
//
// CRITICAL: The resolved IPs are used by the transport layer.
// DNS rebinding attacks are prevented by pinning the IP in SSRFDecision.
//
// ═══════════════════════════════════════════════════════════════════════════════

import { promises as dns } from 'dns';
import {
  type DNSRecord,
  type DNSResolutionResult,
  type DNSError,
} from './types.js';
import { getLogger } from '../../observability/logging/index.js';
import { incCounter, observeHistogram } from '../../observability/metrics/index.js';
import { getStore, type KeyValueStore } from '../../storage/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * DNS resolver configuration.
 */
export interface DNSResolverConfig {
  /** Resolution timeout in milliseconds */
  readonly timeoutMs: number;
  
  /** Cache TTL in seconds (0 = no caching) */
  readonly cacheTTLSeconds: number;
  
  /** Maximum cache entries (for memory limiting) */
  readonly maxCacheEntries: number;
  
  /** Whether to resolve IPv6 (AAAA) records */
  readonly resolveIPv6: boolean;
  
  /** Custom DNS servers (empty = system default) */
  readonly servers: readonly string[];
  
  /** Key prefix for cache */
  readonly cacheKeyPrefix: string;
}

/**
 * Default DNS resolver configuration.
 */
export const DEFAULT_DNS_CONFIG: DNSResolverConfig = {
  timeoutMs: 3000,
  cacheTTLSeconds: 60, // Short TTL for security
  maxCacheEntries: 10000,
  resolveIPv6: true,
  servers: [],
  cacheKeyPrefix: 'dns:',
};

/**
 * Cached DNS entry structure.
 */
interface CachedDNSEntry {
  readonly hostname: string;
  readonly addresses: DNSRecord[];
  readonly resolvedAt: number;
  readonly expiresAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'dns-resolver' });

// ─────────────────────────────────────────────────────────────────────────────────
// DNS RESOLVER CLASS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Secure DNS resolver with caching and timeout support.
 */
export class DNSResolver {
  private readonly config: DNSResolverConfig;
  private readonly store: KeyValueStore;
  private readonly resolver: dns.Resolver;
  
  // In-memory cache for when Redis is unavailable
  private readonly memoryCache = new Map<string, CachedDNSEntry>();
  private memoryCacheSize = 0;
  
  constructor(config: Partial<DNSResolverConfig> = {}, store?: KeyValueStore) {
    this.config = { ...DEFAULT_DNS_CONFIG, ...config };
    this.store = store ?? getStore();
    this.resolver = new dns.Resolver();
    
    // Set custom DNS servers if provided
    if (this.config.servers.length > 0) {
      this.resolver.setServers([...this.config.servers]);
    }
    
    // Set timeout
    // Note: Node.js Resolver doesn't have native timeout, we implement it ourselves
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Resolve a hostname to IP addresses.
   * 
   * @param hostname - The hostname to resolve
   * @returns Resolution result with all addresses
   */
  async resolve(hostname: string): Promise<DNSResolutionResult> {
    const startTime = Date.now();
    
    // Validate hostname
    if (!hostname || typeof hostname !== 'string') {
      return this.createErrorResult(hostname, 'INVALID_HOSTNAME', startTime);
    }
    
    // Normalize hostname
    const normalizedHostname = hostname.toLowerCase().trim();
    
    // Check cache first
    const cached = await this.getFromCache(normalizedHostname);
    if (cached) {
      logger.debug('DNS cache hit', { hostname: normalizedHostname });
      incCounter('dns_cache_hits_total', { status: 'hit' });
      
      return {
        hostname: normalizedHostname,
        success: true,
        addresses: cached.addresses,
        ipv4Addresses: cached.addresses.filter(a => a.family === 4).map(a => a.address),
        ipv6Addresses: cached.addresses.filter(a => a.family === 6).map(a => a.address),
        durationMs: Date.now() - startTime,
        fromCache: true,
        cacheTTL: Math.max(0, Math.floor((cached.expiresAt - Date.now()) / 1000)),
      };
    }
    
    incCounter('dns_cache_hits_total', { status: 'miss' });
    
    // Resolve with timeout
    try {
      const addresses = await this.resolveWithTimeout(normalizedHostname);
      
      const durationMs = Date.now() - startTime;
      
      // Record metrics
      observeHistogram('dns_resolution_duration_seconds', durationMs / 1000, {
        status: 'success',
      });
      incCounter('dns_resolutions_total', { status: 'success' });
      
      // Cache the result
      await this.saveToCache(normalizedHostname, addresses);
      
      logger.debug('DNS resolution successful', {
        hostname: normalizedHostname,
        addressCount: addresses.length,
        durationMs,
      });
      
      return {
        hostname: normalizedHostname,
        success: true,
        addresses,
        ipv4Addresses: addresses.filter(a => a.family === 4).map(a => a.address),
        ipv6Addresses: addresses.filter(a => a.family === 6).map(a => a.address),
        durationMs,
        fromCache: false,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const dnsError = this.mapError(error);
      
      // Record metrics
      observeHistogram('dns_resolution_duration_seconds', durationMs / 1000, {
        status: 'error',
      });
      incCounter('dns_resolutions_total', { status: 'error', error: dnsError });
      
      logger.warn('DNS resolution failed', {
        hostname: normalizedHostname,
        error: dnsError,
        durationMs,
      });
      
      return this.createErrorResult(normalizedHostname, dnsError, startTime);
    }
  }
  
  /**
   * Resolve and return only IPv4 addresses.
   */
  async resolve4(hostname: string): Promise<DNSResolutionResult> {
    const result = await this.resolve(hostname);
    return {
      ...result,
      addresses: result.addresses.filter(a => a.family === 4),
      ipv6Addresses: [],
    };
  }
  
  /**
   * Resolve and return only IPv6 addresses.
   */
  async resolve6(hostname: string): Promise<DNSResolutionResult> {
    const result = await this.resolve(hostname);
    return {
      ...result,
      addresses: result.addresses.filter(a => a.family === 6),
      ipv4Addresses: [],
    };
  }
  
  /**
   * Clear the DNS cache.
   */
  async clearCache(): Promise<void> {
    this.memoryCache.clear();
    this.memoryCacheSize = 0;
    
    // Clear Redis cache (if available)
    if (this.store.isConnected()) {
      try {
        const pattern = `${this.config.cacheKeyPrefix}*`;
        const keys = await this.store.keys(pattern);
        for (const key of keys) {
          await this.store.delete(key);
        }
      } catch (error) {
        logger.warn('Failed to clear Redis DNS cache', { error });
      }
    }
    
    logger.info('DNS cache cleared');
  }
  
  /**
   * Invalidate a specific hostname from cache.
   */
  async invalidate(hostname: string): Promise<void> {
    const normalizedHostname = hostname.toLowerCase().trim();
    const cacheKey = this.getCacheKey(normalizedHostname);
    
    // Remove from memory cache
    this.memoryCache.delete(normalizedHostname);
    
    // Remove from Redis
    if (this.store.isConnected()) {
      try {
        await this.store.delete(cacheKey);
      } catch (error) {
        logger.warn('Failed to invalidate Redis DNS cache entry', { hostname, error });
      }
    }
  }
  
  /**
   * Get cache statistics.
   */
  getCacheStats(): { memoryEntries: number; maxEntries: number } {
    return {
      memoryEntries: this.memoryCache.size,
      maxEntries: this.config.maxCacheEntries,
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE METHODS
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Resolve with timeout wrapper.
   */
  private async resolveWithTimeout(hostname: string): Promise<DNSRecord[]> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('DNS_TIMEOUT'));
      }, this.config.timeoutMs);
    });
    
    const resolvePromise = this.doResolve(hostname);
    
    return Promise.race([resolvePromise, timeoutPromise]);
  }
  
  /**
   * Perform the actual DNS resolution.
   */
  private async doResolve(hostname: string): Promise<DNSRecord[]> {
    const records: DNSRecord[] = [];
    const errors: Error[] = [];
    
    // Resolve IPv4 (A records)
    try {
      const ipv4Results = await this.resolver.resolve4(hostname, { ttl: true });
      for (const result of ipv4Results) {
        records.push({
          address: result.address,
          family: 4,
          ttl: result.ttl,
        });
      }
    } catch (error) {
      // ENODATA means no A records, not necessarily an error
      if ((error as NodeJS.ErrnoException).code !== 'ENODATA') {
        errors.push(error as Error);
      }
    }
    
    // Resolve IPv6 (AAAA records) if enabled
    if (this.config.resolveIPv6) {
      try {
        const ipv6Results = await this.resolver.resolve6(hostname, { ttl: true });
        for (const result of ipv6Results) {
          records.push({
            address: result.address,
            family: 6,
            ttl: result.ttl,
          });
        }
      } catch (error) {
        // ENODATA means no AAAA records, not necessarily an error
        if ((error as NodeJS.ErrnoException).code !== 'ENODATA') {
          errors.push(error as Error);
        }
      }
    }
    
    // If we have no records and had errors, throw the first error
    if (records.length === 0 && errors.length > 0) {
      throw errors[0];
    }
    
    // If we have no records at all (NXDOMAIN or no data)
    if (records.length === 0) {
      const error = new Error('NO_DATA') as NodeJS.ErrnoException;
      error.code = 'ENODATA';
      throw error;
    }
    
    return records;
  }
  
  /**
   * Get cache key for a hostname.
   */
  private getCacheKey(hostname: string): string {
    return `${this.config.cacheKeyPrefix}${hostname}`;
  }
  
  /**
   * Get entry from cache.
   */
  private async getFromCache(hostname: string): Promise<CachedDNSEntry | null> {
    const now = Date.now();
    
    // Try memory cache first
    const memoryEntry = this.memoryCache.get(hostname);
    if (memoryEntry && memoryEntry.expiresAt > now) {
      return memoryEntry;
    } else if (memoryEntry) {
      // Expired, remove it
      this.memoryCache.delete(hostname);
    }
    
    // Try Redis cache
    if (this.config.cacheTTLSeconds > 0 && this.store.isConnected()) {
      try {
        const cacheKey = this.getCacheKey(hostname);
        const cached = await this.store.get(cacheKey);
        
        if (cached) {
          const entry: CachedDNSEntry = JSON.parse(cached);
          
          // Check if still valid
          if (entry.expiresAt > now) {
            // Also store in memory cache for faster access
            this.memoryCache.set(hostname, entry);
            return entry;
          }
        }
      } catch (error) {
        logger.warn('Failed to read DNS cache from Redis', { hostname, error });
      }
    }
    
    return null;
  }
  
  /**
   * Save entry to cache.
   */
  private async saveToCache(hostname: string, addresses: DNSRecord[]): Promise<void> {
    if (this.config.cacheTTLSeconds <= 0) {
      return;
    }
    
    const now = Date.now();
    
    // Determine TTL: use minimum of config TTL and DNS record TTL
    let ttl = this.config.cacheTTLSeconds;
    const minRecordTTL = Math.min(...addresses.filter(a => a.ttl !== undefined).map(a => a.ttl!));
    if (minRecordTTL > 0 && minRecordTTL < ttl) {
      ttl = minRecordTTL;
    }
    
    const entry: CachedDNSEntry = {
      hostname,
      addresses,
      resolvedAt: now,
      expiresAt: now + (ttl * 1000),
    };
    
    // Evict old entries if at capacity
    if (this.memoryCache.size >= this.config.maxCacheEntries) {
      this.evictOldestMemoryEntry();
    }
    
    // Store in memory cache
    this.memoryCache.set(hostname, entry);
    
    // Store in Redis
    if (this.store.isConnected()) {
      try {
        const cacheKey = this.getCacheKey(hostname);
        await this.store.set(cacheKey, JSON.stringify(entry), ttl);
      } catch (error) {
        logger.warn('Failed to save DNS cache to Redis', { hostname, error });
      }
    }
  }
  
  /**
   * Evict the oldest entry from memory cache.
   */
  private evictOldestMemoryEntry(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    
    for (const [key, entry] of this.memoryCache.entries()) {
      if (entry.resolvedAt < oldestTime) {
        oldestTime = entry.resolvedAt;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.memoryCache.delete(oldestKey);
    }
  }
  
  /**
   * Map Node.js DNS errors to our error types.
   */
  private mapError(error: unknown): DNSError {
    if (error instanceof Error) {
      const message = error.message;
      const code = (error as NodeJS.ErrnoException).code;
      
      if (message === 'DNS_TIMEOUT' || code === 'ETIMEOUT') {
        return 'TIMEOUT';
      }
      
      switch (code) {
        case 'ENOTFOUND':
        case 'ENOENT':
          return 'NXDOMAIN';
        
        case 'ENODATA':
          return 'NO_DATA';
        
        case 'ESERVFAIL':
        case 'SERVFAIL':
          return 'SERVFAIL';
        
        case 'EREFUSED':
        case 'REFUSED':
          return 'REFUSED';
        
        case 'ECONNREFUSED':
        case 'ENETUNREACH':
        case 'EHOSTUNREACH':
          return 'NETWORK_ERROR';
        
        default:
          logger.warn('Unknown DNS error code', { code, message });
          return 'NETWORK_ERROR';
      }
    }
    
    return 'NETWORK_ERROR';
  }
  
  /**
   * Create an error result.
   */
  private createErrorResult(
    hostname: string,
    error: DNSError,
    startTime: number
  ): DNSResolutionResult {
    return {
      hostname,
      success: false,
      addresses: [],
      ipv4Addresses: [],
      ipv6Addresses: [],
      durationMs: Date.now() - startTime,
      fromCache: false,
      error,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON INSTANCE
// ─────────────────────────────────────────────────────────────────────────────────

let resolverInstance: DNSResolver | null = null;

/**
 * Get or create the global DNS resolver.
 */
export function getDNSResolver(config?: Partial<DNSResolverConfig>): DNSResolver {
  if (!resolverInstance) {
    resolverInstance = new DNSResolver(config);
  }
  return resolverInstance;
}

/**
 * Create a new DNS resolver with custom configuration.
 */
export function createDNSResolver(
  config?: Partial<DNSResolverConfig>,
  store?: KeyValueStore
): DNSResolver {
  return new DNSResolver(config, store);
}

/**
 * Reset the global DNS resolver (for testing).
 */
export function resetDNSResolver(): void {
  if (resolverInstance) {
    resolverInstance.clearCache().catch(() => {});
  }
  resolverInstance = null;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONVENIENCE FUNCTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a hostname using the global resolver.
 * 
 * @param hostname - The hostname to resolve
 * @returns Resolution result
 */
export async function resolveDNS(hostname: string): Promise<DNSResolutionResult> {
  return getDNSResolver().resolve(hostname);
}

/**
 * Resolve and get the first IPv4 address.
 * 
 * @param hostname - The hostname to resolve
 * @returns First IPv4 address or null
 */
export async function resolveToIPv4(hostname: string): Promise<string | null> {
  const result = await getDNSResolver().resolve(hostname);
  return result.ipv4Addresses[0] ?? null;
}

/**
 * Resolve and get all addresses as strings.
 * 
 * @param hostname - The hostname to resolve
 * @returns Array of IP addresses
 */
export async function resolveAll(hostname: string): Promise<string[]> {
  const result = await getDNSResolver().resolve(hostname);
  return result.addresses.map(a => a.address);
}
