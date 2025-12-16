// ═══════════════════════════════════════════════════════════════════════════════
// ACK TOKEN SECURITY — Fixes B-1, B-2, B-3
// Implements secure, non-replayable acknowledgment tokens
// ═══════════════════════════════════════════════════════════════════════════════

import { createHash, createHmac, randomUUID, timingSafeEqual as cryptoTimingSafeEqual } from 'crypto';
import { UserInput } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface AckTokenPayload {
  // Identity binding
  userId: string;
  sessionId: string;
  
  // Request binding
  messageHash: string;      // SHA-256 of input.message
  actionsHash: string;      // SHA-256 of JSON.stringify(requestedActions)
  
  // Veto context
  reason: string;
  auditId: string;
  
  // Replay prevention
  nonce: string;            // Single-use UUID
  
  // Timing
  createdAt: number;        // Unix timestamp ms
  expiresAt: number;        // Unix timestamp ms
}

export interface AckTokenValidationResult {
  valid: boolean;
  reason?: string;
  payload?: AckTokenPayload;
}

// ─────────────────────────────────────────────────────────────────────────────────
// NONCE STORE INTERFACE — Fix B-2
// Must be implemented with Redis, DB, or similar persistent store
// ─────────────────────────────────────────────────────────────────────────────────

export interface NonceStore {
  /**
   * Check if a nonce has been used.
   * @returns true if nonce exists (already used), false if available
   * @deprecated Use tryMarkUsed for atomic check-and-set
   */
  isUsed(nonce: string): Promise<boolean>;
  
  /**
   * Mark a nonce as used.
   * @param nonce - The nonce to mark
   * @param expiresAt - When the nonce record can be cleaned up
   * @deprecated Use tryMarkUsed for atomic check-and-set
   */
  markUsed(nonce: string, expiresAt: Date): Promise<void>;
  
  /**
   * Atomically check if nonce is unused AND mark it as used.
   * This prevents TOCTOU race conditions.
   * @param nonce - The nonce to check and mark
   * @param expiresAt - When the nonce record can be cleaned up
   * @returns true if nonce was unused and is now marked, false if already used
   */
  tryMarkUsed(nonce: string, expiresAt: Date): Promise<boolean>;
}

/**
 * In-memory nonce store for development/testing.
 * DO NOT USE IN PRODUCTION — use Redis or database.
 */
export class InMemoryNonceStore implements NonceStore {
  private used: Map<string, number> = new Map();
  private mutex: Set<string> = new Set(); // Simple mutex for atomicity
  
  async isUsed(nonce: string): Promise<boolean> {
    this.cleanup();
    return this.used.has(nonce);
  }
  
  async markUsed(nonce: string, expiresAt: Date): Promise<void> {
    this.used.set(nonce, expiresAt.getTime());
  }
  
  /**
   * Atomic check-and-set for in-memory store.
   * Uses a mutex set to prevent concurrent access.
   */
  async tryMarkUsed(nonce: string, expiresAt: Date): Promise<boolean> {
    this.cleanup();
    
    // Check mutex first (simulates lock acquisition)
    if (this.mutex.has(nonce)) {
      // Another operation is in progress on this nonce
      return false;
    }
    
    // Acquire mutex
    this.mutex.add(nonce);
    
    try {
      // Check if already used
      if (this.used.has(nonce)) {
        return false;
      }
      
      // Mark as used
      this.used.set(nonce, expiresAt.getTime());
      return true;
    } finally {
      // Release mutex
      this.mutex.delete(nonce);
    }
  }
  
  private cleanup(): void {
    const now = Date.now();
    for (const [nonce, expiry] of this.used.entries()) {
      if (expiry < now) {
        this.used.delete(nonce);
      }
    }
  }
}

/**
 * Redis nonce store implementation.
 * Use this in production.
 */
export class RedisNonceStore implements NonceStore {
  constructor(private redis: { 
    get: Function; 
    setex: Function;
    set: Function; // For NX option
  }) {}
  
