// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK EVENTS — Event Definitions and Emitters
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  WebhookEvent,
  WebhookEventType,
  WebhookEventCategory,
} from './types.js';
import { getEventCategory } from './types.js';
import { getWebhookDispatcher } from './dispatcher.js';
import { getLogger } from '../logging/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

const API_VERSION = '1.0';
const ENVIRONMENT = process.env.NODE_ENV ?? 'development';

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'webhook-events' });

// ─────────────────────────────────────────────────────────────────────────────────
// EVENT BUILDER
// ─────────────────────────────────────────────────────────────────────────────────

function generateEventId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createEvent(
  type: WebhookEventType,
  userId: string,
  data: Record<string, unknown>,
  options?: {
    source?: string;
    correlationId?: string;
  }
): WebhookEvent {
  return {
    id: generateEventId(),
    type,
    category: getEventCategory(type),
    userId,
    timestamp: new Date().toISOString(),
    data,
    source: options?.source,
    correlationId: options?.correlationId,
    version: API_VERSION,
    environment: ENVIRONMENT,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// EVENT EMITTER
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Emit a webhook event.
 * This queues the event for delivery to all subscribed webhooks.
 */
export async function emitEvent(
  type: WebhookEventType,
  userId: string,
  data: Record<string, unknown>,
  options?: {
    source?: string;
    correlationId?: string;
  }
): Promise<void> {
  const event = createEvent(type, userId, data, options);
  
  logger.debug('Emitting webhook event', {
    eventId: event.id,
    type: event.type,
    userId: event.userId,
  });
  
  try {
    const dispatcher = getWebhookDispatcher();
    await dispatcher.dispatch(event);
  } catch (error) {
    logger.error(
      'Failed to dispatch webhook event',
      error instanceof Error ? error : new Error(String(error)),
      { eventId: event.id, type: event.type }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// TYPED EVENT EMITTERS
// ─────────────────────────────────────────────────────────────────────────────────

// Goal Events
export const goalEvents = {
  created: (userId: string, goal: { id: string; title: string; description?: string }) =>
    emitEvent('goal.created', userId, { goal }, { source: 'sword' }),
    
  updated: (userId: string, goal: { id: string; title: string; changes: string[] }) =>
    emitEvent('goal.updated', userId, { goal }, { source: 'sword' }),
    
  completed: (userId: string, goal: { id: string; title: string; completedAt: string }) =>
    emitEvent('goal.completed', userId, { goal }, { source: 'sword' }),
    
  abandoned: (userId: string, goal: { id: string; title: string; reason?: string }) =>
    emitEvent('goal.abandoned', userId, { goal }, { source: 'sword' }),
    
  progress: (userId: string, goal: { id: string; title: string; progress: number; previousProgress: number }) =>
    emitEvent('goal.progress', userId, { goal }, { source: 'sword' }),
};

// Quest Events
export const questEvents = {
  created: (userId: string, quest: { id: string; goalId: string; title: string }) =>
    emitEvent('quest.created', userId, { quest }, { source: 'sword' }),
    
  started: (userId: string, quest: { id: string; goalId: string; title: string }) =>
    emitEvent('quest.started', userId, { quest }, { source: 'sword' }),
    
  completed: (userId: string, quest: { id: string; goalId: string; title: string }) =>
    emitEvent('quest.completed', userId, { quest }, { source: 'sword' }),
    
  blocked: (userId: string, quest: { id: string; goalId: string; title: string; reason: string }) =>
    emitEvent('quest.blocked', userId, { quest }, { source: 'sword' }),
};

// Step Events
export const stepEvents = {
  created: (userId: string, step: { id: string; questId: string; title: string }) =>
    emitEvent('step.created', userId, { step }, { source: 'sword' }),
    
  completed: (userId: string, step: { id: string; questId: string; title: string }) =>
    emitEvent('step.completed', userId, { step }, { source: 'sword' }),
    
  skipped: (userId: string, step: { id: string; questId: string; title: string; reason?: string }) =>
    emitEvent('step.skipped', userId, { step }, { source: 'sword' }),
};

// Spark Events
export const sparkEvents = {
  suggested: (userId: string, spark: { id: string; action: string; stepId?: string }) =>
    emitEvent('spark.suggested', userId, { spark }, { source: 'sword' }),
    
  accepted: (userId: string, spark: { id: string; action: string }) =>
    emitEvent('spark.accepted', userId, { spark }, { source: 'sword' }),
    
  completed: (userId: string, spark: { id: string; action: string; duration?: number }) =>
    emitEvent('spark.completed', userId, { spark }, { source: 'sword' }),
    
  expired: (userId: string, spark: { id: string; action: string }) =>
    emitEvent('spark.expired', userId, { spark }, { source: 'sword' }),
    
  declined: (userId: string, spark: { id: string; action: string; reason?: string }) =>
    emitEvent('spark.declined', userId, { spark }, { source: 'sword' }),
};

// Memory Events
export const memoryEvents = {
  created: (userId: string, memory: { id: string; category: string; key: string }) =>
    emitEvent('memory.created', userId, { memory }, { source: 'memory' }),
    
  updated: (userId: string, memory: { id: string; category: string; key: string; changes: string[] }) =>
    emitEvent('memory.updated', userId, { memory }, { source: 'memory' }),
    
  deleted: (userId: string, memory: { id: string; category: string; key: string; reason?: string }) =>
    emitEvent('memory.deleted', userId, { memory }, { source: 'memory' }),
    
  decayed: (userId: string, stats: { decayedCount: number; deletedCount: number }) =>
    emitEvent('memory.decayed', userId, { stats }, { source: 'scheduler' }),
};

// Chat Events
export const chatEvents = {
  message: (userId: string, message: { conversationId: string; role: 'user' | 'assistant'; preview: string }) =>
    emitEvent('chat.message', userId, { message }, { source: 'chat' }),
    
  veto: (userId: string, veto: { type: 'soft' | 'hard'; reason: string; auditId?: string }) =>
    emitEvent('chat.veto', userId, { veto }, { source: 'shield' }),
    
  shieldTriggered: (userId: string, shield: { riskLevel: string; triggers: string[]; stance: string }) =>
    emitEvent('chat.shield_triggered', userId, { shield }, { source: 'shield' }),
};

// User Events
export const userEvents = {
  profileUpdated: (userId: string, profile: { changes: string[] }) =>
    emitEvent('user.profile_updated', userId, { profile }, { source: 'user' }),
    
  preferencesUpdated: (userId: string, preferences: { changes: string[] }) =>
    emitEvent('user.preferences_updated', userId, { preferences }, { source: 'user' }),
};

// System Events
export const systemEvents = {
  healthDegraded: (userId: string, health: { component: string; status: string; message: string }) =>
    emitEvent('system.health_degraded', userId, { health }, { source: 'system' }),
    
  jobFailed: (userId: string, job: { jobId: string; error: string; attempt: number }) =>
    emitEvent('system.job_failed', userId, { job }, { source: 'scheduler' }),
};

// ─────────────────────────────────────────────────────────────────────────────────
// EVENT REGISTRY
// ─────────────────────────────────────────────────────────────────────────────────

export const webhookEvents = {
  goal: goalEvents,
  quest: questEvents,
  step: stepEvents,
  spark: sparkEvents,
  memory: memoryEvents,
  chat: chatEvents,
  user: userEvents,
  system: systemEvents,
  
  // Generic emitter
  emit: emitEvent,
  create: createEvent,
};
