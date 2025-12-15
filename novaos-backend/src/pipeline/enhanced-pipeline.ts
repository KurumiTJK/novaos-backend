// ═══════════════════════════════════════════════════════════════════════════════
// ENHANCED PIPELINE — Full Integration of Memory, Sword, and Chat
// ═══════════════════════════════════════════════════════════════════════════════
//
// Wraps the ExecutionPipeline with:
// - Pre-generation context injection (Memory + Sword)
// - Post-generation processing (fact extraction, spark suggestions)
// - Conversation history management
// - Session tracking
//
// This is the recommended entry point for chat interactions.
//
// ═══════════════════════════════════════════════════════════════════════════════

import {
  ExecutionPipeline,
  type PipelineConfig,
} from './execution-pipeline.js';

import type {
  PipelineContext,
  PipelineResult,
  ActionSource,
} from '../types/index.js';

import {
  getContextBuilder,
  getPipelineHooks,
  type UnifiedContext,
  type PreGenerationResult,
  type PostGenerationResult,
} from '../core/context/index.js';

import { conversations, type Conversation } from '../conversations/index.js';
import { NOVA_SYSTEM_PROMPT } from '../providers/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface EnhancedPipelineConfig extends PipelineConfig {
  enableMemory?: boolean;
  enableSword?: boolean;
  enableAutoExtract?: boolean;
  enableSparkSuggestions?: boolean;
}

export interface EnhancedContext {
  userId: string;
  conversationId?: string;  // Optional - will be created if not provided
  sessionId?: string;
  requestId?: string;
  timestamp: number;
  actionSources: ActionSource[];
  timezone?: string;
  locale?: string;
  ackTokenValid?: boolean;
}