  async isUsed(nonce: string): Promise<boolean> {
    const key = `ack_nonce:${nonce}`;
    const result = await this.redis.get(key);
    return result !== null;
  }
  
  async markUsed(nonce: string, expiresAt: Date): Promise<void> {
    const key = `ack_nonce:${nonce}`;
    const ttlSeconds = Math.ceil((expiresAt.getTime() - Date.now()) / 1000) + 60; // +60s buffer
    await this.redis.setex(key, ttlSeconds, '1');
  }
  
  /**
   * Atomic check-and-set using Redis SET NX EX.
   * SET key value NX EX ttl — only sets if key doesn't exist.
   * Returns OK if set, null if key already exists.
   */
  async tryMarkUsed(nonce: string, expiresAt: Date): Promise<boolean> {
    const key = `ack_nonce:${nonce}`;
    const ttlSeconds = Math.ceil((expiresAt.getTime() - Date.now()) / 1000) + 60;
    
    // SET key value NX EX ttl — atomic check-and-set
    // Returns 'OK' if set succeeded (key didn't exist)
    // Returns null if key already existed
    const result = await this.redis.set(key, '1', 'NX', 'EX', ttlSeconds);
    return result === 'OK';
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// TOKEN GENERATION — Fix B-1
// ─────────────────────────────────────────────────────────────────────────────────

const TOKEN_VERSION = '1';
const TOKEN_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const CLOCK_SKEW_TOLERANCE_MS = 30 * 1000; // 30 seconds — Fix B-3

/**
 * Generate a secure, context-bound acknowledgment token.
 */
export function generateAckToken(
  input: UserInput,
  reason: string,
  auditId: string,
  secret: string
): { token: string; payload: AckTokenPayload } {
  const now = Date.now();
  
  const payload: AckTokenPayload = {
    // Identity binding
    userId: input.userId,
    sessionId: input.sessionId,
    
    // Request binding — hash the actual content
    messageHash: hashContent(input.message),
    actionsHash: hashContent(JSON.stringify(input.requestedActions || [])),
    
    // Context
    reason,
    auditId,
    
    // Replay prevention
    nonce: randomUUID(),
    
    // Timing — use expiresAt directly for clarity
    createdAt: now,
    expiresAt: now + TOKEN_EXPIRY_MS,
  };
  
  // Encode payload
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
  
  // Sign with HMAC-SHA256
  const signature = createHmac('sha256', secret)
    .update(`${TOKEN_VERSION}.${payloadStr}`)
    .digest('base64url');
  
  const token = `${TOKEN_VERSION}.${payloadStr}.${signature}`;
  
  return { token, payload };
}

/**
 * Hash content for binding.
 * Uses full SHA-256, no truncation.
 */
function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────────
// TOKEN VALIDATION — Fixes B-1, B-2, B-3
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Validate an acknowledgment token.
 * 
 * Checks:
 * 1. Signature validity
 * 2. Token not expired (with clock skew tolerance)
 * 3. Nonce not previously used
 * 4. Context matches current request
 * 5. Acknowledgment text matches expected
 */
export async function validateAckToken(
  token: string,
  input: UserInput,
  ackText: string,
  expectedText: string,
  secret: string,
  nonceStore: NonceStore
): Promise<AckTokenValidationResult> {
  
  // ─────────────────────────────────────────────────────────────────────────
  // Step 1: Parse and verify signature
  // ─────────────────────────────────────────────────────────────────────────
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, reason: 'Invalid token format' };
  }
  
  const [version, payloadStr, signature] = parts;
  
  // Ensure all parts are defined (TypeScript can't infer from length check)
  if (!version || !payloadStr || !signature) {
    return { valid: false, reason: 'Invalid token format' };
  }

  if (version !== TOKEN_VERSION) {
    return { valid: false, reason: 'Invalid token version' };
  }
  
  // Verify signature
  const expectedSignature = createHmac('sha256', secret)
    .update(`${version}.${payloadStr}`)
    .digest('base64url');
  
