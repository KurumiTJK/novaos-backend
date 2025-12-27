// ═══════════════════════════════════════════════════════════════════════════════
// EXPLORE FLOW — Goal Crystallization Conversation Manager
// NovaOS Gates — Phase 14A: SwordGate Explore Module
// ═══════════════════════════════════════════════════════════════════════════════
//
// Manages the exploration conversation that helps users crystallize
// vague intentions into concrete, actionable learning goals.
//
// Philosophy:
//   - Thinking partner, not interviewer
//   - Collaborative discovery, not interrogation
//   - Reflect understanding, don't just collect data
//   - Propose goals naturally, let user confirm or redirect
//
// Flow:
//   1. Acknowledge initial statement
//   2. Explore interests, motivations, constraints
//   3. Reflect emerging understanding
//   4. Propose crystallized goal when clarity threshold reached
//   5. Confirm and transition to refine phase
//
// ═══════════════════════════════════════════════════════════════════════════════

import OpenAI from 'openai';

import type { UserId, Timestamp } from '../../../types/branded.js';
import { createTimestamp } from '../../../types/branded.js';
import type { AsyncAppResult } from '../../../types/result.js';
import { ok, err, appError } from '../../../types/result.js';

import type {
  ExploreState,
  ExploreConfig,
  ExploreContext,
  ExploreMessage,
  ExploreFlowInput,
  ExploreFlowOutput,
  ExploreTransitionReason,
  ClarityDetectionResult,
} from './types.js';
import {
  DEFAULT_EXPLORE_CONFIG,
  buildExploreContext,
  createEmptyExploreContext,
} from './types.js';
import { ClarityDetector, createClarityDetector } from './clarity-detector.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPTS
// ═══════════════════════════════════════════════════════════════════════════════

const EXPLORE_SYSTEM_PROMPT = `You are a thoughtful learning coach helping someone discover what they want to learn. Your role is to be a thinking partner—collaborative, curious, and supportive.

## Your Approach

**Be a thinking partner, not an interviewer:**
- Have a natural conversation, not a Q&A session
- Share observations and reflections, not just questions
- Help them think through their interests, not just collect information

**Explore gently:**
- Ask ONE question at a time
- Build on what they share
- Notice patterns and connections
- Suggest possibilities they might not have considered

**Reflect understanding:**
- Periodically summarize what you're hearing
- Check if your understanding is accurate
- Help them see their interests from a new angle

## What to Discover

- What specifically interests them (narrow from broad topics)
- Why they want to learn this (career, curiosity, project, etc.)
- Their background/context (experience level, time available, constraints)
- Any specific outcomes they're hoping for

## When to Propose a Goal

When you have enough clarity (specific topic + some motivation), propose a concrete goal:
"Based on what you've shared, it sounds like you want to: [specific goal]. Does that capture what you're looking for?"

## Response Format

Keep responses conversational and concise (2-3 sentences typically). End with ONE of:
- A clarifying question
- A reflection to confirm understanding
- A proposed goal statement

Never use bullet points or structured formats—this is a conversation.

## Example Exchanges

User: "I want to do something with AI"
You: "AI is such a broad and exciting field! Are you more drawn to building things with AI—like chatbots or image generators—or understanding how AI actually works under the hood?"

User: "I'm a backend developer looking to expand my skills"
You: "Nice! Backend experience is a great foundation. What's prompting the expansion—are you eyeing a specific role, working on a project that needs new skills, or just following your curiosity?"

User: "I want to learn React for my portfolio"
You: "That's a clear goal! So you're looking to learn React specifically to build portfolio projects. Before we create a plan, are you starting fresh with frontend work, or do you have some HTML/CSS/JavaScript background already?"`;

const INSIGHT_EXTRACTION_PROMPT = `Analyze this conversation exchange and extract insights about the user's learning goals.

Return JSON only, no markdown:
{
  "interests": ["specific interests mentioned"],
  "constraints": ["things ruled out or limitations"],
  "background": ["experience, context, situation"],
  "motivations": ["why they want to learn"],
  "suggestedGoal": "concrete goal if clear enough, or null",
  "clarityScore": 0.0-1.0,
  "summary": "brief summary of current understanding"
}

Be specific—extract actual details, not generic placeholders.`;

