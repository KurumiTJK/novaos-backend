// ═══════════════════════════════════════════════════════════════════════════════
// LENS OVERRIDES — Deterministic Post-Classification Logic
// Applied after LLM classification to enforce hard rules
// ═══════════════════════════════════════════════════════════════════════════════

import type { LensClassification, RiskFactor } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TIME-SENSITIVE PATTERNS
// ─────────────────────────────────────────────────────────────────────────────────

const TIME_SENSITIVE_PATTERNS = /\b(just now|breaking|today|right now|this morning|this afternoon|live|happening)\b/i;

// ─────────────────────────────────────────────────────────────────────────────────
// FORCE HIGH DOMAIN PATTERNS
// ─────────────────────────────────────────────────────────────────────────────────

const FORCE_HIGH_DOMAIN_PATTERNS = [
  /\b(drug|medication|medicine|prescription|dosage|side effect|interaction)\b/i,
  /\b(diagnosis|symptom|treatment|therapy|disease|condition|surgery)\b/i,
  /\b(lawsuit|court|legal|attorney|lawyer|sue|regulation|statute)\b/i,
  /\b(invest|trading|stock|portfolio|retirement|401k|savings|financial)\b/i,
  /\b(safety|hazard|danger|emergency|poison|toxic)\b/i,
];

// ─────────────────────────────────────────────────────────────────────────────────
// DECISION PRESSURE PATTERNS
// ─────────────────────────────────────────────────────────────────────────────────

const DECISION_PRESSURE_PATTERNS = [
  /\bshould I\b/i,
  /\bis it (safe|okay|ok|good|bad|wise|smart) to\b/i,
  /\bcan I (safely|take|use|do)\b/i,
  /\bam I (allowed|permitted|able) to\b/i,
  /\bwill (it|this) (hurt|harm|damage|affect)\b/i,
];

// ─────────────────────────────────────────────────────────────────────────────────
// APPLY OVERRIDES
// ─────────────────────────────────────────────────────────────────────────────────

export function applyDeterministicOverrides(
  classification: LensClassification,
  message: string
): LensClassification {
  const c = { ...classification };
  const riskFactors = new Set(c.riskFactors);

  // ─── OVERRIDE 1: Recency request → webHelpful=true ───
  if (c.hasRecencyRequest && !c.isTimelessTopic) {
    c.webHelpful = true;
  }

  // ─── OVERRIDE 2: forceHigh conditions → webHelpful=true ───
  if (c.forceHigh) {
    c.webHelpful = true;
  }

  // ─── OVERRIDE 3: Time-sensitive claim → forceHigh=true ───
  if (TIME_SENSITIVE_PATTERNS.test(message) && riskFactors.has('recent_events')) {
    c.forceHigh = true;
    c.webHelpful = true;
    if (!riskFactors.has('time_sensitive_claim')) {
      riskFactors.add('time_sensitive_claim');
    }
  }

  // ─── OVERRIDE 4: Force HIGH domain detection ───
  if (FORCE_HIGH_DOMAIN_PATTERNS.some(p => p.test(message))) {
    c.forceHigh = true;
    c.webHelpful = true;
    if (!riskFactors.has('high_stakes')) {
      riskFactors.add('high_stakes');
    }
    // Ensure risk score is at least 0.8
    if (c.riskScore < 0.8) {
      c.riskScore = 0.8;
    }
  }

  // ─── OVERRIDE 5: Decision pressure → forceHigh=true ───
  if (DECISION_PRESSURE_PATTERNS.some(p => p.test(message))) {
    // Only force high if already webHelpful or has risk factors
    if (c.webHelpful || riskFactors.size > 0) {
      c.forceHigh = true;
      if (!riskFactors.has('high_stakes')) {
        riskFactors.add('high_stakes');
      }
    }
  }

  // ─── OVERRIDE 6: Breaking news → forceHigh=true ───
  if (/\b(breaking|breaking news|just announced|just reported)\b/i.test(message)) {
    c.forceHigh = true;
    c.webHelpful = true;
    if (!riskFactors.has('breaking_news')) {
      riskFactors.add('breaking_news');
    }
    c.riskScore = Math.max(c.riskScore, 0.95);
  }

  // ─── OVERRIDE 7: Volatile data → boost risk score ───
  if (riskFactors.has('volatile_data')) {
    c.riskScore = Math.max(c.riskScore, 0.85);
  }

  // ─── OVERRIDE 8: Specific numbers in volatile context ───
  if (riskFactors.has('specific_numbers') && riskFactors.has('volatile_data')) {
    c.forceHigh = true;
  }

  // Update risk factors
  c.riskFactors = Array.from(riskFactors);

  return c;
}

// ─────────────────────────────────────────────────────────────────────────────────
// DETECT DOMAIN FOR BACKWARDS COMPATIBILITY
// ─────────────────────────────────────────────────────────────────────────────────

export function detectDomain(message: string): string | undefined {
  const lower = message.toLowerCase();

  const domainPatterns: Array<{ pattern: RegExp; domain: string }> = [
    { pattern: /\b(stock|share|trading|market|invest)\b.*\b(price|worth|value)\b/i, domain: 'stock_prices' },
    { pattern: /\b(bitcoin|crypto|ethereum|btc|eth)\b.*\b(price|worth|value)\b/i, domain: 'crypto' },
    { pattern: /\b(weather|forecast|temperature|rain)\b/i, domain: 'weather' },
    { pattern: /\b(legal|law|court|attorney|regulation)\b/i, domain: 'legal' },
    { pattern: /\b(health|medical|doctor|symptom|treatment)\b/i, domain: 'health' },
    { pattern: /\b(finance|budget|savings|retirement)\b/i, domain: 'finance' },
  ];

  for (const { pattern, domain } of domainPatterns) {
    if (pattern.test(lower)) {
      return domain;
    }
  }

  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────────
// DETECT STAKES LEVEL
// ─────────────────────────────────────────────────────────────────────────────────

export function detectStakes(
  classification: LensClassification,
  domain?: string
): 'low' | 'medium' | 'high' | 'critical' {
  // Critical: health/legal with forceHigh
  if (classification.forceHigh) {
    if (domain === 'health' || domain === 'legal') {
      return 'critical';
    }
    return 'high';
  }

  // High stakes domains
  if (['health', 'legal', 'finance', 'stock_prices', 'crypto'].includes(domain ?? '')) {
    return 'high';
  }

  // Based on risk score
  if (classification.riskScore >= 0.8) return 'high';
  if (classification.riskScore >= 0.5) return 'medium';

  return 'low';
}
