// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXT BUILDER — Unified Context for LLM Generation
// ═══════════════════════════════════════════════════════════════════════════════
//
// Aggregates context from all sources:
// - User Memory (profile, preferences, learned facts)
// - Sword (active goals, current spark, progress)
// - Conversation history
// - Session state
//
// Produces a structured context injection for the LLM system prompt.
//
// ═══════════════════════════════════════════════════════════════════════════════

import {
  getMemoryStore,
  MemoryStore,
  MemoryRetriever,
  type UserProfile,
  type UserPreferences,
  type ContextInjection,
} from '../memory/index.js';

import {
  getSwordStore,
  SwordStore,
  type Goal,
  type Quest,
  type Step,
  type Spark,
  type Path,
} from '../sword/index.js';

import { conversations, type Message } from '../../conversations/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface UnifiedContext {
  // User identity and preferences
  user: {
    profile: UserProfile | null;
    preferences: UserPreferences | null;
  };
  
  // Memory-derived context
  memory: ContextInjection;
  
  // Active Sword context
  sword: {
    activeGoals: GoalSummary[];
    currentSpark: Spark | null;
    overallProgress: number;
    nextAction: string | null;
  };
  
  // Conversation context
  conversation: {
    id: string | null;
    recentMessages: MessageSummary[];
    messageCount: number;
    topics: string[];
  };
  
  // Session metadata
  session: {
    timestamp: string;
    requestId?: string;
  };
}

export interface GoalSummary {
  id: string;
  title: string;
  progress: number;
  currentQuest: string | null;
  nextStep: string | null;
  onTrack: boolean;
}

export interface MessageSummary {
  role: 'user' | 'assistant';
  preview: string;  // First 100 chars
  timestamp: string;
}

export interface ContextBuildOptions {
  includeMemory?: boolean;
  includeSword?: boolean;
  includeConversation?: boolean;
  maxRecentMessages?: number;
  maxGoals?: number;
}

const DEFAULT_OPTIONS: ContextBuildOptions = {
  includeMemory: true,
  includeSword: true,
  includeConversation: true,
  maxRecentMessages: 5,
  maxGoals: 3,
};

// ─────────────────────────────────────────────────────────────────────────────────
// CONTEXT BUILDER CLASS
// ─────────────────────────────────────────────────────────────────────────────────

export class ContextBuilder {
  private memoryStore: MemoryStore;
  private memoryRetriever: MemoryRetriever;
  private swordStore: SwordStore;
  
