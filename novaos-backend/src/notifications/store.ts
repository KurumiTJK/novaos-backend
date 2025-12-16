// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATION STORE — Persistence for In-App Notifications
// ═══════════════════════════════════════════════════════════════════════════════

import { getStore, type KeyValueStore } from '../storage/index.js';
import type {
  Notification,
  NotificationType,
  NotificationPriority,
  NotificationPreferences,
  NotificationSummary,
  CreateNotificationRequest,
} from './types.js';
import { NOTIFICATION_TEMPLATES, PRIORITY_ORDER, DEFAULT_NOTIFICATION_PREFERENCES } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

const NOTIFICATION_TTL = 30 * 24 * 60 * 60;     // 30 days
const PREFERENCES_TTL = 365 * 24 * 60 * 60;    // 1 year
const MAX_NOTIFICATIONS_PER_USER = 500;
const MAX_UNREAD_RETURN = 100;

// ─────────────────────────────────────────────────────────────────────────────────
// KEY GENERATION
// ─────────────────────────────────────────────────────────────────────────────────

function notificationKey(id: string): string {
  return `notification:${id}`;
}

function userNotificationsKey(userId: string): string {
  return `notification:user:${userId}:list`;
}

function userUnreadKey(userId: string): string {
  return `notification:user:${userId}:unread`;
}

function preferencesKey(userId: string): string {
  return `notification:user:${userId}:preferences`;
}

