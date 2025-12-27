// ═══════════════════════════════════════════════════════════════════════════════
// VOLATILITY DETECTOR — Topic Freshness Assessment
// NovaOS Gates — Phase 14B: SwordGate Refine Expansion
// ═══════════════════════════════════════════════════════════════════════════════
//
// Assesses how quickly a topic changes to determine if web search is needed:
//   - Pattern-based detection for known volatile keywords
//   - LLM-based detection for nuanced assessment
//   - Hybrid approach combining both methods
//
// Volatility categories:
//   - tool_specific: "React 18", "Python 3.12" — version-locked
//   - version_sensitive: "latest API", "current syntax" — explicit recency
//   - regulatory: "tax law", "GDPR" — legal/compliance
//   - platform_dependent: "AWS", "Azure" — cloud platforms
//   - certification: "PMP", "AWS SA" — exam content
//   - research_frontier: "AI alignment", "quantum" — rapid advancement
//   - market_dynamic: "crypto", "stocks" — financial
//   - best_practices: "security", "performance" — evolving standards
//   - security_threat: "vulnerability", "CVE" — urgent updates
//   - api_dependent: "OpenAI API", "Stripe API" — third-party
//
// ═══════════════════════════════════════════════════════════════════════════════

import OpenAI from 'openai';
import { createTimestamp } from '../../../types/branded.js';
import type { Timestamp } from '../../../types/branded.js';
import type { AsyncAppResult } from '../../../types/result.js';
import { ok, err, appError } from '../../../types/result.js';

