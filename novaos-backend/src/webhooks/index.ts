// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOKS MODULE — Event Delivery System
// ═══════════════════════════════════════════════════════════════════════════════

// Types
export type {
  WebhookEventType,
  WebhookEventCategory,
  WebhookStatus,
  Webhook,
  WebhookOptions,
  WebhookEvent,
  DeliveryStatus,
  WebhookDelivery,
  DeliveryAttempt,
  DeliveryLog,
  CreateWebhookRequest,
  UpdateWebhookRequest,
  WebhookPayload,
} from './types.js';

export {
  DEFAULT_WEBHOOK_OPTIONS,
  EVENT_CATEGORIES,
  ALL_EVENT_TYPES,
  getEventCategory,
} from './types.js';

// Signature
export {
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
  TIMESTAMP_HEADER,
  DELIVERY_ID_HEADER,
  EVENT_TYPE_HEADER,
  WEBHOOK_ID_HEADER,
  type SignatureVerificationResult,
  type WebhookHeaders,
  type SignedPayload,
} from './signature.js';

// Store
export { WebhookStore, getWebhookStore } from './store.js';

// Events
export {
  createEvent,
  emitEvent,
  goalEvents,
  questEvents,
  stepEvents,
  sparkEvents,
  memoryEvents,
  chatEvents,
  userEvents,
  systemEvents,
  webhookEvents,
} from './events.js';

// Dispatcher
export {
  WebhookDispatcher,
  getWebhookDispatcher,
  createWebhookDispatcher,
} from './dispatcher.js';
