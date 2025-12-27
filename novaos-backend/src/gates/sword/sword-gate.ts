// ═══════════════════════════════════════════════════════════════════════════════
// SWORDGATE — Goal Creation Pipeline Gate
// NovaOS Gates — Phase 14A: SwordGate Explore Module
// ═══════════════════════════════════════════════════════════════════════════════
//
// Constitution §2.3: Sword — Forward Motion
//
// SwordGate orchestrates goal creation through:
//   1. Mode Detection — Determine capture/explore/refine/suggest/create/modify
//   2. Goal Exploration — NEW: Dialogue for crystallizing vague goals
//   3. Goal Capture — Extract and sanitize goal statement
//   4. Refinement Flow — Multi-turn clarification conversation
//   5. Plan Generation — Create lesson plan proposal
//   6. Confirmation — User confirms before creation
//   7. Goal Creation — Create goal via SparkEngine
//
// Integration points:
//   - ModeDetector: Classify user intent
//   - ExploreFlow: Goal crystallization dialogue (NEW)
//   - RefinementFlow: Manage multi-turn conversation
//   - SwordRefinementStore: Persist refinement state
//   - ExploreStore: Persist exploration state (NEW)
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
  ExploreContext,
  ViewTarget,
  ViewRequest,
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

// Phase 14A: Import explore components
import type { ExploreState } from './explore/types.js';
import { buildExploreContext } from './explore/types.js';
import { ExploreStore, createExploreStore } from './explore/explore-store.js';
import { ExploreFlow, createExploreFlow } from './explore/explore-flow.js';
import { ClarityDetector, createClarityDetector } from './explore/clarity-detector.js';

