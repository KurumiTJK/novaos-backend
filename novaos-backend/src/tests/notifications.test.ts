// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATION TESTS — Comprehensive Test Suite
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import {
  NOTIFICATION_TEMPLATES,
  PRIORITY_ORDER,
  comparePriority,
  meetsMinPriority,
  type NotificationType,
  type NotificationPriority,
} from '../notifications/types.js';
import { NotificationStore } from '../notifications/store.js';
import { NotificationService, MockPushProvider, MockEmailProvider } from '../notifications/service.js';
import { MemoryStore } from '../storage/memory.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────────────────────────────────────────

const TEST_USER_ID = 'test-user-123';

function createTestStore(): NotificationStore {
  const memoryStore = new MemoryStore();
  return new NotificationStore(memoryStore as any);
}

function createTestService(store: NotificationStore): NotificationService {
  return new NotificationService(store, {
    pushProvider: new MockPushProvider(),
    emailProvider: new MockEmailProvider(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────────
// TYPE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Notification Types', () => {
  describe('NOTIFICATION_TEMPLATES', () => {
    it('should have templates for all notification types', () => {
      const expectedTypes: NotificationType[] = [
        'spark_reminder', 'spark_expiring', 'spark_expired',
        'goal_deadline', 'goal_stalled', 'goal_milestone', 'goal_completed',
        'quest_blocked', 'quest_ready', 'quest_completed',
        'shield_triggered', 'risk_alert',
        'system_alert', 'feature_update', 'tip',
      ];
      
      for (const type of expectedTypes) {
        expect(NOTIFICATION_TEMPLATES[type]).toBeDefined();
        expect(NOTIFICATION_TEMPLATES[type].type).toBe(type);
      }
    });
    
    it('should have valid default priorities', () => {
      const validPriorities: NotificationPriority[] = ['low', 'medium', 'high', 'urgent'];
      
      for (const template of Object.values(NOTIFICATION_TEMPLATES)) {
        expect(validPriorities).toContain(template.defaultPriority);
      }
    });
    
    it('should have icons for all templates', () => {
      for (const template of Object.values(NOTIFICATION_TEMPLATES)) {
        expect(template.icon).toBeDefined();
        expect(template.icon.length).toBeGreaterThan(0);
      }
    });
    
    it('should have title and body templates', () => {
      for (const template of Object.values(NOTIFICATION_TEMPLATES)) {
        expect(template.titleTemplate).toBeDefined();
        expect(template.bodyTemplate).toBeDefined();
      }
    });
  });
  
  describe('PRIORITY_ORDER', () => {
    it('should have correct priority ordering', () => {
      expect(PRIORITY_ORDER.low).toBeLessThan(PRIORITY_ORDER.medium);
      expect(PRIORITY_ORDER.medium).toBeLessThan(PRIORITY_ORDER.high);
      expect(PRIORITY_ORDER.high).toBeLessThan(PRIORITY_ORDER.urgent);
    });
  });
  
  describe('comparePriority', () => {
    it('should compare priorities correctly', () => {
      expect(comparePriority('low', 'high')).toBeLessThan(0);
      expect(comparePriority('high', 'low')).toBeGreaterThan(0);
      expect(comparePriority('medium', 'medium')).toBe(0);
    });
  });
  
  describe('meetsMinPriority', () => {
    it('should check minimum priority correctly', () => {
      expect(meetsMinPriority('high', 'medium')).toBe(true);
      expect(meetsMinPriority('medium', 'medium')).toBe(true);
      expect(meetsMinPriority('low', 'medium')).toBe(false);
      expect(meetsMinPriority('urgent', 'low')).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// NOTIFICATION STORE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('NotificationStore', () => {
  let store: NotificationStore;
  
  beforeEach(() => {
    store = createTestStore();
  });
  
  describe('createNotification', () => {
    it('should create a notification with all fields', async () => {
      const notification = await store.createNotification(TEST_USER_ID, {
        type: 'spark_reminder',
        title: 'Test Notification',
        body: 'This is a test',
        priority: 'medium',
      });
      
      expect(notification.id).toMatch(/^ntf_/);
      expect(notification.userId).toBe(TEST_USER_ID);
      expect(notification.type).toBe('spark_reminder');
      expect(notification.title).toBe('Test Notification');
      expect(notification.body).toBe('This is a test');
      expect(notification.priority).toBe('medium');
      expect(notification.read).toBe(false);
      expect(notification.dismissed).toBe(false);
      expect(notification.createdAt).toBeDefined();
    });
    
    it('should use template icon by default', async () => {
      const notification = await store.createNotification(TEST_USER_ID, {
        type: 'goal_completed',
        title: 'Test',
        body: 'Test',
      });
      
      expect(notification.icon).toBe(NOTIFICATION_TEMPLATES.goal_completed.icon);
    });
    
    it('should allow custom icon', async () => {
      const notification = await store.createNotification(TEST_USER_ID, {
        type: 'goal_completed',
        title: 'Test',
        body: 'Test',
        icon: '🎊',
      });
      
      expect(notification.icon).toBe('🎊');
    });
    
    it('should set action when provided', async () => {
      const notification = await store.createNotification(TEST_USER_ID, {
        type: 'spark_reminder',
        title: 'Test',
        body: 'Test',
        action: {
          type: 'link',
          label: 'View',
          url: '/sparks/123',
        },
      });
      
      expect(notification.action).toBeDefined();
      expect(notification.action?.type).toBe('link');
      expect(notification.action?.url).toBe('/sparks/123');
    });
  });
  
  describe('getNotification', () => {
    it('should retrieve a created notification', async () => {
      const created = await store.createNotification(TEST_USER_ID, {
        type: 'tip',
        title: 'Tip',
        body: 'A helpful tip',
      });
      
      const retrieved = await store.getNotification(created.id);
      
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.title).toBe('Tip');
    });
    
    it('should return null for non-existent notification', async () => {
      const result = await store.getNotification('non-existent');
      expect(result).toBeNull();
    });
  });
  
  describe('getUserNotifications', () => {
    it('should list notifications in reverse chronological order', async () => {
      await store.createNotification(TEST_USER_ID, {
        type: 'tip',
        title: 'First',
        body: 'First notification',
      });
      
      await store.createNotification(TEST_USER_ID, {
        type: 'tip',
        title: 'Second',
        body: 'Second notification',
      });
      
      const notifications = await store.getUserNotifications(TEST_USER_ID);
      
      expect(notifications).toHaveLength(2);
      expect(notifications[0].title).toBe('Second');
      expect(notifications[1].title).toBe('First');
    });
    
    it('should respect limit and offset', async () => {
      for (let i = 0; i < 10; i++) {
        await store.createNotification(TEST_USER_ID, {
          type: 'tip',
          title: `Notification ${i}`,
          body: 'Test',
        });
      }
      
      const page1 = await store.getUserNotifications(TEST_USER_ID, { limit: 3 });
      expect(page1).toHaveLength(3);
      
      const page2 = await store.getUserNotifications(TEST_USER_ID, { limit: 3, offset: 3 });
      expect(page2).toHaveLength(3);
      expect(page2[0].title).not.toBe(page1[0].title);
    });
    
    it('should filter by unread only', async () => {
      const n1 = await store.createNotification(TEST_USER_ID, {
        type: 'tip',
        title: 'Unread',
        body: 'Test',
      });
      
      await store.createNotification(TEST_USER_ID, {
        type: 'tip',
        title: 'Will be read',
        body: 'Test',
      });
      
      await store.markAsRead(n1.id, TEST_USER_ID);
      
      const unread = await store.getUserNotifications(TEST_USER_ID, { unreadOnly: true });
      expect(unread).toHaveLength(1);
      expect(unread[0].title).toBe('Will be read');
    });
    
    it('should filter by type', async () => {
      await store.createNotification(TEST_USER_ID, {
        type: 'tip',
        title: 'Tip',
        body: 'Test',
      });
      
      await store.createNotification(TEST_USER_ID, {
        type: 'system_alert',
        title: 'Alert',
        body: 'Test',
      });
      
      const tips = await store.getUserNotifications(TEST_USER_ID, { types: ['tip'] });
      expect(tips).toHaveLength(1);
      expect(tips[0].type).toBe('tip');
    });
    
    it('should filter by minimum priority', async () => {
      await store.createNotification(TEST_USER_ID, {
        type: 'tip',
        title: 'Low Priority',
        body: 'Test',
        priority: 'low',
      });
      
      await store.createNotification(TEST_USER_ID, {
        type: 'risk_alert',
        title: 'High Priority',
        body: 'Test',
        priority: 'high',
      });
      
      const highPriority = await store.getUserNotifications(TEST_USER_ID, { 
        minPriority: 'high' 
      });
      expect(highPriority).toHaveLength(1);
      expect(highPriority[0].priority).toBe('high');
    });
  });
  
  describe('markAsRead', () => {
    it('should mark notification as read', async () => {
      const notification = await store.createNotification(TEST_USER_ID, {
        type: 'tip',
        title: 'Test',
        body: 'Test',
      });
      
      expect(notification.read).toBe(false);
      
      await store.markAsRead(notification.id, TEST_USER_ID);
      
      const updated = await store.getNotification(notification.id);
      expect(updated?.read).toBe(true);
      expect(updated?.readAt).toBeDefined();
    });
    
    it('should return false for wrong user', async () => {
      const notification = await store.createNotification(TEST_USER_ID, {
        type: 'tip',
        title: 'Test',
        body: 'Test',
      });
      
      const result = await store.markAsRead(notification.id, 'other-user');
      expect(result).toBe(false);
    });
    
    it('should remove from unread set', async () => {
      const notification = await store.createNotification(TEST_USER_ID, {
        type: 'tip',
        title: 'Test',
        body: 'Test',
      });
      
      let unreadCount = await store.getUnreadCount(TEST_USER_ID);
      expect(unreadCount).toBe(1);
      
      await store.markAsRead(notification.id, TEST_USER_ID);
      
      unreadCount = await store.getUnreadCount(TEST_USER_ID);
      expect(unreadCount).toBe(0);
    });
  });
  
  describe('markAllAsRead', () => {
    it('should mark all notifications as read', async () => {
      await store.createNotification(TEST_USER_ID, {
        type: 'tip',
        title: 'Test 1',
        body: 'Test',
      });
      
      await store.createNotification(TEST_USER_ID, {
        type: 'tip',
        title: 'Test 2',
        body: 'Test',
      });
      
      const count = await store.markAllAsRead(TEST_USER_ID);
      
      expect(count).toBe(2);
      
      const unreadCount = await store.getUnreadCount(TEST_USER_ID);
      expect(unreadCount).toBe(0);
    });
  });
  
  describe('dismiss', () => {
    it('should dismiss notification', async () => {
      const notification = await store.createNotification(TEST_USER_ID, {
        type: 'tip',
        title: 'Test',
        body: 'Test',
      });
      
      await store.dismiss(notification.id, TEST_USER_ID);
      
      const updated = await store.getNotification(notification.id);
      expect(updated?.dismissed).toBe(true);
      expect(updated?.dismissedAt).toBeDefined();
      expect(updated?.read).toBe(true); // Also marks as read
    });
  });
  
  describe('getSummary', () => {
    it('should return notification summary', async () => {
      await store.createNotification(TEST_USER_ID, {
        type: 'tip',
        title: 'Low',
        body: 'Test',
        priority: 'low',
      });
      
      await store.createNotification(TEST_USER_ID, {
        type: 'system_alert',
        title: 'High',
        body: 'Test',
        priority: 'high',
      });
      
      const summary = await store.getSummary(TEST_USER_ID);
      
      expect(summary.total).toBe(2);
      expect(summary.unread).toBe(2);
      expect(summary.byPriority.low).toBe(1);
      expect(summary.byPriority.high).toBe(1);
      expect(summary.byType.tip).toBe(1);
      expect(summary.byType.system_alert).toBe(1);
    });
  });
  
  describe('preferences', () => {
    it('should return default preferences', async () => {
      const prefs = await store.getPreferences(TEST_USER_ID);
      
      expect(prefs.userId).toBe(TEST_USER_ID);
      expect(prefs.enabled).toBe(true);
      expect(prefs.quietHoursEnabled).toBe(false);
      expect(prefs.channelSettings.in_app.enabled).toBe(true);
    });
    
    it('should update preferences', async () => {
      await store.updatePreferences(TEST_USER_ID, {
        quietHoursEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
      });
      
      const prefs = await store.getPreferences(TEST_USER_ID);
      
      expect(prefs.quietHoursEnabled).toBe(true);
      expect(prefs.quietHoursStart).toBe('22:00');
      expect(prefs.quietHoursEnd).toBe('07:00');
    });
    
    it('should update type settings', async () => {
      await store.updatePreferences(TEST_USER_ID, {
        typeSettings: {
          tip: { enabled: false },
        },
      });
      
      const prefs = await store.getPreferences(TEST_USER_ID);
      expect(prefs.typeSettings.tip?.enabled).toBe(false);
    });
  });
  
  describe('deleteNotification', () => {
    it('should delete notification', async () => {
      const notification = await store.createNotification(TEST_USER_ID, {
        type: 'tip',
        title: 'Test',
        body: 'Test',
      });
      
      const deleted = await store.deleteNotification(notification.id, TEST_USER_ID);
      expect(deleted).toBe(true);
      
      const retrieved = await store.getNotification(notification.id);
      expect(retrieved).toBeNull();
    });
    
    it('should not delete notification for wrong user', async () => {
      const notification = await store.createNotification(TEST_USER_ID, {
        type: 'tip',
        title: 'Test',
        body: 'Test',
      });
      
      const deleted = await store.deleteNotification(notification.id, 'other-user');
      expect(deleted).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// NOTIFICATION SERVICE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('NotificationService', () => {
  let store: NotificationStore;
  let service: NotificationService;
  
  beforeEach(() => {
    store = createTestStore();
    service = createTestService(store);
  });
  
  describe('notify', () => {
    it('should create and return notification', async () => {
      const notification = await service.notify(TEST_USER_ID, {
        type: 'tip',
        title: 'Test',
        body: 'Test body',
      });
      
      expect(notification.id).toBeDefined();
      expect(notification.title).toBe('Test');
      expect(notification.body).toBe('Test body');
    });
    
    it('should respect disabled notifications', async () => {
      await store.updatePreferences(TEST_USER_ID, {
        enabled: false,
      });
      
      await expect(
        service.notify(TEST_USER_ID, {
          type: 'tip',
          title: 'Test',
          body: 'Test',
        })
      ).rejects.toThrow('disabled');
    });
    
    it('should respect type-specific settings', async () => {
      await store.updatePreferences(TEST_USER_ID, {
        typeSettings: {
          tip: { enabled: false },
        },
      });
      
      await expect(
        service.notify(TEST_USER_ID, {
          type: 'tip',
          title: 'Test',
          body: 'Test',
        })
      ).rejects.toThrow('disabled');
      
      // Other types should still work
      const notification = await service.notify(TEST_USER_ID, {
        type: 'system_alert',
        title: 'Test',
        body: 'Test',
      });
      
      expect(notification.id).toBeDefined();
    });
  });
  
  describe('notifyFromTemplate', () => {
    it('should substitute variables in template', async () => {
      const notification = await service.notifyFromTemplate(
        TEST_USER_ID,
        'spark_reminder',
        { action: 'Write documentation' }
      );
      
      expect(notification.body).toContain('Write documentation');
    });
    
    it('should use template defaults', async () => {
      const notification = await service.notifyFromTemplate(
        TEST_USER_ID,
        'goal_completed',
        { title: 'My Goal' }
      );
      
      expect(notification.icon).toBe(NOTIFICATION_TEMPLATES.goal_completed.icon);
      expect(notification.priority).toBe(NOTIFICATION_TEMPLATES.goal_completed.defaultPriority);
    });
    
    it('should allow priority override', async () => {
      const notification = await service.notifyFromTemplate(
        TEST_USER_ID,
        'tip',
        { message: 'Test' },
        { priorityOverride: 'urgent' }
      );
      
      expect(notification.priority).toBe('urgent');
    });
  });
  
  describe('convenience methods', () => {
    it('should send spark reminder', async () => {
      const notification = await service.sparkReminder(TEST_USER_ID, {
        id: 'spark-123',
        action: 'Call mom',
      });
      
      expect(notification.type).toBe('spark_reminder');
      expect(notification.body).toContain('Call mom');
      expect(notification.correlationId).toBe('spark-123');
    });
    
    it('should send goal deadline notification', async () => {
      const notification = await service.goalDeadline(TEST_USER_ID, {
        id: 'goal-123',
        title: 'Finish project',
        timeLeft: '3 days',
      });
      
      expect(notification.type).toBe('goal_deadline');
      expect(notification.body).toContain('3 days');
    });
    
    it('should send goal completed notification', async () => {
      const notification = await service.goalCompleted(TEST_USER_ID, {
        id: 'goal-123',
        title: 'Learn TypeScript',
      });
      
      expect(notification.type).toBe('goal_completed');
      expect(notification.body).toContain('Learn TypeScript');
    });
    
    it('should send risk alert', async () => {
      const notification = await service.riskAlert(TEST_USER_ID, {
        message: 'Potential security issue detected',
      });
      
      expect(notification.type).toBe('risk_alert');
      expect(notification.priority).toBe('urgent');
    });
    
    it('should send tip', async () => {
      const notification = await service.tip(TEST_USER_ID, {
        message: 'Try breaking your goal into smaller steps',
      });
      
      expect(notification.type).toBe('tip');
      expect(notification.priority).toBe('low');
    });
  });
});
