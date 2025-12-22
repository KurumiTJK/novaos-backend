// ═══════════════════════════════════════════════════════════════════════════════
// REFINEMENT FLOW — Multi-Turn Goal Clarification
// NovaOS Gates — Phase 13: SwordGate Integration
// ═══════════════════════════════════════════════════════════════════════════════
//
// Manages the multi-turn conversation flow for goal creation:
//   - Initiates refinement from a goal statement
//   - Processes user responses and extracts structured data
//   - Generates contextual follow-up questions
//   - Tracks progress through required fields
//
// Flow: goalStatement → userLevel → dailyTimeCommitment → totalDuration → [optional fields]
//
// ═══════════════════════════════════════════════════════════════════════════════

import { createTimestamp } from '../../types/branded.js';
import type { UserId, Timestamp } from '../../types/branded.js';
import type { UserLevel, LearningStyle, DayOfWeek, ALL_DAYS } from '../../services/spark-engine/types.js';

import type {
  SwordRefinementState,
  SwordRefinementInputs,
  SwordUserPreferences,
  SwordGateConfig,
  RefinementField,
} from './types.js';
import {
  REQUIRED_REFINEMENT_FIELDS,
  OPTIONAL_REFINEMENT_FIELDS,
  hasRequiredFields,
  getMissingRequiredFields,
  calculateRefinementProgress,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// QUESTION TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Questions for each refinement field.
 * Multiple variants for natural conversation.
 */
const QUESTION_TEMPLATES: Record<RefinementField, readonly string[]> = {
  goalStatement: [
    "What would you like to learn?",
    "What skill or topic do you want to master?",
  ],
  userLevel: [
    "What's your current experience level with {topic}? (beginner, intermediate, or advanced)",
    "How familiar are you with {topic}? Would you say you're a beginner, intermediate, or advanced?",
    "Are you new to {topic} or do you have some experience already?",
  ],
  dailyTimeCommitment: [
    "How much time can you dedicate each day? (e.g., 30 minutes, 1 hour)",
    "How many minutes per day would you like to spend learning?",
    "What's a realistic daily time commitment for you?",
  ],
  totalDuration: [
    "How long would you like this learning plan to span? (e.g., 4 weeks, 30 days)",
    "What's your target timeline for completing this goal?",
    "How much total time do you want to dedicate to this goal?",
  ],
  learningStyle: [
    "How do you prefer to learn? (reading, video, hands-on practice, or a mix)",
    "What learning style works best for you?",
  ],
  startDate: [
    "When would you like to start? (today, tomorrow, or a specific date)",
    "What start date works for you?",
  ],
  activeDays: [
    "Which days of the week would you like to learn? (e.g., weekdays, every day, specific days)",
    "Do you want to learn every day or just on certain days?",
  ],
  reminderPreferences: [
    "Would you like daily reminders to help you stay on track?",
    "Should I set up reminders for your learning sessions?",
  ],
};

/**
 * Get a question for a field, with topic substitution.
 */
function getQuestionForField(field: RefinementField, topic?: string): string {
  const templates = QUESTION_TEMPLATES[field];
  const template = templates[Math.floor(Math.random() * templates.length)];
  return template.replace('{topic}', topic ?? 'this topic');
}

// ═══════════════════════════════════════════════════════════════════════════════
// RESPONSE PARSERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parse user level from response.
 */
function parseUserLevel(response: string): UserLevel | null {
  const lower = response.toLowerCase().trim();

  // Direct matches
  if (/^beginner|^novice|^new|^just start|^no experience|^none|^zero/i.test(lower)) {
    return 'beginner';
  }
  if (/^intermediate|^some experience|^familiar|^know (the )?basics|^not new/i.test(lower)) {
    return 'intermediate';
  }
  if (/^advanced|^expert|^proficient|^experienced|^very familiar/i.test(lower)) {
    return 'advanced';
  }

  // Contextual patterns
  if (/never (used|tried|learned|done)|first time|starting from scratch/i.test(lower)) {
    return 'beginner';
  }
  if (/used (it )?before|some (background|knowledge)|worked with/i.test(lower)) {
    return 'intermediate';
  }
  if (/years of experience|professional|work with (it )?daily|expert/i.test(lower)) {
    return 'advanced';
  }

  return null;
}

/**
 * Parse daily time commitment from response.
 * Returns minutes.
 */
function parseDailyTimeCommitment(response: string): number | null {
  const lower = response.toLowerCase().trim();

  // Direct minute/hour patterns
  const minuteMatch = lower.match(/(\d+)\s*(min|minute|m\b)/i);
  if (minuteMatch) {
    const minutes = parseInt(minuteMatch[1], 10);
    if (minutes >= 1 && minutes <= 480) {
      return minutes;
    }
  }

  const hourMatch = lower.match(/(\d+(?:\.\d+)?)\s*(hour|hr|h\b)/i);
  if (hourMatch) {
    const hours = parseFloat(hourMatch[1]);
    const minutes = Math.round(hours * 60);
    if (minutes >= 1 && minutes <= 480) {
      return minutes;
    }
  }

  // "half an hour", "an hour"
  if (/half\s*(an\s*)?hour/i.test(lower)) {
    return 30;
  }
  if (/\ban?\s*hour\b/i.test(lower) && !/half/i.test(lower)) {
    return 60;
  }

  // Bare number (assume minutes if <= 120, hours if <= 8)
  const bareNumber = lower.match(/^(\d+)$/);
  if (bareNumber) {
    const num = parseInt(bareNumber[1], 10);
    if (num <= 120) return num; // Assume minutes
    if (num <= 8) return num * 60; // Assume hours
  }

  return null;
}

/**
 * Parse total duration from response.
 * Returns parsed duration string and estimated days.
 */
function parseTotalDuration(response: string): { duration: string; days: number } | null {
  const lower = response.toLowerCase().trim();

  // Week patterns
  const weekMatch = lower.match(/(\d+)\s*(week|wk)/i);
  if (weekMatch) {
    const weeks = parseInt(weekMatch[1], 10);
    if (weeks >= 1 && weeks <= 52) {
      return { duration: `${weeks} week${weeks > 1 ? 's' : ''}`, days: weeks * 7 };
    }
  }

  // Month patterns
  const monthMatch = lower.match(/(\d+)\s*(month|mo\b)/i);
  if (monthMatch) {
    const months = parseInt(monthMatch[1], 10);
    if (months >= 1 && months <= 12) {
      return { duration: `${months} month${months > 1 ? 's' : ''}`, days: months * 30 };
    }
  }

  // Day patterns
  const dayMatch = lower.match(/(\d+)\s*(day|d\b)/i);
  if (dayMatch) {
    const days = parseInt(dayMatch[1], 10);
    if (days >= 3 && days <= 365) {
      return { duration: `${days} days`, days };
    }
  }

  // "a week", "a month"
  if (/\ba\s*week\b/i.test(lower)) {
    return { duration: '1 week', days: 7 };
  }
  if (/\ba\s*month\b/i.test(lower)) {
    return { duration: '1 month', days: 30 };
  }

  // "couple of weeks"
  if (/couple\s*(of\s*)?weeks/i.test(lower)) {
    return { duration: '2 weeks', days: 14 };
  }

  return null;
}

/**
 * Parse learning style from response.
 */
function parseLearningStyle(response: string): LearningStyle | null {
  const lower = response.toLowerCase().trim();

  if (/^video|watch|youtube|visual/i.test(lower)) {
    return 'video';
  }
  if (/^read|article|book|text|documentation/i.test(lower)) {
    return 'reading';
  }
  if (/^hands[- ]?on|practice|project|coding|doing|build/i.test(lower)) {
    return 'hands-on';
  }
  if (/^mix|combination|all|variety|both|everything/i.test(lower)) {
    return 'mixed';
  }

  return null;
}

/**
 * Parse start date from response.
 * Returns YYYY-MM-DD format.
 */
function parseStartDate(response: string): string | null {
  const lower = response.toLowerCase().trim();
  const today = new Date();

  // "today", "now"
  if (/^today|^now|^right now|^immediately|^asap/i.test(lower)) {
    return formatDate(today);
  }

  // "tomorrow"
  if (/^tomorrow/i.test(lower)) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatDate(tomorrow);
  }

  // "next week", "next monday"
  if (/^next\s*week/i.test(lower)) {
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    return formatDate(nextWeek);
  }

  // Day of week
  const dayMatch = lower.match(/^(next\s*)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);
  if (dayMatch) {
    const targetDay = dayMatch[2].toLowerCase();
    const dayIndex = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(targetDay);
    const currentDay = today.getDay();
    let daysUntil = dayIndex - currentDay;
    if (daysUntil <= 0 || dayMatch[1]) {
      daysUntil += 7;
    }
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + daysUntil);
    return formatDate(targetDate);
  }

  // ISO date (YYYY-MM-DD)
  const isoMatch = lower.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return isoMatch[0];
  }

  // US date (MM/DD/YYYY or MM-DD-YYYY)
  const usMatch = lower.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (usMatch) {
    const month = usMatch[1].padStart(2, '0');
    const day = usMatch[2].padStart(2, '0');
    const year = usMatch[3];
    return `${year}-${month}-${day}`;
  }

  return null;
}