import type {
  VolatilityAssessment,
  VolatilitySignal,
  VolatilityCategory,
  VolatilityThresholds,
  RefineModuleConfig,
} from './types.js';
import {
  DEFAULT_VOLATILITY_THRESHOLDS,
  createStableVolatilityAssessment,
  createHighVolatilityAssessment,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// VOLATILITY PATTERNS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Pattern definition for volatility detection.
 */
interface VolatilityPattern {
  readonly pattern: RegExp;
  readonly category: VolatilityCategory;
  readonly weight: number;
  readonly reason: string;
}

/**
 * High volatility patterns — topics that change frequently.
 */
const HIGH_VOLATILITY_PATTERNS: readonly VolatilityPattern[] = [
  // Tool/Framework specific with versions
  {
    pattern: /\b(react|vue|angular|svelte|next\.?js|nuxt)\s*\d+/i,
    category: 'tool_specific',
    weight: 0.8,
    reason: 'Frontend framework with version - APIs change between versions',
  },
  {
    pattern: /\b(node\.?js|deno|bun)\s*\d+/i,
    category: 'tool_specific',
    weight: 0.7,
    reason: 'JavaScript runtime with version',
  },
  {
    pattern: /\b(python|ruby|php|java|kotlin|swift)\s*\d+(\.\d+)?/i,
    category: 'tool_specific',
    weight: 0.6,
    reason: 'Programming language with specific version',
  },
  {
    pattern: /\b(tensorflow|pytorch|keras|jax)\s*\d*/i,
    category: 'tool_specific',
    weight: 0.85,
    reason: 'ML framework - rapidly evolving APIs',
  },

  // Version sensitive keywords
  {
    pattern: /\b(latest|newest|current|modern|updated?|recent)\s+(version|release|api|syntax|features?)/i,
    category: 'version_sensitive',
    weight: 0.9,
    reason: 'Explicitly requesting current information',
  },
  {
    pattern: /\b(new|upcoming|beta|preview|experimental)\s+(features?|api|syntax)/i,
    category: 'version_sensitive',
    weight: 0.85,
    reason: 'Requesting cutting-edge features',
  },
  {
    pattern: /\b(deprecated|legacy|old)\s+(api|syntax|method|approach)/i,
    category: 'version_sensitive',
    weight: 0.8,
    reason: 'Concern about deprecation',
  },

  // Platform dependent
  {
    pattern: /\b(aws|amazon\s+web\s+services|azure|gcp|google\s+cloud)\b/i,
    category: 'platform_dependent',
    weight: 0.75,
    reason: 'Cloud platform - services change frequently',
  },
  {
    pattern: /\b(kubernetes|k8s|docker|terraform|ansible)\b/i,
    category: 'platform_dependent',
    weight: 0.7,
    reason: 'DevOps/infrastructure tool',
  },
  {
    pattern: /\b(vercel|netlify|heroku|railway|fly\.io)\b/i,
    category: 'platform_dependent',
    weight: 0.65,
    reason: 'Deployment platform',
  },

  // API dependent
  {
    pattern: /\b(openai|anthropic|claude|gpt|chatgpt|gemini|llama)\s*(api)?/i,
    category: 'api_dependent',
    weight: 0.9,
    reason: 'AI/LLM API - rapidly evolving',
  },
  {
    pattern: /\b(stripe|twilio|sendgrid|auth0|firebase)\s*(api|sdk)?/i,
    category: 'api_dependent',
    weight: 0.7,
    reason: 'Third-party API integration',
  },
  {
    pattern: /\b(rest\s*api|graphql|grpc)\s+(design|best\s+practices)/i,
    category: 'api_dependent',
    weight: 0.6,
    reason: 'API design patterns evolve',
  },

  // Certification
  {
    pattern: /\b(aws\s+(certified|certification)|azure\s+cert|gcp\s+cert)/i,
    category: 'certification',
    weight: 0.85,
    reason: 'Cloud certification - exams updated regularly',
  },
  {
    pattern: /\b(pmp|scrum\s+master|cissp|cka|ckad)\s*(exam|certification)?/i,
    category: 'certification',
    weight: 0.8,
    reason: 'Professional certification',
  },

  // Research frontier
  {
    pattern: /\b(ai\s+safety|alignment|rlhf|constitutional\s+ai)/i,
    category: 'research_frontier',
    weight: 0.95,
    reason: 'AI safety research - rapidly evolving field',
  },
  {
    pattern: /\b(quantum\s+computing|quantum\s+machine\s+learning)/i,
    category: 'research_frontier',
    weight: 0.9,
    reason: 'Quantum computing - emerging field',
  },
  {
    pattern: /\b(llm|large\s+language\s+model|foundation\s+model|transformer)/i,
    category: 'research_frontier',
    weight: 0.85,
    reason: 'LLM/AI research - very active area',
  },
  {
    pattern: /\b(prompt\s+engineering|fine[\s-]?tuning|rag|retrieval[\s-]augmented)/i,
    category: 'research_frontier',
    weight: 0.85,
    reason: 'LLM techniques - best practices evolving',
  },

  // Security
  {
    pattern: /\b(security|vulnerability|cve|exploit|penetration\s+testing)/i,
    category: 'security_threat',
    weight: 0.9,
    reason: 'Security - threats evolve constantly',
  },
  {
    pattern: /\b(owasp|security\s+best\s+practices|secure\s+coding)/i,
    category: 'security_threat',
    weight: 0.8,
    reason: 'Security standards update regularly',
  },

  // Regulatory
  {
    pattern: /\b(gdpr|ccpa|hipaa|sox|pci[\s-]?dss)\b/i,
    category: 'regulatory',
    weight: 0.75,
    reason: 'Compliance regulation - updates and interpretations',
  },
  {
    pattern: /\b(tax\s+(law|code|regulation)|accounting\s+standards)/i,
    category: 'regulatory',
    weight: 0.85,
    reason: 'Tax/accounting - annual changes',
  },

  // Market dynamic
  {
    pattern: /\b(crypto|cryptocurrency|bitcoin|ethereum|defi|nft|web3)\b/i,
    category: 'market_dynamic',
    weight: 0.95,
    reason: 'Cryptocurrency - extremely volatile',
  },
  {
    pattern: /\b(trading|stock\s+market|forex|options\s+trading)/i,
    category: 'market_dynamic',
    weight: 0.85,
    reason: 'Financial markets - dynamic',
  },

  // Best practices
  {
    pattern: /\b(best\s+practices|design\s+patterns|clean\s+code|architecture)/i,
    category: 'best_practices',
    weight: 0.5,
    reason: 'Best practices evolve over time',
  },
  {
    pattern: /\b(performance\s+optimization|scalability|microservices)/i,
    category: 'best_practices',
    weight: 0.55,
    reason: 'Performance approaches evolve',
  },
];

/**
 * Low volatility patterns — stable topics.
 */
const LOW_VOLATILITY_PATTERNS: readonly VolatilityPattern[] = [
  // Foundational CS
  {
    pattern: /\b(algorithms?|data\s+structures?|big[\s-]?o|complexity)/i,
    category: 'stable',
    weight: -0.6,
    reason: 'Fundamental CS - stable for decades',
  },
  {
    pattern: /\b(discrete\s+math|linear\s+algebra|calculus|statistics)/i,
    category: 'stable',
    weight: -0.7,
    reason: 'Mathematics - very stable',
  },
  {
    pattern: /\b(operating\s+systems?|computer\s+architecture|networking\s+fundamentals)/i,
    category: 'stable',
    weight: -0.5,
    reason: 'Core CS concepts - stable',
  },

  // Stable languages (fundamentals)
  {
    pattern: /\b(c\s+programming|assembly|fortran)\b/i,
    category: 'stable',
    weight: -0.6,
    reason: 'Stable language fundamentals',
  },
  {
    pattern: /\b(sql\s+basics|relational\s+database|normalization)/i,
    category: 'stable',
    weight: -0.5,
    reason: 'SQL fundamentals - very stable',
  },

  // General programming concepts
  {
    pattern: /\b(oop|object[\s-]oriented|functional\s+programming|recursion)/i,
    category: 'stable',
    weight: -0.5,
    reason: 'Programming paradigms - stable concepts',
  },
  {
    pattern: /\b(debugging|testing\s+fundamentals|code\s+review)/i,
    category: 'stable',
    weight: -0.4,
    reason: 'Core development practices',
  },

  // Design fundamentals
  {
    pattern: /\b(color\s+theory|typography|composition|ui\s+principles)/i,
    category: 'stable',
    weight: -0.5,
    reason: 'Design fundamentals - stable',
  },

  // Soft skills
  {
    pattern: /\b(communication|leadership|teamwork|problem[\s-]solving)/i,
    category: 'stable',
    weight: -0.6,
    reason: 'Soft skills - timeless',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// LLM CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

const VOLATILITY_DETECTION_PROMPT = `You are assessing the volatility of a learning topic - how quickly the content changes and whether web search is needed for freshness.

VOLATILITY CATEGORIES:
- tool_specific: Version-locked content (React 18, Python 3.12)
- version_sensitive: Explicit recency needs (latest API, current syntax)
- regulatory: Legal/compliance (GDPR, tax law)
- platform_dependent: Cloud/infrastructure (AWS, Kubernetes)
- certification: Exam content (AWS cert, PMP)
- research_frontier: Rapidly advancing (AI alignment, quantum)
- market_dynamic: Financial/market (crypto, trading)
- best_practices: Evolving standards (security, performance)
- security_threat: Security concerns (vulnerabilities, CVEs)
- api_dependent: Third-party APIs (OpenAI API, Stripe)
- stable: Foundational, rarely changes (algorithms, math)

OUTPUT FORMAT (JSON only, no markdown):
{
  "score": 0.0-1.0,
  "needsFreshness": true/false,
  "signals": [
    {"signal": "detected pattern", "weight": -1.0 to 1.0, "category": "category", "reason": "explanation"}
  ],
  "reasoning": "overall explanation",
  "suggestedSearchTopics": ["topic1", "topic2"]
}

SCORING GUIDELINES:
- 0.0-0.3: Very stable (math, algorithms, fundamentals)
- 0.3-0.5: Mostly stable (core programming, design principles)
- 0.5-0.7: Moderate volatility (best practices, some frameworks)
- 0.7-0.9: High volatility (cloud platforms, APIs, certifications)
- 0.9-1.0: Extreme volatility (AI/ML, crypto, security threats)

needsFreshness should be true if score > 0.6

EXAMPLES:

Topic: "Learn calculus"
{"score":0.1,"needsFreshness":false,"signals":[{"signal":"mathematics","weight":-0.7,"category":"stable","reason":"Math fundamentals unchanged for centuries"}],"reasoning":"Calculus is a stable mathematical foundation","suggestedSearchTopics":[]}

Topic: "Learn React 18 hooks"
{"score":0.85,"needsFreshness":true,"signals":[{"signal":"React 18","weight":0.8,"category":"tool_specific","reason":"Version-specific framework features"},{"signal":"hooks","weight":0.5,"category":"best_practices","reason":"Hook patterns evolving"}],"reasoning":"React 18 is recent with evolving best practices","suggestedSearchTopics":["React 18 hooks best practices 2024","useEffect vs useLayoutEffect React 18"]}

Now assess this topic:`;

/**
 * LLM volatility classification result.
 */
interface LlmVolatilityResult {
  score: number;
  needsFreshness: boolean;
  signals: VolatilitySignal[];
  reasoning: string;
  suggestedSearchTopics: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// VOLATILITY DETECTOR CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detects topic volatility to determine if web search is needed.
 */
export class VolatilityDetector {
  private openai: OpenAI | null = null;
  private readonly thresholds: VolatilityThresholds;
  private readonly useLlm: boolean;
  private readonly llmModel: string;

  constructor(
    openaiApiKey?: string,
    config?: Partial<{
      thresholds: VolatilityThresholds;
      useLlm: boolean;
      llmModel: string;
    }>
  ) {
    this.thresholds = config?.thresholds ?? DEFAULT_VOLATILITY_THRESHOLDS;
    this.useLlm = config?.useLlm ?? true;
    this.llmModel = config?.llmModel ?? 'gpt-4o-mini';

    const key = openaiApiKey ?? process.env.OPENAI_API_KEY;
    if (key && this.useLlm) {
      this.openai = new OpenAI({ apiKey: key });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN DETECTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Assess volatility of a topic.
   *
   * Uses tiered approach:
   * 1. Pattern-based detection for known patterns
   * 2. LLM for nuanced assessment if patterns inconclusive
   * 3. Hybrid combination when both available
   */
  async assess(
    topic: string,
    additionalContext?: string
  ): AsyncAppResult<VolatilityAssessment> {
    const timestamp = createTimestamp();
    const fullText = additionalContext ? `${topic} ${additionalContext}` : topic;

    try {
      // Step 1: Pattern-based detection
      const patternResult = this.assessWithPatterns(fullText);

      // If pattern detection is highly confident, use it
      if (patternResult.confidence === 'high') {
        return ok({
          ...patternResult,
          assessedAt: timestamp,
        });
      }

      // Step 2: LLM assessment if available and patterns inconclusive
      if (this.openai && this.useLlm) {
        const llmResult = await this.assessWithLlm(topic, additionalContext);

        if (llmResult) {
          // Combine pattern and LLM results
          const combined = this.combineResults(patternResult, llmResult, timestamp);
          return ok(combined);
        }
      }

      // Fall back to pattern result
      return ok({
        ...patternResult,
        assessedAt: timestamp,
      });
    } catch (error) {
      console.error('[VOLATILITY_DETECTOR] Assessment error:', error);
      // Return a safe default on error
      return ok(createStableVolatilityAssessment(timestamp));
    }
  }

  /**
   * Quick pattern-only assessment (no LLM).
   */
  assessSync(topic: string, additionalContext?: string): VolatilityAssessment {
    const timestamp = createTimestamp();
    const fullText = additionalContext ? `${topic} ${additionalContext}` : topic;
    const result = this.assessWithPatterns(fullText);
    return { ...result, assessedAt: timestamp };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PATTERN-BASED DETECTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Assess using pattern matching.
   */
  private assessWithPatterns(text: string): Omit<VolatilityAssessment, 'assessedAt'> {
    const signals: VolatilitySignal[] = [];

    // Check high volatility patterns
    for (const pattern of HIGH_VOLATILITY_PATTERNS) {
      const match = text.match(pattern.pattern);
      if (match) {
        signals.push({
          signal: match[0],
          weight: pattern.weight,
          category: pattern.category,
          reason: pattern.reason,
        });
      }
    }

    // Check low volatility patterns
    for (const pattern of LOW_VOLATILITY_PATTERNS) {
      const match = text.match(pattern.pattern);
      if (match) {
        signals.push({
          signal: match[0],
          weight: pattern.weight,
          category: pattern.category,
          reason: pattern.reason,
        });
      }
    }

    // Calculate score
    if (signals.length === 0) {
      // No signals - moderate uncertainty
      return {
        score: 0.4,
        needsFreshness: false,
        signals: [],
        confidence: 'low',
        method: 'pattern',
        reasoning: 'No volatility signals detected - assuming moderate stability',
      };
    }

    // Weighted average of signals
    const totalWeight = signals.reduce((sum, s) => sum + Math.abs(s.weight), 0);
    const weightedSum = signals.reduce((sum, s) => sum + s.weight * Math.abs(s.weight), 0);
    const rawScore = (weightedSum / totalWeight + 1) / 2; // Normalize to 0-1
    const score = Math.max(0, Math.min(1, rawScore));

    // Determine confidence based on signal strength
    const maxWeight = Math.max(...signals.map(s => Math.abs(s.weight)));
    const confidence = maxWeight >= 0.7 ? 'high' : maxWeight >= 0.5 ? 'medium' : 'low';

    // Generate suggested search topics for high volatility
    const suggestedSearchTopics = score > this.thresholds.searchTrigger
      ? this.generateSearchTopics(text, signals)
      : undefined;

    return {
      score,
      needsFreshness: score > this.thresholds.searchTrigger,
      signals,
      confidence,
      method: 'pattern',
      reasoning: this.generateReasoning(signals, score),
      suggestedSearchTopics,
    };
  }

  /**
   * Generate suggested search topics based on signals.
   */
  private generateSearchTopics(text: string, signals: VolatilitySignal[]): string[] {
    const topics: string[] = [];
    const currentYear = new Date().getFullYear();

    // Extract main topic
    const mainTopic = text
      .replace(/\b(learn|study|master|understand|teach me)\b/gi, '')
      .trim()
      .substring(0, 50);

    // Add version-specific searches
    if (signals.some(s => s.category === 'tool_specific' || s.category === 'version_sensitive')) {
      topics.push(`${mainTopic} ${currentYear} changes`);
      topics.push(`${mainTopic} latest best practices`);
    }

    // Add deprecation searches
    if (signals.some(s => s.category === 'api_dependent' || s.category === 'platform_dependent')) {
      topics.push(`${mainTopic} deprecation ${currentYear}`);
      topics.push(`${mainTopic} migration guide`);
    }

    // Add security searches
    if (signals.some(s => s.category === 'security_threat')) {
      topics.push(`${mainTopic} security vulnerabilities ${currentYear}`);
    }

    // Add certification searches
    if (signals.some(s => s.category === 'certification')) {
      topics.push(`${mainTopic} exam updates ${currentYear}`);
    }

    return topics.slice(0, 3); // Limit to 3 suggestions
  }

  /**
   * Generate human-readable reasoning.
   */
  private generateReasoning(signals: VolatilitySignal[], score: number): string {
    if (signals.length === 0) {
      return 'No specific volatility indicators found';
    }

    const categories = [...new Set(signals.map(s => s.category))];
    const highVolatile = signals.filter(s => s.weight > 0.5);
    const stable = signals.filter(s => s.weight < -0.3);

    if (score > 0.7) {
      return `High volatility due to: ${categories.join(', ')}. Web search recommended for current information.`;
    } else if (score > 0.5) {
      return `Moderate volatility with signals: ${categories.join(', ')}. Some content may need freshness verification.`;
    } else if (score > 0.3) {
      return `Mostly stable with some evolving aspects: ${categories.join(', ')}.`;
    } else {
      return `Stable topic. ${stable.map(s => s.reason).join('. ')}.`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LLM-BASED DETECTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Assess using LLM.
   */
  private async assessWithLlm(
    topic: string,
    additionalContext?: string
  ): Promise<LlmVolatilityResult | null> {
    if (!this.openai) {
      return null;
    }

    try {
      const userMessage = additionalContext
        ? `Topic: "${topic}"\nAdditional context: ${additionalContext}`
        : `Topic: "${topic}"`;

      const response = await this.openai.chat.completions.create({
        model: this.llmModel,
        messages: [
          { role: 'system', content: VOLATILITY_DETECTION_PROMPT },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 500,
        temperature: 0.1,
      });

      const content = response.choices[0]?.message?.content?.trim() ?? '';
      return this.parseLlmResult(content);
    } catch (error) {
      console.error('[VOLATILITY_DETECTOR] LLM assessment error:', error);
      return null;
    }
  }

  /**
   * Parse LLM response.
   */
  private parseLlmResult(content: string): LlmVolatilityResult | null {
    try {
      // Handle potential markdown code blocks
      let jsonStr = content;
      if (content.includes('```')) {
        const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        jsonStr = match?.[1]?.trim() ?? content;
      }

      const parsed = JSON.parse(jsonStr.trim());

      // Validate and normalize
      return {
        score: Math.max(0, Math.min(1, Number(parsed.score) || 0.5)),
        needsFreshness: Boolean(parsed.needsFreshness),
        signals: Array.isArray(parsed.signals)
          ? parsed.signals.map((s: any) => ({
              signal: String(s.signal || ''),
              weight: Math.max(-1, Math.min(1, Number(s.weight) || 0)),
              category: String(s.category || 'stable') as VolatilityCategory,
              reason: String(s.reason || ''),
            }))
          : [],
        reasoning: String(parsed.reasoning || ''),
        suggestedSearchTopics: Array.isArray(parsed.suggestedSearchTopics)
          ? parsed.suggestedSearchTopics.map(String)
          : [],
      };
    } catch {
      console.warn('[VOLATILITY_DETECTOR] Failed to parse LLM response:', content);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RESULT COMBINATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Combine pattern and LLM results.
   */
  private combineResults(
    patternResult: Omit<VolatilityAssessment, 'assessedAt'>,
    llmResult: LlmVolatilityResult,
    timestamp: Timestamp
  ): VolatilityAssessment {
    // Weight: 30% pattern, 70% LLM (LLM is more nuanced)
    const combinedScore = patternResult.score * 0.3 + llmResult.score * 0.7;

    // Merge signals (deduplicate by category)
    const seenCategories = new Set<string>();
    const mergedSignals: VolatilitySignal[] = [];

    // Prefer LLM signals
    for (const signal of llmResult.signals) {
      if (!seenCategories.has(signal.category)) {
        mergedSignals.push(signal);
        seenCategories.add(signal.category);
      }
    }

    // Add pattern signals for unseen categories
    for (const signal of patternResult.signals) {
      if (!seenCategories.has(signal.category)) {
        mergedSignals.push(signal);
        seenCategories.add(signal.category);
      }
    }

    // Combine search topics
    const searchTopics = [
      ...(llmResult.suggestedSearchTopics || []),
      ...(patternResult.suggestedSearchTopics || []),
    ].slice(0, 5);

    return {
      score: combinedScore,
      needsFreshness: combinedScore > this.thresholds.searchTrigger,
      signals: mergedSignals,
      confidence: 'high', // Hybrid is most confident
      method: 'hybrid',
      reasoning: llmResult.reasoning || patternResult.reasoning,
      suggestedSearchTopics: searchTopics.length > 0 ? searchTopics : undefined,
      assessedAt: timestamp,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if a score indicates web search should be triggered.
   */
  shouldTriggerSearch(assessment: VolatilityAssessment): boolean {
    return assessment.score > this.thresholds.searchTrigger;
  }

  /**
   * Check if a score indicates shorter plan segments should be used.
   */
  shouldUseShortSegments(assessment: VolatilityAssessment): boolean {
    return assessment.score > this.thresholds.shortSegmentTrigger;
  }

  /**
   * Get category description for display.
   */
  getCategoryDescription(category: VolatilityCategory): string {
    const descriptions: Record<VolatilityCategory, string> = {
      tool_specific: 'Tool/framework with version-specific content',
      version_sensitive: 'Content that explicitly requires current information',
      regulatory: 'Legal or compliance-related content',
      platform_dependent: 'Cloud or infrastructure platform',
      certification: 'Professional certification or exam content',
      research_frontier: 'Rapidly advancing research area',
      market_dynamic: 'Financial or market-related content',
      best_practices: 'Evolving industry standards',
      security_threat: 'Security-related content',
      api_dependent: 'Third-party API integration',
      stable: 'Foundational content that rarely changes',
    };
    return descriptions[category] || 'Unknown category';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a VolatilityDetector instance.
 */
export function createVolatilityDetector(
  openaiApiKey?: string,
  config?: Partial<{
    thresholds: VolatilityThresholds;
    useLlm: boolean;
    llmModel: string;
  }>
): VolatilityDetector {
  return new VolatilityDetector(openaiApiKey, config);
}
