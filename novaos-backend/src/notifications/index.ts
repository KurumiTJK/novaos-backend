// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS MODULE — In-App Notification System
// ═══════════════════════════════════════════════════════════════════════════════

// Types
export type {
  NotificationType,
  NotificationPriority,
  NotificationChannel,
  Notification,
  NotificationAction,
  NotificationPreferences,
  NotificationTypeSettings,
  ChannelSettings,
  NotificationTemplate,
  NotificationSummary,
  CreateNotificationRequest,
} from './types.js';

export {
  NOTIFICATION_TEMPLATES,
  DEFAULT_NOTIFICATION_PREFERENCES,
  PRIORITY_ORDER,
  comparePriority,
  meetsMinPriority,
} from './types.js';

// Store
export { NotificationStore, getNotificationStore } from './store.js';

// Service
export {
  NotificationService,
  getNotificationService,
  type PushProvider,
  type EmailProvider,
  MockPushProvider,
  MockEmailProvider,
} from './service.js';
