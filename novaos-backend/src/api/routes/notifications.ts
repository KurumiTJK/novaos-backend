// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATION API ROUTES — In-App Notification Endpoints
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, type Request, type Response } from 'express';
import { getNotificationStore } from '../../notifications/store.js';
import { getNotificationService } from '../../notifications/service.js';
import type { NotificationType, NotificationPriority } from '../../notifications/types.js';
import { getLogger } from '../../logging/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'notification-api' });

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
// ROUTER
// ─────────────────────────────────────────────────────────────────────────────────

export function createNotificationsRouter(): Router {
  const router = Router();
  const store = getNotificationStore();
  const service = getNotificationService();
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // LIST NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = getUserId(req);
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;
      const unreadOnly = req.query.unreadOnly === 'true';
      const types = req.query.types 
        ? (req.query.types as string).split(',') as NotificationType[]
        : undefined;
      const minPriority = req.query.minPriority as NotificationPriority | undefined;
      
      const notifications = await store.getUserNotifications(userId, {
        limit,
        offset,
        unreadOnly,
        types,
        minPriority,
      });
      
      res.json({
        notifications,
        count: notifications.length,
        offset,
        limit,
      });
    } catch (error) {
      logger.error('Failed to list notifications', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to list notifications' });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // GET UNREAD NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get('/unread', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = getUserId(req);
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      
      const notifications = await store.getUnreadNotifications(userId, limit);
      
      res.json({
        notifications,
        count: notifications.length,
      });
    } catch (error) {
      logger.error('Failed to get unread notifications', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to get unread notifications' });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // GET SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get('/summary', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = getUserId(req);
      const summary = await store.getSummary(userId);
      
      res.json({ summary });
    } catch (error) {
      logger.error('Failed to get summary', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to get summary' });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // GET UNREAD COUNT
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get('/count', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = getUserId(req);
      const unreadCount = await store.getUnreadCount(userId);
      
      res.json({ unreadCount });
    } catch (error) {
      logger.error('Failed to get count', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to get count' });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // GET NOTIFICATION
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = getUserId(req);
      const id = req.params.id;
      
      if (!id) {
        res.status(400).json({ error: 'id parameter is required' });
        return;
      }
      
      const notification = await store.getNotification(id);
      
      if (!notification || notification.userId !== userId) {
        res.status(404).json({ error: 'Notification not found' });
        return;
      }
      
      res.json({ notification });
    } catch (error) {
      logger.error('Failed to get notification', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to get notification' });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // MARK AS READ
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.post('/:id/read', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = getUserId(req);
      const id = req.params.id;
      
      if (!id) {
        res.status(400).json({ error: 'id parameter is required' });
        return;
      }
      
      const success = await store.markAsRead(id, userId);
      
      if (!success) {
        res.status(404).json({ error: 'Notification not found' });
        return;
      }
      
      res.json({ message: 'Marked as read' });
    } catch (error) {
      logger.error('Failed to mark as read', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to mark as read' });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // MARK ALL AS READ
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.post('/read-all', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = getUserId(req);
      const count = await store.markAllAsRead(userId);
      
      logger.info('Marked all notifications as read', { userId, count });
      
      res.json({ message: 'All marked as read', count });
    } catch (error) {
      logger.error('Failed to mark all as read', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to mark all as read' });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // DISMISS NOTIFICATION
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.post('/:id/dismiss', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = getUserId(req);
      const id = req.params.id;
      
      if (!id) {
        res.status(400).json({ error: 'id parameter is required' });
        return;
      }
      
      const success = await store.dismiss(id, userId);
      
      if (!success) {
        res.status(404).json({ error: 'Notification not found' });
        return;
      }
      
      res.json({ message: 'Dismissed' });
    } catch (error) {
      logger.error('Failed to dismiss', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to dismiss' });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // DISMISS ALL
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.post('/dismiss-all', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = getUserId(req);
      const count = await store.dismissAll(userId);
      
      logger.info('Dismissed all notifications', { userId, count });
      
      res.json({ message: 'All dismissed', count });
    } catch (error) {
      logger.error('Failed to dismiss all', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to dismiss all' });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // DELETE NOTIFICATION
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.delete('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = getUserId(req);
      const id = req.params.id;
      
      if (!id) {
        res.status(400).json({ error: 'id parameter is required' });
        return;
      }
      
      const deleted = await store.deleteNotification(id, userId);
      
      if (!deleted) {
        res.status(404).json({ error: 'Notification not found' });
        return;
      }
      
      res.json({ message: 'Deleted' });
    } catch (error) {
      logger.error('Failed to delete notification', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to delete notification' });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // PREFERENCES
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get('/preferences', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = getUserId(req);
      const preferences = await store.getPreferences(userId);
      
      res.json({ preferences });
    } catch (error) {
      logger.error('Failed to get preferences', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to get preferences' });
    }
  });
  
  router.patch('/preferences', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = getUserId(req);
      const updates = req.body;
      
      // Remove userId from updates to prevent tampering
      delete updates.userId;
      
      const preferences = await store.updatePreferences(userId, updates);
      
      logger.info('Notification preferences updated', { userId });
      
      res.json({ preferences });
    } catch (error) {
      logger.error('Failed to update preferences', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to update preferences' });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // CLEANUP EXPIRED
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.post('/cleanup', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = getUserId(req);
      const removed = await store.cleanupExpired(userId);
      
      res.json({ removed });
    } catch (error) {
      logger.error('Failed to cleanup', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to cleanup' });
    }
  });
  
  return router;
}
