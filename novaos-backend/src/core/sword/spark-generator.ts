// ═══════════════════════════════════════════════════════════════════════════════
// SPARK GENERATOR — Minimal Action Generator (Nova Constitution §2.3)
// ═══════════════════════════════════════════════════════════════════════════════
//
// "Spark — produces a minimal, low-friction action that creates immediate
// forward motion. Sword exists to convert intention into motion without
// relying on motivation or willpower."
//
// Design principles:
// 1. Actions must be SPECIFIC and IMMEDIATE (not "work on project")
// 2. Time estimate should be realistic (2-15 minutes typical)
// 3. Friction should be minimal (no complex setup required)
// 4. Actions should be reversible when possible
// 5. Each spark should create visible progress
//
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  Spark,
  Goal,
  Quest,
  Step,
  GenerateSparkRequest,
} from './types.js';
import { SwordStore, getSwordStore } from './store.js';
import { ProviderManager } from '../../providers/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// SPARK TEMPLATES (for common patterns)
// ─────────────────────────────────────────────────────────────────────────────────

interface SparkTemplate {
  pattern: RegExp;
  generator: (context: SparkContext) => TemplatedSpark;
}

interface TemplatedSpark {
  action: string;
  rationale: string;
  estimatedMinutes: number;
  frictionLevel: 'minimal' | 'low' | 'medium';
  reversible: boolean;
}

interface SparkContext {
  goal?: Goal;
  quest?: Quest;
  step?: Step;
  userContext?: string;
}

const SPARK_TEMPLATES: SparkTemplate[] = [
  // Research/Learning patterns
  {
    pattern: /research|learn|understand|study/i,
    generator: (ctx) => ({
      action: `Open a new browser tab and search for "${ctx.step?.title || ctx.quest?.title || 'your topic'}"`,
      rationale: 'Starting with a simple search removes the barrier of figuring out where to begin.',
      estimatedMinutes: 5,
      frictionLevel: 'minimal',
      reversible: true,
    }),
  },
  
  // Writing patterns
  {
    pattern: /write|draft|create.*document|blog|article/i,
    generator: (ctx) => ({
      action: `Create a new document and write just the title and 3 bullet points for "${ctx.step?.title || 'your piece'}"`,
      rationale: 'A blank page is intimidating. Starting with bullets makes it manageable.',
      estimatedMinutes: 5,
      frictionLevel: 'minimal',
      reversible: true,
    }),
  },
  
  // Communication patterns
  {
    pattern: /email|message|contact|reach out|call/i,
    generator: (ctx) => ({
      action: `Draft a 2-sentence message outline (greeting + main point) for your communication`,
      rationale: 'Having an outline makes the actual writing much easier.',
      estimatedMinutes: 3,
      frictionLevel: 'minimal',
      reversible: true,
    }),
  },
  
  // Planning patterns
  {
    pattern: /plan|organize|schedule|prepare/i,
    generator: (ctx) => ({
      action: `Write down 3 concrete next steps for "${ctx.step?.title || ctx.quest?.title}"`,
      rationale: 'Breaking down the task makes it less overwhelming and creates clarity.',
      estimatedMinutes: 5,
      frictionLevel: 'minimal',
      reversible: true,
    }),
  },
  
  // Setup/Configuration patterns
  {
    pattern: /setup|configure|install|initialize/i,
    generator: (ctx) => ({
      action: `Open the settings/configuration page and identify the first 3 things to configure`,
      rationale: 'Reconnaissance before action prevents wasted effort.',
      estimatedMinutes: 5,
      frictionLevel: 'low',
      reversible: true,
    }),
  },
  
  // Review patterns
  {
    pattern: /review|check|verify|audit/i,
    generator: (ctx) => ({
      action: `Open the item to review and spend exactly 5 minutes scanning it`,
      rationale: 'Time-boxing prevents review paralysis and ensures forward motion.',
      estimatedMinutes: 5,
      frictionLevel: 'minimal',
      reversible: true,
    }),
  },
  
  // Meeting patterns
  {
    pattern: /meeting|discuss|conversation/i,
    generator: (ctx) => ({
      action: `Write down 1 question and 1 point you want to make in the meeting`,
      rationale: 'Preparation ensures the meeting is productive.',
      estimatedMinutes: 3,
      frictionLevel: 'minimal',
      reversible: true,
    }),
  },
  
  // Coding patterns
  {
    pattern: /code|program|develop|implement|build.*feature/i,
    generator: (ctx) => ({
      action: `Open your IDE and write a comment describing what the code should do`,
      rationale: 'A comment-first approach clarifies intent before implementation.',
      estimatedMinutes: 3,
      frictionLevel: 'minimal',
      reversible: true,
    }),
  },
  
  // Decision patterns
  {
    pattern: /decide|choose|select|pick/i,
    generator: (ctx) => ({
      action: `Write down the top 2 options and one pro/con for each`,
      rationale: 'Externalizing options makes comparison easier.',
      estimatedMinutes: 5,
      frictionLevel: 'minimal',
      reversible: true,
    }),
  },
];