function generateId(): string {
  return `ntf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────────────────────────────────────────────────────────────────
// NOTIFICATION STORE CLASS
// ─────────────────────────────────────────────────────────────────────────────────

export class NotificationStore {
  private store: KeyValueStore;
  
  constructor(store?: KeyValueStore) {
    this.store = store ?? getStore();
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // NOTIFICATION CRUD
  // ═══════════════════════════════════════════════════════════════════════════════
  
  async createNotification(
    userId: string,
    request: CreateNotificationRequest
  ): Promise<Notification> {
    const template = NOTIFICATION_TEMPLATES[request.type];
    const id = generateId();
    const now = new Date().toISOString();
    
    const notification: Notification = {
      id,
      userId,
      type: request.type,
      title: request.title,
      body: request.body,
      icon: request.icon ?? template.icon,
      priority: request.priority ?? template.defaultPriority,
      action: request.action,
      data: request.data,
      source: request.source,
      correlationId: request.correlationId,
      read: false,
      dismissed: false,
      createdAt: now,
      expiresAt: request.expiresAt,
      channels: request.channels ?? template.defaultChannels,
      deliveredVia: [],
    };
    
    // Save notification
    await this.store.set(notificationKey(id), JSON.stringify(notification), NOTIFICATION_TTL);
    
    // Add to user's list (prepend for reverse chronological)
    await this.store.lpush(userNotificationsKey(userId), id);
    
    // Trim to max
    await this.store.ltrim(userNotificationsKey(userId), 0, MAX_NOTIFICATIONS_PER_USER - 1);
    
    // Add to unread set
    await this.store.sadd(userUnreadKey(userId), id);
    
    return notification;
  }
  
  async getNotification(id: string): Promise<Notification | null> {
    const data = await this.store.get(notificationKey(id));
    return data ? JSON.parse(data) : null;
  }
  
  async getUserNotifications(
    userId: string,
    options?: {
      limit?: number;
      offset?: number;
      unreadOnly?: boolean;
      types?: NotificationType[];
      minPriority?: NotificationPriority;
    }
  ): Promise<Notification[]> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    
    // Get notification IDs
    const ids = await this.store.lrange(
      userNotificationsKey(userId),
      offset,
      offset + limit - 1
    );
    
    const notifications: Notification[] = [];
    
    for (const id of ids) {
      const notification = await this.getNotification(id);
      if (!notification) continue;
      
      // Apply filters
      if (options?.unreadOnly && notification.read) continue;
      if (options?.types && !options.types.includes(notification.type)) continue;
      if (options?.minPriority && 
          PRIORITY_ORDER[notification.priority] < PRIORITY_ORDER[options.minPriority]) continue;
      
      // Check expiration
      if (notification.expiresAt && new Date(notification.expiresAt) < new Date()) {
        continue;
      }
      
      notifications.push(notification);
    }
    
    return notifications;
  }
  
  async getUnreadNotifications(userId: string, limit: number = MAX_UNREAD_RETURN): Promise<Notification[]> {
    return this.getUserNotifications(userId, { unreadOnly: true, limit });
  }
  
  async deleteNotification(id: string, userId: string): Promise<boolean> {
    const notification = await this.getNotification(id);
    if (!notification || notification.userId !== userId) {
      return false;
    }
    
    await this.store.delete(notificationKey(id));
    await this.store.srem(userUnreadKey(userId), id);
    
    // Remove from list (expensive but necessary for cleanup)
    const ids = await this.store.lrange(userNotificationsKey(userId), 0, -1);
    const filtered = ids.filter(nid => nid !== id);
    
    await this.store.delete(userNotificationsKey(userId));
    for (const fid of filtered.reverse()) {
      await this.store.lpush(userNotificationsKey(userId), fid);
    }
    
    return true;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // READ/DISMISS STATUS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  async markAsRead(id: string, userId: string): Promise<boolean> {
    const notification = await this.getNotification(id);
    if (!notification || notification.userId !== userId) {
      return false;
    }
    
    if (notification.read) {
      return true; // Already read
    }
    
    notification.read = true;
    notification.readAt = new Date().toISOString();
    
    await this.store.set(notificationKey(id), JSON.stringify(notification), NOTIFICATION_TTL);
    await this.store.srem(userUnreadKey(userId), id);
    
    return true;
  }
  
  async markAllAsRead(userId: string): Promise<number> {
    const unreadIds = await this.store.smembers(userUnreadKey(userId));
    let count = 0;
    
    for (const id of unreadIds) {
      const notification = await this.getNotification(id);
      if (notification && !notification.read) {
        notification.read = true;
        notification.readAt = new Date().toISOString();
        await this.store.set(notificationKey(id), JSON.stringify(notification), NOTIFICATION_TTL);
        count++;
      }
    }
    
    // Clear unread set
    await this.store.delete(userUnreadKey(userId));
    
    return count;
  }
  
  async dismiss(id: string, userId: string): Promise<boolean> {
    const notification = await this.getNotification(id);
    if (!notification || notification.userId !== userId) {
      return false;
    }
    
    notification.dismissed = true;
    notification.dismissedAt = new Date().toISOString();
    notification.read = true;
    notification.readAt = notification.readAt ?? notification.dismissedAt;
    
    await this.store.set(notificationKey(id), JSON.stringify(notification), NOTIFICATION_TTL);
    await this.store.srem(userUnreadKey(userId), id);
    
    return true;
  }
  
  async dismissAll(userId: string): Promise<number> {
    const ids = await this.store.lrange(userNotificationsKey(userId), 0, -1);
    let count = 0;
    const now = new Date().toISOString();
    
    for (const id of ids) {
      const notification = await this.getNotification(id);
      if (notification && !notification.dismissed) {
        notification.dismissed = true;
        notification.dismissedAt = now;
        notification.read = true;
        notification.readAt = notification.readAt ?? now;
        await this.store.set(notificationKey(id), JSON.stringify(notification), NOTIFICATION_TTL);
        count++;
      }
    }
    
    await this.store.delete(userUnreadKey(userId));
    
    return count;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // DELIVERY TRACKING
  // ═══════════════════════════════════════════════════════════════════════════════
  
  async markAsDelivered(id: string, channel: 'in_app' | 'push' | 'email'): Promise<void> {
    const notification = await this.getNotification(id);
    if (!notification) return;
    
    if (!notification.deliveredVia.includes(channel)) {
      notification.deliveredVia.push(channel);
      await this.store.set(notificationKey(id), JSON.stringify(notification), NOTIFICATION_TTL);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════════
  
  async getSummary(userId: string): Promise<NotificationSummary> {
    const ids = await this.store.lrange(userNotificationsKey(userId), 0, -1);
    const unreadIds = await this.store.smembers(userUnreadKey(userId));
    
    const summary: NotificationSummary = {
      total: ids.length,
      unread: unreadIds.length,
      byPriority: { low: 0, medium: 0, high: 0, urgent: 0 },
      byType: {},
    };
    
    // Count unread by priority and type
    for (const id of unreadIds) {
      const notification = await this.getNotification(id);
      if (!notification) continue;
      
      summary.byPriority[notification.priority]++;
      summary.byType[notification.type] = (summary.byType[notification.type] ?? 0) + 1;
    }
    
    return summary;
  }
  
  async getUnreadCount(userId: string): Promise<number> {
    return this.store.scard(userUnreadKey(userId));
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // PREFERENCES
  // ═══════════════════════════════════════════════════════════════════════════════
  
  async getPreferences(userId: string): Promise<NotificationPreferences> {
    const data = await this.store.get(preferencesKey(userId));
    if (data) {
      return JSON.parse(data);
    }
    
    // Return defaults
    return {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      userId,
    };
  }
  
  async updatePreferences(
    userId: string,
    updates: Partial<Omit<NotificationPreferences, 'userId'>>
  ): Promise<NotificationPreferences> {
    const current = await this.getPreferences(userId);
    
    const updated: NotificationPreferences = {
      ...current,
      ...updates,
      userId, // Ensure userId is preserved
      typeSettings: {
        ...current.typeSettings,
        ...updates.typeSettings,
      },
      channelSettings: {
        ...current.channelSettings,
        ...updates.channelSettings,
      },
    };
    
    await this.store.set(preferencesKey(userId), JSON.stringify(updated), PREFERENCES_TTL);
    return updated;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════════════════════════════════════════════
  
  async cleanupExpired(userId: string): Promise<number> {
    const ids = await this.store.lrange(userNotificationsKey(userId), 0, -1);
    const now = new Date();
    let removed = 0;
    const validIds: string[] = [];
    
    for (const id of ids) {
      const notification = await this.getNotification(id);
      
      if (!notification || 
          (notification.expiresAt && new Date(notification.expiresAt) < now)) {
        // Expired or missing - remove
        await this.store.delete(notificationKey(id));
        await this.store.srem(userUnreadKey(userId), id);
        removed++;
      } else {
        validIds.push(id);
      }
    }
    
    // Rebuild list if any were removed
    if (removed > 0) {
      await this.store.delete(userNotificationsKey(userId));
      for (const id of validIds.reverse()) {
        await this.store.lpush(userNotificationsKey(userId), id);
      }
    }
    
    return removed;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let notificationStore: NotificationStore | null = null;

export function getNotificationStore(): NotificationStore {
  if (!notificationStore) {
    notificationStore = new NotificationStore();
  }
  return notificationStore;
}
