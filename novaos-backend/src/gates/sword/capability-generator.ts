// ═══════════════════════════════════════════════════════════════════════════════
// CAPABILITY GENERATOR — Dynamic Competence + Agency Progressions
// NovaOS Gates — Phase 14: SwordGate
// ═══════════════════════════════════════════════════════════════════════════════
//
// Generates capability-based learning progressions for ANY topic using LLM.
//
// The Universal 5-Stage Competence Model:
//   1. REPRODUCE — Create basic outcome unaided
//   2. MODIFY    — Change it under constraints
//   3. DIAGNOSE  — Find and fix failures
//   4. DESIGN    — Build independently from requirements
//   5. SHIP      — Deploy and defend decisions
//
// THE AGENCY LAYER (What Makes This Different)
// ─────────────────────────────────────────────
// Every stage includes a DECISION POINT — a moment of judgment where:
//   - Multiple options are plausible
//   - Each has real tradeoffs (not strawmen)
//   - There is NO correct answer
//   - The learner must CHOOSE and DEFEND
//
// The diagnostic:
//   If a learner never says "I chose this because the alternatives were worse,"
//   the plan isn't robust yet.
//
// This is what separates:
//   training (compliance) → thinking (agency)
//   execution → adaptation
//   following rails → owning consequences
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { AsyncAppResult } from '../../types/result.js';
import { ok, err, appError } from '../../types/result.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Tradeoff severity — determines visibility.
 * 
 * - 'info': Subtle mention, learner probably already considered it
 * - 'caution': Worth noting, easy to overlook
 * - 'warning': Significant tradeoff, could derail progress if ignored
 */
export type TradeoffSeverity = 'info' | 'caution' | 'warning';

/**
 * A consideration — what the learner gains and trades off by pursuing this stage.
 * 
 * NOT a menu of choices. Instead:
 * - Surfaces what they're implicitly gaining
 * - Warns about what they're implicitly trading off
 * - Only demands attention when severity is 'warning'
 * 
 * Think of it as the Shield role: protect from blind spots without being annoying.
 */
export interface Consideration {
  /** What the learner gains by completing this stage */
  gaining: string;
  
  /** What the learner is trading off or deferring */
  tradingOff: string;
  
  /** How significant is this tradeoff? */
  severity: TradeoffSeverity;
  
  /** 
   * Only shown if severity is 'warning'.
   * A prompt to make the learner consciously acknowledge the tradeoff.
   */
  checkpoint?: string;
}

/**
 * A single stage in the capability-based progression.
 * 
 * Now includes CONSIDERATION — a tradeoff-aware layer that:
 * - Shows what you're gaining vs trading off
 * - Only becomes prominent when there's a significant risk
 * - Lets the learner decide if the tradeoff is acceptable for their situation
 */
export interface CapabilityStage {
  /** Short title (2-5 words) */
  title: string;
  
  /** What the learner CAN DO after (verb-based, verifiable) */
  capability: string;
  
  /** Inspectable, falsifiable output that proves competence */
  artifact: string;
  
  /** Specific mistake to make and recover from */
  designedFailure: string;
  
  /** Apply skill in new context without scaffolding */
  transfer: string;
  
  /** Subtopics for resource discovery */
  topics: string[];
  
  /**
   * CONSIDERATION — The tradeoff awareness layer.
   * 
   * Not a forced choice. Instead:
   * - "By doing this, you're gaining X"
   * - "You're trading off Y"
   * - If Y is significant: "Is that acceptable for your situation?"
   * 
   * Only demands attention when the tradeoff could cause real problems.
   */
  consideration: Consideration;
}

/**
 * User level affects the depth and complexity of generated stages.
 */
export type UserLevel = 'beginner' | 'intermediate' | 'advanced';

/**
 * Configuration for capability generation.
 */
