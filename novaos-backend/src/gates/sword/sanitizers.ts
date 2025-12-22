// ═══════════════════════════════════════════════════════════════════════════════
// GOAL STATEMENT SANITIZER — Input Validation & Injection Protection
// NovaOS Gates — Phase 13: SwordGate Integration
// ═══════════════════════════════════════════════════════════════════════════════
//
// Sanitizes and validates goal statements before processing:
//   - Prompt injection detection and neutralization
//   - Unicode normalization and homoglyph protection
//   - Length validation and truncation
//   - Profanity/inappropriate content filtering
//   - Topic extraction and validation
//
// Security principles:
//   - Never trust user input
//   - Fail closed on suspicious content
//   - Normalize before comparison
//   - Log all rejections for analysis
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { SwordGateConfig } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Result of sanitization.
 */
export interface SanitizationResult {
  /** Whether the input is valid */
  readonly valid: boolean;

  /** Sanitized goal statement (if valid) */
  readonly sanitized?: string;

  /** Extracted topic (if valid) */
  readonly topic?: string;

  /** Rejection reason (if invalid) */
  readonly rejectionReason?: SanitizationRejectionReason;

  /** Human-readable error message */
  readonly errorMessage?: string;

  /** Warnings that don't block but should be noted */
  readonly warnings: readonly string[];

  /** Whether content was modified during sanitization */
  readonly wasModified: boolean;

  /** Original length before truncation */
  readonly originalLength: number;
}

/**
 * Reasons for rejection.
 */
export type SanitizationRejectionReason =
  | 'empty_input'
  | 'too_short'
  | 'too_long'
  | 'injection_detected'
  | 'unicode_attack'
  | 'inappropriate_content'
  | 'no_learning_intent'
  | 'invalid_characters';

// ═══════════════════════════════════════════════════════════════════════════════
// INJECTION DETECTION PATTERNS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Patterns that indicate prompt injection attempts.
 * These are checked after normalization.
 */
