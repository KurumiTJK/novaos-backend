// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATION TYPES — In-App Notification System
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// NOTIFICATION TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export type NotificationType =
  // Spark notifications
  | 'spark_reminder'
  | 'spark_expiring'
  | 'spark_expired'
  
  // Goal notifications
  | 'goal_deadline'
  | 'goal_stalled'
  | 'goal_milestone'
  | 'goal_completed'
  
  // Quest notifications
  | 'quest_blocked'
  | 'quest_ready'
  | 'quest_completed'
  
  // Shield notifications
  | 'shield_triggered'
  | 'risk_alert'
  
  // System notifications
  | 'system_alert'
  | 'feature_update'
  | 'tip';

export type NotificationPriority = 'low' | 'medium' | 'high' | 'urgent';

export type NotificationChannel = 'in_app' | 'push' | 'email';

// ─────────────────────────────────────────────────────────────────────────────────
// NOTIFICATION MODEL
// ─────────────────────────────────────────────────────────────────────────────────

export interface Notification {
  id: string;
  userId: string;
  
  // Content
  type: NotificationType;
  title: string;
  body: string;
  icon?: string;
  
  // Priority and urgency
  priority: NotificationPriority;
  
  // Action
  action?: NotificationAction;
  
  // Metadata
  data?: Record<string, unknown>;
  source?: string;           // What triggered this notification
  correlationId?: string;    // Link to related entity (goal, spark, etc.)
  
  // Status
  read: boolean;
  readAt?: string;
  dismissed: boolean;
  dismissedAt?: string;
  
  // Timing
  createdAt: string;
  expiresAt?: string;        // Auto-dismiss after this time
  
  // Channels
  channels: NotificationChannel[];
  deliveredVia: NotificationChannel[];
}

export interface NotificationAction {
  type: 'link' | 'button' | 'dismiss';
  label: string;
  url?: string;              // For link actions
  endpoint?: string;         // API endpoint for button actions
  method?: 'GET' | 'POST';
}

// ─────────────────────────────────────────────────────────────────────────────────
// CREATE NOTIFICATION REQUEST
// ─────────────────────────────────────────────────────────────────────────────────

