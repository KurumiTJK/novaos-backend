// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE HOOKS — Pre/Post Processing for Memory and Sword Integration
// ═══════════════════════════════════════════════════════════════════════════════
//
// These hooks are executed before and after LLM generation to:
// - Inject personalized context (pre-generation)
// - Extract facts and update memory (post-generation)
// - Suggest sparks when relevant (post-generation)
// - Track conversation flow for goals (post-generation)
//
// ═══════════════════════════════════════════════════════════════════════════════

import { getMemoryExtractor, getMemoryStore, MemoryExtractor, MemoryStore } from '../memory/index.js';
import { getSwordStore, getSparkGenerator, SwordStore, SparkGenerator, type Spark } from '../sword/index.js';
import { getContextBuilder, ContextBuilder, type UnifiedContext } from './builder.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface PreGenerationResult {
  contextInjection: string;
  unifiedContext: UnifiedContext;
  modifiedSystemPrompt?: string;
}

export interface PostGenerationResult {
  memoriesExtracted: number;
  profileUpdated: boolean;
  preferencesUpdated: boolean;
  sparkSuggested: Spark | null;
  goalProgressUpdated: boolean;
}

export interface HookOptions {
  extractMemory?: boolean;
  suggestSparks?: boolean;
  updateLastInteraction?: boolean;
  conversationId?: string;
}

const DEFAULT_HOOK_OPTIONS: HookOptions = {
  extractMemory: true,
  suggestSparks: true,
  updateLastInteraction: true,
};

// ─────────────────────────────────────────────────────────────────────────────────
// PIPELINE HOOKS CLASS
// ─────────────────────────────────────────────────────────────────────────────────

export class PipelineHooks {
  private contextBuilder: ContextBuilder;
  private memoryExtractor: MemoryExtractor;
  private memoryStore: MemoryStore;
  private swordStore: SwordStore;
  private sparkGenerator: SparkGenerator;
  