/**
 * Format date as YYYY-MM-DD.
 */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Parse active days from response.
 */
function parseActiveDays(response: string): readonly DayOfWeek[] | null {
  const lower = response.toLowerCase().trim();

  // "every day", "daily"
  if (/every\s*day|daily|all\s*(days|week)/i.test(lower)) {
    return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  }

  // "weekdays", "work days"
  if (/weekday|work\s*day|monday.*(through|to|-).*friday/i.test(lower)) {
    return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  }

  // "weekends"
  if (/weekend/i.test(lower)) {
    return ['saturday', 'sunday'];
  }

  // Specific days mentioned
  const days: DayOfWeek[] = [];
  const dayMap: Record<string, DayOfWeek> = {
    'mon': 'monday',
    'tue': 'tuesday',
    'wed': 'wednesday',
    'thu': 'thursday',
    'fri': 'friday',
    'sat': 'saturday',
    'sun': 'sunday',
    'monday': 'monday',
    'tuesday': 'tuesday',
    'wednesday': 'wednesday',
    'thursday': 'thursday',
    'friday': 'friday',
    'saturday': 'saturday',
    'sunday': 'sunday',
  };

  for (const [pattern, day] of Object.entries(dayMap)) {
    if (new RegExp(`\\b${pattern}`, 'i').test(lower) && !days.includes(day)) {
      days.push(day);
    }
  }

  if (days.length > 0) {
    // Sort by day order
    const dayOrder: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    return days.sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
  }

  return null;
}