const INJECTION_PATTERNS: readonly RegExp[] = [
  // Direct instruction overrides
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /forget\s+(everything|all|what)\s+(you|i)\s+(told|said)/i,

  // Role manipulation
  /you\s+are\s+(now|no longer)\s+(a|an)/i,
  /pretend\s+(to\s+be|you'?re)/i,
  /act\s+as\s+(if|though|a|an)/i,
  /roleplay\s+as/i,
  /from\s+now\s+on\s+you/i,

  // System prompt extraction
  /what\s+(is|are)\s+your\s+(instructions?|prompts?|rules?|system)/i,
  /show\s+(me\s+)?(your|the)\s+(system|initial)\s+prompt/i,
  /reveal\s+(your|the)\s+(system|hidden)/i,
  /print\s+(your|the)\s+(instructions?|prompts?)/i,

  // Jailbreak attempts
  /\bdan\s+mode\b/i,
  /\bdeveloper\s+mode\b/i,
  /\bjailbreak\b/i,
  /\bunlock\s+(your|full)\s+(potential|capabilities)/i,
  /\bbypass\s+(safety|restrictions|filters)/i,

  // Code execution attempts
  /```\s*(python|javascript|bash|sh|exec)/i,
  /eval\s*\(/i,
  /exec\s*\(/i,
  /__import__/i,
  /subprocess\./i,
  /os\.system/i,

  // XML/JSON injection
  /<\/?system>/i,
  /<\/?user>/i,
  /<\/?assistant>/i,
  /<\/?prompt>/i,
  /"\s*:\s*"\s*}/i, // JSON injection pattern

  // Delimiter confusion
  /={3,}/,
  /-{5,}/,
  /#{3,}\s*(system|prompt|instruction)/i,

  // Token manipulation
  /<\|.*\|>/i, // Token-like patterns
  /\[\[.*\]\]/i, // Double bracket patterns
  /\{\{.*\}\}/i, // Template patterns
];

/**
 * Less severe patterns that warrant warnings.
 */
const WARNING_PATTERNS: readonly { pattern: RegExp; message: string }[] = [
  { pattern: /\bplease\s+don'?t\b/i, message: 'Contains negative instruction' },
  { pattern: /\bsecret(ly)?\b/i, message: 'Contains "secret" keyword' },
  { pattern: /\bhack(ing)?\b/i, message: 'Contains "hack" keyword' },
  { pattern: /\bexploit\b/i, message: 'Contains "exploit" keyword' },
];

// ═══════════════════════════════════════════════════════════════════════════════
// UNICODE ATTACK PATTERNS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Unicode categories to reject or normalize.
 */
const UNICODE_ATTACKS = {
  // Right-to-left override and other direction controls
  RTL_OVERRIDES: /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g,

  // Zero-width characters (can hide content)
  ZERO_WIDTH: /[\u200B-\u200D\uFEFF\u00AD]/g,

  // Homoglyphs for common ASCII (Cyrillic, Greek that look like Latin)
  CYRILLIC_LOOKALIKES: /[\u0400-\u04FF]/g,

  // Combining characters (can be used to obfuscate)
  EXCESSIVE_COMBINING: /[\u0300-\u036F]{3,}/g,

  // Private use area
  PRIVATE_USE: /[\uE000-\uF8FF\uDB80-\uDBFF][\uDC00-\uDFFF]?/g,

  // Control characters (except newline, tab)
  CONTROL_CHARS: /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,
};

// ═══════════════════════════════════════════════════════════════════════════════
// INAPPROPRIATE CONTENT PATTERNS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Content that should not be in learning goals.
 * Kept minimal to avoid over-blocking legitimate content.
 */
const INAPPROPRIATE_PATTERNS: readonly RegExp[] = [
  // Illegal activities
  /\b(how\s+to\s+)?(make|build|create)\s+(a\s+)?(bomb|explosive|weapon)/i,
  /\b(hack|break\s+into)\s+(someone'?s?|a)\s+(account|computer|system)/i,
  /\b(steal|forge)\s+(identity|credit\s+card|password)/i,

  // Harmful content
  /\b(how\s+to\s+)?(hurt|harm|kill)\s+(myself|yourself|someone)/i,
  /\bself[- ]?harm\b/i,
  /\bsuicide\s+method/i,

  // Child safety
  /\bchild\s+(porn|abuse|exploitation)/i,
  /\bminor\s+(porn|abuse|exploitation)/i,
];

// ═══════════════════════════════════════════════════════════════════════════════
// LEARNING INTENT VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Patterns that indicate legitimate learning intent.
 * At least one should match for a valid goal statement.
 */
const LEARNING_INTENT_PATTERNS: readonly RegExp[] = [
  /\b(learn|study|master|understand|practice|improve|develop|get\s+better)\b/i,
  /\b(teach|help)\s+me\b/i,
  /\b(how\s+to|tutorial|guide|course|lesson|training)\b/i,
  /\b(skill|knowledge|proficiency|expertise|competency)\b/i,
  /\b(beginner|intermediate|advanced)\s+(in|at|level)/i,
  /\b(start|begin|introduction)\s+(to|with|learning)/i,
];

// ═══════════════════════════════════════════════════════════════════════════════
// SANITIZER CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sanitizes and validates goal statements.
 */
export class GoalStatementSanitizer {
  private readonly config: SwordGateConfig;
  private readonly minLength: number = 5;

  constructor(config: SwordGateConfig) {
    this.config = config;
  }

  /**
   * Sanitize and validate a goal statement.
   */
  sanitize(input: string): SanitizationResult {
    const originalLength = input.length;
    const warnings: string[] = [];
    let wasModified = false;

    // ─────────────────────────────────────────────────────────────────────────
    // Step 1: Basic validation
    // ─────────────────────────────────────────────────────────────────────────
    if (!input || typeof input !== 'string') {
      return this.reject('empty_input', 'Please provide a learning goal', originalLength);
    }

    let text = input.trim();
    if (text !== input) {
      wasModified = true;
    }

    if (text.length === 0) {
      return this.reject('empty_input', 'Please provide a learning goal', originalLength);
    }

    if (text.length < this.minLength) {
      return this.reject(
        'too_short',
        `Goal statement is too short (minimum ${this.minLength} characters)`,
        originalLength
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 2: Unicode normalization and attack detection
    // ─────────────────────────────────────────────────────────────────────────
    const unicodeResult = this.sanitizeUnicode(text);
    if (!unicodeResult.valid) {
      return this.reject('unicode_attack', unicodeResult.reason!, originalLength);
    }
    if (unicodeResult.sanitized !== text) {
      wasModified = true;
    }
    text = unicodeResult.sanitized;

    // ─────────────────────────────────────────────────────────────────────────
    // Step 3: Control character removal
    // ─────────────────────────────────────────────────────────────────────────
    const cleanedControl = text.replace(UNICODE_ATTACKS.CONTROL_CHARS, '');
    if (cleanedControl !== text) {
      wasModified = true;
      text = cleanedControl;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 4: Length check and truncation
    // ─────────────────────────────────────────────────────────────────────────
    if (text.length > this.config.maxGoalStatementLength) {
      text = text.substring(0, this.config.maxGoalStatementLength);
      wasModified = true;
      warnings.push(`Truncated to ${this.config.maxGoalStatementLength} characters`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 5: Injection detection
    // ─────────────────────────────────────────────────────────────────────────
    const injectionCheck = this.detectInjection(text);
    if (injectionCheck.detected) {
      console.warn('[SANITIZER] Injection attempt detected:', {
        pattern: injectionCheck.pattern,
        input: text.substring(0, 100),
      });
      return this.reject(
        'injection_detected',
        'Your goal contains patterns that cannot be processed. Please rephrase.',
        originalLength
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 6: Warning patterns
    // ─────────────────────────────────────────────────────────────────────────
    for (const { pattern, message } of WARNING_PATTERNS) {
      if (pattern.test(text)) {
        warnings.push(message);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 7: Inappropriate content check
    // ─────────────────────────────────────────────────────────────────────────
    if (this.containsInappropriateContent(text)) {
      console.warn('[SANITIZER] Inappropriate content detected:', {
        input: text.substring(0, 100),
      });
      return this.reject(
        'inappropriate_content',
        'This type of content cannot be used as a learning goal.',
        originalLength
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 8: Learning intent validation
    // ─────────────────────────────────────────────────────────────────────────
    if (!this.hasLearningIntent(text)) {
      // Soft fail - add as warning but still allow
      warnings.push('No clear learning intent detected - goal may need refinement');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 9: Extract topic
    // ─────────────────────────────────────────────────────────────────────────
    const topic = this.extractTopic(text);

    // ─────────────────────────────────────────────────────────────────────────
    // Step 10: Final normalization
    // ─────────────────────────────────────────────────────────────────────────
    const sanitized = this.normalize(text);
    if (sanitized !== text) {
      wasModified = true;
    }

    return {
      valid: true,
      sanitized,
      topic,
      warnings,
      wasModified,
      originalLength,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a rejection result.
   */
  private reject(
    reason: SanitizationRejectionReason,
    message: string,
    originalLength: number
  ): SanitizationResult {
    return {
      valid: false,
      rejectionReason: reason,
      errorMessage: message,
      warnings: [],
      wasModified: false,
      originalLength,
    };
  }

  /**
   * Sanitize Unicode and detect attacks.
   */
  private sanitizeUnicode(text: string): { valid: boolean; sanitized: string; reason?: string } {
    // Normalize to NFC form first
    let normalized = text.normalize('NFC');

    // Check for RTL override attacks
    if (UNICODE_ATTACKS.RTL_OVERRIDES.test(normalized)) {
      return { valid: false, sanitized: '', reason: 'Text contains direction override characters' };
    }

    // Remove zero-width characters
    normalized = normalized.replace(UNICODE_ATTACKS.ZERO_WIDTH, '');

    // Check for excessive Cyrillic (potential homoglyph attack)
    const cyrillicMatches = normalized.match(UNICODE_ATTACKS.CYRILLIC_LOOKALIKES) || [];
    const latinCount = (normalized.match(/[a-zA-Z]/g) || []).length;
    if (cyrillicMatches.length > 0 && latinCount > 0) {
      // Mixed scripts - potential homoglyph attack
      const ratio = cyrillicMatches.length / (cyrillicMatches.length + latinCount);
      if (ratio > 0.1 && ratio < 0.9) {
        return { valid: false, sanitized: '', reason: 'Text contains suspicious mixed scripts' };
      }
    }

    // Remove excessive combining characters
    normalized = normalized.replace(UNICODE_ATTACKS.EXCESSIVE_COMBINING, '');

    // Remove private use area characters
    normalized = normalized.replace(UNICODE_ATTACKS.PRIVATE_USE, '');

    return { valid: true, sanitized: normalized };
  }

  /**
   * Detect injection attempts.
   */
  private detectInjection(text: string): { detected: boolean; pattern?: string } {
    const normalized = text.toLowerCase();

    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(normalized)) {
        return { detected: true, pattern: pattern.source };
      }
    }

    return { detected: false };
  }

  /**
   * Check for inappropriate content.
   */
  private containsInappropriateContent(text: string): boolean {
    const normalized = text.toLowerCase();

    for (const pattern of INAPPROPRIATE_PATTERNS) {
      if (pattern.test(normalized)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check for learning intent.
   */
  private hasLearningIntent(text: string): boolean {
    const normalized = text.toLowerCase();

    for (const pattern of LEARNING_INTENT_PATTERNS) {
      if (pattern.test(normalized)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Extract the main topic from the goal statement.
   */
  private extractTopic(text: string): string {
    const patterns = [
      /(?:learn|study|master|understand)\s+(?:about\s+)?(?:how\s+to\s+)?(.+?)(?:\.|$)/i,
      /(?:teach|help)\s+me\s+(?:about\s+)?(?:how\s+to\s+)?(.+?)(?:\.|$)/i,
      /(?:get\s+better\s+at|improve\s+(?:my\s+)?)\s*(.+?)(?:\.|$)/i,
      /(?:become\s+(?:a\s+)?(?:proficient|expert)\s+(?:in|at)\s*)(.+?)(?:\.|$)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1].trim().substring(0, 100);
      }
    }

    // Fallback: clean and return first 100 chars
    return text
      .replace(/^(i\s+want\s+to|i'?d\s+like\s+to|please|help\s+me)\s+/i, '')
      .trim()
      .substring(0, 100);
  }

  /**
   * Final normalization pass.
   */
  private normalize(text: string): string {
    return text
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      // Remove leading/trailing whitespace
      .trim()
      // Ensure proper capitalization (first letter uppercase)
      .replace(/^./, (c) => c.toUpperCase());
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a GoalStatementSanitizer instance.
 */
export function createGoalStatementSanitizer(config: SwordGateConfig): GoalStatementSanitizer {
  return new GoalStatementSanitizer(config);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STANDALONE FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Quick sanitization with default config.
 */
export function sanitizeGoalStatement(
  input: string,
  maxLength: number = 500
): SanitizationResult {
  const config: SwordGateConfig = {
    maxGoalStatementLength: maxLength,
    maxGoalsPerUser: 10,
    maxActiveGoals: 3,
    maxRefinementTurns: 10,
    refinementTtlSeconds: 3600,
    minDailyMinutes: 5,
    maxDailyMinutes: 480,
    minTotalDays: 3,
    maxTotalDays: 365,
    useLlmModeDetection: false,
    llmModel: 'gpt-4o-mini',
  };

  return new GoalStatementSanitizer(config).sanitize(input);
}