  constructor(memoryStore?: MemoryStore, swordStore?: SwordStore) {
    this.memoryStore = memoryStore ?? getMemoryStore();
    this.memoryRetriever = new MemoryRetriever(this.memoryStore);
    this.swordStore = swordStore ?? getSwordStore();
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // BUILD UNIFIED CONTEXT
  // ─────────────────────────────────────────────────────────────────────────────
  
  async build(
    userId: string,
    conversationId: string | null,
    message: string,
    options: ContextBuildOptions = {}
  ): Promise<UnifiedContext> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    
    const context: UnifiedContext = {
      user: {
        profile: null,
        preferences: null,
      },
      memory: {
        summary: '',
        facts: [],
        preferences: [],
        activeProjects: [],
        warnings: [],
      },
      sword: {
        activeGoals: [],
        currentSpark: null,
        overallProgress: 0,
        nextAction: null,
      },
      conversation: {
        id: conversationId,
        recentMessages: [],
        messageCount: 0,
        topics: [],
      },
      session: {
        timestamp: new Date().toISOString(),
      },
    };
    
    // Build in parallel for performance
    const [userContext, memoryContext, swordContext, convContext] = await Promise.all([
      this.buildUserContext(userId),
      opts.includeMemory ? this.buildMemoryContext(userId, message) : null,
      opts.includeSword ? this.buildSwordContext(userId, opts.maxGoals!) : null,
      opts.includeConversation && conversationId 
        ? this.buildConversationContext(userId, conversationId, opts.maxRecentMessages!)
        : null,
    ]);
    
    context.user = userContext;
    if (memoryContext) context.memory = memoryContext;
    if (swordContext) context.sword = swordContext;
    if (convContext) context.conversation = convContext;
    
    return context;
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // USER CONTEXT
  // ─────────────────────────────────────────────────────────────────────────────
  
  private async buildUserContext(userId: string): Promise<UnifiedContext['user']> {
    const [profile, preferences] = await Promise.all([
      this.memoryStore.getProfile(userId),
      this.memoryStore.getPreferences(userId),
    ]);
    
    return { profile, preferences };
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // MEMORY CONTEXT
  // ─────────────────────────────────────────────────────────────────────────────
  
  private async buildMemoryContext(userId: string, message: string): Promise<ContextInjection> {
    return this.memoryRetriever.buildContextInjection(userId, message);
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // SWORD CONTEXT
  // ─────────────────────────────────────────────────────────────────────────────
  
  private async buildSwordContext(userId: string, maxGoals: number): Promise<UnifiedContext['sword']> {
    const result: UnifiedContext['sword'] = {
      activeGoals: [],
      currentSpark: null,
      overallProgress: 0,
      nextAction: null,
    };
    
    // Get active goals
    const goals = await this.swordStore.getUserGoals(userId, 'active');
    const limitedGoals = goals.slice(0, maxGoals);
    
    let totalProgress = 0;
    
    for (const goal of limitedGoals) {
      const path = await this.swordStore.getPath(goal.id, userId);
      
      const summary: GoalSummary = {
        id: goal.id,
        title: goal.title,
        progress: goal.progress,
        currentQuest: path?.currentQuestId 
          ? (await this.swordStore.getQuest(path.currentQuestId))?.title ?? null
          : null,
        nextStep: path?.nextStep?.title ?? null,
        onTrack: path?.onTrack ?? true,
      };
      
      result.activeGoals.push(summary);
      totalProgress += goal.progress;
    }
    
    if (limitedGoals.length > 0) {
      result.overallProgress = Math.round(totalProgress / limitedGoals.length);
    }
    
    // Get current spark
    const spark = await this.swordStore.getActiveSpark(userId);
    if (spark) {
      result.currentSpark = spark;
      result.nextAction = spark.action;
    } else if (result.activeGoals.length > 0 && result.activeGoals[0]!.nextStep) {
      result.nextAction = result.activeGoals[0]!.nextStep;
    }
    
    return result;
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // CONVERSATION CONTEXT
  // ─────────────────────────────────────────────────────────────────────────────
  
  private async buildConversationContext(
    userId: string,
    conversationId: string,
    maxMessages: number
  ): Promise<UnifiedContext['conversation']> {
    const result: UnifiedContext['conversation'] = {
      id: conversationId,
      recentMessages: [],
      messageCount: 0,
      topics: [],
    };
    
    // Get full conversation with messages
    const conv = await conversations.getFull(conversationId);
    if (!conv) return result;
    
    // Get messages separately
    const messages = await conversations.getMessages(conversationId);
    if (!messages) return result;
    
    result.messageCount = messages.length;
    
    // Get recent messages
    const recent = messages.slice(-maxMessages);
    result.recentMessages = recent.map((m: Message) => ({
      role: m.role as 'user' | 'assistant',
      preview: m.content.slice(0, 100) + (m.content.length > 100 ? '...' : ''),
      timestamp: typeof m.timestamp === 'number' ? new Date(m.timestamp).toISOString() : String(m.timestamp),
    }));
    
    // Extract topics (simple keyword extraction)
    result.topics = this.extractTopics(messages);
    
    return result;
  }
  
  private extractTopics(messages: Message[]): string[] {
    // Simple topic extraction from recent user messages
    const userMessages = messages
      .filter(m => m.role === 'user')
      .slice(-5)
      .map(m => m.content.toLowerCase());
    
    const text = userMessages.join(' ');
    
    // Extract potential topics (nouns/noun phrases)
    const words = text.split(/\s+/);
    const stopWords = new Set([
      'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'can', 'need', 'and', 'or', 'but', 'if', 'then', 'else',
      'when', 'at', 'by', 'for', 'with', 'about', 'to', 'from', 'in', 'out',
      'on', 'off', 'up', 'down', 'i', 'me', 'my', 'you', 'your', 'we', 'our',
      'it', 'its', 'this', 'that', 'what', 'how', 'why', 'where', 'who',
      'please', 'help', 'want', 'know', 'think', 'like', 'get', 'make',
    ]);
    
    const candidates = words
      .filter(w => w.length > 3 && !stopWords.has(w))
      .filter(w => /^[a-z]+$/.test(w));
    
    // Count frequency
    const freq = new Map<string, number>();
    for (const word of candidates) {
      freq.set(word, (freq.get(word) ?? 0) + 1);
    }
    
    // Return top topics
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // FORMAT FOR LLM
  // ─────────────────────────────────────────────────────────────────────────────
  
  formatForLLM(context: UnifiedContext): string {
    const parts: string[] = [];
    
    parts.push('<nova_context>');
    
    // User section
    if (context.user.profile?.name || context.user.profile?.role) {
      parts.push('');
      parts.push('<user>');
      if (context.user.profile?.name) {
        parts.push(`Name: ${context.user.profile.name}`);
      }
      if (context.user.profile?.role) {
        parts.push(`Role: ${context.user.profile.role}`);
      }
      if (context.user.profile?.organization) {
        parts.push(`Organization: ${context.user.profile.organization}`);
      }
      if (context.user.profile?.expertiseAreas?.length) {
        parts.push(`Expertise: ${context.user.profile.expertiseAreas.join(', ')}`);
      }
      parts.push('</user>');
    }
    
    // Memory section
    if (context.memory.facts.length > 0 || context.memory.activeProjects.length > 0) {
      parts.push('');
      parts.push('<memory>');
      if (context.memory.facts.length > 0) {
        parts.push('Known facts:');
        for (const fact of context.memory.facts) {
          parts.push(`- ${fact}`);
        }
      }
      if (context.memory.activeProjects.length > 0) {
        parts.push('Active projects:');
        for (const project of context.memory.activeProjects) {
          parts.push(`- ${project}`);
        }
      }
      parts.push('</memory>');
    }
    
    // Preferences section
    if (context.user.preferences) {
      const prefs = context.user.preferences;
      const prefParts: string[] = [];
      
      if (prefs.tone !== 'friendly') prefParts.push(`tone: ${prefs.tone}`);
      if (prefs.verbosity !== 'balanced') prefParts.push(`verbosity: ${prefs.verbosity}`);
      if (prefs.formatting !== 'moderate') prefParts.push(`formatting: ${prefs.formatting}`);
      if (prefs.defaultMode !== 'snapshot') prefParts.push(`mode: ${prefs.defaultMode}`);
      
      if (prefParts.length > 0) {
        parts.push('');
        parts.push('<preferences>');
        parts.push(prefParts.join(', '));
        parts.push('</preferences>');
      }
    }
    
    // Sword section (goals and progress)
    if (context.sword.activeGoals.length > 0) {
      parts.push('');
      parts.push('<goals>');
      for (const goal of context.sword.activeGoals) {
        const status = goal.onTrack ? '' : ' [OFF TRACK]';
        parts.push(`- ${goal.title} (${goal.progress}% complete)${status}`);
        if (goal.currentQuest) {
          parts.push(`  Current: ${goal.currentQuest}`);
        }
        if (goal.nextStep) {
          parts.push(`  Next: ${goal.nextStep}`);
        }
      }
      parts.push('</goals>');
    }
    
    // Current spark (immediate action)
    if (context.sword.currentSpark) {
      parts.push('');
      parts.push('<current_spark>');
      parts.push(`Action: ${context.sword.currentSpark.action}`);
      parts.push(`Status: ${context.sword.currentSpark.status}`);
      if (context.sword.currentSpark.estimatedMinutes) {
        parts.push(`Time: ~${context.sword.currentSpark.estimatedMinutes} minutes`);
      }
      parts.push('</current_spark>');
    }
    
    // Warnings
    if (context.memory.warnings.length > 0) {
      parts.push('');
      parts.push('<warnings>');
      for (const warning of context.memory.warnings) {
        parts.push(`- ${warning}`);
      }
      parts.push('</warnings>');
    }
    
    parts.push('');
    parts.push('</nova_context>');
    
    return parts.join('\n');
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // QUICK ACCESSORS
  // ─────────────────────────────────────────────────────────────────────────────
  
  async getUserName(userId: string): Promise<string | null> {
    const profile = await this.memoryStore.getProfile(userId);
    return profile?.name ?? null;
  }
  
  async getPreferredTone(userId: string): Promise<string> {
    const prefs = await this.memoryStore.getPreferences(userId);
    return prefs?.tone ?? 'friendly';
  }
  
  async hasActiveSpark(userId: string): Promise<boolean> {
    const spark = await this.swordStore.getActiveSpark(userId);
    return spark !== null;
  }
  
  async getCurrentSparkAction(userId: string): Promise<string | null> {
    const spark = await this.swordStore.getActiveSpark(userId);
    return spark?.action ?? null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let contextBuilder: ContextBuilder | null = null;

export function getContextBuilder(): ContextBuilder {
  if (!contextBuilder) {
    contextBuilder = new ContextBuilder();
  }
  return contextBuilder;
}
