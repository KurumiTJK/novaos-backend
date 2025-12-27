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

import { createTimestamp } from '../../../types/branded.js';
import type { UserId, Timestamp } from '../../../types/branded.js';
import type { UserLevel, LearningStyle, DayOfWeek, ALL_DAYS } from '../../../services/spark-engine/types.js';

import type {
  SwordRefinementState,
  SwordRefinementInputs,
  SwordUserPreferences,
  SwordGateConfig,
  RefinementField,
} from '../types.js';
import {
  REQUIRED_REFINEMENT_FIELDS,
  OPTIONAL_REFINEMENT_FIELDS,
  hasRequiredFields,
  getMissingRequiredFields,
  calculateRefinementProgress,
} from '../types.js';

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
 * Converts bare verbs to gerund form for better grammar.
 * "sing" → "singing", "cook" → "cooking"
 */
function getQuestionForField(field: RefinementField, topic?: string): string {
  const templates = QUESTION_TEMPLATES[field];
  if (!templates || templates.length === 0) {
    return `Please provide your ${field}.`;
  }
  const template = templates[Math.floor(Math.random() * templates.length)]!;
  
  // Convert bare verbs to gerund form for natural grammar
  // "How familiar are you with sing?" → "How familiar are you with singing?"
  const topicForQuestion = toGerundIfVerb(topic ?? 'this topic');
  
  return template.replace('{topic}', topicForQuestion);
}

/**
 * Convert bare verbs to gerund form (-ing) for natural grammar in questions.
 * "sing" → "singing", "cook" → "cooking"
 * Leaves noun-based topics unchanged: "rust" → "rust", "python" → "python"
 */
