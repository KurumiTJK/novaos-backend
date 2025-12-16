// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK TESTS — Comprehensive Test Suite
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generateWebhookSecret,
  validateSecret,
  generateSignature,
  generateRawSignature,
  verifySignature,
  verifySignatureDetailed,
  verifyTimestamp,
  generateWebhookHeaders,
  signPayload,
  SIGNATURE_HEADER,
} from '../webhooks/signature.js';
import {
  ALL_EVENT_TYPES,
  EVENT_CATEGORIES,
  getEventCategory,
  type WebhookEventType,
} from '../webhooks/types.js';
import { createEvent } from '../webhooks/events.js';
import { WebhookStore } from '../webhooks/store.js';
import { WebhookDispatcher } from '../webhooks/dispatcher.js';
import { MemoryStore } from '../storage/memory.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────────────────────────────────────────

const TEST_USER_ID = 'test-user-123';
const TEST_WEBHOOK_URL = 'https://example.com/webhook';

function createTestStore(): WebhookStore {
  const memoryStore = new MemoryStore();
  return new WebhookStore(memoryStore as any);
}

// ─────────────────────────────────────────────────────────────────────────────────
// SIGNATURE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Webhook Signature', () => {
  describe('generateWebhookSecret', () => {
    it('should generate a 64-character hex string', () => {
      const secret = generateWebhookSecret();
      expect(secret).toHaveLength(64);
      expect(/^[a-f0-9]+$/i.test(secret)).toBe(true);
    });
    
    it('should generate unique secrets', () => {
      const secrets = new Set<string>();
      for (let i = 0; i < 100; i++) {
        secrets.add(generateWebhookSecret());
      }
      expect(secrets.size).toBe(100);
    });
  });
  
  describe('validateSecret', () => {
    it('should accept valid secrets', () => {
      const secret = generateWebhookSecret();
      const result = validateSecret(secret);
      expect(result.valid).toBe(true);
    });
    
    it('should reject empty secrets', () => {
      const result = validateSecret('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('required');
    });
    
    it('should reject short secrets', () => {
      const result = validateSecret('short');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('32 characters');
    });
    
    it('should reject low-entropy secrets', () => {
      const result = validateSecret('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('entropy');
    });
  });
  
  describe('generateSignature', () => {
    it('should generate sha256 prefixed signature', () => {
      const secret = generateWebhookSecret();
      const signature = generateSignature('test payload', secret);
      expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/i);
    });
    
    it('should handle object payloads', () => {
      const secret = generateWebhookSecret();
      const payload = { test: 'data' };
      const signature = generateSignature(payload, secret);
      expect(signature).toMatch(/^sha256=/);
    });
    
    it('should produce consistent signatures', () => {
      const secret = generateWebhookSecret();
      const payload = 'test payload';
      const sig1 = generateSignature(payload, secret);
      const sig2 = generateSignature(payload, secret);
      expect(sig1).toBe(sig2);
    });
    
    it('should produce different signatures for different payloads', () => {
      const secret = generateWebhookSecret();
      const sig1 = generateSignature('payload 1', secret);
      const sig2 = generateSignature('payload 2', secret);
      expect(sig1).not.toBe(sig2);
    });
    
    it('should produce different signatures for different secrets', () => {
      const payload = 'test payload';
      const sig1 = generateSignature(payload, generateWebhookSecret());
      const sig2 = generateSignature(payload, generateWebhookSecret());
      expect(sig1).not.toBe(sig2);
    });
  });
  
  describe('verifySignature', () => {
    it('should verify valid signatures', () => {
      const secret = generateWebhookSecret();
      const payload = 'test payload';
      const signature = generateSignature(payload, secret);
      
      expect(verifySignature(payload, signature, secret)).toBe(true);
    });
    
    it('should reject invalid signatures', () => {
      const secret = generateWebhookSecret();
      const payload = 'test payload';
      
      expect(verifySignature(payload, 'sha256=invalid', secret)).toBe(false);
    });
    
    it('should reject tampered payloads', () => {
      const secret = generateWebhookSecret();
      const signature = generateSignature('original payload', secret);
      
      expect(verifySignature('tampered payload', signature, secret)).toBe(false);
    });
    
    it('should handle signatures without prefix', () => {
      const secret = generateWebhookSecret();
      const payload = 'test payload';
      const rawSig = generateRawSignature(payload, secret);
      
      expect(verifySignature(payload, rawSig, secret)).toBe(true);
    });
  });
  
  describe('verifySignatureDetailed', () => {
    it('should return detailed success result', () => {
      const secret = generateWebhookSecret();
      const payload = 'test';
      const signature = generateSignature(payload, secret);
      
      const result = verifySignatureDetailed(payload, signature, secret);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
    
    it('should return error for missing signature', () => {
      const result = verifySignatureDetailed('payload', '', 'secret');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('No signature');
    });
    
    it('should return error for invalid format', () => {
      const result = verifySignatureDetailed('payload', 'invalid', 'secret');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('format');
    });
  });
  
  describe('verifyTimestamp', () => {
    it('should accept recent timestamps', () => {
      const now = new Date().toISOString();
      expect(verifyTimestamp(now)).toBe(true);
    });
    
    it('should reject old timestamps', () => {
      const old = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
      expect(verifyTimestamp(old, 5 * 60 * 1000)).toBe(false); // 5 minute tolerance
    });
    
    it('should accept timestamps within tolerance', () => {
      const recent = new Date(Date.now() - 2 * 60 * 1000).toISOString(); // 2 minutes ago
      expect(verifyTimestamp(recent, 5 * 60 * 1000)).toBe(true);
    });
    
    it('should reject invalid timestamps', () => {
      expect(verifyTimestamp('invalid')).toBe(false);
    });
  });
  
  describe('generateWebhookHeaders', () => {
    it('should generate all required headers', () => {
      const headers = generateWebhookHeaders(
        '{"test": true}',
        generateWebhookSecret(),
        'delivery-123',
        'goal.created',
        'webhook-456'
      );
      
      expect(headers['X-Nova-Signature']).toBeDefined();
      expect(headers['X-Nova-Timestamp']).toBeDefined();
      expect(headers['X-Nova-Delivery-Id']).toBe('delivery-123');
      expect(headers['X-Nova-Event']).toBe('goal.created');
      expect(headers['X-Nova-Webhook-Id']).toBe('webhook-456');
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['User-Agent']).toContain('NovaOS');
    });
    
    it('should include custom headers', () => {
      const headers = generateWebhookHeaders(
        '{}',
        generateWebhookSecret(),
        'delivery',
        'event',
        'webhook',
        { 'X-Custom': 'value' }
      );
      
      expect(headers['X-Custom']).toBe('value');
    });
  });
  
  describe('signPayload', () => {
    it('should return signed payload with all components', () => {
      const secret = generateWebhookSecret();
      const result = signPayload({ test: true }, secret);
      
      expect(result.payload).toBe('{"test":true}');
      expect(result.signature).toMatch(/^sha256=/);
      expect(result.timestamp).toBeDefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// EVENT TYPE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Webhook Event Types', () => {
  describe('ALL_EVENT_TYPES', () => {
    it('should contain all expected events', () => {
      expect(ALL_EVENT_TYPES).toContain('goal.created');
      expect(ALL_EVENT_TYPES).toContain('spark.suggested');
      expect(ALL_EVENT_TYPES).toContain('memory.created');
      expect(ALL_EVENT_TYPES).toContain('chat.message');
      expect(ALL_EVENT_TYPES).toContain('system.health_degraded');
    });
    
    it('should have no duplicates', () => {
      const unique = new Set(ALL_EVENT_TYPES);
      expect(unique.size).toBe(ALL_EVENT_TYPES.length);
    });
  });
  
  describe('EVENT_CATEGORIES', () => {
    it('should contain all categories', () => {
      expect(Object.keys(EVENT_CATEGORIES)).toContain('goal');
      expect(Object.keys(EVENT_CATEGORIES)).toContain('quest');
      expect(Object.keys(EVENT_CATEGORIES)).toContain('step');
      expect(Object.keys(EVENT_CATEGORIES)).toContain('spark');
      expect(Object.keys(EVENT_CATEGORIES)).toContain('memory');
      expect(Object.keys(EVENT_CATEGORIES)).toContain('chat');
      expect(Object.keys(EVENT_CATEGORIES)).toContain('user');
      expect(Object.keys(EVENT_CATEGORIES)).toContain('system');
    });
    
    it('should have events in each category', () => {
      for (const [category, events] of Object.entries(EVENT_CATEGORIES)) {
        expect(events.length).toBeGreaterThan(0);
        // All events in category should start with category prefix
        for (const event of events) {
          expect(event.startsWith(`${category}.`)).toBe(true);
        }
      }
    });
  });
  
  describe('getEventCategory', () => {
    it('should extract category from event type', () => {
      expect(getEventCategory('goal.created')).toBe('goal');
      expect(getEventCategory('spark.suggested')).toBe('spark');
      expect(getEventCategory('system.health_degraded')).toBe('system');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// EVENT CREATION TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Webhook Event Creation', () => {
  describe('createEvent', () => {
    it('should create event with all required fields', () => {
      const event = createEvent('goal.created', TEST_USER_ID, { goalId: '123' });
      
      expect(event.id).toMatch(/^evt_/);
      expect(event.type).toBe('goal.created');
      expect(event.category).toBe('goal');
      expect(event.userId).toBe(TEST_USER_ID);
      expect(event.timestamp).toBeDefined();
      expect(event.data).toEqual({ goalId: '123' });
      expect(event.version).toBe('1.0');
    });
    
    it('should include optional fields when provided', () => {
      const event = createEvent('goal.created', TEST_USER_ID, {}, {
        source: 'test',
        correlationId: 'corr-123',
      });
      
      expect(event.source).toBe('test');
      expect(event.correlationId).toBe('corr-123');
    });
    
    it('should generate unique IDs', () => {
      const events = Array.from({ length: 100 }, () =>
        createEvent('goal.created', TEST_USER_ID, {})
      );
      const ids = new Set(events.map(e => e.id));
      expect(ids.size).toBe(100);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// WEBHOOK STORE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('WebhookStore', () => {
  let store: WebhookStore;
  
  beforeEach(() => {
    store = createTestStore();
  });
  
  describe('createWebhook', () => {
    it('should create a webhook with all fields', async () => {
      const webhook = await store.createWebhook(TEST_USER_ID, {
        name: 'Test Webhook',
        description: 'A test webhook',
        url: TEST_WEBHOOK_URL,
        events: ['goal.created', 'goal.completed'],
      });
      
      expect(webhook.id).toBeDefined();
      expect(webhook.userId).toBe(TEST_USER_ID);
      expect(webhook.name).toBe('Test Webhook');
      expect(webhook.description).toBe('A test webhook');
      expect(webhook.url).toBe(TEST_WEBHOOK_URL);
      expect(webhook.secret).toHaveLength(64);
      expect(webhook.events).toEqual(['goal.created', 'goal.completed']);
      expect(webhook.status).toBe('active');
      expect(webhook.totalDeliveries).toBe(0);
      expect(webhook.consecutiveFailures).toBe(0);
    });
    
    it('should apply default options', async () => {
      const webhook = await store.createWebhook(TEST_USER_ID, {
        name: 'Test',
        url: TEST_WEBHOOK_URL,
        events: ['goal.created'],
      });
      
      expect(webhook.options.maxRetries).toBe(3);
      expect(webhook.options.retryDelayMs).toBe(1000);
      expect(webhook.options.retryBackoffMultiplier).toBe(2);
      expect(webhook.options.timeoutMs).toBe(10000);
    });
    
    it('should respect custom options', async () => {
      const webhook = await store.createWebhook(TEST_USER_ID, {
        name: 'Test',
        url: TEST_WEBHOOK_URL,
        events: ['goal.created'],
        options: {
          maxRetries: 5,
          timeoutMs: 5000,
        },
      });
      
      expect(webhook.options.maxRetries).toBe(5);
      expect(webhook.options.timeoutMs).toBe(5000);
    });
  });
  
  describe('getWebhook', () => {
    it('should retrieve a created webhook', async () => {
      const created = await store.createWebhook(TEST_USER_ID, {
        name: 'Test',
        url: TEST_WEBHOOK_URL,
        events: ['goal.created'],
      });
      
      const retrieved = await store.getWebhook(created.id);
      
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.name).toBe('Test');
    });
    
    it('should return null for non-existent webhook', async () => {
      const result = await store.getWebhook('non-existent');
      expect(result).toBeNull();
    });
  });
  
  describe('updateWebhook', () => {
    it('should update webhook fields', async () => {
      const webhook = await store.createWebhook(TEST_USER_ID, {
        name: 'Original',
        url: TEST_WEBHOOK_URL,
        events: ['goal.created'],
      });
      
      const updated = await store.updateWebhook(webhook.id, TEST_USER_ID, {
        name: 'Updated',
        events: ['goal.created', 'goal.completed'],
      });
      
      expect(updated?.name).toBe('Updated');
      expect(updated?.events).toEqual(['goal.created', 'goal.completed']);
    });
    
    it('should not update webhook for wrong user', async () => {
      const webhook = await store.createWebhook(TEST_USER_ID, {
        name: 'Test',
        url: TEST_WEBHOOK_URL,
        events: ['goal.created'],
      });
      
      const result = await store.updateWebhook(webhook.id, 'other-user', {
        name: 'Hacked',
      });
      
      expect(result).toBeNull();
    });
  });
  
  describe('deleteWebhook', () => {
    it('should delete a webhook', async () => {
      const webhook = await store.createWebhook(TEST_USER_ID, {
        name: 'Test',
        url: TEST_WEBHOOK_URL,
        events: ['goal.created'],
      });
      
      const deleted = await store.deleteWebhook(webhook.id, TEST_USER_ID);
      expect(deleted).toBe(true);
      
      const retrieved = await store.getWebhook(webhook.id);
      expect(retrieved).toBeNull();
    });
    
    it('should not delete webhook for wrong user', async () => {
      const webhook = await store.createWebhook(TEST_USER_ID, {
        name: 'Test',
        url: TEST_WEBHOOK_URL,
        events: ['goal.created'],
      });
      
      const deleted = await store.deleteWebhook(webhook.id, 'other-user');
      expect(deleted).toBe(false);
    });
  });
  
  describe('getUserWebhooks', () => {
    it('should list all user webhooks', async () => {
      await store.createWebhook(TEST_USER_ID, {
        name: 'Webhook 1',
        url: TEST_WEBHOOK_URL,
        events: ['goal.created'],
      });
      
      await store.createWebhook(TEST_USER_ID, {
        name: 'Webhook 2',
        url: 'https://example.com/webhook2',
        events: ['spark.suggested'],
      });
      
      const webhooks = await store.getUserWebhooks(TEST_USER_ID);
      
      expect(webhooks).toHaveLength(2);
      expect(webhooks.map(w => w.name)).toContain('Webhook 1');
      expect(webhooks.map(w => w.name)).toContain('Webhook 2');
    });
    
    it('should not return other users webhooks', async () => {
      await store.createWebhook(TEST_USER_ID, {
        name: 'Test',
        url: TEST_WEBHOOK_URL,
        events: ['goal.created'],
      });
      
      const webhooks = await store.getUserWebhooks('other-user');
      expect(webhooks).toHaveLength(0);
    });
  });
  
  describe('getWebhooksForEvent', () => {
    it('should return webhooks subscribed to event', async () => {
      await store.createWebhook(TEST_USER_ID, {
        name: 'Goal Webhook',
        url: TEST_WEBHOOK_URL,
        events: ['goal.created', 'goal.completed'],
      });
      
      await store.createWebhook(TEST_USER_ID, {
        name: 'Spark Webhook',
        url: 'https://example.com/spark',
        events: ['spark.suggested'],
      });
      
      const goalWebhooks = await store.getWebhooksForEvent(TEST_USER_ID, 'goal.created');
      expect(goalWebhooks).toHaveLength(1);
      expect(goalWebhooks[0].name).toBe('Goal Webhook');
      
      const sparkWebhooks = await store.getWebhooksForEvent(TEST_USER_ID, 'spark.suggested');
      expect(sparkWebhooks).toHaveLength(1);
      expect(sparkWebhooks[0].name).toBe('Spark Webhook');
    });
    
    it('should not return inactive webhooks', async () => {
      const webhook = await store.createWebhook(TEST_USER_ID, {
        name: 'Test',
        url: TEST_WEBHOOK_URL,
        events: ['goal.created'],
      });
      
      await store.setWebhookStatus(webhook.id, 'paused');
      
      const webhooks = await store.getWebhooksForEvent(TEST_USER_ID, 'goal.created');
      expect(webhooks).toHaveLength(0);
    });
  });
  
  describe('rotateSecret', () => {
    it('should generate new secret', async () => {
      const webhook = await store.createWebhook(TEST_USER_ID, {
        name: 'Test',
        url: TEST_WEBHOOK_URL,
        events: ['goal.created'],
      });
      
      const originalSecret = webhook.secret;
      const newSecret = await store.rotateSecret(webhook.id, TEST_USER_ID);
      
      expect(newSecret).not.toBeNull();
      expect(newSecret).not.toBe(originalSecret);
      expect(newSecret).toHaveLength(64);
    });
  });
  
  describe('delivery tracking', () => {
    it('should record successful delivery', async () => {
      const webhook = await store.createWebhook(TEST_USER_ID, {
        name: 'Test',
        url: TEST_WEBHOOK_URL,
        events: ['goal.created'],
      });
      
      await store.recordDeliverySuccess(webhook.id);
      
      const updated = await store.getWebhook(webhook.id);
      expect(updated?.totalDeliveries).toBe(1);
      expect(updated?.successfulDeliveries).toBe(1);
      expect(updated?.failedDeliveries).toBe(0);
      expect(updated?.consecutiveFailures).toBe(0);
    });
    
    it('should record failed delivery', async () => {
      const webhook = await store.createWebhook(TEST_USER_ID, {
        name: 'Test',
        url: TEST_WEBHOOK_URL,
        events: ['goal.created'],
      });
      
      await store.recordDeliveryFailure(webhook.id);
      
      const updated = await store.getWebhook(webhook.id);
      expect(updated?.totalDeliveries).toBe(1);
      expect(updated?.failedDeliveries).toBe(1);
      expect(updated?.consecutiveFailures).toBe(1);
    });
    
    it('should disable webhook after consecutive failures', async () => {
      const webhook = await store.createWebhook(TEST_USER_ID, {
        name: 'Test',
        url: TEST_WEBHOOK_URL,
        events: ['goal.created'],
      });
      
      // 10 consecutive failures should disable
      for (let i = 0; i < 10; i++) {
        await store.recordDeliveryFailure(webhook.id);
      }
      
      const updated = await store.getWebhook(webhook.id);
      expect(updated?.status).toBe('failed');
      expect(updated?.consecutiveFailures).toBe(10);
    });
    
    it('should reset consecutive failures on success', async () => {
      const webhook = await store.createWebhook(TEST_USER_ID, {
        name: 'Test',
        url: TEST_WEBHOOK_URL,
        events: ['goal.created'],
      });
      
      await store.recordDeliveryFailure(webhook.id);
      await store.recordDeliveryFailure(webhook.id);
      await store.recordDeliverySuccess(webhook.id);
      
      const updated = await store.getWebhook(webhook.id);
      expect(updated?.consecutiveFailures).toBe(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// DISPATCHER TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('WebhookDispatcher', () => {
  let store: WebhookStore;
  let dispatcher: WebhookDispatcher;
  
  beforeEach(() => {
    store = createTestStore();
    dispatcher = new WebhookDispatcher(store);
  });
  
  afterEach(() => {
    dispatcher.stop();
  });
  
  describe('lifecycle', () => {
    it('should start and stop', () => {
      expect(dispatcher.isRunning()).toBe(false);
      
      dispatcher.start();
      expect(dispatcher.isRunning()).toBe(true);
      
      dispatcher.stop();
      expect(dispatcher.isRunning()).toBe(false);
    });
    
    it('should handle multiple starts', () => {
      dispatcher.start();
      dispatcher.start();
      expect(dispatcher.isRunning()).toBe(true);
    });
  });
  
  describe('getStats', () => {
    it('should return dispatcher stats', () => {
      const stats = dispatcher.getStats();
      
      expect(stats).toHaveProperty('running');
      expect(stats).toHaveProperty('activeDeliveries');
      expect(typeof stats.running).toBe('boolean');
      expect(typeof stats.activeDeliveries).toBe('number');
    });
  });
  
  describe('dispatch', () => {
    it('should return 0 when no webhooks subscribed', async () => {
      const event = createEvent('goal.created', TEST_USER_ID, { goalId: '123' });
      const count = await dispatcher.dispatch(event);
      
      expect(count).toBe(0);
    });
    
    it('should queue delivery for subscribed webhooks', async () => {
      await store.createWebhook(TEST_USER_ID, {
        name: 'Test',
        url: TEST_WEBHOOK_URL,
        events: ['goal.created'],
      });
      
      const event = createEvent('goal.created', TEST_USER_ID, { goalId: '123' });
      const count = await dispatcher.dispatch(event);
      
      expect(count).toBe(1);
    });
  });
});
