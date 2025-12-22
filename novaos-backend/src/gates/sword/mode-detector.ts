// ═══════════════════════════════════════════════════════════════════════════════
// MODE DETECTOR — SwordGate Mode Classification
// NovaOS Gates — Phase 13: SwordGate Integration
// ═══════════════════════════════════════════════════════════════════════════════
//
// Detects the appropriate SwordGate mode based on:
//   1. Active refinement state (continue refine/suggest flow)
//   2. Confirmation patterns (proceed to create)
//   3. Modification requests (modify existing goal)
//   4. Goal creation intent (start capture)
//   5. LLM classification for ambiguous cases
//
// Implements fail-open: defaults to 'capture' when uncertain.
//
// ═══════════════════════════════════════════════════════════════════════════════

import OpenAI from 'openai';

import type { UserId, GoalId } from '../../types/branded.js';
import type { Intent } from '../../helpers/types.js';
import type {
  SwordGateMode,
  SwordGateInput,
  SwordRefinementState,
  SwordGateConfig,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Mode detection result.
 */
export interface ModeDetectionResult {
  /** Detected mode */
  readonly mode: SwordGateMode;

  /** Confidence in detection (0-1) */
  readonly confidence: number;

  /** How the mode was detected */
  readonly detectionMethod: 'refinement_state' | 'confirmation' | 'modification' | 'keyword' | 'llm' | 'default';

  /** Reasoning for the detection */
  readonly reasoning: string;

  /** Existing goal ID if modify mode */
  readonly targetGoalId?: GoalId;

  /** Whether this is a continuation of existing flow */
  readonly isContinuation: boolean;
}

/**
 * LLM classification output.
 */
interface LlmModeClassification {
  mode: SwordGateMode;
  confidence: number;
  reasoning: string;
  isConfirmation: boolean;
  isModification: boolean;
  targetGoalReference?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PATTERNS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Confirmation patterns — user wants to proceed with the plan.
 */
const CONFIRMATION_PATTERNS: RegExp[] = [
  /^(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|let'?s do it|sounds good|looks good|perfect|great|confirm|proceed|create it|start|begin)\.?$/i,
  /\b(looks good|sounds good|sounds great|that works|i'?m ready|let'?s go|create the plan|create my plan|make it|set it up)\b/i,
  /^(👍|✅|✓|yep!|yes!|sure!|ok!|okay!)$/i,
];

/**
 * Rejection/modification patterns — user wants changes.
 */
const MODIFICATION_PATTERNS: RegExp[] = [
  /\b(change|modify|update|edit|adjust|tweak|different|instead|rather|actually|wait|hold on|no|nope)\b/i,
  /\b(too (long|short|much|little|many|few))\b/i,
  /\b(more|less|fewer) (time|days|hours|weeks)\b/i,
  /\b(can you|could you|please) (change|modify|update|make it)\b/i,
  /\b(i want|i'?d like|prefer) (to change|something different|a different)\b/i,
];

/**
 * Goal creation intent patterns.
 */
const GOAL_CREATION_PATTERNS: RegExp[] = [
  /\b(i want to learn|teach me|help me learn|i'?d like to learn|learn how to|learning)\b/i,
  /\b(create a (learning )?plan|make a (learning )?plan|set up a plan|build a plan)\b/i,
  /\b(new goal|start learning|begin learning|get started with)\b/i,
  /\b(master|become proficient|get better at|improve my)\b/i,
  /\b(study|practice|train|develop skills in)\b/i,
];

/**
 * Existing goal modification patterns.
 */
const EXISTING_GOAL_PATTERNS: RegExp[] = [
  /\b(my (goal|plan|learning plan)|the (goal|plan))\b/i,
  /\b(pause|resume|abandon|delete|cancel) (my|the) (goal|plan)\b/i,
  /\b(update|change|modify) (my|the) (existing|current) (goal|plan)\b/i,
];

// ═══════════════════════════════════════════════════════════════════════════════
// LLM CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

const MODE_DETECTION_SYSTEM_PROMPT = `You are a goal creation flow classifier. Analyze the user message and determine the appropriate mode.

Return JSON only, no markdown, no code blocks.

Output format:
{"mode":"...","confidence":0.0-1.0,"reasoning":"...","isConfirmation":true/false,"isModification":true/false,"targetGoalReference":"..."}

MODES:
- capture: User wants to create a new learning goal (extract their goal statement)
- refine: User is answering questions about their learning preferences
- suggest: System should generate/show a lesson plan (internal - don't return this)
- create: User confirmed the proposed plan, ready to create
- modify: User wants to change an existing goal or the current proposal

CLASSIFICATION RULES:

1. If user is clearly confirming/approving something → "create" with isConfirmation=true
   Examples: "yes", "looks good", "let's do it", "create it", "perfect"

2. If user is requesting changes to a proposal → "modify" with isModification=true
   Examples: "make it shorter", "change the duration", "too many days"

3. If user is answering a question about preferences → "refine"
   Examples: "30 minutes", "beginner", "I prefer videos", "weekdays only"

4. If user is stating a new learning goal → "capture"
   Examples: "I want to learn Rust", "teach me Python", "help me master cooking"

5. If user wants to modify an existing goal → "modify" with targetGoalReference
   Examples: "pause my Rust goal", "update my learning plan"

Context will be provided about whether there's an active refinement session.

═══════════════════════════════════════════════════════════════
EXAMPLES:
═══════════════════════════════════════════════════════════════

User: "Yes, create it"
{"mode":"create","confidence":0.98,"reasoning":"Clear confirmation to proceed","isConfirmation":true,"isModification":false}

User: "I want to learn TypeScript"
{"mode":"capture","confidence":0.95,"reasoning":"New learning goal statement","isConfirmation":false,"isModification":false}

User: "About 30 minutes a day"
{"mode":"refine","confidence":0.90,"reasoning":"Answering time commitment question","isConfirmation":false,"isModification":false}

User: "Make it 4 weeks instead"
{"mode":"modify","confidence":0.92,"reasoning":"Requesting change to duration","isConfirmation":false,"isModification":true}

User: "Pause my current goal"
{"mode":"modify","confidence":0.88,"reasoning":"Modifying existing goal","isConfirmation":false,"isModification":true,"targetGoalReference":"current goal"}

═══════════════════════════════════════════════════════════════
Now classify the following. Return only valid JSON:`;

// ═══════════════════════════════════════════════════════════════════════════════
// MODE DETECTOR CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detects the appropriate SwordGate mode for a given input.
 */
export class ModeDetector {
  private openai: OpenAI | null = null;
  private readonly config: SwordGateConfig;

  constructor(config: SwordGateConfig, openaiApiKey?: string) {
    this.config = config;
    const key = openaiApiKey ?? process.env.OPENAI_API_KEY;
    if (key && config.useLlmModeDetection) {
      this.openai = new OpenAI({ apiKey: key });
    }
  }

  /**
   * Detect the appropriate mode for the input.
   *
   * Priority order:
   * 1. Check refinement state (if in confirming stage → check for confirmation)
   * 2. Check for confirmation patterns
   * 3. Check for modification patterns
   * 4. Check refinement state (if active → refine)
   * 5. Check for goal creation patterns
   * 6. Use LLM classification
   * 7. Default to capture
   */
  async detect(
    input: SwordGateInput,
    refinementState: SwordRefinementState | null
  ): Promise<ModeDetectionResult> {
    const message = input.message.trim();

    // ─────────────────────────────────────────────────────────────────────────
    // Priority 1: Active refinement in confirming stage
    // ─────────────────────────────────────────────────────────────────────────
    if (refinementState?.stage === 'confirming') {
      // Check if user is confirming the proposed plan
      if (this.isConfirmation(message)) {
        return {
          mode: 'create',
          confidence: 0.95,
          detectionMethod: 'confirmation',
          reasoning: 'User confirmed proposed plan',
          isContinuation: true,
        };
      }

      // Check if user wants modifications
      if (this.isModificationRequest(message)) {
        return {
          mode: 'modify',
          confidence: 0.90,
          detectionMethod: 'modification',
          reasoning: 'User requesting changes to proposal',
          isContinuation: true,
        };
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Priority 2: Explicit confirmation (even without state)
    // ─────────────────────────────────────────────────────────────────────────
    if (refinementState && this.isStrongConfirmation(message)) {
      return {
        mode: 'create',
        confidence: 0.92,
        detectionMethod: 'confirmation',
        reasoning: 'Strong confirmation detected',
        isContinuation: true,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Priority 3: Modification of existing goal
    // ─────────────────────────────────────────────────────────────────────────
    if (this.isExistingGoalModification(message)) {
      return {
        mode: 'modify',
        confidence: 0.88,
        detectionMethod: 'modification',
        reasoning: 'Modification of existing goal detected',
        targetGoalId: input.existingGoalId,
        isContinuation: false,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Priority 4: Active refinement state → continue refining
    // ─────────────────────────────────────────────────────────────────────────
    if (refinementState && refinementState.stage === 'clarifying') {
      // User is answering refinement questions
      return {
        mode: 'refine',
        confidence: 0.90,
        detectionMethod: 'refinement_state',
        reasoning: 'Active refinement session - processing response',
        isContinuation: true,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Priority 5: Goal creation patterns
    // ─────────────────────────────────────────────────────────────────────────
    if (this.isGoalCreationIntent(message, input.intent)) {
      return {
        mode: 'capture',
        confidence: 0.85,
        detectionMethod: 'keyword',
        reasoning: 'Goal creation intent detected',
        isContinuation: false,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Priority 6: LLM Classification (if enabled and available)
    // ─────────────────────────────────────────────────────────────────────────
    if (this.openai && this.config.useLlmModeDetection) {
      const llmResult = await this.classifyWithLlm(message, refinementState);
      if (llmResult) {
        return llmResult;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Priority 7: Keyword-based fallback
    // ─────────────────────────────────────────────────────────────────────────
    const keywordResult = this.classifyWithKeywords(message, refinementState);
    if (keywordResult.confidence > 0.5) {
      return keywordResult;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Default: Capture mode (fail-open)
    // ─────────────────────────────────────────────────────────────────────────
    return {
      mode: 'capture',
      confidence: 0.5,
      detectionMethod: 'default',
      reasoning: 'Default to capture - unable to determine intent',
      isContinuation: false,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PATTERN MATCHING HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Check if message is a confirmation.
   */
  private isConfirmation(message: string): boolean {
    return CONFIRMATION_PATTERNS.some((pattern) => pattern.test(message));
  }

  /**
   * Check if message is a strong/explicit confirmation.
   */
  private isStrongConfirmation(message: string): boolean {
    const strongPatterns = [
      /^(yes|yeah|yep|sure|ok|okay|confirm|go ahead|do it|create it|let'?s do it)\.?$/i,
      /^(👍|✅|✓)$/,
    ];
    return strongPatterns.some((pattern) => pattern.test(message.trim()));
  }

  /**
   * Check if message is requesting modifications.
   */
  private isModificationRequest(message: string): boolean {
    return MODIFICATION_PATTERNS.some((pattern) => pattern.test(message));
  }

  /**
   * Check if message is about modifying an existing goal.
   */
  private isExistingGoalModification(message: string): boolean {
    return EXISTING_GOAL_PATTERNS.some((pattern) => pattern.test(message));
  }

  /**
   * Check if message indicates goal creation intent.
   */
  private isGoalCreationIntent(message: string, intent?: Intent): boolean {
    // Check intent type from IntentGate
    if (intent?.type === 'action' || intent?.type === 'planning') {
      if (GOAL_CREATION_PATTERNS.some((pattern) => pattern.test(message))) {
        return true;
      }
    }

    // Direct pattern match
    return GOAL_CREATION_PATTERNS.some((pattern) => pattern.test(message));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // KEYWORD-BASED CLASSIFICATION
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Classify using keyword heuristics.
   */
  private classifyWithKeywords(
    message: string,
    refinementState: SwordRefinementState | null
  ): ModeDetectionResult {
    const lower = message.toLowerCase();

    // Short affirmative responses during active refinement
    if (refinementState && message.length < 50) {
      // Check for time expressions (answering dailyTimeCommitment)
      if (/^\d+\s*(min|minute|hour|hr|m|h)/i.test(message)) {
        return {
          mode: 'refine',
          confidence: 0.85,
          detectionMethod: 'keyword',
          reasoning: 'Time expression detected - answering refinement question',
          isContinuation: true,
        };
      }

      // Check for duration expressions (answering totalDuration)
      if (/^\d+\s*(day|week|month)/i.test(message)) {
        return {
          mode: 'refine',
          confidence: 0.85,
          detectionMethod: 'keyword',
          reasoning: 'Duration expression detected - answering refinement question',
          isContinuation: true,
        };
      }

      // Check for level keywords
      if (/^(beginner|intermediate|advanced|novice|expert)/i.test(message)) {
        return {
          mode: 'refine',
          confidence: 0.88,
          detectionMethod: 'keyword',
          reasoning: 'Skill level detected - answering refinement question',
          isContinuation: true,
        };
      }

      // Check for learning style keywords
      if (/^(video|reading|hands[- ]?on|mixed|practical)/i.test(message)) {
        return {
          mode: 'refine',
          confidence: 0.85,
          detectionMethod: 'keyword',
          reasoning: 'Learning style detected - answering refinement question',
          isContinuation: true,
        };
      }
    }

    // Learning goal patterns
    if (
      lower.includes('learn') ||
      lower.includes('teach me') ||
      lower.includes('study') ||
      lower.includes('master')
    ) {
      return {
        mode: 'capture',
        confidence: 0.75,
        detectionMethod: 'keyword',
        reasoning: 'Learning-related keywords detected',
        isContinuation: false,
      };
    }

    // Default low confidence
    return {
      mode: 'capture',
      confidence: 0.4,
      detectionMethod: 'keyword',
      reasoning: 'No strong keyword signals',
      isContinuation: false,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // LLM CLASSIFICATION
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Classify using LLM.
   */
  private async classifyWithLlm(
    message: string,
    refinementState: SwordRefinementState | null
  ): Promise<ModeDetectionResult | null> {
    if (!this.openai) {
      return null;
    }

    try {
      // Build context about current state
      const contextParts: string[] = [];
      if (refinementState) {
        contextParts.push(`Active refinement session: stage=${refinementState.stage}`);
        if (refinementState.currentQuestion) {
          contextParts.push(`Current question: ${refinementState.currentQuestion}`);
        }
        if (refinementState.lastProposedPlan) {
          contextParts.push('A lesson plan proposal has been shown to the user');
        }
      } else {
        contextParts.push('No active refinement session');
      }

      const context = contextParts.join('\n');
      const userPrompt = `Context:\n${context}\n\nUser message: "${message}"`;

      const response = await this.openai.chat.completions.create({
        model: this.config.llmModel,
        messages: [
          { role: 'system', content: MODE_DETECTION_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 150,
        temperature: 0,
      });

      const content = response.choices[0]?.message?.content?.trim() ?? '';
      const classification = this.parseLlmClassification(content);

      if (!classification) {
        return null;
      }

      // Map LLM result to detection result
      return {
        mode: classification.mode,
        confidence: classification.confidence,
        detectionMethod: 'llm',
        reasoning: classification.reasoning,
        isContinuation: !!refinementState,
      };
    } catch (error) {
      console.error('[MODE_DETECTOR] LLM classification error:', error);
      return null;
    }
  }

  /**
   * Parse LLM classification response.
   */
  private parseLlmClassification(content: string): LlmModeClassification | null {
    try {
      // Handle potential markdown code blocks
      let jsonStr = content;
      if (content.includes('```')) {
        const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        jsonStr = match?.[1]?.trim() ?? content;
      }

      const parsed = JSON.parse(jsonStr.trim());

      // Validate mode
      const validModes: SwordGateMode[] = ['capture', 'refine', 'suggest', 'create', 'modify'];
      const mode = validModes.includes(parsed.mode) ? parsed.mode : 'capture';

      return {
        mode,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
        reasoning: String(parsed.reasoning || 'No reasoning provided'),
        isConfirmation: Boolean(parsed.isConfirmation),
        isModification: Boolean(parsed.isModification),
        targetGoalReference: parsed.targetGoalReference,
      };
    } catch {
      console.warn('[MODE_DETECTOR] Failed to parse LLM response:', content);
      return null;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a ModeDetector instance.
 */
export function createModeDetector(
  config: SwordGateConfig,
  openaiApiKey?: string
): ModeDetector {
  return new ModeDetector(config, openaiApiKey);
}