export interface CreateNotificationRequest {
  type: NotificationType;
  title: string;
  body: string;
  icon?: string;
  priority?: NotificationPriority;
  action?: NotificationAction;
  data?: Record<string, unknown>;
  source?: string;
  correlationId?: string;
  expiresAt?: string;
  channels?: NotificationChannel[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// NOTIFICATION PREFERENCES
// ─────────────────────────────────────────────────────────────────────────────────

export interface NotificationPreferences {
  userId: string;
  
  // Global settings
  enabled: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart?: string;  // HH:mm format
  quietHoursEnd?: string;    // HH:mm format
  
  // Per-type settings
  typeSettings: Partial<Record<NotificationType, NotificationTypeSettings>>;
  
  // Channel settings
  channelSettings: Record<NotificationChannel, ChannelSettings>;
}

export interface NotificationTypeSettings {
  enabled: boolean;
  priority?: NotificationPriority; // Override default priority
  channels?: NotificationChannel[];
}

export interface ChannelSettings {
  enabled: boolean;
  minPriority?: NotificationPriority; // Only deliver if priority >= this
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  userId: '',
  enabled: true,
  quietHoursEnabled: false,
  typeSettings: {},
  channelSettings: {
    in_app: { enabled: true },
    push: { enabled: false, minPriority: 'medium' },
    email: { enabled: false, minPriority: 'high' },
  },
};

// ─────────────────────────────────────────────────────────────────────────────────
// NOTIFICATION TEMPLATES
// ─────────────────────────────────────────────────────────────────────────────────

export interface NotificationTemplate {
  type: NotificationType;
  defaultPriority: NotificationPriority;
  defaultChannels: NotificationChannel[];
  icon: string;
  titleTemplate: string;
  bodyTemplate: string;
}

export const NOTIFICATION_TEMPLATES: Record<NotificationType, NotificationTemplate> = {
  // Spark notifications
  spark_reminder: {
    type: 'spark_reminder',
    defaultPriority: 'medium',
    defaultChannels: ['in_app'],
    icon: '⚡',
    titleTemplate: 'Spark reminder',
    bodyTemplate: "You have a pending spark: {{action}}",
  },
  spark_expiring: {
    type: 'spark_expiring',
    defaultPriority: 'high',
    defaultChannels: ['in_app', 'push'],
    icon: '⏰',
    titleTemplate: 'Spark expiring soon',
    bodyTemplate: "Your spark '{{action}}' expires in {{timeLeft}}",
  },
  spark_expired: {
    type: 'spark_expired',
    defaultPriority: 'low',
    defaultChannels: ['in_app'],
    icon: '💨',
    titleTemplate: 'Spark expired',
    bodyTemplate: "Your spark '{{action}}' has expired",
  },
  
  // Goal notifications
  goal_deadline: {
    type: 'goal_deadline',
    defaultPriority: 'high',
    defaultChannels: ['in_app', 'push'],
    icon: '🎯',
    titleTemplate: 'Goal deadline approaching',
    bodyTemplate: "'{{title}}' is due in {{timeLeft}}",
  },
  goal_stalled: {
    type: 'goal_stalled',
    defaultPriority: 'medium',
    defaultChannels: ['in_app'],
    icon: '⏸️',
    titleTemplate: 'Goal needs attention',
    bodyTemplate: "'{{title}}' hasn't had progress in {{daysSinceUpdate}} days",
  },
  goal_milestone: {
    type: 'goal_milestone',
    defaultPriority: 'medium',
    defaultChannels: ['in_app'],
    icon: '🏆',
    titleTemplate: 'Milestone reached!',
    bodyTemplate: "'{{title}}' is {{progress}}% complete",
  },
  goal_completed: {
    type: 'goal_completed',
    defaultPriority: 'high',
    defaultChannels: ['in_app', 'push'],
    icon: '🎉',
    titleTemplate: 'Goal completed!',
    bodyTemplate: "Congratulations! You completed '{{title}}'",
  },
  
  // Quest notifications
  quest_blocked: {
    type: 'quest_blocked',
    defaultPriority: 'medium',
    defaultChannels: ['in_app'],
    icon: '🚧',
    titleTemplate: 'Quest blocked',
    bodyTemplate: "'{{title}}' is blocked: {{reason}}",
  },
  quest_ready: {
    type: 'quest_ready',
    defaultPriority: 'medium',
    defaultChannels: ['in_app'],
    icon: '✅',
    titleTemplate: 'Quest ready',
    bodyTemplate: "'{{title}}' is ready to start",
  },
  quest_completed: {
    type: 'quest_completed',
    defaultPriority: 'medium',
    defaultChannels: ['in_app'],
    icon: '🏅',
    titleTemplate: 'Quest completed!',
    bodyTemplate: "You completed '{{title}}'",
  },
  
  // Shield notifications
  shield_triggered: {
    type: 'shield_triggered',
    defaultPriority: 'high',
    defaultChannels: ['in_app'],
    icon: '🛡️',
    titleTemplate: 'Shield activated',
    bodyTemplate: 'Nova detected a potential risk: {{reason}}',
  },
  risk_alert: {
    type: 'risk_alert',
    defaultPriority: 'urgent',
    defaultChannels: ['in_app', 'push'],
    icon: '⚠️',
    titleTemplate: 'Risk alert',
    bodyTemplate: '{{message}}',
  },
  
  // System notifications
  system_alert: {
    type: 'system_alert',
    defaultPriority: 'high',
    defaultChannels: ['in_app'],
    icon: '🔔',
    titleTemplate: 'System alert',
    bodyTemplate: '{{message}}',
  },
  feature_update: {
    type: 'feature_update',
    defaultPriority: 'low',
    defaultChannels: ['in_app'],
    icon: '✨',
    titleTemplate: 'New feature',
    bodyTemplate: '{{message}}',
  },
  tip: {
    type: 'tip',
    defaultPriority: 'low',
    defaultChannels: ['in_app'],
    icon: '💡',
    titleTemplate: 'Tip',
    bodyTemplate: '{{message}}',
  },
};

// ─────────────────────────────────────────────────────────────────────────────────
// NOTIFICATION SUMMARY
// ─────────────────────────────────────────────────────────────────────────────────

export interface NotificationSummary {
  total: number;
  unread: number;
  byPriority: Record<NotificationPriority, number>;
  byType: Partial<Record<NotificationType, number>>;
}

// ─────────────────────────────────────────────────────────────────────────────────
// PRIORITY HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

export const PRIORITY_ORDER: Record<NotificationPriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
  urgent: 3,
};

export function comparePriority(a: NotificationPriority, b: NotificationPriority): number {
  return PRIORITY_ORDER[a] - PRIORITY_ORDER[b];
}

export function meetsMinPriority(priority: NotificationPriority, minPriority: NotificationPriority): boolean {
  return PRIORITY_ORDER[priority] >= PRIORITY_ORDER[minPriority];
}