// ─────────────────────────────────────────────────────────────────────────────────
// SPARK GENERATOR CLASS
// ─────────────────────────────────────────────────────────────────────────────────

export class SparkGenerator {
  private store: SwordStore;
  private providerManager: ProviderManager | null;
  
  constructor(store?: SwordStore, providerManager?: ProviderManager) {
    this.store = store ?? getSwordStore();
    this.providerManager = providerManager ?? null;
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // MAIN GENERATION METHOD
  // ─────────────────────────────────────────────────────────────────────────────
  
  async generate(userId: string, request: GenerateSparkRequest): Promise<Spark> {
    // Build context
    const context = await this.buildContext(request);
    
    // Try template-based generation first (fast, no API call)
    const templatedSpark = this.tryTemplateGeneration(context);
    
    if (templatedSpark) {
      return this.store.createSpark(userId, {
        userId,
        stepId: request.stepId,
        questId: request.questId ?? context.quest?.id,
        action: templatedSpark.action,
        rationale: templatedSpark.rationale,
        estimatedMinutes: Math.min(templatedSpark.estimatedMinutes, request.maxMinutes ?? 15),
        frictionLevel: request.frictionLevel ?? templatedSpark.frictionLevel,
        reversible: templatedSpark.reversible,
      });
    }
    
    // Fall back to LLM generation if provider available
    if (this.providerManager) {
      return this.generateWithLLM(userId, request, context);
    }
    
    // Default fallback spark
    return this.generateFallbackSpark(userId, request, context);
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // CONTEXT BUILDING
  // ─────────────────────────────────────────────────────────────────────────────
  
  private async buildContext(request: GenerateSparkRequest): Promise<SparkContext> {
    const context: SparkContext = {
      userContext: request.context,
    };
    
    if (request.stepId) {
      context.step = await this.store.getStep(request.stepId) ?? undefined;
      if (context.step) {
        context.quest = await this.store.getQuest(context.step.questId) ?? undefined;
      }
    }
    
    if (request.questId && !context.quest) {
      context.quest = await this.store.getQuest(request.questId) ?? undefined;
    }
    
    if (context.quest) {
      context.goal = await this.store.getGoal(context.quest.goalId) ?? undefined;
    } else if (request.goalId) {
      context.goal = await this.store.getGoal(request.goalId) ?? undefined;
    }
    
    return context;
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // TEMPLATE-BASED GENERATION
  // ─────────────────────────────────────────────────────────────────────────────
  
  private tryTemplateGeneration(context: SparkContext): TemplatedSpark | null {
    const searchText = [
      context.step?.title,
      context.step?.description,
      context.step?.sparkPrompt,
      context.quest?.title,
      context.quest?.description,
      context.goal?.title,
      context.userContext,
    ].filter(Boolean).join(' ');
    
    if (!searchText) return null;
    
    for (const template of SPARK_TEMPLATES) {
      if (template.pattern.test(searchText)) {
        return template.generator(context);
      }
    }
    
    return null;
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // LLM-BASED GENERATION
  // ─────────────────────────────────────────────────────────────────────────────
  
  private async generateWithLLM(
    userId: string,
    request: GenerateSparkRequest,
    context: SparkContext
  ): Promise<Spark> {
    const prompt = this.buildLLMPrompt(context, request);
    const systemPrompt = 'You are a productivity assistant that generates minimal, actionable sparks.';
    
    try {
      const response = await this.providerManager!.generate(prompt, systemPrompt);
      const parsed = this.parseLLMResponse(response.text);
      
      return this.store.createSpark(userId, {
        userId,
        stepId: request.stepId,
        questId: request.questId ?? context.quest?.id,
        action: parsed.action,
        rationale: parsed.rationale,
        estimatedMinutes: Math.min(parsed.estimatedMinutes, request.maxMinutes ?? 15),
        frictionLevel: request.frictionLevel ?? parsed.frictionLevel,
        reversible: parsed.reversible,
        nextSparkHint: parsed.nextSparkHint,
      });
    } catch {
      // Fall back to default if LLM fails
      return this.generateFallbackSpark(userId, request, context);
    }
  }
  
  private buildLLMPrompt(context: SparkContext, request: GenerateSparkRequest): string {
    const parts: string[] = [
      'Generate a minimal, low-friction action (Spark) that creates immediate forward motion.',
      '',
      'Requirements:',
      '- Action must be SPECIFIC and IMMEDIATE (not vague like "work on project")',
      '- Time estimate should be 2-15 minutes',
      '- Should require minimal setup or prerequisites',
      '- Should create visible progress',
      '- Prefer reversible actions when possible',
      '',
    ];
    
    if (context.goal) {
      parts.push(`Goal: ${context.goal.title}`);
      parts.push(`Desired outcome: ${context.goal.desiredOutcome}`);
    }
    
    if (context.quest) {
      parts.push(`Current milestone: ${context.quest.title}`);
      parts.push(`Milestone outcome: ${context.quest.outcome}`);
    }
    
    if (context.step) {
      parts.push(`Current step: ${context.step.title}`);
      if (context.step.description) {
        parts.push(`Step details: ${context.step.description}`);
      }
      if (context.step.sparkPrompt) {
        parts.push(`Hint: ${context.step.sparkPrompt}`);
      }
    }
    
    if (context.userContext) {
      parts.push(`Additional context: ${context.userContext}`);
    }
    
    if (request.maxMinutes) {
      parts.push(`Max time: ${request.maxMinutes} minutes`);
    }
    
    parts.push('');
    parts.push('Respond in JSON format:');
    parts.push('{');
    parts.push('  "action": "imperative verb phrase, < 100 chars",');
    parts.push('  "rationale": "why this specific action, 1-2 sentences",');
    parts.push('  "estimatedMinutes": number,');
    parts.push('  "frictionLevel": "minimal" | "low" | "medium",');
    parts.push('  "reversible": boolean,');
    parts.push('  "nextSparkHint": "what might come after this"');
    parts.push('}');
    
    return parts.join('\n');
  }
  
  private parseLLMResponse(response: string): {
    action: string;
    rationale: string;
    estimatedMinutes: number;
    frictionLevel: 'minimal' | 'low' | 'medium';
    reversible: boolean;
    nextSparkHint?: string;
  } {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          action: String(parsed.action || 'Take the first small step'),
          rationale: String(parsed.rationale || 'Small steps build momentum'),
          estimatedMinutes: Number(parsed.estimatedMinutes) || 5,
          frictionLevel: parsed.frictionLevel || 'minimal',
          reversible: Boolean(parsed.reversible ?? true),
          nextSparkHint: parsed.nextSparkHint,
        };
      }
    } catch {
      // Parse failed
    }
    
    // Default if parsing fails
    return {
      action: 'Spend 5 minutes reviewing your next step',
      rationale: 'Clarity precedes action',
      estimatedMinutes: 5,
      frictionLevel: 'minimal',
      reversible: true,
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // FALLBACK GENERATION
  // ─────────────────────────────────────────────────────────────────────────────
  
  private async generateFallbackSpark(
    userId: string,
    request: GenerateSparkRequest,
    context: SparkContext
  ): Promise<Spark> {
    const maxMins = request.maxMinutes ?? 5;
    let action = `Spend ${maxMins} minutes planning your next concrete action`;
    let rationale = 'When uncertain, planning creates clarity and momentum.';
    
    if (context.step) {
      action = `Open your tools and spend ${maxMins} minutes on: ${context.step.title}`;
      rationale = 'Starting is often the hardest part. Just begin.';
    } else if (context.quest) {
      action = `Write down 3 specific things you could do for: ${context.quest.title}`;
      rationale = 'Breaking down tasks makes them manageable.';
    } else if (context.goal) {
      action = `Spend ${maxMins} minutes reviewing your progress toward: ${context.goal.title}`;
      rationale = 'Regular reflection keeps you aligned with your goals.';
    }
    
    return this.store.createSpark(userId, {
      userId,
      stepId: request.stepId,
      questId: request.questId ?? context.quest?.id,
      action,
      rationale,
      estimatedMinutes: Math.min(5, maxMins),
      frictionLevel: 'minimal',
      reversible: true,
    });
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // SMART SPARK (generates for next logical step)
  // ─────────────────────────────────────────────────────────────────────────────
  
  async generateNextSpark(userId: string, goalId: string): Promise<Spark | null> {
    const path = await this.store.getPath(goalId, userId);
    if (!path) return null;
    
    // If there's already an active spark, return it
    if (path.activeSpark && path.activeSpark.status !== 'expired') {
      return path.activeSpark;
    }
    
    // Generate for next step
    if (path.nextStep) {
      return this.generate(userId, {
        stepId: path.nextStep.id,
        questId: path.currentQuestId,
        goalId,
      });
    }
    
    // Generate for current quest
    if (path.currentQuestId) {
      return this.generate(userId, {
        questId: path.currentQuestId,
        goalId,
      });
    }
    
    // Generate for goal
    return this.generate(userId, { goalId });
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let sparkGenerator: SparkGenerator | null = null;

export function getSparkGenerator(): SparkGenerator {
  if (!sparkGenerator) {
    sparkGenerator = new SparkGenerator();
  }
  return sparkGenerator;
}

export function createSparkGenerator(
  store?: SwordStore,
  providerManager?: ProviderManager
): SparkGenerator {
  return new SparkGenerator(store, providerManager);
}