// ═══════════════════════════════════════════════════════════════════════════════
// EXPLORE FLOW CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Manages the exploration conversation flow.
 */
export class ExploreFlow {
  private openai: OpenAI;
  private readonly config: ExploreConfig;
  private readonly clarityDetector: ClarityDetector;

  constructor(
    config: Partial<ExploreConfig> = {},
    openaiApiKey?: string
  ) {
    this.config = { ...DEFAULT_EXPLORE_CONFIG, ...config };
    
    const key = openaiApiKey ?? process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error('OpenAI API key required for ExploreFlow');
    }
    this.openai = new OpenAI({ apiKey: key });
    this.clarityDetector = createClarityDetector(this.config, key);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MAIN FLOW
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Process a message in the exploration flow.
   */
  async process(input: ExploreFlowInput): AsyncAppResult<ExploreFlowOutput> {
    const { message, currentState } = input;

    try {
      // If no current state, this is the start of exploration
      if (!currentState) {
        return this.startExploration(message);
      }

      // Check for special commands
      if (this.clarityDetector.isSkipRequest(message)) {
        return this.handleSkip(currentState, message);
      }

      // Check if user is confirming a proposed goal
      if (
        currentState.stage === 'proposing' &&
        this.clarityDetector.isConfirmation(message)
      ) {
        return this.handleConfirmation(currentState);
      }

      // Continue exploration conversation
      return this.continueExploration(currentState, message);
    } catch (error) {
      console.error('[EXPLORE_FLOW] Processing error:', error);
      return err(appError(
        'INTERNAL_ERROR',
        'Failed to process exploration message',
        { cause: error instanceof Error ? error : new Error(String(error)) }
      ));
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // START EXPLORATION
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Start a new exploration from initial statement.
   */
  private async startExploration(
    initialStatement: string
  ): AsyncAppResult<ExploreFlowOutput> {
    // First, assess initial clarity
    const clarity = await this.clarityDetector.assess(initialStatement);

    // If already clear, skip exploration
    if (clarity.isClear && clarity.extractedGoal) {
      return this.buildSkipResult(initialStatement, clarity, 'explicit_goal');
    }

    // Generate opening response
    const response = await this.generateResponse(initialStatement, null, clarity);

    // Create initial state
    const now = createTimestamp();
    const expiresAt = createTimestamp(
      new Date(Date.now() + this.config.exploreTtlSeconds * 1000)
    );

    const state: ExploreState = {
      userId: '' as UserId, // Will be set by store
      initialStatement,
      conversationHistory: [
        { role: 'user', content: initialStatement, timestamp: now },
        { role: 'assistant', content: response, timestamp: now, intent: 'exploring' },
      ],
      conversationSummary: '',
      interests: [],
      constraints: [],
      background: [],
      motivations: [],
      candidateGoals: [],
      crystallizedGoal: undefined,
      clarityScore: clarity.score,
      stage: 'exploring',
      turnCount: 1,
      maxTurns: this.config.maxTurns,
      createdAt: now,
      updatedAt: now,
      expiresAt,
    };

    return ok({
      state,
      response,
      shouldTransition: false,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CONTINUE EXPLORATION
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Continue an existing exploration conversation.
   */
  private async continueExploration(
    currentState: ExploreState,
    userMessage: string
  ): AsyncAppResult<ExploreFlowOutput> {
    const now = createTimestamp();

    // Check if max turns exceeded
    if (currentState.turnCount >= currentState.maxTurns) {
      return this.handleMaxTurns(currentState, userMessage);
    }

    // Extract insights from the new message
    const insights = await this.extractInsights(currentState, userMessage);

    // Assess current clarity
    const clarity = await this.clarityDetector.assess(
      userMessage,
      currentState
    );

    // Update state with new insights
    const updatedState: ExploreState = {
      ...currentState,
      conversationHistory: [
        ...currentState.conversationHistory,
        { role: 'user', content: userMessage, timestamp: now },
      ],
      interests: [...new Set([...currentState.interests, ...insights.interests])],
      constraints: [...new Set([...currentState.constraints, ...insights.constraints])],
      background: [...new Set([...currentState.background, ...insights.background])],
      motivations: [...new Set([...currentState.motivations, ...insights.motivations])],
      conversationSummary: insights.summary || currentState.conversationSummary,
      clarityScore: Math.max(currentState.clarityScore, clarity.score),
      turnCount: currentState.turnCount + 1,
      updatedAt: now,
    };

    // Check if clarity threshold reached
    const shouldPropose = 
      updatedState.clarityScore >= this.config.clarityThreshold &&
      updatedState.turnCount >= this.config.minTurnsBeforeTransition;

    if (shouldPropose && insights.suggestedGoal) {
      return this.proposeGoal(updatedState, insights.suggestedGoal);
    }

    // Generate continuation response
    const response = await this.generateResponse(userMessage, updatedState, clarity);

    // Add assistant message to history
    const finalState: ExploreState = {
      ...updatedState,
      conversationHistory: [
        ...updatedState.conversationHistory,
        { role: 'assistant', content: response, timestamp: now, intent: 'exploring' },
      ],
    };

    return ok({
      state: finalState,
      response,
      shouldTransition: false,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GOAL PROPOSAL
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Propose a crystallized goal to the user.
   */
  private async proposeGoal(
    state: ExploreState,
    proposedGoal: string
  ): AsyncAppResult<ExploreFlowOutput> {
    const now = createTimestamp();

    // Build proposal message
    const response = this.buildProposalMessage(state, proposedGoal);

    const updatedState: ExploreState = {
      ...state,
      stage: 'proposing',
      candidateGoals: [...state.candidateGoals, proposedGoal],
      conversationHistory: [
        ...state.conversationHistory,
        { role: 'assistant', content: response, timestamp: now, intent: 'proposing' },
      ],
      updatedAt: now,
    };

    return ok({
      state: updatedState,
      response,
      shouldTransition: false,
    });
  }

  /**
   * Build the proposal message.
   */
  private buildProposalMessage(state: ExploreState, proposedGoal: string): string {
    const parts: string[] = [];

    // Add reflection of what we learned
    if (state.motivations.length > 0) {
      parts.push(`I hear that you're motivated by ${state.motivations[0]?.toLowerCase()}.`);
    }

    // Propose the goal
    parts.push(`Based on our conversation, it sounds like you want to: **${proposedGoal}**`);
    parts.push('\nDoes that capture what you\'re looking for? If so, we can start building your learning plan. Or let me know if you\'d like to adjust the focus.');

    return parts.join(' ');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CONFIRMATION
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Handle user confirming a proposed goal.
   */
  private async handleConfirmation(
    state: ExploreState
  ): AsyncAppResult<ExploreFlowOutput> {
    const now = createTimestamp();
    const crystallizedGoal = state.candidateGoals[state.candidateGoals.length - 1] ?? state.initialStatement;

    const response = `Great! Let's create a learning plan for: **${crystallizedGoal}**\n\nI'll ask you a few quick questions about your schedule and preferences to customize the plan.`;

    const finalState: ExploreState = {
      ...state,
      stage: 'confirmed',
      crystallizedGoal,
      clarityScore: 1.0,
      conversationHistory: [
        ...state.conversationHistory,
        { role: 'assistant', content: response, timestamp: now, intent: 'transitioning' },
      ],
      updatedAt: now,
    };

    return ok({
      state: finalState,
      response,
      shouldTransition: true,
      transitionContext: buildExploreContext(finalState),
      transitionReason: 'goal_confirmed',
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SKIP HANDLING
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Handle user requesting to skip exploration.
   */
  private handleSkip(
    state: ExploreState,
    message: string
  ): AsyncAppResult<ExploreFlowOutput> {
    const now = createTimestamp();

    // Use the most recent candidate goal, or extract from initial statement
    const goal = state.candidateGoals[state.candidateGoals.length - 1] 
      ?? this.extractBasicGoal(state.initialStatement);

    const response = `Got it! Let's get straight to building your plan for: **${goal}**\n\nJust a few quick questions about your schedule.`;

    const finalState: ExploreState = {
      ...state,
      stage: 'skipped',
      crystallizedGoal: goal,
      conversationHistory: [
        ...state.conversationHistory,
        { role: 'user', content: message, timestamp: now },
        { role: 'assistant', content: response, timestamp: now, intent: 'transitioning' },
      ],
      updatedAt: now,
    };

    return ok({
      state: finalState,
      response,
      shouldTransition: true,
      transitionContext: buildExploreContext(finalState),
      transitionReason: 'user_skip',
    });
  }

  /**
   * Build skip result for initially clear goals.
   */
  private buildSkipResult(
    initialStatement: string,
    clarity: ClarityDetectionResult,
    reason: ExploreTransitionReason
  ): AsyncAppResult<ExploreFlowOutput> {
    const now = createTimestamp();
    const goal = clarity.extractedGoal ?? initialStatement;

    const response = `I'll help you learn ${goal}. Let me ask a few quick questions to customize your learning plan.`;

    const state: ExploreState = {
      userId: '' as UserId,
      initialStatement,
      conversationHistory: [
        { role: 'user', content: initialStatement, timestamp: now },
        { role: 'assistant', content: response, timestamp: now, intent: 'transitioning' },
      ],
      conversationSummary: 'User provided clear goal - skipping exploration.',
      interests: [],
      constraints: [],
      background: [],
      motivations: [],
      candidateGoals: [goal],
      crystallizedGoal: goal,
      clarityScore: 1.0,
      stage: 'confirmed',
      turnCount: 1,
      maxTurns: this.config.maxTurns,
      createdAt: now,
      updatedAt: now,
      expiresAt: createTimestamp(new Date(Date.now() + this.config.exploreTtlSeconds * 1000)),
    };

    return ok({
      state,
      response,
      shouldTransition: true,
      transitionContext: createEmptyExploreContext(goal),
      transitionReason: reason,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MAX TURNS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Handle max turns reached - synthesize and transition.
   */
  private async handleMaxTurns(
    state: ExploreState,
    userMessage: string
  ): AsyncAppResult<ExploreFlowOutput> {
    const now = createTimestamp();

    // Synthesize a goal from what we have
    const synthesizedGoal = await this.synthesizeGoal(state);

    const response = `We've explored quite a bit! Based on everything you've shared, I'd suggest focusing on: **${synthesizedGoal}**\n\nLet's create a learning plan around this. I'll ask a few questions about your schedule.`;

    const finalState: ExploreState = {
      ...state,
      stage: 'confirmed',
      crystallizedGoal: synthesizedGoal,
      candidateGoals: [...state.candidateGoals, synthesizedGoal],
      conversationHistory: [
        ...state.conversationHistory,
        { role: 'user', content: userMessage, timestamp: now },
        { role: 'assistant', content: response, timestamp: now, intent: 'transitioning' },
      ],
      clarityScore: 0.75, // Moderate confidence for synthesized goals
      updatedAt: now,
    };

    return ok({
      state: finalState,
      response,
      shouldTransition: true,
      transitionContext: buildExploreContext(finalState),
      transitionReason: 'max_turns',
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // LLM INTERACTIONS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Generate a response for the exploration conversation.
   */
  private async generateResponse(
    userMessage: string,
    state: ExploreState | null,
    clarity: ClarityDetectionResult
  ): Promise<string> {
    try {
      // Build conversation history for context
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: 'system', content: EXPLORE_SYSTEM_PROMPT },
      ];

      // Add conversation history if exists
      if (state) {
        for (const msg of state.conversationHistory.slice(-6)) { // Last 6 messages
          messages.push({
            role: msg.role,
            content: msg.content,
          });
        }
      }

      // Add current message with context
      let contextNote = '';
      if (clarity.unclearAspects.length > 0) {
        contextNote = `\n[Still unclear: ${clarity.unclearAspects.join(', ')}]`;
      }
      if (clarity.suggestedQuestion) {
        contextNote += `\n[Consider asking about: ${clarity.suggestedQuestion}]`;
      }

      messages.push({
        role: 'user',
        content: userMessage + contextNote,
      });

      const response = await this.openai.chat.completions.create({
        model: this.config.llmModel,
        messages,
        max_tokens: 200,
        temperature: this.config.llmTemperature,
      });

      return response.choices[0]?.message?.content?.trim() ?? 
        "I'd love to hear more about what you're hoping to learn. What draws you to this topic?";
    } catch (error) {
      console.error('[EXPLORE_FLOW] Response generation error:', error);
      return "Tell me more about what you're hoping to learn—what draws you to this topic?";
    }
  }

  /**
   * Extract insights from the conversation.
   */
  private async extractInsights(
    state: ExploreState,
    userMessage: string
  ): Promise<{
    interests: string[];
    constraints: string[];
    background: string[];
    motivations: string[];
    suggestedGoal: string | null;
    summary: string;
  }> {
    try {
      // Build context
      const recentHistory = state.conversationHistory.slice(-4)
        .map(m => `${m.role}: ${m.content}`)
        .join('\n');

      const context = `Previous conversation:\n${recentHistory}\n\nNew user message: "${userMessage}"`;

      const response = await this.openai.chat.completions.create({
        model: this.config.llmModel,
        messages: [
          { role: 'system', content: INSIGHT_EXTRACTION_PROMPT },
          { role: 'user', content: context },
        ],
        max_tokens: 300,
        temperature: 0,
      });

      const content = response.choices[0]?.message?.content?.trim() ?? '{}';
      
      // Parse JSON
      let jsonStr = content;
      if (content.includes('```')) {
        const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        jsonStr = match?.[1]?.trim() ?? content;
      }

      const parsed = JSON.parse(jsonStr);

      return {
        interests: Array.isArray(parsed.interests) ? parsed.interests : [],
        constraints: Array.isArray(parsed.constraints) ? parsed.constraints : [],
        background: Array.isArray(parsed.background) ? parsed.background : [],
        motivations: Array.isArray(parsed.motivations) ? parsed.motivations : [],
        suggestedGoal: parsed.suggestedGoal || null,
        summary: parsed.summary || '',
      };
    } catch (error) {
      console.error('[EXPLORE_FLOW] Insight extraction error:', error);
      return {
        interests: [],
        constraints: [],
        background: [],
        motivations: [],
        suggestedGoal: null,
        summary: '',
      };
    }
  }

  /**
   * Synthesize a goal when max turns reached.
   */
  private async synthesizeGoal(state: ExploreState): Promise<string> {
    // If we have candidate goals, use the most recent
    if (state.candidateGoals.length > 0) {
      return state.candidateGoals[state.candidateGoals.length - 1]!;
    }

    // Try to synthesize from interests and initial statement
    if (state.interests.length > 0) {
      const primaryInterest = state.interests[0];
      return `Learn ${primaryInterest}`;
    }

    // Fall back to cleaned initial statement
    return this.extractBasicGoal(state.initialStatement);
  }

  /**
   * Extract a basic goal from a statement.
   */
  private extractBasicGoal(statement: string): string {
    return statement
      .replace(/^(i want to|i'd like to|help me|teach me)\s+/i, '')
      .replace(/^(learn|study|understand|master)\s+/i, 'Learn ')
      .trim()
      .replace(/^./, c => c.toUpperCase());
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create an ExploreFlow instance.
 */
export function createExploreFlow(
  config?: Partial<ExploreConfig>,
  openaiApiKey?: string
): ExploreFlow {
  return new ExploreFlow(config, openaiApiKey);
}