function toGerundIfVerb(topic: string): string {
  const normalized = topic.toLowerCase().trim();
  
  // Common bare verbs that sound wrong without -ing in "familiar with X"
  const verbToGerund: Record<string, string> = {
    'sing': 'singing',
    'cook': 'cooking',
    'code': 'coding',
    'draw': 'drawing',
    'paint': 'painting',
    'write': 'writing',
    'read': 'reading',
    'swim': 'swimming',
    'dance': 'dancing',
    'run': 'running',
    'skate': 'skating',
    'ski': 'skiing',
    'surf': 'surfing',
    'drive': 'driving',
    'bake': 'baking',
    'sew': 'sewing',
    'knit': 'knitting',
    'garden': 'gardening',
    'fish': 'fishing',
    'hunt': 'hunting',
    'meditate': 'meditating',
    'negotiate': 'negotiating',
    'present': 'presenting',
    'lead': 'leading',
    'manage': 'managing',
    'play': 'playing',
    'fly': 'flying',
  };
  
  return verbToGerund[normalized] ?? topic;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RESPONSE PARSERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parse user level from response.
 * 
 * ✅ FIX: Use word boundaries (\b) instead of start anchors (^)
 * to match phrases like "i'm a beginner" and "i am new to this".
 */
function parseUserLevel(response: string): UserLevel | null {
  const lower = response.toLowerCase().trim();

  // ─── BEGINNER PATTERNS ───
  // Word boundary patterns for beginner
  if (/\b(beginner|novice)\b/i.test(lower)) {
    return 'beginner';
  }
  // "I'm new", "I am new", "completely new", "totally new"
  if (/\b(i'?m|i am|completely|totally|very|brand)?\s*new\b/i.test(lower)) {
    return 'beginner';
  }
  // "just starting", "no experience", "never used"
  if (/\b(just start|no experience|none|zero experience)\b/i.test(lower)) {
    return 'beginner';
  }
  // Contextual patterns
  if (/never (used|tried|learned|done)|first time|starting from scratch/i.test(lower)) {
    return 'beginner';
  }
  // Direct "no" or "none" as standalone answer
  if (/^(no|none|nope|zero)$/i.test(lower)) {
    return 'beginner';
  }

  // ─── INTERMEDIATE PATTERNS ───
  // Word boundary patterns for intermediate
  if (/\b(intermediate|familiar)\b/i.test(lower)) {
    return 'intermediate';
  }
  // "some experience", "a little experience", "bit of experience"
  if (/\b(some|a little|a bit of|basic)\s*(experience|knowledge|background)\b/i.test(lower)) {
    return 'intermediate';
  }
  // "know the basics", "not new"
  if (/\b(know (the )?basics|not new|used (it )?before|worked with)\b/i.test(lower)) {
    return 'intermediate';
  }

  // ─── ADVANCED PATTERNS ───
  // Word boundary patterns for advanced
  if (/\b(advanced|expert|proficient|experienced|very familiar)\b/i.test(lower)) {
    return 'advanced';
  }
  // Professional experience
  if (/years of experience|professional|work with (it )?daily/i.test(lower)) {
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
    const minutes = parseInt(minuteMatch[1]!, 10);
    if (minutes >= 1 && minutes <= 480) {
      return minutes;
    }
  }

  const hourMatch = lower.match(/(\d+(?:\.\d+)?)\s*(hour|hr|h\b)/i);
  if (hourMatch) {
    const hours = parseFloat(hourMatch[1]!);
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
    const num = parseInt(bareNumber[1]!, 10);
    if (num <= 120) return num; // Assume minutes
    if (num <= 8) return num * 60; // Assume hours
  }

  return null;
}

/**
 * Convert word numbers to digits.
 */
function wordToNumber(word: string): number | null {
  const map: Record<string, number> = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'eleven': 11, 'twelve': 12,
  };
  return map[word.toLowerCase()] ?? null;
}

/**
 * Parse total duration from response.
 * Returns parsed duration string and estimated days.
 * 
 * ✅ FIX: Handle word numbers ("one week", "two months") and be more flexible with patterns.
 */
function parseTotalDuration(response: string): { duration: string; days: number } | null {
  const lower = response.toLowerCase().trim();

  // ─── WEEK PATTERNS ───
  // Digit + week: "4 weeks", "1 week"
  const weekDigitMatch = lower.match(/(\d+)\s*(week|wk)s?/i);
  if (weekDigitMatch) {
    const weeks = parseInt(weekDigitMatch[1]!, 10);
    if (weeks >= 1 && weeks <= 52) {
      return { duration: `${weeks} week${weeks > 1 ? 's' : ''}`, days: weeks * 7 };
    }
  }
  
  // Word number + week: "one week", "two weeks", "three weeks"
  const weekWordMatch = lower.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(week|wk)s?\b/i);
  if (weekWordMatch) {
    const weeks = wordToNumber(weekWordMatch[1]!);
    if (weeks && weeks >= 1 && weeks <= 52) {
      return { duration: `${weeks} week${weeks > 1 ? 's' : ''}`, days: weeks * 7 };
    }
  }
  
  // "a week", "the week"
  if (/\b(a|one)\s*week\b/i.test(lower)) {
    return { duration: '1 week', days: 7 };
  }
  
  // "couple of weeks", "couple weeks"
  if (/couple\s*(of\s*)?weeks?/i.test(lower)) {
    return { duration: '2 weeks', days: 14 };
  }
  
  // "few weeks"
  if (/\bfew\s*weeks?\b/i.test(lower)) {
    return { duration: '3 weeks', days: 21 };
  }

  // ─── MONTH PATTERNS ───
  // Digit + month: "2 months", "1 month"
  const monthDigitMatch = lower.match(/(\d+)\s*(month|mo)s?/i);
  if (monthDigitMatch) {
    const months = parseInt(monthDigitMatch[1]!, 10);
    if (months >= 1 && months <= 12) {
      return { duration: `${months} month${months > 1 ? 's' : ''}`, days: months * 30 };
    }
  }
  
  // Word number + month: "one month", "two months"
  const monthWordMatch = lower.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(month|mo)s?\b/i);
  if (monthWordMatch) {
    const months = wordToNumber(monthWordMatch[1]!);
    if (months && months >= 1 && months <= 12) {
      return { duration: `${months} month${months > 1 ? 's' : ''}`, days: months * 30 };
    }
  }
  
  // "a month", "one month"
  if (/\b(a|one)\s*month\b/i.test(lower)) {
    return { duration: '1 month', days: 30 };
  }
  
  // "couple of months"
  if (/couple\s*(of\s*)?months?/i.test(lower)) {
    return { duration: '2 months', days: 60 };
  }
  
  // "few months"
  if (/\bfew\s*months?\b/i.test(lower)) {
    return { duration: '3 months', days: 90 };
  }

  // ─── DAY PATTERNS ───
  // Digit + day: "30 days", "14 days"
  const dayMatch = lower.match(/(\d+)\s*(day|d\b)s?/i);
  if (dayMatch) {
    const days = parseInt(dayMatch[1]!, 10);
    if (days >= 3 && days <= 365) {
      return { duration: `${days} days`, days };
    }
  }
  
  // "few days"
  if (/\bfew\s*days?\b/i.test(lower)) {
    return { duration: '5 days', days: 5 };
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

  // "next monday", "next week"
  const nextWeekMatch = lower.match(/next\s+(week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);
  if (nextWeekMatch) {
    const target = nextWeekMatch[1]!.toLowerCase();
    if (target === 'week') {
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);
      return formatDate(nextWeek);
    }
    // Find next occurrence of day
    const dayMap: Record<string, number> = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
      thursday: 4, friday: 5, saturday: 6,
    };
    const targetDay = dayMap[target];
    if (targetDay !== undefined) {
      const currentDay = today.getDay();
      let daysUntil = targetDay - currentDay;
      if (daysUntil <= 0) daysUntil += 7;
      const nextDay = new Date(today);
      nextDay.setDate(nextDay.getDate() + daysUntil);
      return formatDate(nextDay);
    }
  }

  // ISO date format (YYYY-MM-DD)
  const isoMatch = lower.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return isoMatch[0]!;
  }

  // Common date formats
  const dateMatch = lower.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
  if (dateMatch) {
    const month = parseInt(dateMatch[1]!, 10);
    const day = parseInt(dateMatch[2]!, 10);
    let year = dateMatch[3] ? parseInt(dateMatch[3], 10) : today.getFullYear();
    if (year < 100) year += 2000;
    
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    }
  }

  return null;
}