// Phase 14B: Import view components
import { ViewFlow, createViewFlow } from './view-flow.js';

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
 * exploration, refinement, plan generation, and final creation.
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

  // Phase 14A: Explore components
  private readonly exploreStore: ExploreStore;
  private readonly exploreFlow: ExploreFlow;
  private readonly clarityDetector: ClarityDetector;

  // Phase 14B: View component
  private readonly viewFlow: ViewFlow | null = null;

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

    // Phase 14A: Initialize explore components
    this.exploreStore = createExploreStore(baseRefinementStore, {
      maxTurns: this.config.maxExploreTurns,
      exploreTtlSeconds: this.config.exploreTtlSeconds,
    });
    this.exploreFlow = createExploreFlow({
      maxTurns: this.config.maxExploreTurns,
      clarityThreshold: this.config.exploreClarityThreshold,
    }, options.openaiApiKey);
    this.clarityDetector = createClarityDetector({}, options.openaiApiKey);

    this.sparkEngine = options.sparkEngine;
    this.rateLimiter = options.rateLimiter;

    // Phase 14B: Initialize ViewFlow if sparkEngine available
    if (this.sparkEngine) {
      this.viewFlow = createViewFlow(this.sparkEngine, {
        defaultUpcomingDays: this.config.viewDefaultUpcomingDays,
        maxGoalsToList: this.config.viewMaxGoalsToList,
        includeProgressInList: this.config.viewIncludeProgressInList,
      });
    }
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

      // Phase 14A: Get existing explore state
      let exploreState: ExploreState | null = null;
      if (this.config.enableExplore) {
        const exploreResult = await this.exploreStore.get(input.userId);
        if (exploreResult.ok) {
          exploreState = exploreResult.value;
        }
      }

      // Detect mode (Phase 14A: pass explore state)
      const modeResult = await this.modeDetector.detect(input, refinementState, exploreState);
      console.log(`[SWORD_GATE] Mode detected: ${modeResult.mode} (${modeResult.detectionMethod})`);

      // Execute mode-specific handler
      const output = await this.executeMode(input, refinementState, exploreState, modeResult);

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
    exploreState: ExploreState | null,
    modeResult: { mode: SwordGateMode; bypassExplore?: boolean; bypassReason?: string }
  ): Promise<SwordGateOutput> {
    const { mode, bypassExplore, bypassReason } = modeResult;

    switch (mode) {
      case 'capture':
        // Phase 14A: Check if we should route to explore or bypass
        if (this.config.enableExplore && !bypassExplore) {
          return this.handleCaptureWithExplore(input);
        }
        return this.handleCapture(input, bypassReason === 'clear_goal');

      case 'explore':
        return this.handleExplore(input, exploreState);

      case 'refine':
        // Phase 14A: Check for explore context transition
        if (exploreState && !this.isExploreTerminal(exploreState)) {
          return this.handleExploreToRefine(input, exploreState);
        }
        return this.handleRefine(input, refinementState!);

      case 'suggest':
        return this.handleSuggest(input, refinementState!);

      case 'create':
        return this.handleCreate(input, refinementState!);

      case 'modify':
        return this.handleModify(input, refinementState);

      // Phase 14B: View mode
      case 'view':
        return this.handleView(input, modeResult.viewTarget, modeResult.viewRequest);

      default:
        return {
          mode: 'capture',
          responseMessage: 'What would you like to learn?',
          suppressModelGeneration: true,
        };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // EXPLORE MODE (Phase 14A - NEW)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Handle capture with explore check - determines if explore is needed.
   */
  private async handleCaptureWithExplore(input: SwordGateInput): Promise<SwordGateOutput> {
    // Check clarity of the goal statement
    const clarityResult = await this.clarityDetector.assess(input.message);

    // If goal is clear enough, skip explore
    if (clarityResult.isClear) {
      console.log(`[SWORD_GATE] Goal is clear (${clarityResult.score}), skipping explore`);
      return this.handleCapture(input, true);
    }

    // If user wants to skip exploration
    if (this.clarityDetector.isSkipRequest(input.message)) {
      console.log('[SWORD_GATE] User requested to skip exploration');
      return this.handleCapture(input, true);
    }

    // Start exploration for vague goal
    console.log(`[SWORD_GATE] Goal is vague (${clarityResult.score}), starting explore`);
    return this.handleExploreStart(input);
  }

  /**
   * Start a new exploration session.
   */
  private async handleExploreStart(input: SwordGateInput): Promise<SwordGateOutput> {
    // Start exploration flow
    const result = await this.exploreFlow.process({
      message: input.message,
      currentState: null,
    });

    if (!result.ok) {
      console.error('[SWORD_GATE] Failed to start exploration:', result.error);
      // Fall back to regular capture
      return this.handleCapture(input, false);
    }

    const { state, response } = result.value;

    // ★ FIX: Set userId on state before saving (ExploreFlow returns empty userId)
    const stateWithUserId: ExploreState = {
      ...state,
      userId: input.userId,
    };

    // Save explore state
    const saveResult = await this.exploreStore.save(stateWithUserId);
    if (!saveResult.ok) {
      console.error('[SWORD_GATE] Failed to save explore state:', saveResult.error);
    }

    return {
      mode: 'explore',
      explorationInProgress: true,
      clarityScore: stateWithUserId.clarityScore,
      responseMessage: response,
      suppressModelGeneration: true,
    };
  }

  /**
   * Continue an existing exploration session.
   */
  private async handleExplore(
    input: SwordGateInput,
    exploreState: ExploreState | null
  ): Promise<SwordGateOutput> {
    // If no explore state, start new exploration
    if (!exploreState) {
      return this.handleExploreStart(input);
    }

    // Check for expiration
    if (this.exploreStore.isExpired(exploreState)) {
      await this.exploreStore.delete(input.userId);
      return {
        mode: 'capture',
        responseMessage: 'Your exploration session has expired. What would you like to learn?',
        suppressModelGeneration: true,
      };
    }

    // Check for skip request
    if (this.clarityDetector.isSkipRequest(input.message)) {
      const skipResult = await this.exploreFlow.process({
        message: input.message,
        currentState: exploreState,
      });
      if (skipResult.ok) {
        await this.exploreStore.skip(input.userId);
        return this.handleExploreToRefine(input, skipResult.value.state);
      }
    }

    // Check for confirmation of proposed goal
    if (exploreState.stage === 'proposing' && this.clarityDetector.isConfirmation(input.message)) {
      const goalToConfirm = exploreState.crystallizedGoal ?? exploreState.candidateGoals[exploreState.candidateGoals.length - 1] ?? exploreState.initialStatement;
      await this.exploreStore.crystallizeGoal(input.userId, goalToConfirm);
      return this.handleExploreToRefine(input, exploreState);
    }

    // Continue exploration
    const result = await this.exploreFlow.process({
      message: input.message,
      currentState: exploreState,
    });

    if (!result.ok) {
      console.error('[SWORD_GATE] Exploration continue failed:', result.error);
      return {
        mode: 'explore',
        explorationInProgress: true,
        responseMessage: "I'm having trouble understanding. Could you tell me more about what you're hoping to achieve?",
        suppressModelGeneration: true,
      };
    }

    const { state: updatedState, response, shouldTransition, transitionReason } = result.value;

    // Save updated state
    await this.exploreStore.save(updatedState);

    // Check if we should transition to refine
    if (shouldTransition) {
      console.log(`[SWORD_GATE] Transitioning from explore to refine: ${transitionReason}`);
      return this.handleExploreToRefine(input, updatedState);
    }

    return {
      mode: 'explore',
      explorationInProgress: true,
      clarityScore: updatedState.clarityScore,
      responseMessage: response,
      suppressModelGeneration: true,
    };
  }

  /**
   * Transition from explore to refine with context.
   */
  private async handleExploreToRefine(
    input: SwordGateInput,
    exploreState: ExploreState
  ): Promise<SwordGateOutput> {
    // Build explore context for refinement
    const context = buildExploreContext(exploreState);

    // Get crystallized goal or synthesize one
    const goalStatement = exploreState.crystallizedGoal ?? exploreState.initialStatement;

    // Clean up explore state
    await this.exploreStore.delete(input.userId);

    // Sanitize the goal statement
    const sanitizeResult = this.sanitizer.sanitize(goalStatement);

    if (!sanitizeResult.valid) {
      return {
        mode: 'capture',
        responseMessage: sanitizeResult.errorMessage ?? 'Please provide a valid learning goal.',
        suppressModelGeneration: true,
      };
    }

    // Check rate limits
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

    // Initiate refinement with explore context
    const newState = this.refinementFlow.initiate(
      input.userId,
      sanitizeResult.sanitized!,
      input.userPreferences
    );

    // Add explore context to inputs
    const stateWithContext: SwordRefinementState = {
      ...newState,
      inputs: {
        ...newState.inputs,
        exploreContext: context,
      },
    };

    // Save refinement state
    const saveResult = await this.refinementStore.save(stateWithContext);
    if (!saveResult.ok) {
      console.error('[SWORD_GATE] Failed to save refinement state:', saveResult.error);
    }

    // Get the first question
    const nextQuestion = this.refinementFlow.getNextQuestion(stateWithContext);

    // Build a response that acknowledges the exploration
    const response = context
      ? `Great! So you want to ${goalStatement}. ${nextQuestion ?? ''}`
      : `Got it! I'll help you ${goalStatement}. ${nextQuestion ?? ''}`;

    return {
      mode: 'refine',
      exploreContext: context,
      clarityScore: exploreState.clarityScore,
      nextQuestion: nextQuestion ?? undefined,
      refinementProgress: 0.25,
      missingFields: getMissingRequiredFields(stateWithContext.inputs),
      responseMessage: response,
      suppressModelGeneration: true,
    };
  }

  /**
   * Check if explore state is terminal.
   */
  private isExploreTerminal(state: ExploreState): boolean {
    return ['confirmed', 'skipped', 'expired'].includes(state.stage);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CAPTURE MODE
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Handle capture mode — extract goal statement and start refinement.
   */
  private async handleCapture(
    input: SwordGateInput,
    skipExplore: boolean = false
  ): Promise<SwordGateOutput> {
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

    // ─────────────────────────────────────────────────────────────────────────
    // GRACEFUL FALLBACK: If SparkEngine isn't available, show success with
    // plan details but note that persistence isn't available.
    // This allows the refinement flow to complete in dev/testing environments.
    // ─────────────────────────────────────────────────────────────────────────
    if (!this.sparkEngine) {
      console.warn('[SWORD_GATE] SparkEngine not available - using graceful fallback');
      
      // Clean up refinement state
      await this.refinementStore.delete(input.userId);
      
      const proposal = currentState.lastProposedPlan;
      const inputs = currentState.inputs;
      
      // Build a summary response
      const summary = this.buildFallbackSummary(inputs, proposal);
      
      return {
        mode: 'create',
        responseMessage: summary,
        suppressModelGeneration: true,
        // Note: createdGoal is undefined since we couldn't persist
      };
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

  /**
   * Build a summary when SparkEngine isn't available.
   * Provides a positive completion message with plan details.
   */
  private buildFallbackSummary(
    inputs: SwordRefinementInputs,
    proposal: LessonPlanProposal
  ): string {
    const lines: string[] = [
      `✅ Your learning plan for "${inputs.goalStatement}" is ready!`,
      '',
      `📅 **Duration:** ${inputs.totalDuration} (${inputs.totalDays} days)`,
      `⏱️ **Daily commitment:** ${inputs.dailyTimeCommitment} minutes`,
      `📊 **Level:** ${inputs.userLevel}`,
      '',
      `**Your ${proposal.quests.length} section${proposal.quests.length > 1 ? 's' : ''}:**`,
    ];

    for (const quest of proposal.quests) {
      lines.push(`  ${quest.order}. ${quest.title} (${quest.estimatedDays} days)`);
    }

    lines.push('');
    lines.push('🚧 *Note: Goal persistence requires SparkEngine integration.*');
    lines.push('*Your plan details are shown above but not saved to the database.*');

    return lines.join('\n');
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
  // VIEW MODE (Phase 14B)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle view mode — retrieve and display existing goals/lessons/progress.
   */
  private async handleView(
    input: SwordGateInput,
    viewTarget?: ViewTarget,
    viewRequest?: ViewRequest
  ): Promise<SwordGateOutput> {
    // Check if ViewFlow is available
    if (!this.viewFlow) {
      return {
        mode: 'view',
        responseMessage: '⚠️ View functionality is not available. SparkEngine not configured.',
        suppressModelGeneration: true,
      };
    }

    // Build view request
    const request: ViewRequest = viewRequest ?? {
      target: viewTarget ?? 'today',
      goalId: input.existingGoalId,
    };

    // Process view request
    const result = await this.viewFlow.process(input.userId, request);

    if (!result.ok) {
      // Handle error gracefully
      console.error('[SWORD_GATE] View error:', result.error);
      return {
        mode: 'view',
        viewTarget: request.target,
        responseMessage: '❌ Unable to retrieve your learning content. Please try again.',
        suppressModelGeneration: true,
      };
    }

    const viewResult = result.value;

    return {
      mode: 'view',
      viewTarget: request.target,
      viewMessage: viewResult.message,
      viewHasContent: viewResult.hasContent,
      viewSuggestedActions: viewResult.suggestedActions,
      responseMessage: viewResult.message,
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
        channels: { email: false, sms: false, push: true },
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
      userId: state.input.userId as UserId,
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
    return tomorrow.toISOString().split('T')[0] ?? '';
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
