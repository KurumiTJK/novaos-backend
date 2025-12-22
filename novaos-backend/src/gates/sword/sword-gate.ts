// ═══════════════════════════════════════════════════════════════════════════════
// SWORDGATE — Goal Creation Pipeline Gate
// NovaOS Gates — Phase 13: SwordGate Integration
// ═══════════════════════════════════════════════════════════════════════════════
//
// Constitution §2.3: Sword — Forward Motion
//
// SwordGate orchestrates goal creation through:
//   1. Mode Detection — Determine capture/refine/suggest/create/modify
//   2. Goal Capture — Extract and sanitize goal statement
//   3. Refinement Flow — Multi-turn clarification conversation
//   4. Plan Generation — Create lesson plan proposal
//   5. Confirmation — User confirms before creation
//   6. Goal Creation — Create goal via SparkEngine
//
// Integration points:
//   - ModeDetector: Classify user intent
//   - RefinementFlow: Manage multi-turn conversation
//   - SwordRefinementStore: Persist refinement state
//   - GoalStatementSanitizer: Validate and sanitize input
//   - LessonPlanGenerator: Generate curriculum proposals
//   - ISparkEngine: Create goals and quests
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { UserId, GoalId } from '../../types/branded.js';
import { createTimestamp, createGoalId } from '../../types/branded.js';
import type { AsyncAppResult, AppError } from '../../types/result.js';
import { ok, err, appError } from '../../types/result.js';

import type {
  PipelineState,
  PipelineContext,
  GateResult,
  GateId,
  GateStatus,
  GateAction,
} from '../../helpers/types.js';

import type { Goal, Quest, CreateGoalParams } from '../../services/spark-engine/types.js';
import type { ISparkEngine } from '../../services/spark-engine/interfaces.js';
import type { IRefinementStore } from '../../services/spark-engine/store/types.js';

import type {
  SwordGateMode,
  SwordGateInput,
  SwordGateOutput,
  SwordGateConfig,
  SwordRefinementState,
  SwordRefinementInputs,
  LessonPlanProposal,
  GoalRateLimitInfo,
  CreatedGoalResult,
} from './types.js';
import { DEFAULT_SWORD_GATE_CONFIG, hasRequiredFields, getMissingRequiredFields } from './types.js';

import { ModeDetector, createModeDetector } from './mode-detector.js';
import { RefinementFlow, createRefinementFlow } from './refinement-flow.js';
import { SwordRefinementStore, createSwordRefinementStore } from './sword-refinement-store.js';
import { GoalStatementSanitizer, createGoalStatementSanitizer } from './sanitizers.js';
import {
  LessonPlanGenerator,
  createLessonPlanGenerator,
  type IResourceDiscoveryService,
  type ICurriculumService,
} from './lesson-plan-generator.js';

// ═══════════════════════════════════════════════════════════════════════════════
// RATE LIMITER INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Interface for goal creation rate limiting.
 */
export interface IGoalRateLimiter {
  /**
   * Check if user can create a new goal.
   */
  canCreateGoal(userId: UserId): AsyncAppResult<GoalRateLimitInfo>;

  /**
   * Record a goal creation.
   */
  recordGoalCreation(userId: UserId): AsyncAppResult<void>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SWORDGATE CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * SwordGate — Goal Creation Pipeline Gate
 *
 * Orchestrates the goal creation flow from initial capture through
 * refinement, plan generation, and final creation.
 */
export class SwordGate {
  readonly gateId: GateId = 'spark'; // Uses 'spark' gate ID for pipeline compatibility

  private readonly config: SwordGateConfig;
  private readonly modeDetector: ModeDetector;
  private readonly refinementFlow: RefinementFlow;
  private readonly refinementStore: SwordRefinementStore;
  private readonly sanitizer: GoalStatementSanitizer;
  private readonly planGenerator: LessonPlanGenerator;
  private readonly sparkEngine?: ISparkEngine;
  private readonly rateLimiter?: IGoalRateLimiter;

