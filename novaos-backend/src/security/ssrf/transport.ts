// ═══════════════════════════════════════════════════════════════════════════════
// SECURE TRANSPORT — SSRF-Safe HTTP Client
// NovaOS Security — Phase 5: SSRF Protection Layer
// ═══════════════════════════════════════════════════════════════════════════════
//
// This module implements the transport layer that enforces SSRFDecision:
// - Connects to the pinned IP (not hostname) to prevent DNS rebinding
// - Sets Host header and SNI to original hostname
// - Validates TLS certificates with optional pin checking
// - Enforces response size limits
// - Enforces connection and read timeouts
//
// CRITICAL: This transport MUST be used with SSRFDecision.transport
// to ensure all security checks are enforced.
//
// ═══════════════════════════════════════════════════════════════════════════════

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import {
  type TransportRequirements,
  type TransportEvidence,
  type CertificateInfo,
  type SSRFDecision,
  isAllowed,
} from './types.js';
import {
  verifyCertificatePins,
  extractCertificateChain,
  getPinStore,
} from './cert-pinning.js';
import { getLogger } from '../../observability/logging/index.js';
import { incCounter, observeHistogram } from '../../observability/metrics/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'secure-transport' });

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Transport response.
 */
export interface TransportResponse {
  /** HTTP status code */
  readonly statusCode: number;
  
  /** HTTP status message */
  readonly statusMessage: string;
  
  /** Response headers */
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  
  /** Response body (may be truncated) */
  readonly body: Buffer;
  
  /** Whether body was truncated due to size limit */
  readonly truncated: boolean;
  
  /** Evidence of transport security */
  readonly evidence: TransportEvidence;
  
  /** Final URL (after redirects, if followed) */
  readonly finalUrl: string;
}

/**
 * Transport error.
 */
export class TransportError extends Error {
  constructor(
    message: string,
    public readonly code: TransportErrorCode,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'TransportError';
  }
}

/**
 * Transport error codes.
 */
export type TransportErrorCode =
  | 'INVALID_DECISION'
  | 'CONNECTION_FAILED'
  | 'CONNECTION_TIMEOUT'
  | 'READ_TIMEOUT'
  | 'TLS_ERROR'
  | 'CERTIFICATE_PIN_MISMATCH'
  | 'RESPONSE_TOO_LARGE'
  | 'PROTOCOL_ERROR'
  | 'ABORTED';

/**
 * Request options for transport.
 */
export interface TransportRequestOptions {
  /** HTTP method */
  readonly method?: string;
  
  /** Request headers */
  readonly headers?: Record<string, string>;
  
  /** Request body */
  readonly body?: Buffer | string;
  
  /** Abort signal */
  readonly signal?: AbortSignal;
}

// ─────────────────────────────────────────────────────────────────────────────────
// SECURE TRANSPORT CLASS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Secure HTTP transport that enforces SSRFDecision requirements.
 */
export class SecureTransport {
  /**
   * Make a request using SSRFDecision transport requirements.
   * 
   * @param decision - The SSRFDecision (must be allowed)
   * @param options - Request options
   * @returns Transport response
   * @throws TransportError if request fails
   */
  async request(
    decision: SSRFDecision,
    options: TransportRequestOptions = {}
  ): Promise<TransportResponse> {
    // Validate decision
    if (!isAllowed(decision) || !decision.transport) {
      throw new TransportError(
        'Invalid or denied SSRFDecision',
        'INVALID_DECISION'
      );
    }
    
    const transport = decision.transport;
    const startTime = Date.now();
    
    logger.debug('Starting secure transport request', {
      connectToIP: transport.connectToIP,
      hostname: transport.hostname,
      port: transport.port,
      useTLS: transport.useTLS,
      requestId: decision.requestId,
    });
    
    try {
      const response = await this.doRequest(transport, options);
      
      const durationMs = Date.now() - startTime;
      
      incCounter('secure_transport_requests_total', { result: 'success' });
      observeHistogram('secure_transport_duration_seconds', durationMs / 1000, { result: 'success' });
      
      logger.info('Secure transport request completed', {
        statusCode: response.statusCode,
        bodySize: response.body.length,
        truncated: response.truncated,
        durationMs,
        requestId: decision.requestId,
      });
      
      return response;
      
    } catch (error) {
      const durationMs = Date.now() - startTime;
      
      incCounter('secure_transport_requests_total', { result: 'error' });
      observeHistogram('secure_transport_duration_seconds', durationMs / 1000, { result: 'error' });
      
      if (error instanceof TransportError) {
        throw error;
      }
      
      throw new TransportError(
        error instanceof Error ? error.message : 'Unknown error',
        'CONNECTION_FAILED',
        error instanceof Error ? error : undefined
      );
    }
  }
  
