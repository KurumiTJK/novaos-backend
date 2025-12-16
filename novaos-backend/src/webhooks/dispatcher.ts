// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK DISPATCHER — Delivery Engine with Retry Logic
// ═══════════════════════════════════════════════════════════════════════════════
//
// Handles:
// - Queuing events for delivery
// - HTTP delivery with timeout
// - Retry with exponential backoff
// - Failure tracking and webhook disabling
//
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  WebhookEvent,
  Webhook,
  WebhookDelivery,
  WebhookPayload,
  DeliveryAttempt,
} from './types.js';
import { WebhookStore, getWebhookStore } from './store.js';
import {
  generateSignature,
  generateWebhookHeaders,
  SIGNATURE_HEADER,
} from './signature.js';
import { getLogger } from '../logging/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_PAYLOAD_SIZE = 1024 * 1024; // 1MB
const PROCESS_INTERVAL_MS = 5000;     // Check for pending deliveries every 5s

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'webhook-dispatcher' });

// ─────────────────────────────────────────────────────────────────────────────────
// DISPATCHER CLASS
// ─────────────────────────────────────────────────────────────────────────────────

export class WebhookDispatcher {
  private store: WebhookStore;
  private running: boolean = false;
  private processInterval: NodeJS.Timeout | null = null;
  private activeDeliveries: Set<string> = new Set();
  
  constructor(store?: WebhookStore) {
    this.store = store ?? getWebhookStore();
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════════
  
  start(): void {
    if (this.running) return;
    
    this.running = true;
    this.processInterval = setInterval(() => this.processPendingDeliveries(), PROCESS_INTERVAL_MS);
    
    logger.info('Webhook dispatcher started');
  }
  
  stop(): void {
    if (!this.running) return;
    
    this.running = false;
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }
    
    logger.info('Webhook dispatcher stopped');
  }
  