  constructor(
    baseRefinementStore: IRefinementStore,
    config: Partial<SwordGateConfig> = {},
    options: {
      sparkEngine?: ISparkEngine;
      rateLimiter?: IGoalRateLimiter;
      resourceService?: IResourceDiscoveryService;
      curriculumService?: ICurriculumService;
      openaiApiKey?: string;
    } = {}
  ) {
    this.config = { ...DEFAULT_SWORD_GATE_CONFIG, ...config };

    // Initialize components
    this.modeDetector = createModeDetector(this.config, options.openaiApiKey);
    this.refinementFlow = createRefinementFlow(this.config);
    this.refinementStore = createSwordRefinementStore(baseRefinementStore, this.config);
    this.sanitizer = createGoalStatementSanitizer(this.config);
    this.planGenerator = createLessonPlanGenerator(
      this.config,
      options.resourceService,
      options.curriculumService
    );

    this.sparkEngine = options.sparkEngine;
    this.rateLimiter = options.rateLimiter;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN EXECUTE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute the SwordGate.
   */
  async execute(
    state: PipelineState,
    context: PipelineContext
  ): Promise<GateResult<SwordGateOutput>> {
    const startTime = Date.now();

    try {
      // Build input from pipeline state
      const input = this.buildInput(state, context);

      // Get existing refinement state
      const stateResult = await this.refinementStore.get(input.userId);
      if (!stateResult.ok) {
        return this.gateError('Failed to load refinement state', startTime, stateResult.error);
      }
      const refinementState = stateResult.value;

      // Detect mode
      const modeResult = await this.modeDetector.detect(input, refinementState);
      console.log(`[SWORD_GATE] Mode detected: ${modeResult.mode} (${modeResult.detectionMethod})`);

      // Execute mode-specific handler
      const output = await this.executeMode(input, refinementState, modeResult.mode);

      return {
        gateId: this.gateId,
        status: 'pass',
        output,
        action: this.determineAction(output),
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      console.error('[SWORD_GATE] Execution error:', error);
      return this.gateError(
        'SwordGate execution failed',
        startTime,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MODE HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute the appropriate handler for the detected mode.
   */
  private async executeMode(
    input: SwordGateInput,
    refinementState: SwordRefinementState | null,
    mode: SwordGateMode
  ): Promise<SwordGateOutput> {
    switch (mode) {
      case 'capture':
        return this.handleCapture(input);

      case 'refine':
        return this.handleRefine(input, refinementState!);

      case 'suggest':
        return this.handleSuggest(input, refinementState!);

      case 'create':
        return this.handleCreate(input, refinementState!);

      case 'modify':
        return this.handleModify(input, refinementState);

      default:
        return {
          mode: 'capture',
          responseMessage: 'What would you like to learn?',
          suppressModelGeneration: true,
        };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CAPTURE MODE
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Handle capture mode — extract goal statement and start refinement.
   */
  private async handleCapture(input: SwordGateInput): Promise<SwordGateOutput> {
    // Sanitize the goal statement
    const sanitizeResult = this.sanitizer.sanitize(input.message);

    if (!sanitizeResult.valid) {
      return {
        mode: 'capture',
        responseMessage: sanitizeResult.errorMessage ?? 'Please provide a valid learning goal.',
        suppressModelGeneration: true,
      };
    }

    // Check rate limits before proceeding
    if (this.rateLimiter) {
      const limitResult = await this.rateLimiter.canCreateGoal(input.userId);
      if (limitResult.ok && limitResult.value.exceeded) {
        return {
          mode: 'capture',
          rateLimit: limitResult.value,
          responseMessage: limitResult.value.message,
          suppressModelGeneration: true,
        };
      }
    }

    // Initiate refinement flow
    const newState = this.refinementFlow.initiate(
      input.userId,
      sanitizeResult.sanitized!,
      input.userPreferences
    );

    // Save refinement state
    const saveResult = await this.refinementStore.save(newState);
    if (!saveResult.ok) {
      console.error('[SWORD_GATE] Failed to save refinement state:', saveResult.error);
      return {
        mode: 'capture',
        responseMessage: 'Something went wrong. Please try again.',
        suppressModelGeneration: true,
      };
    }

    // Get the first question
    const nextQuestion = this.refinementFlow.getNextQuestion(newState);

    return {
      mode: 'capture',
      nextQuestion: nextQuestion ?? undefined,
      refinementProgress: 0.25, // goalStatement is filled
      missingFields: getMissingRequiredFields(newState.inputs),
      responseMessage: this.buildCaptureResponse(sanitizeResult.topic!, nextQuestion),
      suppressModelGeneration: true,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // REFINE MODE
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Handle refine mode — process user response and continue refinement.
   */
  private async handleRefine(
    input: SwordGateInput,
    currentState: SwordRefinementState
  ): Promise<SwordGateOutput> {
    // Check for expiration
    if (this.refinementStore.isExpired(currentState)) {
      await this.refinementStore.delete(input.userId);
      return {
        mode: 'capture',
        responseMessage: 'Your session has expired. What would you like to learn?',
        suppressModelGeneration: true,
      };
    }

    // Check max turns
    if (this.refinementStore.isMaxTurnsExceeded(currentState)) {
      // Force move to suggest with what we have
      return this.handleSuggest(input, currentState);
    }

    // Process the response
    const updatedState = this.refinementFlow.processResponse(currentState, input.message);

    // Save updated state
    const saveResult = await this.refinementStore.save(updatedState);
    if (!saveResult.ok) {
      console.error('[SWORD_GATE] Failed to update refinement state:', saveResult.error);
    }

    // Check if refinement is complete
    if (this.refinementFlow.isComplete(updatedState)) {
      // Move to suggest mode
      return this.handleSuggest(input, updatedState);
    }

    // Get next question
    const nextQuestion = this.refinementFlow.getNextQuestion(updatedState);

    if (!nextQuestion) {
      // No more questions, move to suggest
      return this.handleSuggest(input, updatedState);
    }

    return {
      mode: 'refine',
      nextQuestion,
      refinementProgress: this.refinementFlow.getProgressPercent(updatedState) / 100,
      missingFields: this.refinementFlow.getMissingFields(updatedState),
      responseMessage: nextQuestion,
      suppressModelGeneration: true,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SUGGEST MODE
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Handle suggest mode — generate and present lesson plan proposal.
   */
  private async handleSuggest(
    input: SwordGateInput,
    currentState: SwordRefinementState
  ): Promise<SwordGateOutput> {
    // Ensure we have minimum required fields
    if (!hasRequiredFields(currentState.inputs)) {
      // Fill defaults for missing fields
      const inputs = this.fillDefaults(currentState.inputs);
      const updatedState = { ...currentState, inputs };
      await this.refinementStore.save(updatedState);
    }

    // Generate lesson plan proposal
    const planResult = await this.planGenerator.generate(currentState.inputs);

    if (!planResult.ok) {
      console.error('[SWORD_GATE] Plan generation failed:', planResult.error);
      return {
        mode: 'suggest',
        responseMessage: 'I couldn\'t generate a learning plan. Please try again with different details.',
        suppressModelGeneration: true,
      };
    }

    const proposal = planResult.value;

    // Update state to confirming with the proposal
    await this.refinementStore.startConfirming(input.userId, proposal);

    return {
      mode: 'suggest',
      proposedPlan: proposal,
      confirmationRequired: true,
      responseMessage: this.buildProposalResponse(proposal),
      suppressModelGeneration: true,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CREATE MODE
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Handle create mode — create goal after user confirmation.
   */
  private async handleCreate(
    input: SwordGateInput,
    currentState: SwordRefinementState
  ): Promise<SwordGateOutput> {
    // Verify we have a proposed plan
    if (!currentState.lastProposedPlan) {
      return {
        mode: 'create',
        responseMessage: 'No plan to create. Please start over.',
        suppressModelGeneration: true,
      };
    }

    // Check rate limits
    if (this.rateLimiter) {
      const limitResult = await this.rateLimiter.canCreateGoal(input.userId);
      if (limitResult.ok && limitResult.value.exceeded) {
        return {
          mode: 'create',
          rateLimit: limitResult.value,
          responseMessage: limitResult.value.message,
          suppressModelGeneration: true,
        };
      }
    }

    // Create the goal
    const createResult = await this.createGoalFromProposal(
      input.userId,
      currentState.inputs,
      currentState.lastProposedPlan
    );

    if (!createResult.ok) {
      console.error('[SWORD_GATE] Goal creation failed:', createResult.error);
      return {
        mode: 'create',
        responseMessage: `Failed to create goal: ${createResult.error.message}`,
        suppressModelGeneration: true,
      };
    }

    // Record rate limit
    if (this.rateLimiter) {
      await this.rateLimiter.recordGoalCreation(input.userId);
    }

    // Complete refinement and clean up
    await this.refinementStore.complete(input.userId, createResult.value.goal.id);
    await this.refinementStore.delete(input.userId);

    return {
      mode: 'create',
      createdGoal: createResult.value,
      responseMessage: createResult.value.summary,
      suppressModelGeneration: true,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MODIFY MODE
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Handle modify mode — modify proposal or existing goal.
   */
  private async handleModify(
    input: SwordGateInput,
    currentState: SwordRefinementState | null
  ): Promise<SwordGateOutput> {
    // If modifying a proposal in progress
    if (currentState?.lastProposedPlan) {
      // Reset to clarifying stage to collect new preferences
      const resetState: SwordRefinementState = {
        ...currentState,
        stage: 'clarifying',
        turnCount: currentState.turnCount + 1,
      };

      await this.refinementStore.save(resetState);

      return {
        mode: 'modify',
        responseMessage: 'What would you like to change about the plan?',
        suppressModelGeneration: true,
      };
    }

    // If modifying an existing goal
    if (input.existingGoalId) {
      // TODO: Implement existing goal modification
      return {
        mode: 'modify',
        responseMessage: 'Goal modification is not yet implemented.',
        suppressModelGeneration: true,
      };
    }

    // No context for modification
    return {
      mode: 'capture',
      responseMessage: 'What would you like to learn?',
      suppressModelGeneration: true,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GOAL CREATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a goal from the proposal.
   */
  private async createGoalFromProposal(
    userId: UserId,
    inputs: SwordRefinementInputs,
    proposal: LessonPlanProposal
  ): AsyncAppResult<CreatedGoalResult> {
    if (!this.sparkEngine) {
      return err(appError('SERVICE_UNAVAILABLE', 'SparkEngine not available'));
    }

    // Build goal params
    const goalParams: CreateGoalParams = {
      userId,
      title: proposal.title,
      description: proposal.description,
      learningConfig: proposal.learningConfig,
      reminderConfig: {
        enabled: inputs.remindersEnabled ?? true,
        firstReminderHour: inputs.firstReminderHour ?? 9,
        lastReminderHour: inputs.lastReminderHour ?? 21,
        intervalHours: 4,
        channels: ['push'],
        shrinkSparksOnEscalation: true,
        maxRemindersPerDay: 3,
        quietDays: [],
        timezone: 'UTC',
      },
    };

    // Create goal via SparkEngine
    const goalResult = await this.sparkEngine.createGoal(goalParams);
    if (!goalResult.ok) {
      return goalResult;
    }

    const goal = goalResult.value;

    // Create quests
    const quests: Quest[] = [];
    for (const proposedQuest of proposal.quests) {
      const questResult = await this.sparkEngine.createQuest({
        goalId: goal.id,
        title: proposedQuest.title,
        description: proposedQuest.description,
        order: proposedQuest.order,
        topicIds: proposedQuest.topics.map((t) => t),
        estimatedDays: proposedQuest.estimatedDays,
      });

      if (questResult.ok) {
        quests.push(questResult.value);
      }
    }

    // Trigger onGoalCreated to generate steps and sparks
    await this.sparkEngine.onGoalCreated(goal, quests);

    return ok({
      goal,
      quests,
      summary: this.buildCreationSummary(goal, quests),
      stepsGenerationScheduled: true,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Build SwordGateInput from pipeline state.
   */
  private buildInput(state: PipelineState, context: PipelineContext): SwordGateInput {
    return {
      userId: state.input.userId,
      message: state.input.message,
      conversationHistory: [], // Could be populated from context
      intent: state.intent,
      shield: state.risk,
      stance: state.stance,
      sessionId: state.input.sessionId,
      requestId: context.requestId,
    };
  }

  /**
   * Determine gate action from output.
   */
  private determineAction(output: SwordGateOutput): GateAction {
    if (output.confirmationRequired) {
      return 'await_ack';
    }
    if (output.createdGoal) {
      return 'continue';
    }
    if (output.suppressModelGeneration) {
      return 'continue'; // But with suppressed generation
    }
    return 'continue';
  }

  /**
   * Build error gate result.
   */
  private gateError(
    message: string,
    startTime: number,
    cause?: Error | AppError
  ): GateResult<SwordGateOutput> {
    return {
      gateId: this.gateId,
      status: 'soft_fail',
      output: {
        mode: 'capture',
        responseMessage: message,
        suppressModelGeneration: false,
      },
      action: 'continue',
      failureReason: message,
      executionTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Fill default values for missing required fields.
   */
  private fillDefaults(inputs: SwordRefinementInputs): SwordRefinementInputs {
    return {
      ...inputs,
      userLevel: inputs.userLevel ?? 'beginner',
      dailyTimeCommitment: inputs.dailyTimeCommitment ?? 30,
      totalDuration: inputs.totalDuration ?? '4 weeks',
      totalDays: inputs.totalDays ?? 28,
      learningStyle: inputs.learningStyle ?? 'mixed',
      startDate: inputs.startDate ?? this.getTomorrowDate(),
      activeDays: inputs.activeDays ?? ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    };
  }

  /**
   * Get tomorrow's date in YYYY-MM-DD format.
   */
  private getTomorrowDate(): string {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  }

  /**
   * Build response for capture mode.
   */
  private buildCaptureResponse(topic: string, nextQuestion: string | null): string {
    let response = `Great! I'll help you learn ${topic}. `;

    if (nextQuestion) {
      response += nextQuestion;
    }

    return response;
  }

  /**
   * Build response for proposal.
   */
  private buildProposalResponse(proposal: LessonPlanProposal): string {
    const lines: string[] = [
      `Here's your learning plan for "${proposal.title}":`,
      '',
      `📅 Duration: ${proposal.totalDuration} (${proposal.totalDays} days)`,
      `📚 ${proposal.quests.length} sections covering ${proposal.topicsCovered.length} topics`,
      `🔍 Found ${proposal.resourcesFound} learning resources`,
      '',
      '**Sections:**',
    ];

    for (const quest of proposal.quests) {
      lines.push(`${quest.order}. ${quest.title} (${quest.estimatedDays} days)`);
    }

    if (proposal.gaps && proposal.gaps.length > 0) {
      lines.push('');
      lines.push('⚠️ Note: Some topics may have limited resources.');
    }

    lines.push('');
    lines.push('Does this look good? Say "yes" to create this plan, or tell me what you\'d like to change.');

    return lines.join('\n');
  }

  /**
   * Build summary for created goal.
   */
  private buildCreationSummary(goal: Goal, quests: readonly Quest[]): string {
    return `✅ Created "${goal.title}" with ${quests.length} sections. ` +
      `Your first lesson will be ready ${goal.learningConfig?.startDate ?? 'tomorrow'}. ` +
      `I'll send you reminders to help you stay on track!`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a SwordGate instance.
 */
export function createSwordGate(
  baseRefinementStore: IRefinementStore,
  config?: Partial<SwordGateConfig>,
  options?: {
    sparkEngine?: ISparkEngine;
    rateLimiter?: IGoalRateLimiter;
    resourceService?: IResourceDiscoveryService;
    curriculumService?: ICurriculumService;
    openaiApiKey?: string;
  }
): SwordGate {
  return new SwordGate(baseRefinementStore, config, options);
}
