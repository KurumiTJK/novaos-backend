// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGE GENERATOR — Tone-Appropriate Reminder Messages
// NovaOS Spark Engine — Phase 11: Reminder Service
// ═══════════════════════════════════════════════════════════════════════════════
//
// Generates reminder messages based on:
//   - Tone (encouraging, gentle, last_chance)
//   - Spark content (action, estimated time)
//   - Escalation level
//   - User context
//
// Messages are designed to be:
//   - Brief and actionable
//   - Appropriate to the escalation level
//   - Not annoying or guilt-inducing
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { ReminderSchedule, ReminderTone, Spark, SparkVariant } from '../types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Context for generating a reminder message.
 */
export interface MessageContext {
  /** The reminder being sent */
  readonly reminder: ReminderSchedule;

  /** The spark being reminded about (optional for richer messages) */
  readonly spark?: Spark;

  /** User's name (optional for personalization) */
  readonly userName?: string;

  /** Goal title (optional for context) */
  readonly goalTitle?: string;

  /** Step title (optional for context) */
  readonly stepTitle?: string;
}

/**
 * Generated message with metadata.
 */
export interface GeneratedMessage {
  /** The message text */
  readonly text: string;

  /** Short version for SMS/push title */
  readonly shortText: string;

  /** Subject line for email */
  readonly subject: string;

  /** Tone used */
  readonly tone: ReminderTone;

  /** Whether this includes spark details */
  readonly hasSparkDetails: boolean;
}

/**
 * Message template with placeholders.
 */
interface MessageTemplate {
  readonly text: string;
  readonly shortText: string;
  readonly subject: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// MESSAGE TEMPLATES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Templates for encouraging tone (escalation level 0).
 */
const ENCOURAGING_TEMPLATES: readonly MessageTemplate[] = [
  {
    text: "Ready to learn? Your spark is waiting! Let's make progress today. 🚀",
    shortText: 'Time to learn! 🚀',
    subject: "Let's make progress today!",
  },
  {
    text: "Your learning journey continues! Take a few minutes to grow today. 📚",
    shortText: 'Learning time! 📚',
    subject: 'Your learning spark awaits',
  },
  {
    text: "Small steps lead to big results. Ready for today's spark? ✨",
    shortText: "Today's spark ✨",
    subject: 'Small steps, big results',
  },
  {
    text: "Knowledge awaits! Your daily spark is ready when you are. 🌟",
    shortText: 'Spark ready! 🌟',
    subject: 'Your daily learning spark',
  },
  {
    text: "Time to level up! A few minutes of learning makes all the difference. 💡",
    shortText: 'Level up! 💡',
    subject: 'Time to level up',
  },
];

/**
 * Templates for gentle tone (escalation level 1-2).
 */
const GENTLE_TEMPLATES: readonly MessageTemplate[] = [
  {
    text: "Hey, just a gentle reminder about your learning goal. A few minutes can make a difference! 📖",
    shortText: 'Gentle reminder 📖',
    subject: 'A gentle nudge',
  },
  {
    text: "Still time to fit in some learning today. No pressure, just a friendly nudge. 🙂",
    shortText: 'Friendly nudge 🙂',
    subject: "There's still time",
  },
  {
    text: "Your spark is still waiting. Even a quick session keeps momentum going. 🔄",
    shortText: 'Still waiting 🔄',
    subject: 'Your spark is waiting',
  },
  {
    text: "Just checking in! Your learning goal is here whenever you're ready. 📝",
    shortText: 'Checking in 📝',
    subject: 'Quick check-in',
  },
  {
    text: "Remember your goal? A little progress today keeps you on track. 🎯",
    shortText: 'Stay on track 🎯',
    subject: 'Stay on track',
  },
];

/**
 * Templates for last_chance tone (escalation level 3).
 */
const LAST_CHANCE_TEMPLATES: readonly MessageTemplate[] = [
  {
    text: "Last reminder for today! Even 5 minutes of learning counts. You've got this! 💪",
    shortText: 'Last chance! 💪',
    subject: 'Last reminder for today',
  },
  {
    text: "Final nudge: your spark is still here. A tiny step forward is still forward! 🚶",
    shortText: 'Final nudge 🚶',
    subject: 'Final nudge for today',
  },
  {
    text: "Day's almost done, but there's still time for a quick spark. No guilt, just opportunity! ⏰",
    shortText: 'Still time! ⏰',
    subject: "Day's almost done",
  },
  {
    text: "One more chance today! Even the smallest action beats zero. You decide. 🤔",
    shortText: 'Your call 🤔',
    subject: 'One more chance',
  },
  {
    text: "Last call! Tomorrow's a new day either way, but today still has potential. 🌅",
    shortText: 'Last call 🌅',
    subject: 'Last call for today',
  },
];

/**
 * Templates with spark details (when spark is provided).
 */
const SPARK_DETAIL_TEMPLATES: Record<ReminderTone, readonly string[]> = {
  encouraging: [
    "Ready for today's spark? {{action}} (~{{minutes}} min) 🚀",
    "Your spark awaits: {{action}} — just {{minutes}} minutes! ✨",
    "Time to {{action}}! Should only take about {{minutes}} minutes. 📚",
  ],
  gentle: [
    "Gentle reminder: {{action}} (~{{minutes}} min) 📖",
    "Still time for: {{action}} — {{minutes}} min when you're ready 🙂",
    "Your task is waiting: {{action}} ({{minutes}} min) 🔄",
  ],
  last_chance: [
    "Last chance: {{action}} (~{{minutes}} min) 💪",
    "Final reminder: {{action}} — just {{minutes}} minutes! ⏰",
    "One more shot at: {{action}} ({{minutes}} min) 🌅",
  ],
};

/**
 * Templates for reduced/minimal spark variants.
 */
const REDUCED_SPARK_TEMPLATES: Record<SparkVariant, readonly string[]> = {
  full: [], // Use regular templates
  reduced: [
    "Scaled-down version: {{action}} (~{{minutes}} min)",
    "Lighter option today: {{action}} ({{minutes}} min)",
    "Quick version: {{action}} — {{minutes}} minutes",
  ],
  minimal: [
    "Micro-task: {{action}} (~{{minutes}} min) — every bit counts!",
    "Smallest step: {{action}} (just {{minutes}} min)",
    "Tiny win available: {{action}} — {{minutes}} minutes",
  ],
};

// ─────────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Get templates for a specific tone.
 */
function getTemplatesForTone(tone: ReminderTone): readonly MessageTemplate[] {
  switch (tone) {
    case 'encouraging':
      return ENCOURAGING_TEMPLATES;
    case 'gentle':
      return GENTLE_TEMPLATES;
    case 'last_chance':
      return LAST_CHANCE_TEMPLATES;
    default:
      return ENCOURAGING_TEMPLATES;
  }
}

/**
 * Select a random template from an array.
 * Uses reminder ID as seed for consistency.
 */
function selectTemplate<T>(templates: readonly T[], seed: string): T {
  // Simple hash function for deterministic selection
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  const index = Math.abs(hash) % templates.length;
  return templates[index];
}

/**
 * Replace placeholders in a template string.
 */
function fillTemplate(
  template: string,
  values: Record<string, string | number>
): string {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
  }
  return result;
}