/**
 * Parse reminder preference from response.
 */
function parseReminderPreference(response: string): { enabled: boolean; firstHour?: number; lastHour?: number } | null {
  const lower = response.toLowerCase().trim();

  // Negative responses
  if (/^no|^nope|^don'?t|^not|^skip|^none/i.test(lower)) {
    return { enabled: false };
  }

  // Positive responses
  if (/^yes|^yeah|^sure|^please|^ok|^definitely/i.test(lower)) {
    return { enabled: true };
  }

  // Time-based responses
  const morningMatch = lower.match(/morning|9\s*am|10\s*am/i);
  const eveningMatch = lower.match(/evening|7\s*pm|8\s*pm|19:|20:/i);

  if (morningMatch || eveningMatch) {
    return {
      enabled: true,
      firstHour: morningMatch ? 9 : 12,
      lastHour: eveningMatch ? 19 : 17,
    };
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// REFINEMENT FLOW CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Manages the multi-turn refinement conversation.
 */
export class RefinementFlow {
  private readonly config: SwordGateConfig;

  constructor(config: SwordGateConfig) {
    this.config = config;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // INITIATE
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Initiate a new refinement session from a goal statement.
   */
  initiate(
    userId: UserId,
    goalStatement: string,
    userPreferences?: SwordUserPreferences
  ): SwordRefinementState {
    const now = createTimestamp();
    const expiresAt = createTimestamp(
      new Date(Date.now() + this.config.refinementTtlSeconds * 1000)
    );

    // Extract topic from goal statement
    const extractedTopic = this.extractTopic(goalStatement);

    // Build initial inputs
    const inputs: SwordRefinementInputs = {
      goalStatement,
      extractedTopic,
      // Pre-fill from user preferences
      learningStyle: userPreferences?.defaultLearningStyle,
      activeDays: userPreferences?.preferredDays,
      dailyTimeCommitment: userPreferences?.defaultDailyMinutes,
    };

    return {
      userId,
      stage: 'clarifying',
      inputs,
      currentQuestion: 'userLevel',
      answeredQuestions: ['goalStatement'],
      turnCount: 1,
      maxTurns: this.config.maxRefinementTurns,
      createdAt: now,
      updatedAt: now,
      expiresAt,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PROCESS RESPONSE
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Process a user response and update the refinement state.
   */
  processResponse(
    state: SwordRefinementState,
    message: string
  ): SwordRefinementState {
    const currentQuestion = state.currentQuestion;
    if (!currentQuestion) {
      return state;
    }

    const now = createTimestamp();
    const newInputs = { ...state.inputs };
    const answeredQuestions = [...state.answeredQuestions];
    let parsed = false;

    // Parse response based on current question
    switch (currentQuestion) {
      case 'userLevel': {
        const level = parseUserLevel(message);
        if (level) {
          newInputs.userLevel = level;
          parsed = true;
        }
        break;
      }

      case 'dailyTimeCommitment': {
        const minutes = parseDailyTimeCommitment(message);
        if (minutes !== null) {
          // Clamp to config limits
          newInputs.dailyTimeCommitment = Math.max(
            this.config.minDailyMinutes,
            Math.min(this.config.maxDailyMinutes, minutes)
          );
          parsed = true;
        }
        break;
      }

      case 'totalDuration': {
        const duration = parseTotalDuration(message);
        if (duration) {
          // Clamp days to config limits
          const clampedDays = Math.max(
            this.config.minTotalDays,
            Math.min(this.config.maxTotalDays, duration.days)
          );
          newInputs.totalDuration = duration.duration;
          newInputs.totalDays = clampedDays;
          parsed = true;
        }
        break;
      }

      case 'learningStyle': {
        const style = parseLearningStyle(message);
        if (style) {
          newInputs.learningStyle = style;
          parsed = true;
        }
        break;
      }

      case 'startDate': {
        const date = parseStartDate(message);
        if (date) {
          newInputs.startDate = date;
          parsed = true;
        }
        break;
      }

      case 'activeDays': {
        const days = parseActiveDays(message);
        if (days) {
          newInputs.activeDays = days;
          parsed = true;
        }
        break;
      }

      case 'reminderPreferences': {
        const prefs = parseReminderPreference(message);
        if (prefs) {
          newInputs.remindersEnabled = prefs.enabled;
          if (prefs.firstHour !== undefined) {
            newInputs.firstReminderHour = prefs.firstHour;
          }
          if (prefs.lastHour !== undefined) {
            newInputs.lastReminderHour = prefs.lastHour;
          }
          parsed = true;
        }
        break;
      }
    }

    // Mark as answered if parsed
    if (parsed && !answeredQuestions.includes(currentQuestion)) {
      answeredQuestions.push(currentQuestion);
    }

    // Determine next question
    const nextQuestion = this.getNextQuestionField(newInputs, answeredQuestions);

    // Determine new stage
    let stage = state.stage;
    if (!nextQuestion && hasRequiredFields(newInputs)) {
      stage = 'confirming';
    }

    return {
      ...state,
      inputs: newInputs,
      currentQuestion: nextQuestion ?? undefined,
      answeredQuestions,
      stage,
      turnCount: state.turnCount + 1,
      updatedAt: now,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GET NEXT QUESTION
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get the next question to ask the user.
   * Returns null if all required questions have been answered.
   */
  getNextQuestion(state: SwordRefinementState): string | null {
    const field = this.getNextQuestionField(state.inputs, state.answeredQuestions);
    if (!field) {
      return null;
    }

    return getQuestionForField(field, state.inputs.extractedTopic);
  }

  /**
   * Get the next field to ask about.
   */
  private getNextQuestionField(
    inputs: SwordRefinementInputs,
    answeredQuestions: readonly RefinementField[]
  ): RefinementField | null {
    // Check required fields first
    for (const field of REQUIRED_REFINEMENT_FIELDS) {
      if (field === 'goalStatement') continue; // Already have this
      if (!answeredQuestions.includes(field) && !this.hasField(inputs, field)) {
        return field;
      }
    }

    // Then optional fields (only ask a subset for brevity)
    const optionalToAsk: RefinementField[] = ['startDate', 'activeDays'];
    for (const field of optionalToAsk) {
      if (!answeredQuestions.includes(field) && !this.hasField(inputs, field)) {
        return field;
      }
    }

    return null;
  }

  /**
   * Check if a field has been filled.
   */
  private hasField(inputs: SwordRefinementInputs, field: RefinementField): boolean {
    switch (field) {
      case 'goalStatement':
        return !!inputs.goalStatement;
      case 'userLevel':
        return !!inputs.userLevel;
      case 'dailyTimeCommitment':
        return typeof inputs.dailyTimeCommitment === 'number';
      case 'totalDuration':
        return !!inputs.totalDuration;
      case 'learningStyle':
        return !!inputs.learningStyle;
      case 'startDate':
        return !!inputs.startDate;
      case 'activeDays':
        return !!inputs.activeDays && inputs.activeDays.length > 0;
      case 'reminderPreferences':
        return typeof inputs.remindersEnabled === 'boolean';
      default:
        return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Extract the main topic from a goal statement.
   */
  private extractTopic(goalStatement: string): string {
    const lower = goalStatement.toLowerCase();

    // Common patterns: "learn X", "study X", "master X"
    const patterns = [
      /(?:learn|study|master|understand|get better at|improve my|teach me)\s+(?:about\s+)?(?:how to\s+)?(.+)/i,
      /(?:i want to|i'd like to|help me)\s+(?:learn|study|master|understand)\s+(?:about\s+)?(?:how to\s+)?(.+)/i,
      /(?:create a plan for|learning plan for)\s+(.+)/i,
    ];

    for (const pattern of patterns) {
      const match = goalStatement.match(pattern);
      if (match) {
        // Clean up the extracted topic
        let topic = match[1].trim();
        // Remove trailing punctuation
        topic = topic.replace(/[.!?]+$/, '');
        // Limit length
        if (topic.length > 50) {
          topic = topic.substring(0, 50);
        }
        return topic;
      }
    }

    // Fallback: use first 50 chars of goal statement
    const cleaned = goalStatement.replace(/^(i want to|i'd like to|help me|please)\s+/i, '');
    return cleaned.substring(0, 50).replace(/[.!?]+$/, '').trim();
  }

  /**
   * Check if refinement has exceeded max turns.
   */
  isMaxTurnsExceeded(state: SwordRefinementState): boolean {
    return state.turnCount >= state.maxTurns;
  }

  /**
   * Check if refinement is complete (all required fields filled).
   */
  isComplete(state: SwordRefinementState): boolean {
    return hasRequiredFields(state.inputs);
  }

  /**
   * Get progress as a percentage (0-100).
   */
  getProgressPercent(state: SwordRefinementState): number {
    return Math.round(calculateRefinementProgress(state.inputs) * 100);
  }

  /**
   * Get missing required fields.
   */
  getMissingFields(state: SwordRefinementState): RefinementField[] {
    return getMissingRequiredFields(state.inputs);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a RefinementFlow instance.
 */
export function createRefinementFlow(config: SwordGateConfig): RefinementFlow {
  return new RefinementFlow(config);
}
