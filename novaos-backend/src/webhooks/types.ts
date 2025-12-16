// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK TYPES — Event Subscriptions and Delivery
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// EVENT TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export type WebhookEventType =
  // Goal events
  | 'goal.created'
  | 'goal.updated'
  | 'goal.completed'
  | 'goal.abandoned'
  | 'goal.progress'
  
  // Quest events
  | 'quest.created'
  | 'quest.started'
  | 'quest.completed'
  | 'quest.blocked'
  
  // Step events
  | 'step.created'
  | 'step.completed'
  | 'step.skipped'
  
  // Spark events
  | 'spark.suggested'
  | 'spark.accepted'
  | 'spark.completed'
  | 'spark.expired'
  | 'spark.declined'
  
  // Memory events
  | 'memory.created'
  | 'memory.updated'
  | 'memory.deleted'
  | 'memory.decayed'
  
  // Chat events
  | 'chat.message'
  | 'chat.veto'
  | 'chat.shield_triggered'
  
  // User events
  | 'user.profile_updated'
  | 'user.preferences_updated'
  
  // System events
  | 'system.health_degraded'
  | 'system.job_failed';

export type WebhookEventCategory =
  | 'goal'
  | 'quest'
  | 'step'
  | 'spark'
  | 'memory'
  | 'chat'
  | 'user'
  | 'system';

// ─────────────────────────────────────────────────────────────────────────────────
// WEBHOOK REGISTRATION
// ─────────────────────────────────────────────────────────────────────────────────

export type WebhookStatus = 'active' | 'paused' | 'disabled' | 'failed';

export interface Webhook {
  id: string;
  userId: string;
  
  // Configuration
  name: string;
  description?: string;
  url: string;
  secret: string;          // For HMAC signature
  
  // Subscriptions
  events: WebhookEventType[];  // Which events to send
  
  // Status
  status: WebhookStatus;
  
  // Metadata
  createdAt: string;
  updatedAt: string;
  
  // Delivery stats
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  lastDeliveryAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  consecutiveFailures: number;
  
  // Configuration options
  options: WebhookOptions;
}

export interface WebhookOptions {
  // Retry configuration
  maxRetries: number;           // Default: 3
  retryDelayMs: number;         // Base delay, default: 1000ms
  retryBackoffMultiplier: number; // Default: 2 (exponential)
  
  // Timeout
  timeoutMs: number;            // Default: 10000ms
  
  // Headers
  customHeaders?: Record<string, string>;
  
  // Filtering
  minSeverity?: 'low' | 'medium' | 'high';
  
  // Batching (future feature)
  batchEvents?: boolean;
  batchWindowMs?: number;
}

export const DEFAULT_WEBHOOK_OPTIONS: WebhookOptions = {
  maxRetries: 3,
  retryDelayMs: 1000,
  retryBackoffMultiplier: 2,
  timeoutMs: 10000,
};

// ─────────────────────────────────────────────────────────────────────────────────
// WEBHOOK EVENTS
// ─────────────────────────────────────────────────────────────────────────────────

export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  category: WebhookEventCategory;
  userId: string;
  
  // Event data
  timestamp: string;
  data: Record<string, unknown>;
  
  // Context
  source?: string;           // What triggered this event
  correlationId?: string;    // For tracking related events
  
  // Metadata
  version: string;           // API version
  environment: string;       // production, staging, etc.
}

// ─────────────────────────────────────────────────────────────────────────────────
// DELIVERY TRACKING
// ─────────────────────────────────────────────────────────────────────────────────

export type DeliveryStatus = 
  | 'pending'
  | 'in_progress'
  | 'delivered'
  | 'failed'
  | 'retrying';

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventId: string;
  userId: string;
  
  // Request
  url: string;
  payload: string;           // JSON string
  signature: string;         // HMAC signature
  
  // Status
  status: DeliveryStatus;
  attempt: number;
  maxAttempts: number;
  
  // Response
  responseStatus?: number;
  responseBody?: string;
  responseTimeMs?: number;
  
  // Timing
  createdAt: string;
  scheduledAt: string;       // When to attempt delivery
  attemptedAt?: string;
  completedAt?: string;
  
  // Error tracking
  error?: string;
  errorCode?: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// DELIVERY LOG
// ─────────────────────────────────────────────────────────────────────────────────

export interface DeliveryAttempt {
  attempt: number;
  timestamp: string;
  status: 'success' | 'failure';
  responseStatus?: number;
  responseTimeMs?: number;
  error?: string;
}

export interface DeliveryLog {
  deliveryId: string;
  webhookId: string;
  eventId: string;
  eventType: WebhookEventType;
  
  // Final status
  finalStatus: DeliveryStatus;
  totalAttempts: number;
  
  // Timing
  createdAt: string;
  completedAt?: string;
  totalDurationMs?: number;
  
  // Attempts
  attempts: DeliveryAttempt[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// REQUEST TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface CreateWebhookRequest {
  name: string;
  description?: string;
  url: string;
  events: WebhookEventType[];
  options?: Partial<WebhookOptions>;
  customHeaders?: Record<string, string>;
}

export interface UpdateWebhookRequest {
  name?: string;
  description?: string;
  url?: string;
  events?: WebhookEventType[];
  status?: WebhookStatus;
  options?: Partial<WebhookOptions>;
  customHeaders?: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────────
// WEBHOOK PAYLOAD (sent to endpoint)
// ─────────────────────────────────────────────────────────────────────────────────

export interface WebhookPayload {
  id: string;                // Delivery ID
  event: WebhookEventType;
  timestamp: string;
  data: Record<string, unknown>;
  
  // Metadata
  webhookId: string;
  userId: string;
  attempt: number;
  
  // Verification
  signature: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// SUBSCRIPTION HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

export const EVENT_CATEGORIES: Record<WebhookEventCategory, WebhookEventType[]> = {
  goal: ['goal.created', 'goal.updated', 'goal.completed', 'goal.abandoned', 'goal.progress'],
  quest: ['quest.created', 'quest.started', 'quest.completed', 'quest.blocked'],
  step: ['step.created', 'step.completed', 'step.skipped'],
  spark: ['spark.suggested', 'spark.accepted', 'spark.completed', 'spark.expired', 'spark.declined'],
  memory: ['memory.created', 'memory.updated', 'memory.deleted', 'memory.decayed'],
  chat: ['chat.message', 'chat.veto', 'chat.shield_triggered'],
  user: ['user.profile_updated', 'user.preferences_updated'],
  system: ['system.health_degraded', 'system.job_failed'],
};

export const ALL_EVENT_TYPES: WebhookEventType[] = Object.values(EVENT_CATEGORIES).flat();

export function getEventCategory(eventType: WebhookEventType): WebhookEventCategory {
  const category = eventType.split('.')[0] as WebhookEventCategory;
  return category;
}