/**
 * Format date as YYYY-MM-DD.
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse active days from response.
 */
function parseActiveDays(response: string): DayOfWeek[] | null {
  const lower = response.toLowerCase().trim();

  // "every day", "daily"
  if (/^every\s*day|^daily|^all\s*days/i.test(lower)) {
    return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  }

  // "weekdays"
  if (/^weekdays|^week\s*days|^monday\s*(-|to|through)\s*friday/i.test(lower)) {
    return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  }

  // "weekends"
  if (/^weekends?/i.test(lower)) {
    return ['saturday', 'sunday'];
  }

  // Specific days
  const dayMap: Record<string, DayOfWeek> = {
    'mon': 'monday', 'monday': 'monday',
    'tue': 'tuesday', 'tues': 'tuesday', 'tuesday': 'tuesday',
    'wed': 'wednesday', 'wednesday': 'wednesday',
    'thu': 'thursday', 'thur': 'thursday', 'thurs': 'thursday', 'thursday': 'thursday',
    'fri': 'friday', 'friday': 'friday',
    'sat': 'saturday', 'saturday': 'saturday',
    'sun': 'sunday', 'sunday': 'sunday',
  };

  const foundDays: DayOfWeek[] = [];
  for (const [abbr, day] of Object.entries(dayMap)) {
    if (lower.includes(abbr) && !foundDays.includes(day)) {
      foundDays.push(day);
    }
  }

  if (foundDays.length > 0) {
    return foundDays;
  }

  return null;
}

/**
 * Parse reminder preferences from response.
 */
function parseReminderPreference(response: string): { enabled: boolean; firstHour?: number; lastHour?: number } | null {
  const lower = response.toLowerCase().trim();

  // Negative responses
  if (/^no|^nope|^don'?t|^skip|^none|^not now/i.test(lower)) {
    return { enabled: false };
  }

  // Positive responses
  if (/^yes|^yeah|^sure|^please|^ok|^enable|^set up/i.test(lower)) {
    // Check for time preferences
    const morningMatch = lower.match(/morning|(\d{1,2})\s*(am|a\.m\.)/i);
    const eveningMatch = lower.match(/evening|(\d{1,2})\s*(pm|p\.m\.)/i);

    let firstHour: number | undefined;
    let lastHour: number | undefined;

    if (morningMatch) {
      firstHour = morningMatch[1] ? parseInt(morningMatch[1], 10) : 9;
    }
    if (eveningMatch) {
      lastHour = eveningMatch[1] ? parseInt(eveningMatch[1], 10) + 12 : 18;
    }

    return { enabled: true, firstHour, lastHour };
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// REFINEMENT FLOW CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Manages the multi-turn refinement flow for goal creation.
 */
export class RefinementFlow {
  private readonly config: SwordGateConfig;

  constructor(config: SwordGateConfig) {
    this.config = config;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // INITIATE REFINEMENT
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Start a new refinement session from a goal statement.
   * ✅ FIX: Added optional userPreferences parameter to pre-fill inputs
   */
  initiate(userId: UserId, goalStatement: string, userPreferences?: SwordUserPreferences): SwordRefinementState {
    const now = createTimestamp();
    const expiresAt = createTimestamp(
      new Date(Date.now() + this.config.refinementTtlSeconds * 1000)
    );

    const extractedTopic = this.extractTopic(goalStatement);

    // ✅ FIX: Pre-fill inputs from user preferences
    // Use mutable object then cast to readonly
    const mutableInputs: {
      goalStatement: string;
      extractedTopic?: string;
      learningStyle?: string;
      dailyTimeCommitment?: number;
    } = {
      goalStatement,
      extractedTopic,
    };

    // Apply user preferences if provided
    if (userPreferences) {
      if (userPreferences.defaultLearningStyle) {
        mutableInputs.learningStyle = userPreferences.defaultLearningStyle;
      }
      if (userPreferences.defaultDailyMinutes) {
        mutableInputs.dailyTimeCommitment = userPreferences.defaultDailyMinutes;
      }
    }

    const inputs = mutableInputs as SwordRefinementInputs;

    return {
      userId,
      stage: 'clarifying',
      inputs,
      currentQuestion: 'userLevel',
      answeredQuestions: ['goalStatement'],
      turnCount: 0,
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
   * Process a user response during refinement.
   */
  processResponse(state: SwordRefinementState, message: string): SwordRefinementState {
    const now = createTimestamp();
    const currentQuestion = state.currentQuestion;

    if (!currentQuestion) {
      // No current question, return unchanged
      return { ...state, updatedAt: now };
    }

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
      if (match && match[1]) {
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
