// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK SIGNATURE — HMAC-SHA256 Signature Generation and Verification
// ═══════════════════════════════════════════════════════════════════════════════
//
// Webhooks are signed using HMAC-SHA256 to ensure:
// 1. The payload hasn't been tampered with
// 2. The request comes from NovaOS (not a third party)
//
// Signature format: sha256=<hex_signature>
//
// ═══════════════════════════════════════════════════════════════════════════════

import crypto from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

const SIGNATURE_ALGORITHM = 'sha256';
const SIGNATURE_PREFIX = 'sha256=';
const SECRET_BYTES = 32;

// ─────────────────────────────────────────────────────────────────────────────────
// SECRET GENERATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically secure secret for webhook signing.
 * 
 * @returns 64-character hex string
 */
export function generateWebhookSecret(): string {
  return crypto.randomBytes(SECRET_BYTES).toString('hex');
}

/**
 * Validate that a secret meets security requirements.
 */
export function validateSecret(secret: string): { valid: boolean; error?: string } {
  if (!secret || typeof secret !== 'string') {
    return { valid: false, error: 'Secret is required' };
  }
  
  if (secret.length < 32) {
    return { valid: false, error: 'Secret must be at least 32 characters' };
  }
  
  // Check for low-entropy secrets
  const uniqueChars = new Set(secret).size;
  if (uniqueChars < 10) {
    return { valid: false, error: 'Secret has insufficient entropy' };
  }
  
  return { valid: true };
}

// ─────────────────────────────────────────────────────────────────────────────────
// SIGNATURE GENERATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Generate HMAC-SHA256 signature for a payload.
 * 
 * @param payload - The payload to sign (string or object)
 * @param secret - The webhook secret
 * @returns Signature with prefix (sha256=...)
 */
export function generateSignature(payload: string | object, secret: string): string {
  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  
  const hmac = crypto.createHmac(SIGNATURE_ALGORITHM, secret);
  hmac.update(payloadString, 'utf8');
  const signature = hmac.digest('hex');
  
  return `${SIGNATURE_PREFIX}${signature}`;
}

/**
 * Generate raw signature without prefix.
 */
export function generateRawSignature(payload: string | object, secret: string): string {
  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  
  const hmac = crypto.createHmac(SIGNATURE_ALGORITHM, secret);
  hmac.update(payloadString, 'utf8');
  return hmac.digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────────
// SIGNATURE VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Verify a webhook signature.
 * 
 * @param payload - The payload that was signed
 * @param signature - The signature to verify (with or without prefix)
 * @param secret - The webhook secret
 * @returns true if signature is valid
 */
export function verifySignature(
  payload: string | object,
  signature: string,
  secret: string
): boolean {
  // Extract signature without prefix
  const providedSig = signature.startsWith(SIGNATURE_PREFIX) 
    ? signature.slice(SIGNATURE_PREFIX.length) 
    : signature;
  
  // Generate expected signature
  const expectedSig = generateRawSignature(payload, secret);
  
  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(providedSig, 'hex'),
      Buffer.from(expectedSig, 'hex')
    );
  } catch {
    // Buffers have different lengths or invalid hex
    return false;
  }
}

/**
 * Verify signature with detailed result.
 */
export interface SignatureVerificationResult {
  valid: boolean;
  error?: string;
  expectedPrefix?: string;
}

export function verifySignatureDetailed(
  payload: string | object,
  signature: string,
  secret: string
): SignatureVerificationResult {
  if (!signature) {
    return { valid: false, error: 'No signature provided' };
  }
  
  if (!signature.startsWith(SIGNATURE_PREFIX)) {
    return { 
      valid: false, 
      error: 'Invalid signature format', 
      expectedPrefix: SIGNATURE_PREFIX 
    };
  }
  
  const providedSig = signature.slice(SIGNATURE_PREFIX.length);
  
  // Check hex format
  if (!/^[a-f0-9]{64}$/i.test(providedSig)) {
    return { valid: false, error: 'Invalid signature format (not valid hex)' };
  }
  
  const expectedSig = generateRawSignature(payload, secret);
  
  try {
    const isValid = crypto.timingSafeEqual(
      Buffer.from(providedSig, 'hex'),
      Buffer.from(expectedSig, 'hex')
    );
    
    if (!isValid) {
      return { valid: false, error: 'Signature mismatch' };
    }
    
    return { valid: true };
  } catch (error) {
    return { valid: false, error: 'Signature verification failed' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// TIMESTAMP VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Verify that a webhook timestamp is within acceptable bounds.
 * This prevents replay attacks.
 * 
 * @param timestamp - ISO timestamp string
 * @param toleranceMs - Max age in milliseconds (default: 5 minutes)
 * @returns true if timestamp is recent enough
 */
export function verifyTimestamp(timestamp: string, toleranceMs: number = 300000): boolean {
  try {
    const eventTime = new Date(timestamp).getTime();
    const now = Date.now();
    const age = Math.abs(now - eventTime);
    
    return age <= toleranceMs;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// HEADER HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

export const SIGNATURE_HEADER = 'X-Nova-Signature';
export const TIMESTAMP_HEADER = 'X-Nova-Timestamp';
export const DELIVERY_ID_HEADER = 'X-Nova-Delivery-Id';
export const EVENT_TYPE_HEADER = 'X-Nova-Event';
export const WEBHOOK_ID_HEADER = 'X-Nova-Webhook-Id';

/**
 * Generate all webhook headers for a delivery.
 */
export interface WebhookHeaders {
  [SIGNATURE_HEADER]: string;
  [TIMESTAMP_HEADER]: string;
  [DELIVERY_ID_HEADER]: string;
  [EVENT_TYPE_HEADER]: string;
  [WEBHOOK_ID_HEADER]: string;
  'Content-Type': string;
  'User-Agent': string;
}

export function generateWebhookHeaders(
  payload: string,
  secret: string,
  deliveryId: string,
  eventType: string,
  webhookId: string,
  customHeaders?: Record<string, string>
): WebhookHeaders & Record<string, string> {
  const timestamp = new Date().toISOString();
  const signature = generateSignature(payload, secret);
  
  const headers: WebhookHeaders = {
    [SIGNATURE_HEADER]: signature,
    [TIMESTAMP_HEADER]: timestamp,
    [DELIVERY_ID_HEADER]: deliveryId,
    [EVENT_TYPE_HEADER]: eventType,
    [WEBHOOK_ID_HEADER]: webhookId,
    'Content-Type': 'application/json',
    'User-Agent': 'NovaOS-Webhooks/1.0',
  };
  
  if (customHeaders) {
    return { ...headers, ...customHeaders };
  }
  
  return headers;
}

// ─────────────────────────────────────────────────────────────────────────────────
// PAYLOAD SIGNING HELPER
// ─────────────────────────────────────────────────────────────────────────────────

export interface SignedPayload {
  payload: string;
  signature: string;
  timestamp: string;
}

/**
 * Sign a payload and return all necessary components.
 */
export function signPayload(payload: object, secret: string): SignedPayload {
  const payloadString = JSON.stringify(payload);
  const timestamp = new Date().toISOString();
  const signature = generateSignature(payloadString, secret);
  
  return {
    payload: payloadString,
    signature,
    timestamp,
  };
}