export interface EnhancedResult extends PipelineResult {
  context?: UnifiedContext;
  hooks?: {
    pre: PreGenerationResult;
    post: PostGenerationResult;
  };
  conversationId?: string;
  sparkSuggested?: {
    id: string;
    action: string;
    estimatedMinutes: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// ENHANCED PIPELINE CLASS
// ─────────────────────────────────────────────────────────────────────────────────

export class EnhancedPipeline {
  private basePipeline: ExecutionPipeline;
  private contextBuilder = getContextBuilder();
  private hooks = getPipelineHooks();
  
  private enableMemory: boolean;
  private enableSword: boolean;
  private enableAutoExtract: boolean;
  private enableSparkSuggestions: boolean;
  
  constructor(config: EnhancedPipelineConfig = {}) {
    this.basePipeline = new ExecutionPipeline(config);
    
    this.enableMemory = config.enableMemory ?? true;
    this.enableSword = config.enableSword ?? true;
    this.enableAutoExtract = config.enableAutoExtract ?? true;
    this.enableSparkSuggestions = config.enableSparkSuggestions ?? true;
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // MAIN ENTRY POINT
  // ─────────────────────────────────────────────────────────────────────────────
  
  async execute(
    userMessage: string,
    context: EnhancedContext
  ): Promise<EnhancedResult> {
    const startTime = Date.now();
    const userId = context.userId ?? 'anonymous';
    let conversationId = context.conversationId ?? crypto.randomUUID();
    
    try {
      // ─── STEP 1: ENSURE CONVERSATION ───
      const conversation = await conversations.getOrCreate(userId, conversationId);
      conversationId = conversation.id;
      
      // ─── STEP 2: PRE-GENERATION HOOKS ───
      const preResult = await this.runPreGeneration(
        userId,
        userMessage,
        conversationId
      );
      
      // ─── STEP 3: ADD USER MESSAGE TO HISTORY ───
      await conversations.addUserMessage(conversationId, userMessage);
      
      // ─── STEP 4: BUILD CONVERSATION HISTORY ───
      const messages = await conversations.getMessages(conversationId, 10);
      const history = (messages ?? []).map((m: any) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
      
      // ─── STEP 5: EXECUTE BASE PIPELINE ───
      const pipelineContext: PipelineContext = {
        ...context,
        conversationId,
        conversationHistory: history.slice(0, -1), // Exclude current message (already in userMessage)
      };
      
      // Override system prompt with context-injected version
      const modifiedConfig: PipelineConfig = {
        systemPrompt: preResult.modifiedSystemPrompt,
      };
      
      // Create a new pipeline instance with modified system prompt
      const enhancedBasePipeline = new ExecutionPipeline(modifiedConfig);
      const baseResult = await enhancedBasePipeline.execute(userMessage, pipelineContext);
      
      // ─── STEP 6: POST-GENERATION HOOKS ───
      const postResult = await this.runPostGeneration(
        userId,
        userMessage,
        baseResult.response,
        conversationId
      );
      
      // ─── STEP 7: ENHANCE RESPONSE ───
      let finalResponse = baseResult.response;
      
      if (baseResult.status === 'success') {
        finalResponse = this.hooks.enhanceResponse(
          baseResult.response,
          postResult,
          preResult.unifiedContext
        );
      }
      
      // ─── STEP 8: SAVE ASSISTANT RESPONSE ───
      await conversations.addAssistantMessage(conversationId, finalResponse, {
        stance: baseResult.stance,
        status: baseResult.status,
      });
      
      // ─── STEP 9: BUILD RESULT ───
      const result: EnhancedResult = {
        ...baseResult,
        response: finalResponse,
        context: preResult.unifiedContext,
        hooks: {
          pre: preResult,
          post: postResult,
        },
        conversationId,
        metadata: {
          ...baseResult.metadata,
          totalTimeMs: Date.now() - startTime,
        },
      };
      
      // Add spark info if suggested
      if (postResult.sparkSuggested) {
        result.sparkSuggested = {
          id: postResult.sparkSuggested.id,
          action: postResult.sparkSuggested.action,
          estimatedMinutes: postResult.sparkSuggested.estimatedMinutes,
        };
      }
      
      return result;
      
    } catch (error) {
      console.error('[ENHANCED_PIPELINE] Error:', error);
      
      return {
        status: 'error',
        response: 'An error occurred. Please try again.',
        stance: 'shield',
        gateResults: {} as any,
        metadata: {
          requestId: context.requestId ?? 'unknown',
          totalTimeMs: Date.now() - startTime,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        conversationId,
      };
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // PRE-GENERATION
  // ─────────────────────────────────────────────────────────────────────────────
  
  private async runPreGeneration(
    userId: string,
    message: string,
    conversationId: string
  ): Promise<PreGenerationResult> {
    if (!this.enableMemory && !this.enableSword) {
      // No context injection - return base system prompt
      return {
        contextInjection: '',
        unifiedContext: {
          user: { profile: null, preferences: null },
          memory: { summary: '', facts: [], preferences: [], activeProjects: [], warnings: [] },
          sword: { activeGoals: [], currentSpark: null, overallProgress: 0, nextAction: null },
          conversation: { id: conversationId, recentMessages: [], messageCount: 0, topics: [] },
          session: { timestamp: new Date().toISOString() },
        },
        modifiedSystemPrompt: NOVA_SYSTEM_PROMPT,
      };
    }
    
    return this.hooks.preGeneration(
      userId,
      message,
      NOVA_SYSTEM_PROMPT,
      conversationId
    );
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // POST-GENERATION
  // ─────────────────────────────────────────────────────────────────────────────
  
  private async runPostGeneration(
    userId: string,
    userMessage: string,
    assistantResponse: string,
    conversationId: string
  ): Promise<PostGenerationResult> {
    return this.hooks.postGeneration(userId, userMessage, assistantResponse, {
      extractMemory: this.enableAutoExtract,
      suggestSparks: this.enableSparkSuggestions,
      updateLastInteraction: true,
      conversationId,
    });
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // UTILITY METHODS
  // ─────────────────────────────────────────────────────────────────────────────
  
  async getContextPreview(userId: string, conversationId: string | null = null): Promise<UnifiedContext> {
    return this.contextBuilder.build(userId, conversationId, '');
  }
  
  async getUserName(userId: string): Promise<string | null> {
    return this.contextBuilder.getUserName(userId);
  }
  
  async hasActiveSpark(userId: string): Promise<boolean> {
    return this.contextBuilder.hasActiveSpark(userId);
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // SIMPLE CHAT (no hooks, for testing)
  // ─────────────────────────────────────────────────────────────────────────────
  
  async simpleChat(
    userMessage: string,
    context: PipelineContext
  ): Promise<PipelineResult> {
    return this.basePipeline.execute(userMessage, context);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let enhancedPipeline: EnhancedPipeline | null = null;

export function getEnhancedPipeline(config?: EnhancedPipelineConfig): EnhancedPipeline {
  if (!enhancedPipeline) {
    enhancedPipeline = new EnhancedPipeline(config);
  }
  return enhancedPipeline;
}

export function createEnhancedPipeline(config?: EnhancedPipelineConfig): EnhancedPipeline {
  return new EnhancedPipeline(config);
}
