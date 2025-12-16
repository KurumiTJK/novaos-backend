// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATION SERVICE — Notification Creation and Delivery
// ═══════════════════════════════════════════════════════════════════════════════

import { NotificationStore, getNotificationStore } from './store.js';
import type {
  Notification,
  NotificationType,
  NotificationPriority,
  NotificationChannel,
  NotificationPreferences,
  CreateNotificationRequest,
  NotificationAction,
} from './types.js';
import { NOTIFICATION_TEMPLATES, meetsMinPriority } from './types.js';
import { getLogger } from '../logging/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'notification-service' });

// ─────────────────────────────────────────────────────────────────────────────────
// NOTIFICATION SERVICE
// ─────────────────────────────────────────────────────────────────────────────────

export class NotificationService {
  private store: NotificationStore;
  private pushProvider: PushProvider | null = null;
  private emailProvider: EmailProvider | null = null;
  
  constructor(
    store?: NotificationStore,
    options?: {
      pushProvider?: PushProvider;
      emailProvider?: EmailProvider;
    }
  ) {
    this.store = store ?? getNotificationStore();
    this.pushProvider = options?.pushProvider ?? null;
    this.emailProvider = options?.emailProvider ?? null;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // NOTIFICATION CREATION
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Create and deliver a notification.
   */
  async notify(userId: string, request: CreateNotificationRequest): Promise<Notification> {
    // Get user preferences
    const preferences = await this.store.getPreferences(userId);
    
    // Check if notifications are enabled
    if (!preferences.enabled) {
      logger.debug('Notifications disabled for user', { userId });
      throw new Error('Notifications disabled');
    }
    
    // Check type-specific settings
    const typeSettings = preferences.typeSettings[request.type];
    if (typeSettings?.enabled === false) {
      logger.debug('Notification type disabled', { userId, type: request.type });
      throw new Error(`Notification type ${request.type} disabled`);
    }
    
    // Check quiet hours
    if (preferences.quietHoursEnabled && this.isQuietHours(preferences)) {
      // During quiet hours, only deliver urgent notifications
      if (request.priority !== 'urgent') {
        logger.debug('Notification blocked by quiet hours', { userId, type: request.type });
        // Still create the notification, but don't deliver via push/email
        request.channels = ['in_app'];
      }
    }
    
    // Apply type-specific overrides
    if (typeSettings?.priority) {
      request.priority = typeSettings.priority;
    }
    if (typeSettings?.channels) {
      request.channels = typeSettings.channels;
    }
    
    // Create notification
    const notification = await this.store.createNotification(userId, request);
    
    logger.info('Notification created', {
      notificationId: notification.id,
      userId,
      type: notification.type,
      priority: notification.priority,
    });
    
    // Deliver to channels
    await this.deliverToChannels(notification, preferences);
    
    return notification;
  }
  
  /**
   * Create notification from template with variable substitution.
   */
  async notifyFromTemplate(
    userId: string,
    type: NotificationType,
    variables: Record<string, string>,
    options?: {
      action?: NotificationAction;
      data?: Record<string, unknown>;
      source?: string;
      correlationId?: string;
      priorityOverride?: NotificationPriority;
    }
  ): Promise<Notification> {
    const template = NOTIFICATION_TEMPLATES[type];
    
    // Substitute variables
    const title = this.substituteVariables(template.titleTemplate, variables);
    const body = this.substituteVariables(template.bodyTemplate, variables);
    
    return this.notify(userId, {
      type,
      title,
      body,
      icon: template.icon,
      priority: options?.priorityOverride ?? template.defaultPriority,
      channels: template.defaultChannels,
      action: options?.action,
      data: options?.data,
      source: options?.source,
      correlationId: options?.correlationId,
    });
  }
  
  private substituteVariables(template: string, variables: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? `{{${key}}}`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // DELIVERY
  // ═══════════════════════════════════════════════════════════════════════════════
  
  private async deliverToChannels(
    notification: Notification,
    preferences: NotificationPreferences
  ): Promise<void> {
    const channels = notification.channels;
    
    for (const channel of channels) {
      const channelSettings = preferences.channelSettings[channel];
      
      // Check if channel is enabled and meets minimum priority
      if (!channelSettings?.enabled) continue;
      if (channelSettings.minPriority && 
          !meetsMinPriority(notification.priority, channelSettings.minPriority)) {
        continue;
      }
      
      try {
        await this.deliverToChannel(notification, channel);
        await this.store.markAsDelivered(notification.id, channel);
      } catch (error) {
        logger.error(
          `Failed to deliver notification via ${channel}`,
          error instanceof Error ? error : new Error(String(error)),
          { notificationId: notification.id, channel }
        );
      }
    }
  }
  
  private async deliverToChannel(notification: Notification, channel: NotificationChannel): Promise<void> {
    switch (channel) {
      case 'in_app':
        // In-app is handled by polling/SSE, nothing to do
        logger.debug('Notification ready for in-app delivery', { 
          notificationId: notification.id 
        });
        break;
        
      case 'push':
        if (this.pushProvider) {
          await this.pushProvider.send(notification);
        }
        break;
        
      case 'email':
        if (this.emailProvider) {
          await this.emailProvider.send(notification);
        }
        break;
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // QUIET HOURS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  private isQuietHours(preferences: NotificationPreferences): boolean {
    if (!preferences.quietHoursStart || !preferences.quietHoursEnd) {
      return false;
    }
    
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    
    const [startHour, startMin] = preferences.quietHoursStart.split(':').map(Number);
    const [endHour, endMin] = preferences.quietHoursEnd.split(':').map(Number);
    
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    
    if (startMinutes <= endMinutes) {
      // Normal range (e.g., 22:00 to 07:00 next day doesn't apply here)
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    } else {
      // Overnight range (e.g., 22:00 to 07:00)
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // CONVENIENCE METHODS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  // Spark notifications
  async sparkReminder(userId: string, spark: { id: string; action: string }): Promise<Notification> {
    return this.notifyFromTemplate(userId, 'spark_reminder', {
      action: spark.action,
    }, {
      correlationId: spark.id,
      source: 'scheduler',
      action: {
        type: 'link',
        label: 'View Spark',
        url: `/sparks/${spark.id}`,
      },
    });
  }
  
  async sparkExpiring(userId: string, spark: { id: string; action: string; timeLeft: string }): Promise<Notification> {
    return this.notifyFromTemplate(userId, 'spark_expiring', {
      action: spark.action,
      timeLeft: spark.timeLeft,
    }, {
      correlationId: spark.id,
      source: 'scheduler',
      priorityOverride: 'high',
    });
  }
  
  // Goal notifications
  async goalDeadline(userId: string, goal: { id: string; title: string; timeLeft: string }): Promise<Notification> {
    return this.notifyFromTemplate(userId, 'goal_deadline', {
      title: goal.title,
      timeLeft: goal.timeLeft,
    }, {
      correlationId: goal.id,
      source: 'scheduler',
      action: {
        type: 'link',
        label: 'View Goal',
        url: `/goals/${goal.id}`,
      },
    });
  }
  
  async goalStalled(userId: string, goal: { id: string; title: string; daysSinceUpdate: number }): Promise<Notification> {
    return this.notifyFromTemplate(userId, 'goal_stalled', {
      title: goal.title,
      daysSinceUpdate: goal.daysSinceUpdate.toString(),
    }, {
      correlationId: goal.id,
      source: 'scheduler',
    });
  }
  
  async goalMilestone(userId: string, goal: { id: string; title: string; progress: number }): Promise<Notification> {
    return this.notifyFromTemplate(userId, 'goal_milestone', {
      title: goal.title,
      progress: goal.progress.toString(),
    }, {
      correlationId: goal.id,
      source: 'sword',
    });
  }
  
  async goalCompleted(userId: string, goal: { id: string; title: string }): Promise<Notification> {
    return this.notifyFromTemplate(userId, 'goal_completed', {
      title: goal.title,
    }, {
      correlationId: goal.id,
      source: 'sword',
      priorityOverride: 'high',
    });
  }
  
  // Shield notifications
  async shieldTriggered(userId: string, shield: { reason: string; auditId?: string }): Promise<Notification> {
    return this.notifyFromTemplate(userId, 'shield_triggered', {
      reason: shield.reason,
    }, {
      correlationId: shield.auditId,
      source: 'shield',
    });
  }
  
  async riskAlert(userId: string, alert: { message: string; source?: string }): Promise<Notification> {
    return this.notifyFromTemplate(userId, 'risk_alert', {
      message: alert.message,
    }, {
      source: alert.source ?? 'shield',
      priorityOverride: 'urgent',
    });
  }
  
  // System notifications
  async systemAlert(userId: string, alert: { message: string }): Promise<Notification> {
    return this.notifyFromTemplate(userId, 'system_alert', {
      message: alert.message,
    }, {
      source: 'system',
    });
  }
  
  async tip(userId: string, tip: { message: string }): Promise<Notification> {
    return this.notifyFromTemplate(userId, 'tip', {
      message: tip.message,
    }, {
      source: 'system',
    });
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // PROVIDER CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════════
  
  setPushProvider(provider: PushProvider): void {
    this.pushProvider = provider;
  }
  
  setEmailProvider(provider: EmailProvider): void {
    this.emailProvider = provider;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// PROVIDER INTERFACES
// ─────────────────────────────────────────────────────────────────────────────────

export interface PushProvider {
  send(notification: Notification): Promise<void>;
}

export interface EmailProvider {
  send(notification: Notification): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────────
// MOCK PROVIDERS (for development/testing)
// ─────────────────────────────────────────────────────────────────────────────────

export class MockPushProvider implements PushProvider {
  private logger = getLogger({ component: 'mock-push' });
  
  async send(notification: Notification): Promise<void> {
    this.logger.info('Mock push notification sent', {
      notificationId: notification.id,
      userId: notification.userId,
      title: notification.title,
    });
  }
}

export class MockEmailProvider implements EmailProvider {
  private logger = getLogger({ component: 'mock-email' });
  
  async send(notification: Notification): Promise<void> {
    this.logger.info('Mock email notification sent', {
      notificationId: notification.id,
      userId: notification.userId,
      title: notification.title,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let notificationService: NotificationService | null = null;

export function getNotificationService(): NotificationService {
  if (!notificationService) {
    notificationService = new NotificationService();
  }
  return notificationService;
}
