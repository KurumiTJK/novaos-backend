// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK API ROUTES — Webhook Management Endpoints
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, type Request, type Response } from 'express';
import { getWebhookStore } from '../webhooks/store.js';
import { getWebhookDispatcher } from '../webhooks/dispatcher.js';
import { ALL_EVENT_TYPES, type WebhookEventType } from '../webhooks/types.js';
import { getLogger } from '../logging/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'webhook-api' });

interface AuthenticatedRequest extends Request {
  userId?: string;
}

function getUserId(req: AuthenticatedRequest): string {
  const userId = req.userId;
  if (!userId) {
    throw new Error('Authentication required');
  }
  return userId;
}

// ─────────────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────────────

function validateEvents(events: unknown): WebhookEventType[] {
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error('events must be a non-empty array');
  }
  
  for (const event of events) {
    if (!ALL_EVENT_TYPES.includes(event as WebhookEventType)) {
      throw new Error(`Invalid event type: ${event}`);
    }
  }
  
  return events as WebhookEventType[];
}

function validateUrl(url: string): void {
  try {
    new URL(url);
  } catch {
    throw new Error('Invalid URL format');
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// ROUTER
// ─────────────────────────────────────────────────────────────────────────────────

export function createWebhooksRouter(): Router {
  const router = Router();
  const store = getWebhookStore();
  const dispatcher = getWebhookDispatcher();
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // LIST WEBHOOKS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = getUserId(req);
      const webhooks = await store.getUserWebhooks(userId);
      
      // Remove secrets from response
      const sanitized = webhooks.map(webhook => ({
        ...webhook,
        secret: undefined,
      }));
      
      res.json({
        webhooks: sanitized,
        count: sanitized.length,
      });
    } catch (error) {
      logger.error('Failed to list webhooks', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to list webhooks' });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // CREATE WEBHOOK
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.post('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = getUserId(req);
      const { name, description, url, events, options, customHeaders } = req.body;
      
      // Validation
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'name is required' });
      }
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'url is required' });
      }
      
      validateUrl(url);
      const validatedEvents = validateEvents(events);
      
      const webhook = await store.createWebhook(userId, {
        name,
        description,
        url,
        events: validatedEvents,
        options,
        customHeaders,
      });
      
      logger.info('Webhook created', {
        webhookId: webhook.id,
        userId,
        url: webhook.url,
        events: webhook.events,
      });
      
      res.status(201).json({
        webhook,
        message: 'Webhook created successfully. Save the secret - it will not be shown again.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create webhook';
      logger.error('Failed to create webhook', error instanceof Error ? error : new Error(message));
      res.status(400).json({ error: message });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // GET WEBHOOK
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      
      const webhook = await store.getWebhook(id);
      
      if (!webhook || webhook.userId !== userId) {
        return res.status(404).json({ error: 'Webhook not found' });
      }
      
      // Remove secret
      res.json({
        webhook: {
          ...webhook,
          secret: undefined,
        },
      });
    } catch (error) {
      logger.error('Failed to get webhook', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to get webhook' });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // UPDATE WEBHOOK
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.patch('/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      const { name, description, url, events, status, options, customHeaders } = req.body;
      
      // Validate URL if provided
      if (url) {
        validateUrl(url);
      }
      
      // Validate events if provided
      let validatedEvents: WebhookEventType[] | undefined;
      if (events) {
        validatedEvents = validateEvents(events);
      }
      
      const webhook = await store.updateWebhook(id, userId, {
        name,
        description,
        url,
        events: validatedEvents,
        status,
        options,
        customHeaders,
      });
      
      if (!webhook) {
        return res.status(404).json({ error: 'Webhook not found' });
      }
      
      logger.info('Webhook updated', {
        webhookId: id,
        userId,
      });
      
      res.json({
        webhook: {
          ...webhook,
          secret: undefined,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update webhook';
      logger.error('Failed to update webhook', error instanceof Error ? error : new Error(message));
      res.status(400).json({ error: message });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // DELETE WEBHOOK
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      
      const deleted = await store.deleteWebhook(id, userId);
      
      if (!deleted) {
        return res.status(404).json({ error: 'Webhook not found' });
      }
      
      logger.info('Webhook deleted', {
        webhookId: id,
        userId,
      });
      
      res.json({ message: 'Webhook deleted' });
    } catch (error) {
      logger.error('Failed to delete webhook', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to delete webhook' });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // ROTATE SECRET
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.post('/:id/rotate-secret', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      
      const newSecret = await store.rotateSecret(id, userId);
      
      if (!newSecret) {
        return res.status(404).json({ error: 'Webhook not found' });
      }
      
      logger.info('Webhook secret rotated', {
        webhookId: id,
        userId,
      });
      
      res.json({
        secret: newSecret,
        message: 'Secret rotated successfully. Save the new secret - it will not be shown again.',
      });
    } catch (error) {
      logger.error('Failed to rotate secret', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to rotate secret' });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST WEBHOOK
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.post('/:id/test', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      
      // Verify ownership
      const webhook = await store.getWebhook(id);
      if (!webhook || webhook.userId !== userId) {
        return res.status(404).json({ error: 'Webhook not found' });
      }
      
      const result = await dispatcher.testWebhook(id);
      
      logger.info('Webhook test completed', {
        webhookId: id,
        userId,
        success: result.success,
      });
      
      res.json({
        success: result.success,
        statusCode: result.statusCode,
        responseTimeMs: result.responseTimeMs,
        error: result.error,
      });
    } catch (error) {
      logger.error('Failed to test webhook', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to test webhook' });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // GET DELIVERIES
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get('/:id/deliveries', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      
      // Verify ownership
      const webhook = await store.getWebhook(id);
      if (!webhook || webhook.userId !== userId) {
        return res.status(404).json({ error: 'Webhook not found' });
      }
      
      const deliveries = await store.getWebhookDeliveries(id, limit);
      
      res.json({
        deliveries,
        count: deliveries.length,
      });
    } catch (error) {
      logger.error('Failed to get deliveries', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to get deliveries' });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // GET DELIVERY LOG
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get('/:id/deliveries/:deliveryId/log', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = getUserId(req);
      const { id, deliveryId } = req.params;
      
      // Verify ownership
      const webhook = await store.getWebhook(id);
      if (!webhook || webhook.userId !== userId) {
        return res.status(404).json({ error: 'Webhook not found' });
      }
      
      const log = await store.getDeliveryLog(deliveryId);
      
      if (!log || log.webhookId !== id) {
        return res.status(404).json({ error: 'Delivery log not found' });
      }
      
      res.json({ log });
    } catch (error) {
      logger.error('Failed to get delivery log', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to get delivery log' });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // RETRY DELIVERY
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.post('/:id/deliveries/:deliveryId/retry', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = getUserId(req);
      const { id, deliveryId } = req.params;
      
      // Verify ownership
      const webhook = await store.getWebhook(id);
      if (!webhook || webhook.userId !== userId) {
        return res.status(404).json({ error: 'Webhook not found' });
      }
      
      const delivery = await store.getDelivery(deliveryId);
      if (!delivery || delivery.webhookId !== id) {
        return res.status(404).json({ error: 'Delivery not found' });
      }
      
      const success = await dispatcher.retryDelivery(deliveryId);
      
      if (!success) {
        return res.status(400).json({ error: 'Cannot retry this delivery' });
      }
      
      logger.info('Delivery retry scheduled', {
        webhookId: id,
        deliveryId,
        userId,
      });
      
      res.json({ message: 'Retry scheduled' });
    } catch (error) {
      logger.error('Failed to retry delivery', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to retry delivery' });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // LIST EVENT TYPES
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get('/meta/event-types', (_req: Request, res: Response) => {
    res.json({
      eventTypes: ALL_EVENT_TYPES,
    });
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // DISPATCHER STATUS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get('/meta/status', (_req: Request, res: Response) => {
    const stats = dispatcher.getStats();
    res.json(stats);
  });
  
  return router;
}
