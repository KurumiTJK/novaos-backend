// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK STORE — Persistence for Webhooks and Delivery Logs
// ═══════════════════════════════════════════════════════════════════════════════

import { getStore, type KeyValueStore } from '../storage/index.js';
import { generateWebhookSecret } from './signature.js';
import type {
  Webhook,
  WebhookStatus,
  WebhookEventType,
  WebhookDelivery,
  DeliveryStatus,
  DeliveryLog,
  DeliveryAttempt,
  CreateWebhookRequest,
  UpdateWebhookRequest,
  WebhookOptions,
  DEFAULT_WEBHOOK_OPTIONS,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

const WEBHOOK_TTL = 365 * 24 * 60 * 60;        // 1 year
const DELIVERY_TTL = 30 * 24 * 60 * 60;        // 30 days
const DELIVERY_LOG_TTL = 90 * 24 * 60 * 60;    // 90 days
const MAX_WEBHOOKS_PER_USER = 10;
const MAX_DELIVERY_HISTORY = 100;

// ─────────────────────────────────────────────────────────────────────────────────
// KEY GENERATION
// ─────────────────────────────────────────────────────────────────────────────────

function webhookKey(id: string): string {
  return `webhook:${id}`;
}

function userWebhooksKey(userId: string): string {
  return `webhook:user:${userId}:list`;
}

function deliveryKey(id: string): string {
  return `webhook:delivery:${id}`;
}

function webhookDeliveriesKey(webhookId: string): string {
  return `webhook:${webhookId}:deliveries`;
}

function deliveryLogKey(deliveryId: string): string {
  return `webhook:delivery:${deliveryId}:log`;
}

function pendingDeliveriesKey(): string {
  return 'webhook:pending:queue';
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────────────────────────────────────────────────────────────────
// WEBHOOK STORE CLASS
// ─────────────────────────────────────────────────────────────────────────────────

export class WebhookStore {
  private store: KeyValueStore;
  
  constructor(store?: KeyValueStore) {
    this.store = store ?? getStore();
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // WEBHOOK CRUD
  // ═══════════════════════════════════════════════════════════════════════════════
  
  async createWebhook(userId: string, request: CreateWebhookRequest): Promise<Webhook> {
    // Check limit
    const existing = await this.getUserWebhooks(userId);
    if (existing.length >= MAX_WEBHOOKS_PER_USER) {
      throw new Error(`Maximum ${MAX_WEBHOOKS_PER_USER} webhooks per user`);
    }
    
    // Validate URL
    if (!this.isValidUrl(request.url)) {
      throw new Error('Invalid webhook URL');
    }
    
    const id = generateId();
    const now = new Date().toISOString();
    const secret = generateWebhookSecret();
    
    const webhook: Webhook = {
      id,
      userId,
      name: request.name,
      description: request.description,
      url: request.url,
      secret,
      events: request.events,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      totalDeliveries: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      consecutiveFailures: 0,
      options: {
        maxRetries: request.options?.maxRetries ?? 3,
        retryDelayMs: request.options?.retryDelayMs ?? 1000,
        retryBackoffMultiplier: request.options?.retryBackoffMultiplier ?? 2,
        timeoutMs: request.options?.timeoutMs ?? 10000,
        customHeaders: request.customHeaders,
      },
    };
    
    // Save webhook
    await this.store.set(webhookKey(id), JSON.stringify(webhook), WEBHOOK_TTL);
    
    // Add to user's list
    const userWebhooks = await this.getUserWebhookIds(userId);
    userWebhooks.push(id);
    await this.store.set(userWebhooksKey(userId), JSON.stringify(userWebhooks), WEBHOOK_TTL);
    
    return webhook;
  }
  
  async getWebhook(id: string): Promise<Webhook | null> {
    const data = await this.store.get(webhookKey(id));
    return data ? JSON.parse(data) : null;
  }
  
  async updateWebhook(id: string, userId: string, updates: UpdateWebhookRequest): Promise<Webhook | null> {
    const webhook = await this.getWebhook(id);
    if (!webhook || webhook.userId !== userId) {
      return null;
    }
    
    // Validate URL if being updated
    if (updates.url && !this.isValidUrl(updates.url)) {
      throw new Error('Invalid webhook URL');
    }
    
    const updated: Webhook = {
      ...webhook,
      name: updates.name ?? webhook.name,
      description: updates.description ?? webhook.description,
      url: updates.url ?? webhook.url,
      events: updates.events ?? webhook.events,
      status: updates.status ?? webhook.status,
      updatedAt: new Date().toISOString(),
      options: {
        ...webhook.options,
        ...updates.options,
        customHeaders: updates.customHeaders ?? webhook.options.customHeaders,
      },
    };
    
    await this.store.set(webhookKey(id), JSON.stringify(updated), WEBHOOK_TTL);
    return updated;
  }
  
  async deleteWebhook(id: string, userId: string): Promise<boolean> {
    const webhook = await this.getWebhook(id);
    if (!webhook || webhook.userId !== userId) {
      return false;
    }
    
    // Delete webhook
    await this.store.delete(webhookKey(id));
    
    // Remove from user's list
    const userWebhooks = await this.getUserWebhookIds(userId);
    const filtered = userWebhooks.filter(wid => wid !== id);
    await this.store.set(userWebhooksKey(userId), JSON.stringify(filtered), WEBHOOK_TTL);
    
    return true;
  }
  
  async getUserWebhooks(userId: string): Promise<Webhook[]> {
    const ids = await this.getUserWebhookIds(userId);
    const webhooks: Webhook[] = [];
    
    for (const id of ids) {
      const webhook = await this.getWebhook(id);
      if (webhook) {
        webhooks.push(webhook);
      }
    }
    
    return webhooks;
  }
  
  private async getUserWebhookIds(userId: string): Promise<string[]> {
    const data = await this.store.get(userWebhooksKey(userId));
    return data ? JSON.parse(data) : [];
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // WEBHOOK STATUS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  async setWebhookStatus(id: string, status: WebhookStatus): Promise<void> {
    const webhook = await this.getWebhook(id);
    if (!webhook) return;
    
    webhook.status = status;
    webhook.updatedAt = new Date().toISOString();
    
    await this.store.set(webhookKey(id), JSON.stringify(webhook), WEBHOOK_TTL);
  }
  
  async recordDeliverySuccess(webhookId: string): Promise<void> {
    const webhook = await this.getWebhook(webhookId);
    if (!webhook) return;
    
    webhook.totalDeliveries++;
    webhook.successfulDeliveries++;
    webhook.consecutiveFailures = 0;
    webhook.lastDeliveryAt = new Date().toISOString();
    webhook.lastSuccessAt = webhook.lastDeliveryAt;
    
    // Re-enable if it was in failed state
    if (webhook.status === 'failed') {
      webhook.status = 'active';
    }
    
    await this.store.set(webhookKey(webhookId), JSON.stringify(webhook), WEBHOOK_TTL);
  }
  
  async recordDeliveryFailure(webhookId: string): Promise<void> {
    const webhook = await this.getWebhook(webhookId);
    if (!webhook) return;
    
    webhook.totalDeliveries++;
    webhook.failedDeliveries++;
    webhook.consecutiveFailures++;
    webhook.lastDeliveryAt = new Date().toISOString();
    webhook.lastFailureAt = webhook.lastDeliveryAt;
    
    // Disable after too many consecutive failures
    if (webhook.consecutiveFailures >= 10) {
      webhook.status = 'failed';
    }
    
    await this.store.set(webhookKey(webhookId), JSON.stringify(webhook), WEBHOOK_TTL);
  }
  
  async rotateSecret(id: string, userId: string): Promise<string | null> {
    const webhook = await this.getWebhook(id);
    if (!webhook || webhook.userId !== userId) {
      return null;
    }
    
    const newSecret = generateWebhookSecret();
    webhook.secret = newSecret;
    webhook.updatedAt = new Date().toISOString();
    
    await this.store.set(webhookKey(id), JSON.stringify(webhook), WEBHOOK_TTL);
    return newSecret;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // EVENT SUBSCRIPTIONS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  async getWebhooksForEvent(userId: string, eventType: WebhookEventType): Promise<Webhook[]> {
    const webhooks = await this.getUserWebhooks(userId);
    
    return webhooks.filter(webhook => 
      webhook.status === 'active' && 
      webhook.events.includes(eventType)
    );
  }
  
  async getAllActiveWebhooksForEvent(eventType: WebhookEventType): Promise<Webhook[]> {
    // This would be more efficient with a proper index
    // For now, we scan all webhooks (not ideal for large scale)
    const keys = await this.store.keys('webhook:user:*:list');
    const activeWebhooks: Webhook[] = [];
    
    for (const key of keys) {
      const data = await this.store.get(key);
      if (!data) continue;
      
      const webhookIds: string[] = JSON.parse(data);
      for (const id of webhookIds) {
        const webhook = await this.getWebhook(id);
        if (webhook && 
            webhook.status === 'active' && 
            webhook.events.includes(eventType)) {
          activeWebhooks.push(webhook);
        }
      }
    }
    
    return activeWebhooks;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // DELIVERY MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════════
  
  async createDelivery(
    webhook: Webhook,
    eventId: string,
    payload: string,
    signature: string
  ): Promise<WebhookDelivery> {
    const id = generateId();
    const now = new Date().toISOString();
    
    const delivery: WebhookDelivery = {
      id,
      webhookId: webhook.id,
      eventId,
      userId: webhook.userId,
      url: webhook.url,
      payload,
      signature,
      status: 'pending',
      attempt: 0,
      maxAttempts: webhook.options.maxRetries + 1,
      createdAt: now,
      scheduledAt: now,
    };
    
    // Save delivery
    await this.store.set(deliveryKey(id), JSON.stringify(delivery), DELIVERY_TTL);
    
    // Add to pending queue
    await this.store.lpush(pendingDeliveriesKey(), id);
    
    // Add to webhook's delivery history
    await this.store.lpush(webhookDeliveriesKey(webhook.id), id);
    await this.store.ltrim(webhookDeliveriesKey(webhook.id), 0, MAX_DELIVERY_HISTORY - 1);
    
    return delivery;
  }
  
  async getDelivery(id: string): Promise<WebhookDelivery | null> {
    const data = await this.store.get(deliveryKey(id));
    return data ? JSON.parse(data) : null;
  }
  
  async updateDelivery(delivery: WebhookDelivery): Promise<void> {
    await this.store.set(deliveryKey(delivery.id), JSON.stringify(delivery), DELIVERY_TTL);
  }
  
  async getWebhookDeliveries(webhookId: string, limit: number = 20): Promise<WebhookDelivery[]> {
    const ids = await this.store.lrange(webhookDeliveriesKey(webhookId), 0, limit - 1);
    const deliveries: WebhookDelivery[] = [];
    
    for (const id of ids) {
      const delivery = await this.getDelivery(id);
      if (delivery) {
        deliveries.push(delivery);
      }
    }
    
    return deliveries;
  }
  
  async getPendingDeliveries(limit: number = 50): Promise<WebhookDelivery[]> {
    const ids = await this.store.lrange(pendingDeliveriesKey(), 0, limit - 1);
    const pending: WebhookDelivery[] = [];
    const now = Date.now();
    
    for (const id of ids) {
      const delivery = await this.getDelivery(id);
      if (delivery && 
          (delivery.status === 'pending' || delivery.status === 'retrying') &&
          new Date(delivery.scheduledAt).getTime() <= now) {
        pending.push(delivery);
      }
    }
    
    return pending;
  }
  
  async removePendingDelivery(id: string): Promise<void> {
    // Note: This is O(n) - in production use a sorted set
    const ids = await this.store.lrange(pendingDeliveriesKey(), 0, -1);
    const filtered = ids.filter(did => did !== id);
    
    await this.store.delete(pendingDeliveriesKey());
    for (const fid of filtered.reverse()) {
      await this.store.lpush(pendingDeliveriesKey(), fid);
    }
  }
  
  async scheduleRetry(delivery: WebhookDelivery, delayMs: number): Promise<void> {
    delivery.status = 'retrying';
    delivery.scheduledAt = new Date(Date.now() + delayMs).toISOString();
    
    await this.updateDelivery(delivery);
    await this.store.lpush(pendingDeliveriesKey(), delivery.id);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // DELIVERY LOGS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  async createDeliveryLog(delivery: WebhookDelivery, eventType: WebhookEventType): Promise<DeliveryLog> {
    const log: DeliveryLog = {
      deliveryId: delivery.id,
      webhookId: delivery.webhookId,
      eventId: delivery.eventId,
      eventType,
      finalStatus: delivery.status,
      totalAttempts: delivery.attempt,
      createdAt: delivery.createdAt,
      completedAt: delivery.completedAt,
      totalDurationMs: delivery.completedAt 
        ? new Date(delivery.completedAt).getTime() - new Date(delivery.createdAt).getTime()
        : undefined,
      attempts: [],
    };
    
    await this.store.set(deliveryLogKey(delivery.id), JSON.stringify(log), DELIVERY_LOG_TTL);
    return log;
  }
  
  async addDeliveryAttempt(deliveryId: string, attempt: DeliveryAttempt): Promise<void> {
    const data = await this.store.get(deliveryLogKey(deliveryId));
    if (!data) return;
    
    const log: DeliveryLog = JSON.parse(data);
    log.attempts.push(attempt);
    log.totalAttempts = log.attempts.length;
    
    await this.store.set(deliveryLogKey(deliveryId), JSON.stringify(log), DELIVERY_LOG_TTL);
  }
  
  async finalizeDeliveryLog(deliveryId: string, finalStatus: DeliveryStatus): Promise<void> {
    const data = await this.store.get(deliveryLogKey(deliveryId));
    if (!data) return;
    
    const log: DeliveryLog = JSON.parse(data);
    log.finalStatus = finalStatus;
    log.completedAt = new Date().toISOString();
    log.totalDurationMs = new Date(log.completedAt).getTime() - new Date(log.createdAt).getTime();
    
    await this.store.set(deliveryLogKey(deliveryId), JSON.stringify(log), DELIVERY_LOG_TTL);
  }
  
  async getDeliveryLog(deliveryId: string): Promise<DeliveryLog | null> {
    const data = await this.store.get(deliveryLogKey(deliveryId));
    return data ? JSON.parse(data) : null;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      
      // Must be HTTPS in production
      if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
        return false;
      }
      
      // Block localhost and private IPs in production
      if (process.env.NODE_ENV === 'production') {
        const hostname = parsed.hostname.toLowerCase();
        if (hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname.startsWith('192.168.') ||
            hostname.startsWith('10.') ||
            hostname.startsWith('172.')) {
          return false;
        }
      }
      
      return true;
    } catch {
      return false;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let webhookStore: WebhookStore | null = null;

export function getWebhookStore(): WebhookStore {
  if (!webhookStore) {
    webhookStore = new WebhookStore();
  }
  return webhookStore;
}