  isRunning(): boolean {
    return this.running;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // DISPATCH
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Dispatch an event to all subscribed webhooks.
   */
  async dispatch(event: WebhookEvent): Promise<number> {
    const webhooks = await this.store.getWebhooksForEvent(event.userId, event.type);
    
    if (webhooks.length === 0) {
      logger.debug('No webhooks subscribed to event', { 
        eventType: event.type, 
        userId: event.userId 
      });
      return 0;
    }
    
    logger.info('Dispatching event to webhooks', {
      eventId: event.id,
      eventType: event.type,
      webhookCount: webhooks.length,
    });
    
    let queued = 0;
    
    for (const webhook of webhooks) {
      try {
        await this.queueDelivery(webhook, event);
        queued++;
      } catch (error) {
        logger.error(
          'Failed to queue webhook delivery',
          error instanceof Error ? error : new Error(String(error)),
          { webhookId: webhook.id, eventId: event.id }
        );
      }
    }
    
    return queued;
  }
  
  /**
   * Queue a delivery for a specific webhook.
   */
  private async queueDelivery(webhook: Webhook, event: WebhookEvent): Promise<WebhookDelivery> {
    // Build payload
    const payload: WebhookPayload = {
      id: `dlv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      event: event.type,
      timestamp: event.timestamp,
      data: event.data,
      webhookId: webhook.id,
      userId: event.userId,
      attempt: 1,
      signature: '', // Will be set below
    };
    
    const payloadString = JSON.stringify(payload);
    
    // Check payload size
    if (payloadString.length > MAX_PAYLOAD_SIZE) {
      throw new Error(`Payload too large: ${payloadString.length} bytes`);
    }
    
    // Generate signature
    const signature = generateSignature(payloadString, webhook.secret);
    payload.signature = signature;
    
    // Create delivery record
    const delivery = await this.store.createDelivery(
      webhook,
      event.id,
      payloadString,
      signature
    );
    
    // Create delivery log
    await this.store.createDeliveryLog(delivery, event.type);
    
    logger.debug('Queued webhook delivery', {
      deliveryId: delivery.id,
      webhookId: webhook.id,
      eventId: event.id,
    });
    
    return delivery;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // PROCESSING
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Process pending deliveries.
   */
  private async processPendingDeliveries(): Promise<void> {
    if (!this.running) return;
    
    try {
      const pending = await this.store.getPendingDeliveries(20);
      
      for (const delivery of pending) {
        // Skip if already being processed
        if (this.activeDeliveries.has(delivery.id)) continue;
        
        this.activeDeliveries.add(delivery.id);
        
        // Process in background
        this.processDelivery(delivery).finally(() => {
          this.activeDeliveries.delete(delivery.id);
        });
      }
    } catch (error) {
      logger.error(
        'Error processing pending deliveries',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
  
  /**
   * Process a single delivery.
   */
  private async processDelivery(delivery: WebhookDelivery): Promise<void> {
    const webhook = await this.store.getWebhook(delivery.webhookId);
    if (!webhook) {
      logger.warn('Webhook not found for delivery', { deliveryId: delivery.id });
      await this.store.removePendingDelivery(delivery.id);
      return;
    }
    
    // Check if webhook is still active
    if (webhook.status !== 'active') {
      logger.debug('Skipping delivery for inactive webhook', { 
        deliveryId: delivery.id, 
        status: webhook.status 
      });
      delivery.status = 'failed';
      delivery.error = `Webhook is ${webhook.status}`;
      await this.store.updateDelivery(delivery);
      await this.store.removePendingDelivery(delivery.id);
      return;
    }
    
    // Attempt delivery
    delivery.attempt++;
    delivery.status = 'in_progress';
    delivery.attemptedAt = new Date().toISOString();
    await this.store.updateDelivery(delivery);
    
    const result = await this.attemptDelivery(webhook, delivery);
    
    // Record attempt
    const attempt: DeliveryAttempt = {
      attempt: delivery.attempt,
      timestamp: new Date().toISOString(),
      status: result.success ? 'success' : 'failure',
      responseStatus: result.statusCode,
      responseTimeMs: result.responseTimeMs,
      error: result.error,
    };
    
    await this.store.addDeliveryAttempt(delivery.id, attempt);
    
    if (result.success) {
      // Success
      delivery.status = 'delivered';
      delivery.responseStatus = result.statusCode;
      delivery.responseBody = result.body?.slice(0, 1000); // Truncate response
      delivery.responseTimeMs = result.responseTimeMs;
      delivery.completedAt = new Date().toISOString();
      
      await this.store.updateDelivery(delivery);
      await this.store.removePendingDelivery(delivery.id);
      await this.store.recordDeliverySuccess(webhook.id);
      await this.store.finalizeDeliveryLog(delivery.id, 'delivered');
      
      logger.info('Webhook delivery successful', {
        deliveryId: delivery.id,
        webhookId: webhook.id,
        attempt: delivery.attempt,
        responseTime: result.responseTimeMs,
      });
    } else {
      // Failure
      delivery.responseStatus = result.statusCode;
      delivery.responseBody = result.body?.slice(0, 1000);
      delivery.responseTimeMs = result.responseTimeMs;
      delivery.error = result.error;
      
      if (delivery.attempt < delivery.maxAttempts) {
        // Schedule retry with exponential backoff
        const delay = this.calculateBackoff(
          delivery.attempt,
          webhook.options.retryDelayMs,
          webhook.options.retryBackoffMultiplier
        );
        
        await this.store.scheduleRetry(delivery, delay);
        
        logger.warn('Webhook delivery failed, scheduling retry', {
          deliveryId: delivery.id,
          webhookId: webhook.id,
          attempt: delivery.attempt,
          maxAttempts: delivery.maxAttempts,
          retryIn: delay,
          error: result.error,
        });
      } else {
        // Max attempts reached
        delivery.status = 'failed';
        delivery.completedAt = new Date().toISOString();
        
        await this.store.updateDelivery(delivery);
        await this.store.removePendingDelivery(delivery.id);
        await this.store.recordDeliveryFailure(webhook.id);
        await this.store.finalizeDeliveryLog(delivery.id, 'failed');
        
        logger.error('Webhook delivery failed permanently', undefined, {
          deliveryId: delivery.id,
          webhookId: webhook.id,
          attempts: delivery.attempt,
          error: result.error,
        });
      }
    }
  }
  
  /**
   * Attempt HTTP delivery to webhook endpoint.
   */
  private async attemptDelivery(
    webhook: Webhook,
    delivery: WebhookDelivery
  ): Promise<{
    success: boolean;
    statusCode?: number;
    body?: string;
    responseTimeMs?: number;
    error?: string;
  }> {
    const startTime = Date.now();
    const timeoutMs = webhook.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    
    // Update payload with current attempt
    const payload = JSON.parse(delivery.payload);
    payload.attempt = delivery.attempt;
    const payloadString = JSON.stringify(payload);
    
    // Regenerate signature with updated payload
    const signature = generateSignature(payloadString, webhook.secret);
    
    // Build headers
    const headers = generateWebhookHeaders(
      payloadString,
      webhook.secret,
      delivery.id,
      payload.event,
      webhook.id,
      webhook.options.customHeaders
    );
    
    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body: payloadString,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      const responseTimeMs = Date.now() - startTime;
      const body = await response.text().catch(() => '');
      
      // 2xx is success
      const success = response.status >= 200 && response.status < 300;
      
      return {
        success,
        statusCode: response.status,
        body,
        responseTimeMs,
        error: success ? undefined : `HTTP ${response.status}`,
      };
    } catch (error) {
      const responseTimeMs = Date.now() - startTime;
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return {
            success: false,
            responseTimeMs,
            error: `Timeout after ${timeoutMs}ms`,
          };
        }
        
        return {
          success: false,
          responseTimeMs,
          error: error.message,
        };
      }
      
      return {
        success: false,
        responseTimeMs,
        error: 'Unknown error',
      };
    }
  }
  
  /**
   * Calculate backoff delay for retry.
   */
  private calculateBackoff(attempt: number, baseDelayMs: number, multiplier: number): number {
    // Exponential backoff with jitter
    const exponentialDelay = baseDelayMs * Math.pow(multiplier, attempt - 1);
    const jitter = Math.random() * 0.3 * exponentialDelay; // Up to 30% jitter
    
    // Cap at 1 hour
    return Math.min(exponentialDelay + jitter, 3600000);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // MANUAL OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Manually retry a failed delivery.
   */
  async retryDelivery(deliveryId: string): Promise<boolean> {
    const delivery = await this.store.getDelivery(deliveryId);
    if (!delivery || delivery.status !== 'failed') {
      return false;
    }
    
    // Reset for retry
    delivery.status = 'retrying';
    delivery.attempt = 0; // Will be incremented on next process
    delivery.scheduledAt = new Date().toISOString();
    delivery.error = undefined;
    
    await this.store.updateDelivery(delivery);
    await this.store.scheduleRetry(delivery, 0); // Immediate retry
    
    return true;
  }
  
  /**
   * Test a webhook by sending a test event.
   */
  async testWebhook(webhookId: string): Promise<{
    success: boolean;
    statusCode?: number;
    responseTimeMs?: number;
    error?: string;
  }> {
    const webhook = await this.store.getWebhook(webhookId);
    if (!webhook) {
      return { success: false, error: 'Webhook not found' };
    }
    
    // Create test payload
    const testPayload: WebhookPayload = {
      id: `test_${Date.now().toString(36)}`,
      event: 'goal.created', // Use a common event type
      timestamp: new Date().toISOString(),
      data: {
        test: true,
        message: 'This is a test webhook delivery from NovaOS',
      },
      webhookId: webhook.id,
      userId: webhook.userId,
      attempt: 1,
      signature: '',
    };
    
    const payloadString = JSON.stringify(testPayload);
    testPayload.signature = generateSignature(payloadString, webhook.secret);
    
    // Create a mock delivery for the attempt
    const mockDelivery: WebhookDelivery = {
      id: testPayload.id,
      webhookId: webhook.id,
      eventId: 'test',
      userId: webhook.userId,
      url: webhook.url,
      payload: JSON.stringify(testPayload),
      signature: testPayload.signature,
      status: 'pending',
      attempt: 0,
      maxAttempts: 1,
      createdAt: new Date().toISOString(),
      scheduledAt: new Date().toISOString(),
    };
    
    return this.attemptDelivery(webhook, mockDelivery);
  }
  
  /**
   * Get dispatcher statistics.
   */
  getStats(): {
    running: boolean;
    activeDeliveries: number;
  } {
    return {
      running: this.running,
      activeDeliveries: this.activeDeliveries.size,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let dispatcher: WebhookDispatcher | null = null;

export function getWebhookDispatcher(): WebhookDispatcher {
  if (!dispatcher) {
    dispatcher = new WebhookDispatcher();
  }
  return dispatcher;
}

export function createWebhookDispatcher(store?: WebhookStore): WebhookDispatcher {
  return new WebhookDispatcher(store);
}