  constructor(
    memoryStore?: MemoryStore,
    swordStore?: SwordStore,
    contextBuilder?: ContextBuilder
  ) {
    this.memoryStore = memoryStore ?? getMemoryStore();
    this.swordStore = swordStore ?? getSwordStore();
    this.contextBuilder = contextBuilder ?? new ContextBuilder(this.memoryStore, this.swordStore);
    this.memoryExtractor = new MemoryExtractor(this.memoryStore);
    this.sparkGenerator = new SparkGenerator(this.swordStore);
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // PRE-GENERATION HOOK
  // ─────────────────────────────────────────────────────────────────────────────
  
  async preGeneration(
    userId: string,
    message: string,
    baseSystemPrompt: string,
    conversationId: string | null = null
  ): Promise<PreGenerationResult> {
    // Build unified context
    const unifiedContext = await this.contextBuilder.build(
      userId,
      conversationId,
      message
    );
    
    // Format context for injection
    const contextInjection = this.contextBuilder.formatForLLM(unifiedContext);
    
    // Modify system prompt with context
    let modifiedSystemPrompt = baseSystemPrompt;
    
    if (contextInjection.trim()) {
      modifiedSystemPrompt = `${baseSystemPrompt}\n\n${contextInjection}`;
    }
    
    // Add preference-based instructions
    if (unifiedContext.user.preferences) {
      const prefs = unifiedContext.user.preferences;
      const instructions: string[] = [];
      
      if (prefs.verbosity === 'concise') {
        instructions.push('Keep responses brief and to the point.');
      } else if (prefs.verbosity === 'detailed') {
        instructions.push('Provide comprehensive, detailed responses.');
      }
      
      if (prefs.tone === 'formal') {
        instructions.push('Use a formal, professional tone.');
      } else if (prefs.tone === 'technical') {
        instructions.push('Use precise technical language.');
      }
      
      if (prefs.formatting === 'minimal') {
        instructions.push('Use minimal formatting, prefer prose.');
      } else if (prefs.formatting === 'rich') {
        instructions.push('Use structured formatting with headers and lists when helpful.');
      }
      
      if (!prefs.askClarifyingQuestions) {
        instructions.push('Avoid asking clarifying questions unless essential.');
      }
      
      if (instructions.length > 0) {
        modifiedSystemPrompt += `\n\n<style_guidance>\n${instructions.join('\n')}\n</style_guidance>`;
      }
    }
    
    // Add spark reminder if active
    if (unifiedContext.sword.currentSpark) {
      const spark = unifiedContext.sword.currentSpark;
      modifiedSystemPrompt += `\n\n<active_task>
The user has an active task: "${spark.action}"
Status: ${spark.status}
If relevant, you may ask about their progress or offer help with this task.
</active_task>`;
    }
    
    return {
      contextInjection,
      unifiedContext,
      modifiedSystemPrompt,
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // POST-GENERATION HOOK
  // ─────────────────────────────────────────────────────────────────────────────
  
  async postGeneration(
    userId: string,
    userMessage: string,
    assistantResponse: string,
    options: HookOptions = {}
  ): Promise<PostGenerationResult> {
    const opts = { ...DEFAULT_HOOK_OPTIONS, ...options };
    
    const result: PostGenerationResult = {
      memoriesExtracted: 0,
      profileUpdated: false,
      preferencesUpdated: false,
      sparkSuggested: null,
      goalProgressUpdated: false,
    };
    
    // Check if memory is enabled for user
    const preferences = await this.memoryStore.getPreferences(userId);
    const memoryEnabled = preferences?.memoryEnabled ?? true;
    
    // Extract memories from user message
    if (opts.extractMemory && memoryEnabled) {
      const extraction = await this.memoryExtractor.extractAndSave(
        userId,
        userMessage,
        opts.conversationId
      );
      
      result.memoriesExtracted = extraction.saved.length;
      result.profileUpdated = extraction.profileUpdated;
      result.preferencesUpdated = extraction.preferencesUpdated;
    }
    
    // Update last interaction timestamp
    if (opts.updateLastInteraction) {
      await this.memoryStore.updateProfile(userId, {
        lastInteraction: new Date().toISOString(),
      });
    }
    
    // Check for spark-related patterns and suggest sparks
    if (opts.suggestSparks) {
      const sparkSuggestion = await this.checkForSparkOpportunity(
        userId,
        userMessage,
        assistantResponse
      );
      
      if (sparkSuggestion) {
        result.sparkSuggested = sparkSuggestion;
      }
    }
    
    // Check for goal progress mentions
    const progressUpdate = await this.checkForProgressUpdate(
      userId,
      userMessage,
      assistantResponse
    );
    
    if (progressUpdate) {
      result.goalProgressUpdated = true;
    }
    
    return result;
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // SPARK OPPORTUNITY DETECTION
  // ─────────────────────────────────────────────────────────────────────────────
  
  private async checkForSparkOpportunity(
    userId: string,
    userMessage: string,
    _assistantResponse: string
  ): Promise<Spark | null> {
    const lowerMessage = userMessage.toLowerCase();
    
    // Patterns that suggest user wants to take action
    const actionPatterns = [
      /(?:i want to|i need to|help me|how do i|let's|let me)\s+(\w+)/i,
      /(?:start|begin|work on|tackle|do)\s+(?:my|the|a)?\s*(\w+)/i,
      /(?:what should i do|what's next|next step)/i,
    ];
    
    const wantsAction = actionPatterns.some(p => p.test(lowerMessage));
    
    if (!wantsAction) {
      return null;
    }
    
    // Check if user already has an active spark
    const activeSpark = await this.swordStore.getActiveSpark(userId);
    if (activeSpark && activeSpark.status === 'accepted') {
      // Don't suggest new spark if one is in progress
      return null;
    }
    
    // Get user's active goals
    const goals = await this.swordStore.getUserGoals(userId, 'active');
    
    if (goals.length === 0) {
      // No goals - could suggest creating one
      return null;
    }
    
    // Generate spark for the most relevant goal
    const primaryGoal = goals[0]!;
    
    try {
      const spark = await this.sparkGenerator.generateNextSpark(userId, primaryGoal.id);
      return spark;
    } catch {
      return null;
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // PROGRESS UPDATE DETECTION
  // ─────────────────────────────────────────────────────────────────────────────
  
  private async checkForProgressUpdate(
    userId: string,
    userMessage: string,
    _assistantResponse: string
  ): Promise<boolean> {
    const lowerMessage = userMessage.toLowerCase();
    
    // Patterns indicating progress
    const progressPatterns = [
      /(?:i finished|i completed|i did|done with|i've done)\s+/i,
      /(?:i made progress|i worked on|i started|i began)\s+/i,
      /(?:finally done|all done|finished!)/i,
    ];
    
    const indicatesProgress = progressPatterns.some(p => p.test(lowerMessage));
    
    if (!indicatesProgress) {
      return false;
    }
    
    // Check for active spark to complete
    const activeSpark = await this.swordStore.getActiveSpark(userId);
    
    if (activeSpark && activeSpark.status === 'accepted') {
      // Check if message content relates to spark
      const sparkWords = activeSpark.action.toLowerCase().split(/\s+/);
      const messageWords = lowerMessage.split(/\s+/);
      
      const overlap = sparkWords.filter(w => 
        w.length > 3 && messageWords.some(m => m.includes(w))
      );
      
      if (overlap.length >= 2) {
        // Likely completed the spark - auto-complete it
        await this.swordStore.transitionSparkState(activeSpark.id, { type: 'COMPLETE' });
        return true;
      }
    }
    
    return false;
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // RESPONSE ENHANCEMENT
  // ─────────────────────────────────────────────────────────────────────────────
  
  enhanceResponse(
    response: string,
    postResult: PostGenerationResult,
    context: UnifiedContext
  ): string {
    let enhanced = response;
    
    // Add spark suggestion if one was generated
    if (postResult.sparkSuggested && postResult.sparkSuggested.status === 'suggested') {
      const spark = postResult.sparkSuggested;
      enhanced += `\n\n---\n💡 **Quick Action** (${spark.estimatedMinutes} min): ${spark.action}\n_${spark.rationale}_`;
    }
    
    // Add progress celebration if goal was updated
    if (postResult.goalProgressUpdated && context.sword.activeGoals.length > 0) {
      const goal = context.sword.activeGoals[0]!;
      if (goal.progress >= 100) {
        enhanced += `\n\n🎉 Congratulations! You've completed your goal: "${goal.title}"`;
      } else if (goal.progress > 0 && goal.progress % 25 === 0) {
        enhanced += `\n\n📊 Nice progress! "${goal.title}" is now ${goal.progress}% complete.`;
      }
    }
    
    return enhanced;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let pipelineHooks: PipelineHooks | null = null;

export function getPipelineHooks(): PipelineHooks {
  if (!pipelineHooks) {
    pipelineHooks = new PipelineHooks();
  }
  return pipelineHooks;
}