/**
 * Truncate action text for display.
 */
function truncateAction(action: string, maxLength: number = 50): string {
  if (action.length <= maxLength) {
    return action;
  }
  return action.slice(0, maxLength - 3) + '...';
}

/**
 * Format minutes for display.
 */
function formatMinutes(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${mins}m`;
}

// ─────────────────────────────────────────────────────────────────────────────────
// MESSAGE GENERATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Build a reminder message based on context.
 *
 * @param context - Message generation context
 * @returns Generated message with all variants
 */
export function buildReminderMessage(context: MessageContext): GeneratedMessage {
  const { reminder, spark, userName, goalTitle } = context;
  const { tone } = reminder;

  // If we have spark details, use detailed templates
  if (spark) {
    return buildDetailedMessage(context);
  }

  // Otherwise, use generic templates
  const templates = getTemplatesForTone(tone);
  const template = selectTemplate(templates, reminder.id);

  let text = template.text;
  let subject = template.subject;

  // Personalize with name if available
  if (userName) {
    text = `Hi ${userName}! ${text}`;
  }

  // Add goal context if available
  if (goalTitle) {
    subject = `${subject} — ${goalTitle}`;
  }

  return {
    text,
    shortText: template.shortText,
    subject,
    tone,
    hasSparkDetails: false,
  };
}

/**
 * Build a detailed message with spark information.
 */
function buildDetailedMessage(context: MessageContext): GeneratedMessage {
  const { reminder, spark, userName, goalTitle } = context;
  const { tone } = reminder;

  if (!spark) {
    // Fallback to generic message
    return buildReminderMessage({ ...context, spark: undefined });
  }

  const action = truncateAction(spark.action);
  const minutes = formatMinutes(spark.estimatedMinutes);
  const variant = spark.variant;

  // Choose template based on variant
  let templateSource: readonly string[];

  if (variant !== 'full' && REDUCED_SPARK_TEMPLATES[variant].length > 0) {
    templateSource = REDUCED_SPARK_TEMPLATES[variant];
  } else {
    templateSource = SPARK_DETAIL_TEMPLATES[tone];
  }

  const template = selectTemplate(templateSource, reminder.id);
  let text = fillTemplate(template, { action, minutes });

  // Personalize with name if available
  if (userName) {
    text = `Hi ${userName}! ${text}`;
  }

  // Build subject
  let subject = `Time to learn: ${truncateAction(spark.action, 30)}`;
  if (goalTitle) {
    subject = `${goalTitle}: ${truncateAction(spark.action, 30)}`;
  }

  // Build short text
  const shortText = `${truncateAction(spark.action, 25)} (${minutes} min)`;

  return {
    text,
    shortText,
    subject,
    tone,
    hasSparkDetails: true,
  };
}

/**
 * Build a simple message for a specific tone (convenience function).
 *
 * @param tone - Reminder tone
 * @param reminderId - Reminder ID (for template selection)
 * @returns Simple message text
 */
export function buildSimpleMessage(tone: ReminderTone, reminderId: string): string {
  const templates = getTemplatesForTone(tone);
  const template = selectTemplate(templates, reminderId);
  return template.text;
}

/**
 * Build a push notification payload.
 *
 * @param context - Message context
 * @returns Push notification payload
 */
export function buildPushPayload(
  context: MessageContext
): {
  title: string;
  body: string;
  data: Record<string, unknown>;
} {
  const message = buildReminderMessage(context);
  const { reminder, spark } = context;

  return {
    title: message.shortText,
    body: message.text,
    data: {
      type: 'reminder',
      reminderId: reminder.id,
      sparkId: reminder.sparkId,
      stepId: reminder.stepId,
      escalationLevel: reminder.escalationLevel,
      tone: reminder.tone,
      sparkAction: spark?.action,
    },
  };
}

/**
 * Build an email payload.
 *
 * @param context - Message context
 * @returns Email payload
 */
export function buildEmailPayload(
  context: MessageContext
): {
  subject: string;
  textBody: string;
  htmlBody: string;
} {
  const message = buildReminderMessage(context);
  const { spark, goalTitle, stepTitle } = context;

  // Build HTML body
  let htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #333; margin-bottom: 16px;">${escapeHtml(message.shortText)}</h2>
      <p style="color: #555; font-size: 16px; line-height: 1.5;">${escapeHtml(message.text)}</p>
  `;

  if (spark) {
    htmlBody += `
      <div style="background: #f5f5f5; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <p style="margin: 0; font-weight: 600; color: #333;">Your Task:</p>
        <p style="margin: 8px 0 0; color: #555;">${escapeHtml(spark.action)}</p>
        <p style="margin: 8px 0 0; color: #888; font-size: 14px;">Estimated: ${spark.estimatedMinutes} minutes</p>
      </div>
    `;
  }

  if (goalTitle) {
    htmlBody += `
      <p style="color: #888; font-size: 14px; margin-top: 20px;">
        Goal: ${escapeHtml(goalTitle)}${stepTitle ? ` — ${escapeHtml(stepTitle)}` : ''}
      </p>
    `;
  }

  htmlBody += `
      <p style="color: #888; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;">
        This reminder was sent by NovaOS Spark Engine.
      </p>
    </div>
  `;

  return {
    subject: message.subject,
    textBody: message.text,
    htmlBody,
  };
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Build an SMS message (short format).
 *
 * @param context - Message context
 * @returns SMS message text (max 160 chars)
 */
export function buildSmsMessage(context: MessageContext): string {
  const { reminder, spark } = context;
  const { tone } = reminder;

  // SMS needs to be very short
  if (spark) {
    const action = truncateAction(spark.action, 40);
    const minutes = spark.estimatedMinutes;

    switch (tone) {
      case 'encouraging':
        return `Nova: ${action} (${minutes}min) - Let's go! 🚀`;
      case 'gentle':
        return `Nova: Reminder - ${action} (${minutes}min) 📖`;
      case 'last_chance':
        return `Nova: Last call - ${action} (${minutes}min) 💪`;
    }
  }

  // Generic short messages
  switch (tone) {
    case 'encouraging':
      return 'Nova: Your learning spark is ready! 🚀';
    case 'gentle':
      return 'Nova: Gentle reminder about your learning goal 📖';
    case 'last_chance':
      return 'Nova: Last reminder for today! 💪';
    default:
      return 'Nova: Time for your daily spark!';
  }
}