  /**
   * Make a GET request.
   */
  async get(
    decision: SSRFDecision,
    headers?: Record<string, string>
  ): Promise<TransportResponse> {
    return this.request(decision, { method: 'GET', headers });
  }
  
  /**
   * Make a POST request.
   */
  async post(
    decision: SSRFDecision,
    body: Buffer | string,
    headers?: Record<string, string>
  ): Promise<TransportResponse> {
    return this.request(decision, { method: 'POST', body, headers });
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE METHODS
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Perform the actual HTTP request.
   */
  private doRequest(
    transport: TransportRequirements,
    options: TransportRequestOptions
  ): Promise<TransportResponse> {
    return new Promise((resolve, reject) => {
      const isHTTPS = transport.useTLS;
      const httpModule = isHTTPS ? https : http;
      
      // Build request options
      // CRITICAL: We connect to the IP but use hostname for Host header and SNI
      const requestOptions: https.RequestOptions = {
        // Connect to the pinned IP, NOT the hostname
        hostname: transport.connectToIP,
        port: transport.port,
        path: transport.requestPath,
        method: options.method ?? 'GET',
        
        // Set Host header to original hostname
        headers: {
          'Host': transport.hostname,
          'User-Agent': transport.userAgent ?? 'NovaOS-SecureTransport/1.0',
          ...transport.headers,
          ...options.headers,
        },
        
        // Timeouts
        timeout: transport.connectionTimeoutMs,
      };
      
      // TLS-specific options
      if (isHTTPS) {
        // SNI: Use original hostname for TLS handshake
        requestOptions.servername = transport.hostname;
        
        // Certificate validation
        requestOptions.rejectUnauthorized = true;
        
        // We'll verify pins after connection
      }
      
      // Connection timeout
      const connectionTimer = setTimeout(() => {
        req.destroy();
        reject(new TransportError(
          `Connection timeout after ${transport.connectionTimeoutMs}ms`,
          'CONNECTION_TIMEOUT'
        ));
      }, transport.connectionTimeoutMs ?? 30000);
      
      // Create request
      const req = httpModule.request(requestOptions, (res) => {
        clearTimeout(connectionTimer);
        
        // Read timeout
        const readTimer = setTimeout(() => {
          req.destroy();
          reject(new TransportError(
            `Read timeout after ${transport.readTimeoutMs}ms`,
            'READ_TIMEOUT'
          ));
        }, transport.readTimeoutMs ?? 30000);
        
        // Collect response data
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        let truncated = false;
        const maxBytes = transport.maxResponseBytes ?? 10 * 1024 * 1024;
        
        res.on('data', (chunk: Buffer) => {
          if (truncated) return;
          
          totalBytes += chunk.length;
          
          if (totalBytes > maxBytes) {
            // Truncate
            const overflow = totalBytes - maxBytes;
            const truncatedChunk = chunk.slice(0, chunk.length - overflow);
            if (truncatedChunk.length > 0) {
              chunks.push(truncatedChunk);
            }
            truncated = true;
            
            logger.warn('Response truncated due to size limit', {
              maxBytes,
              totalBytes,
            });
          } else {
            chunks.push(chunk);
          }
        });
        
        res.on('end', () => {
          clearTimeout(readTimer);
          
          // Build evidence
          const evidence = this.buildEvidence(transport, req, res, totalBytes, truncated);
          
          // Verify certificate pins if configured
          if (isHTTPS && transport.certificatePins && transport.certificatePins.length > 0) {
            const pinResult = this.verifyCertPins(transport, req);
            
            if (!pinResult.valid) {
              reject(new TransportError(
                pinResult.error ?? 'Certificate pin verification failed',
                'CERTIFICATE_PIN_MISMATCH'
              ));
              return;
            }
          }
          
          resolve({
            statusCode: res.statusCode ?? 0,
            statusMessage: res.statusMessage ?? '',
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: Buffer.concat(chunks),
            truncated,
            evidence,
            finalUrl: transport.originalUrl,
          });
        });
        
        res.on('error', (error) => {
          clearTimeout(readTimer);
          reject(new TransportError(
            `Response error: ${error.message}`,
            'PROTOCOL_ERROR',
            error
          ));
        });
      });
      
      // Request error handling
      req.on('error', (error) => {
        clearTimeout(connectionTimer);
        
        const message = error.message;
        let code: TransportErrorCode = 'CONNECTION_FAILED';
        
        if (message.includes('ECONNREFUSED')) {
          code = 'CONNECTION_FAILED';
        } else if (message.includes('ETIMEDOUT')) {
          code = 'CONNECTION_TIMEOUT';
        } else if (message.includes('certificate') || message.includes('SSL') || message.includes('TLS')) {
          code = 'TLS_ERROR';
        }
        
        reject(new TransportError(message, code, error));
      });
      
      req.on('timeout', () => {
        req.destroy();
        reject(new TransportError(
          'Request timeout',
          'CONNECTION_TIMEOUT'
        ));
      });
      
      // Handle abort signal
      if (options.signal) {
        options.signal.addEventListener('abort', () => {
          req.destroy();
          reject(new TransportError('Request aborted', 'ABORTED'));
        });
      }
      
      // Send body if present
      if (options.body) {
        req.write(options.body);
      }
      
      req.end();
    });
  }
  
  /**
   * Build transport evidence from request/response.
   */
  private buildEvidence(
    transport: TransportRequirements,
    req: http.ClientRequest,
    res: http.IncomingMessage,
    totalBytes: number,
    truncated: boolean
  ): TransportEvidence {
    const socket = req.socket;
    
    // TLS info
    let tlsVersion: string | undefined;
    let certificateChain: CertificateInfo[] | undefined;
    let pinsVerified: boolean | undefined;
    
    if (transport.useTLS && socket && 'getPeerCertificate' in socket) {
      const tlsSocket = socket as import('tls').TLSSocket;
      tlsVersion = tlsSocket.getProtocol() ?? undefined;
      
      try {
        certificateChain = extractCertificateChain(tlsSocket);
        
        if (transport.certificatePins && transport.certificatePins.length > 0) {
          const pinResult = verifyCertificatePins(
            transport.hostname,
            certificateChain,
            getPinStore()
          );
          pinsVerified = pinResult.valid;
        }
      } catch (error) {
        logger.warn('Failed to extract certificate chain', { error });
      }
    }
    
    return {
      connectedIP: transport.connectToIP,
      connectedPort: transport.port,
      tlsUsed: transport.useTLS,
      tlsVersion,
      certificateChain,
      pinsVerified,
      responseBytes: totalBytes,
      truncated,
    };
  }
  
  /**
   * Verify certificate pins.
   */
  private verifyCertPins(
    transport: TransportRequirements,
    req: http.ClientRequest
  ): { valid: boolean; error?: string } {
    const socket = req.socket;
    
    if (!socket || !('getPeerCertificate' in socket)) {
      return { valid: false, error: 'No TLS socket available' };
    }
    
    const tlsSocket = socket as import('tls').TLSSocket;
    
    try {
      const chain = extractCertificateChain(tlsSocket);
      const result = verifyCertificatePins(
        transport.hostname,
        chain,
        getPinStore()
      );
      
      return {
        valid: result.valid,
        error: result.error,
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Pin verification failed',
      };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON INSTANCE
// ─────────────────────────────────────────────────────────────────────────────────

let transportInstance: SecureTransport | null = null;

/**
 * Get or create the global secure transport.
 */
export function getSecureTransport(): SecureTransport {
  if (!transportInstance) {
    transportInstance = new SecureTransport();
  }
  return transportInstance;
}

/**
 * Create a new secure transport.
 */
export function createSecureTransport(): SecureTransport {
  return new SecureTransport();
}

/**
 * Reset the global secure transport (for testing).
 */
export function resetSecureTransport(): void {
  transportInstance = null;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONVENIENCE FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Make a secure GET request using SSRFDecision.
 */
export async function secureGet(
  decision: SSRFDecision,
  headers?: Record<string, string>
): Promise<TransportResponse> {
  return getSecureTransport().get(decision, headers);
}

/**
 * Make a secure POST request using SSRFDecision.
 */
export async function securePost(
  decision: SSRFDecision,
  body: Buffer | string,
  headers?: Record<string, string>
): Promise<TransportResponse> {
  return getSecureTransport().post(decision, body, headers);
}

/**
 * Make a secure request using SSRFDecision.
 */
export async function secureRequest(
  decision: SSRFDecision,
  options?: TransportRequestOptions
): Promise<TransportResponse> {
  return getSecureTransport().request(decision, options);
}