export interface CapabilityGeneratorConfig {
  /** OpenAI API key */
  openaiApiKey?: string;
  /** Model to use (default: gpt-4o-mini) */
  model?: string;
  /** Cache TTL in seconds (default: 3600 = 1 hour) */
  cacheTtlSeconds?: number;
  /** Maximum retries on failure */
  maxRetries?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LLM PROMPTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build the system prompt for capability generation.
 */
function buildSystemPrompt(): string {
  return `You are an expert instructional designer who creates learning progressions with built-in tradeoff awareness.

Your job is to generate a 5-stage learning path that:
1. Develops real capability (what learners CAN DO)
2. Surfaces what they're gaining AND trading off at each stage
3. Warns them when a tradeoff is significant enough to matter

THE CONSIDERATION LAYER (Key Innovation)
Each stage should surface:
- What the learner GAINS by completing this stage
- What they're TRADING OFF or deferring
- How significant the tradeoff is (info/caution/warning)
- If 'warning': a checkpoint question to make them consciously decide

This is NOT a menu of choices. It's awareness of implicit tradeoffs.

Think of it as a Shield: protect from blind spots without being annoying.
- 'info': Already obvious, just noting it
- 'caution': Easy to overlook, worth mentioning
- 'warning': Could derail progress if ignored, needs conscious acknowledgment

SEVERITY GUIDELINES:
- 'info': The tradeoff is minor or temporary (e.g., "trading off speed for understanding")
- 'caution': The tradeoff could cause friction later (e.g., "skipping tests now means debugging later")
- 'warning': The tradeoff could fundamentally undermine the goal (e.g., "building without security basics")

The 5 stages:
1. REPRODUCE: Create basic outcome unaided
2. MODIFY: Adapt existing work under constraints
3. DIAGNOSE: Find and fix failures systematically
4. DESIGN: Build from requirements, not instructions
5. SHIP: Deploy to users and handle feedback

OUTPUT FORMAT (JSON array with exactly 5 objects):
{
  "title": "Short title (2-5 words)",
  "capability": "What the learner can DO (verb-based, verifiable)",
  "artifact": "Inspectable output that proves competence (must be falsifiable)",
  "designedFailure": "Specific mistake to make and recover from",
  "transfer": "Apply skill in different context without scaffolding",
  "topics": ["subtopic1", "subtopic2", "subtopic3"],
  "consideration": {
    "gaining": "What completing this stage provides",
    "tradingOff": "What is deferred, skipped, or sacrificed",
    "severity": "info" | "caution" | "warning",
    "checkpoint": "Only if severity is 'warning': Question to confirm tradeoff is acceptable"
  }
}

QUALITY CRITERIA:
- Capabilities must be VERIFIABLE
- Artifacts must be FALSIFIABLE
- Tradeoffs must be REAL (not theoretical)
- Severity must be HONEST (don't inflate to 'warning' for minor things)
- Checkpoints only for genuine risks`;
}

/**
 * Build the user prompt for a specific topic.
 */
function buildUserPrompt(topic: string, level: UserLevel, durationDays: number): string {
  const levelContext = {
    beginner: 'Complete beginner with no prior experience.',
    intermediate: 'Some familiarity, building solid foundations.',
    advanced: 'Has experience, filling gaps toward mastery.',
  };

  return `Generate a 5-stage capability progression with tradeoff awareness for:

TOPIC: ${topic}
LEVEL: ${level} — ${levelContext[level]}
DURATION: ${durationDays} days (~${Math.ceil(durationDays / 5)} days per stage)

For each stage, include a "consideration" that surfaces:
1. What the learner GAINS by completing this stage
2. What they're TRADING OFF (deferring, skipping, or sacrificing)
3. Severity: 'info' (minor), 'caution' (worth noting), or 'warning' (could cause problems)
4. If 'warning': a checkpoint question to confirm the tradeoff is acceptable

SEVERITY GUIDELINES:
- 'info': Tradeoff is obvious or temporary
- 'caution': Easy to overlook, could cause friction later
- 'warning': Could fundamentally undermine the learning goal if ignored

Be honest about severity. Most stages should be 'info' or 'caution'.
Only use 'warning' when skipping something could genuinely derail the learner.

Return ONLY the JSON array. No markdown. No explanation.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAPABILITY GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generates capability-based learning progressions dynamically using LLM.
 * 
 * Key innovation: Every stage includes a DECISION POINT that forces
 * the learner to make judgment calls under uncertainty.
 */
export class CapabilityGenerator {
  private readonly config: Required<CapabilityGeneratorConfig>;
  private readonly cache: Map<string, { stages: CapabilityStage[]; expiresAt: number }>;

  constructor(config: CapabilityGeneratorConfig = {}) {
    this.config = {
      openaiApiKey: config.openaiApiKey ?? process.env.OPENAI_API_KEY ?? '',
      model: config.model ?? 'gpt-4o-mini',
      cacheTtlSeconds: config.cacheTtlSeconds ?? 3600,
      maxRetries: config.maxRetries ?? 2,
    };
    this.cache = new Map();
  }

  /**
   * Generate capability-based progression for any topic.
   */
  async generate(
    topic: string,
    level: UserLevel = 'beginner',
    durationDays: number = 30
  ): AsyncAppResult<readonly CapabilityStage[]> {
    const normalizedTopic = this.normalizeTopic(topic);
    const cacheKey = `${normalizedTopic}:${level}:${durationDays}`;

    console.log(`[CAPABILITY_GEN] Generating progression for: "${normalizedTopic}" (${level}, ${durationDays} days)`);

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      console.log(`[CAPABILITY_GEN] Cache hit for: "${normalizedTopic}"`);
      return ok(cached.stages);
    }

    // Generate via LLM
    const result = await this.generateViaLLM(normalizedTopic, level, durationDays);
    
    if (result.ok) {
      this.cache.set(cacheKey, {
        stages: result.value as CapabilityStage[],
        expiresAt: Date.now() + this.config.cacheTtlSeconds * 1000,
      });
      console.log(`[CAPABILITY_GEN] Generated ${result.value.length} stages with tradeoff considerations`);
    }

    return result;
  }

  /**
   * Generate progression via OpenAI API.
   */
  private async generateViaLLM(
    topic: string,
    level: UserLevel,
    durationDays: number
  ): AsyncAppResult<readonly CapabilityStage[]> {
    if (!this.config.openaiApiKey) {
      console.warn('[CAPABILITY_GEN] No OpenAI API key, using fallback generation');
      return ok(this.generateFallback(topic, level, durationDays));
    }

    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(topic, level, durationDays);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.openaiApiKey}`,
          },
          body: JSON.stringify({
            model: this.config.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.7,
            max_tokens: 4000,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json() as {
          choices: Array<{ message: { content: string } }>;
        };

        const content = data.choices[0]?.message?.content;
        if (!content) {
          throw new Error('Empty response from OpenAI');
        }

        const stages = this.parseResponse(content);
        const validated = this.validateStages(stages);
        
        if (!validated.ok) {
          throw new Error(validated.error.message);
        }

        return ok(validated.value);

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`[CAPABILITY_GEN] Attempt ${attempt + 1} failed:`, lastError.message);
        
        if (attempt < this.config.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
        }
      }
    }

    console.warn('[CAPABILITY_GEN] All LLM attempts failed, using fallback');
    return ok(this.generateFallback(topic, level, durationDays));
  }

  /**
   * Parse LLM response into stages.
   */
  private parseResponse(content: string): unknown[] {
    let cleaned = content.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    return JSON.parse(cleaned.trim());
  }

  /**
   * Validate parsed stages including considerations.
   */
  private validateStages(stages: unknown[]): { ok: true; value: CapabilityStage[] } | { ok: false; error: { message: string } } {
    if (!Array.isArray(stages)) {
      return { ok: false, error: { message: 'Response is not an array' } };
    }

    if (stages.length !== 5) {
      return { ok: false, error: { message: `Expected 5 stages, got ${stages.length}` } };
    }

    const validated: CapabilityStage[] = [];

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i] as Record<string, unknown>;
      
      // Validate basic fields
      if (typeof stage.title !== 'string' || !stage.title) {
        return { ok: false, error: { message: `Stage ${i + 1}: missing title` } };
      }
      if (typeof stage.capability !== 'string' || !stage.capability) {
        return { ok: false, error: { message: `Stage ${i + 1}: missing capability` } };
      }
      if (typeof stage.artifact !== 'string' || !stage.artifact) {
        return { ok: false, error: { message: `Stage ${i + 1}: missing artifact` } };
      }
      if (typeof stage.designedFailure !== 'string' || !stage.designedFailure) {
        return { ok: false, error: { message: `Stage ${i + 1}: missing designedFailure` } };
      }
      if (typeof stage.transfer !== 'string' || !stage.transfer) {
        return { ok: false, error: { message: `Stage ${i + 1}: missing transfer` } };
      }
      if (!Array.isArray(stage.topics) || stage.topics.length === 0) {
        return { ok: false, error: { message: `Stage ${i + 1}: missing or empty topics` } };
      }

      // Validate or generate consideration
      const cons = stage.consideration as Record<string, unknown> | undefined;
      let consideration: Consideration;
      
      if (!cons || typeof cons !== 'object') {
        consideration = this.getUniversalConsideration(i);
      } else {
        if (typeof cons.gaining !== 'string' || !cons.gaining) {
          return { ok: false, error: { message: `Stage ${i + 1}: consideration missing 'gaining'` } };
        }
        if (typeof cons.tradingOff !== 'string' || !cons.tradingOff) {
          return { ok: false, error: { message: `Stage ${i + 1}: consideration missing 'tradingOff'` } };
        }
        
        // Validate severity
        const severity = cons.severity as string;
        if (!['info', 'caution', 'warning'].includes(severity)) {
          // Default to 'info' if invalid
          console.warn(`[CAPABILITY_GEN] Stage ${i + 1}: invalid severity '${severity}', defaulting to 'info'`);
        }
        
        const validSeverity: TradeoffSeverity = 
          severity === 'warning' ? 'warning' :
          severity === 'caution' ? 'caution' : 'info';

        consideration = {
          gaining: cons.gaining as string,
          tradingOff: cons.tradingOff as string,
          severity: validSeverity,
          checkpoint: validSeverity === 'warning' && typeof cons.checkpoint === 'string' 
            ? cons.checkpoint 
            : undefined,
        };
      }

      validated.push({
        title: stage.title as string,
        capability: stage.capability as string,
        artifact: stage.artifact as string,
        designedFailure: stage.designedFailure as string,
        transfer: stage.transfer as string,
        topics: (stage.topics as unknown[]).map(String),
        consideration,
      });
    }

    return { ok: true, value: validated };
  }

  /**
   * Universal considerations for each stage phase.
   * These surface common tradeoffs across all learning domains.
   */
  private getUniversalConsideration(stageIndex: number): Consideration {
    const universalConsiderations: Consideration[] = [
      // Stage 1: REPRODUCE
      {
        gaining: 'Ability to produce basic output independently',
        tradingOff: 'Depth of understanding — you\'re learning enough to DO, not everything',
        severity: 'info',
      },
      // Stage 2: MODIFY
      {
        gaining: 'Flexibility to adapt existing work to new requirements',
        tradingOff: 'Time spent on original creation — building on others\' foundations',
        severity: 'info',
      },
      // Stage 3: DIAGNOSE
      {
        gaining: 'Systematic problem-solving skills',
        tradingOff: 'Speed — debugging properly takes longer than guessing',
        severity: 'caution',
        checkpoint: undefined,
      },
      // Stage 4: DESIGN
      {
        gaining: 'Independence — building from requirements, not instructions',
        tradingOff: 'Safety net of step-by-step guidance',
        severity: 'caution',
        checkpoint: undefined,
      },
      // Stage 5: SHIP
      {
        gaining: 'Real-world validation and feedback loops',
        tradingOff: 'Control — others will judge and critique your work',
        severity: 'info',
      },
    ];

    return universalConsiderations[stageIndex] ?? universalConsiderations[0]!;
  }

  /**
   * Generate fallback progression when LLM is unavailable.
   */
  private generateFallback(topic: string, _level: UserLevel, _durationDays: number): CapabilityStage[] {
    const topicName = this.formatTopicName(topic);
    const t = topic.toLowerCase();

    return [
      {
        title: `Your First ${topicName} Output`,
        capability: `Create a basic ${t} deliverable from scratch without step-by-step guidance`,
        artifact: `A working example that demonstrates fundamental ${t} concepts`,
        designedFailure: `Missing a critical step that causes the output to fail in an obvious way`,
        transfer: `Create the same type of output for a different use case or context`,
        topics: [t, 'basics', 'fundamentals', 'getting-started'],
        consideration: this.getUniversalConsideration(0),
      },
      {
        title: `Modify & Adapt`,
        capability: `Take existing ${t} work and modify it to meet new requirements`,
        artifact: `An adapted version with documented changes and rationale`,
        designedFailure: `Breaking existing functionality while adding new features`,
        transfer: `Apply the same modification pattern to a completely different starting point`,
        topics: [t, 'customization', 'adaptation', 'requirements'],
        consideration: this.getUniversalConsideration(1),
      },
      {
        title: `Debug & Diagnose`,
        capability: `Identify and fix problems in ${t} work systematically`,
        artifact: `A debugging log showing problem identification, investigation, and resolution`,
        designedFailure: `Fixing a symptom instead of the root cause`,
        transfer: `Debug a problem in an unfamiliar context`,
        topics: [t, 'debugging', 'troubleshooting', 'problem-solving'],
        consideration: this.getUniversalConsideration(2),
      },
      {
        title: `Design From Requirements`,
        capability: `Build a ${t} solution given only requirements, not instructions`,
        artifact: `A complete solution with design decisions documented`,
        designedFailure: `Over-engineering or under-engineering for the actual requirements`,
        transfer: `Design a solution for requirements in a domain you're less familiar with`,
        topics: [t, 'design', 'architecture', 'decision-making'],
        consideration: this.getUniversalConsideration(3),
      },
      {
        title: `Ship & Defend`,
        capability: `Deploy ${t} work to real users and handle feedback`,
        artifact: `A deployed solution with documentation and record of feedback addressed`,
        designedFailure: `Receiving critical feedback you didn't anticipate`,
        transfer: `Help someone else ship their work and handle their feedback`,
        topics: [t, 'deployment', 'documentation', 'feedback', 'iteration'],
        consideration: this.getUniversalConsideration(4),
      },
    ];
  }

  /**
   * Normalize topic for consistent caching.
   */
  private normalizeTopic(topic: string): string {
    return topic
      .toLowerCase()
      .trim()
      .replace(/^(learn|study|master|understand)\s+(to\s+)?/i, '')
      .replace(/^(how\s+to\s+)/i, '')
      .replace(/^(i\s+want\s+to\s+)/i, '')
      .replace(/^(about\s+)/i, '')
      .trim();
  }

  /**
   * Format topic name for display.
   */
  private formatTopicName(topic: string): string {
    const normalized = this.normalizeTopic(topic);
    return normalized
      .split(/[\s-]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  clearCache(): void {
    this.cache.clear();
  }

  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY & UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

export function createCapabilityGenerator(config?: CapabilityGeneratorConfig): CapabilityGenerator {
  return new CapabilityGenerator(config);
}

export function extractTopicsFromStages(stages: readonly CapabilityStage[]): string[] {
  const allTopics = stages.flatMap(stage => stage.topics);
  const unique = [...new Set(allTopics)];
  return unique.map(t => `topic:${t.toLowerCase().replace(/\s+/g, '-')}`);
}