  if (!timingSafeEqual(signature, expectedSignature)) {
    return { valid: false, reason: 'Invalid signature' };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // Step 2: Decode payload
  // ─────────────────────────────────────────────────────────────────────────
  let payload: AckTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadStr, 'base64url').toString());
  } catch {
    return { valid: false, reason: 'Invalid payload encoding' };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // Step 3: Check expiry with clock skew tolerance — Fix B-3
  // ─────────────────────────────────────────────────────────────────────────
  const now = Date.now();
  
  // Token must not be from the future (beyond tolerance)
  if (payload.createdAt > now + CLOCK_SKEW_TOLERANCE_MS) {
    return { valid: false, reason: 'Token from future (clock skew?)' };
  }
  
  // Token must not be expired (with tolerance)
  if (now > payload.expiresAt + CLOCK_SKEW_TOLERANCE_MS) {
    return { valid: false, reason: 'Token expired' };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // Step 4: Atomically check and mark nonce — Fix TOCTOU race condition
  // ─────────────────────────────────────────────────────────────────────────
  const nonceMarked = await nonceStore.tryMarkUsed(
    payload.nonce,
    new Date(payload.expiresAt + CLOCK_SKEW_TOLERANCE_MS + 60000)
  );
  
  if (!nonceMarked) {
    return { valid: false, reason: 'Token already used (replay detected)' };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // Step 5: Verify context binding — Fix B-1
  // ─────────────────────────────────────────────────────────────────────────
  
  // User must match
  if (payload.userId !== input.userId) {
    return { valid: false, reason: 'User mismatch' };
  }
  
  // Session must match
  if (payload.sessionId !== input.sessionId) {
    return { valid: false, reason: 'Session mismatch' };
  }
  
  // Message must match (same content as when veto was issued)
  const currentMessageHash = hashContent(input.message);
  if (payload.messageHash !== currentMessageHash) {
    return { valid: false, reason: 'Message content changed' };
  }
  
  // Actions must match
  const currentActionsHash = hashContent(JSON.stringify(input.requestedActions || []));
  if (payload.actionsHash !== currentActionsHash) {
    return { valid: false, reason: 'Requested actions changed' };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // Step 6: Verify acknowledgment text
  // ─────────────────────────────────────────────────────────────────────────
  if (ackText !== expectedText) {
    return { valid: false, reason: 'Acknowledgment text mismatch' };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // Step 7: All checks passed — nonce already marked in step 4
  // ─────────────────────────────────────────────────────────────────────────
  
  return { valid: true, payload };
}

/**
 * Timing-safe string comparison to prevent timing attacks.
 * Uses Node.js crypto.timingSafeEqual which handles length differences safely.
 */
function timingSafeEqual(a: string, b: string): boolean {
  // Convert to buffers - crypto.timingSafeEqual requires equal length buffers
  // We pad the shorter one to prevent length leakage
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  
  // If lengths differ, we still do constant-time comparison
  // by comparing against a buffer of the same length as the longer one
  const maxLen = Math.max(bufA.length, bufB.length);
  const paddedA = Buffer.alloc(maxLen, 0);
  const paddedB = Buffer.alloc(maxLen, 0);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  
  // Use crypto's timing-safe comparison
  // Even if lengths differ, we've done constant-time work
  const lengthsMatch = bufA.length === bufB.length;
  const contentsMatch = cryptoTimingSafeEqual(paddedA, paddedB);
  
  return lengthsMatch && contentsMatch;
}

// ─────────────────────────────────────────────────────────────────────────────────
// REQUIRED ACKNOWLEDGMENT TEXT
// Centralized to ensure consistency
// ─────────────────────────────────────────────────────────────────────────────────

export const ACK_REQUIRED_TEXT = 'I understand the risks and want to proceed';

/**
 * Get the required acknowledgment text for a soft veto.
 * Could be customized based on veto type in the future.
 */
export function getRequiredAckText(vetoReason?: string): string {
  // Currently uniform, but structured for future customization
  return ACK_REQUIRED_TEXT;
}
