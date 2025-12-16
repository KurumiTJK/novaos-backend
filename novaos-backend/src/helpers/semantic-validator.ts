// ═══════════════════════════════════════════════════════════════════════════════
// SEMANTIC VALIDATOR — Fix C-3
// Detects action recommendations semantically, not just by keywords
// ═══════════════════════════════════════════════════════════════════════════════

import { LinguisticViolation, GenerationConstraints } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface SemanticValidationResult {
  hasActionRecommendation: boolean;
  hasPreciseNumbers: boolean;
  confidence: number; // 0-1
  matchedPatterns: string[];
  violations: LinguisticViolation[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// ACTION RECOMMENDATION DETECTION
// Uses pattern matching + heuristics (production should use classifier)
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Imperative verb patterns that suggest action recommendations.
 * These are stronger signals than just nouns.
 */
const IMPERATIVE_PATTERNS = [
  // Direct imperatives
  /\byou should\s+(?:buy|sell|invest|purchase|acquire|trade|get|consider getting)/i,
  /\bi recommend\s+(?:buying|selling|investing|purchasing|acquiring|trading)/i,
  /\bi suggest\s+(?:buying|selling|investing|purchasing|acquiring|trading)/i,
  /\bconsider\s+(?:buying|selling|investing|purchasing|acquiring|trading)/i,
  
  // Conditional recommendations
  /\bif i were you,?\s+i(?:'d| would)\s+(?:buy|sell|invest)/i,
  /\bthe best (?:option|choice|move) (?:is|would be) to\s+(?:buy|sell|invest)/i,
  
  // Soft recommendations (still actionable)
  /\bit(?:'s| is) (?:a )?(?:good|great|smart|wise) (?:idea|time|opportunity) to\s+(?:buy|sell|invest)/i,
  /\bnow (?:is|would be) (?:a )?(?:good|great) time to\s+(?:buy|sell|invest)/i,
  
  // Allocations and positions
  /\b(?:allocate|put|place|move)\s+(?:your|the)\s+(?:money|funds|capital|savings)/i,
  /\b(?:take|open|close)\s+(?:a|your)\s+(?:position|trade)/i,
  /\b(?:go|be)\s+(?:long|short)\s+(?:on|in)/i,
];

/**
 * Financial action nouns that in imperative context suggest recommendations.
 */
const FINANCIAL_ACTION_NOUNS = [
  'buy order', 'sell order', 'limit order', 'market order',
  'stop loss', 'take profit', 'entry point', 'exit point',
  'position size', 'lot size', 'leverage',
];

/**
 * Phrases that explicitly disclaim recommendations (reduce false positives).
 */
const DISCLAIMER_PATTERNS = [
  /\bi(?:'m| am) not (?:a )?(?:financial|investment) advisor/i,
  /\bthis is not (?:financial|investment) advice/i,
  /\bdo your own research/i,
  /\bconsult (?:a|your) (?:financial|investment) advisor/i,
  /\bi cannot (?:recommend|advise|suggest)/i,
  /\bi(?:'m| am) not able to (?:recommend|advise)/i,
];

/**
 * Detect if text contains action recommendations.
 * Uses pattern matching + heuristics.
 */
export function detectActionRecommendation(text: string): {
  detected: boolean;
  confidence: number;
  patterns: string[];
} {
  const matchedPatterns: string[] = [];
  let score = 0;

  // Check for disclaimer first (reduces false positives)
  let hasDisclaimer = false;
  for (const pattern of DISCLAIMER_PATTERNS) {
    if (pattern.test(text)) {
      hasDisclaimer = true;
      break;
    }
  }

  // Check imperative patterns (high signal)
  for (const pattern of IMPERATIVE_PATTERNS) {
    if (pattern.test(text)) {
      matchedPatterns.push(pattern.source.slice(0, 50));
      score += 0.4;
    }
  }

  // Check financial action nouns (medium signal)
  const textLC = text.toLowerCase();
  for (const noun of FINANCIAL_ACTION_NOUNS) {
    if (textLC.includes(noun)) {
      matchedPatterns.push(`noun: ${noun}`);
      score += 0.15;
    }
  }

  // Check for specific ticker + action combination (high signal)
  const tickerActionPattern = /\b[A-Z]{1,5}\b.{0,30}\b(?:buy|sell|long|short)\b/i;
  if (tickerActionPattern.test(text)) {
    matchedPatterns.push('ticker_action');
    score += 0.3;
  }

  // Reduce score if disclaimer present
  if (hasDisclaimer && score > 0) {
    score *= 0.3; // Significantly reduce confidence
    matchedPatterns.push('has_disclaimer');
  }

  // Cap at 1.0
  const confidence = Math.min(score, 1.0);

  return {
    detected: confidence >= 0.5,
    confidence,
    patterns: matchedPatterns,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// PRECISE NUMBER DETECTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Detect precise financial numbers in text.
 * Returns matches for audit logging.
 */
export function detectPreciseNumbers(text: string): {
  detected: boolean;
  matches: string[];
} {
  const matches: string[] = [];

  // Price patterns
  const pricePattern = /\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g;
  const priceMatches = text.match(pricePattern) || [];
  matches.push(...priceMatches);

  // Percentage patterns (with decimal)
  const percentPattern = /\b\d+\.\d+%/g;
  const percentMatches = text.match(percentPattern) || [];
  matches.push(...percentMatches);

  // Large numbers with decimals (likely financial)
  const largeNumberPattern = /\b\d{1,3}(?:,\d{3})+\.\d{2}\b/g;
  const largeMatches = text.match(largeNumberPattern) || [];
  matches.push(...largeMatches);

  // Stock prices (e.g., "trading at 187.42")
  const tradingAtPattern = /(?:trading at|priced at|worth|valued at)\s*\$?\d+\.\d{2}/gi;
  const tradingMatches = text.match(tradingAtPattern) || [];
  matches.push(...tradingMatches);

  return {
    detected: matches.length > 0,
    matches: [...new Set(matches)], // Deduplicate
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// MAIN SEMANTIC VALIDATOR
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Run semantic validation on generated text.
 * 
 * @param text - Generated text to validate
 * @param constraints - Current generation constraints
 * @returns Validation result with violations
 */
export function validateSemantics(
  text: string,
  constraints: GenerationConstraints
): SemanticValidationResult {
  const violations: LinguisticViolation[] = [];
  const matchedPatterns: string[] = [];

  // Check action recommendations if not allowed
  let hasActionRecommendation = false;
  if (!constraints.actionRecommendationsAllowed) {
    const actionResult = detectActionRecommendation(text);
    hasActionRecommendation = actionResult.detected;
    matchedPatterns.push(...actionResult.patterns);

    if (hasActionRecommendation) {
      violations.push({
        type: 'action_recommendation',
        phrase: actionResult.patterns[0] || 'action detected',
        severity: 'high', // Triggers regeneration
        canSurgicalEdit: false, // Cannot safely edit out recommendations
      });
    }
  }

  // Check precise numbers if not allowed
  let hasPreciseNumbers = false;
  if (!constraints.numericPrecisionAllowed) {
    const numberResult = detectPreciseNumbers(text);
    hasPreciseNumbers = numberResult.detected;
    matchedPatterns.push(...numberResult.matches);

    if (hasPreciseNumbers) {
      violations.push({
        type: 'precise_numbers',
        phrase: numberResult.matches[0] || 'number detected',
        severity: 'high', // Triggers regeneration
        canSurgicalEdit: false, // Cannot safely edit numbers
      });
    }
  }

  return {
    hasActionRecommendation,
    hasPreciseNumbers,
    confidence: violations.length > 0 ? 0.8 : 0.0,
    matchedPatterns,
    violations,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// INTEGRATION WITH PERSONALITY GATE
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Enhanced violation detection that includes semantic analysis.
 * Call this from PersonalityGate.detectViolations().
 */
export function detectViolationsWithSemantics(
  text: string,
  constraints: GenerationConstraints
): LinguisticViolation[] {
  const violations: LinguisticViolation[] = [];

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Keyword-based violations (fast path)
  // ─────────────────────────────────────────────────────────────────────────
  
  // Check banned phrases
  for (const phrase of constraints.bannedPhrases) {
    if (text.toLowerCase().includes(phrase.toLowerCase())) {
      violations.push({
        type: 'banned_phrase',
        phrase,
        severity: 'high',
        canSurgicalEdit: false,
      });
    }
  }

  // Check "we" usage
  const weCount = (text.match(/\bwe\b/gi) || []).length;
  if (weCount > constraints.maxWe) {
    violations.push({
      type: 'excessive_we',
      phrase: `"we" used ${weCount} times (max: ${constraints.maxWe})`,
      severity: 'medium',
      canSurgicalEdit: true,
    });
  }

  // Check dependency language
  const dependencyPatterns = [
    /\bi(?:'m| am) (?:always )?here for you\b/i,
    /\byou can (?:always )?(?:count|rely|depend) on me\b/i,
    /\bi(?:'ll| will) (?:always )?be here\b/i,
    /\bi care (?:about|for) you\b/i,
  ];
  for (const pattern of dependencyPatterns) {
    if (pattern.test(text)) {
      violations.push({
        type: 'dependency_language',
        phrase: pattern.source.slice(0, 40),
        severity: 'high',
        canSurgicalEdit: false,
      });
    }
  }

  // Check emotional manipulation
  const manipulationPatterns = [
    /\bi(?:'m| am) (?:so )?proud of you\b/i,
    /\bgreat job\b/i,
    /\byou(?:'re| are) (?:so )?(?:amazing|wonderful|incredible)\b/i,
  ];
  for (const pattern of manipulationPatterns) {
    // Only flag if no external action preceded it
    if (pattern.test(text) && !text.includes('completed') && !text.includes('finished')) {
      violations.push({
        type: 'emotional_manipulation',
        phrase: pattern.source.slice(0, 40),
        severity: 'medium',
        canSurgicalEdit: true,
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Semantic violations (slower, but catches bypasses)
  // ─────────────────────────────────────────────────────────────────────────
  
  const semanticResult = validateSemantics(text, constraints);
  violations.push(...semanticResult.violations);

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Check mustInclude requirements
  // ─────────────────────────────────────────────────────────────────────────
  
  if (constraints.mustInclude) {
    for (const required of constraints.mustInclude) {
      if (!text.includes(required)) {
        violations.push({
          type: 'missing_required',
          phrase: required,
          severity: 'high',
          canSurgicalEdit: false, // Need to regenerate to include
        });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Check mustNotInclude requirements
  // ─────────────────────────────────────────────────────────────────────────
  
  if (constraints.mustNotInclude) {
    for (const forbidden of constraints.mustNotInclude) {
      if (text.toLowerCase().includes(forbidden.toLowerCase())) {
        violations.push({
          type: 'forbidden_content',
          phrase: forbidden,
          severity: 'high',
          canSurgicalEdit: false,
        });
      }
    }
  }

  return violations;
}
