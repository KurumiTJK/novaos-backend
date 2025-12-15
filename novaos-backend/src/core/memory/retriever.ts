// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY RETRIEVER — Context Injection for LLM Personalization
// ═══════════════════════════════════════════════════════════════════════════════
//
// Retrieves relevant memories and builds context injections for LLM prompts.
// Balances personalization with privacy and relevance.
//
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  Memory,
  MemoryCategory,
  UserProfile,
  UserPreferences,
  MemoryQuery,
  RetrievalResult,
  ContextInjection,
} from './types.js';
import { MemoryStore, getMemoryStore } from './store.js';

// ─────────────────────────────────────────────────────────────────────────────────
// RETRIEVAL CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────────

const DEFAULT_RETRIEVAL_CONFIG = {
  maxMemories: 10,
  maxContextLength: 1500, // Characters
  minRelevanceScore: 0.3,
  categoryWeights: {
    preference: 1.5,
    fact: 1.2,
    project: 1.3,
    skill: 1.0,
    interest: 0.8,
    relationship: 0.7,
    goal: 1.1,
    context: 1.4,
  } as Record<MemoryCategory, number>,
};

// ─────────────────────────────────────────────────────────────────────────────────
// MEMORY RETRIEVER CLASS
// ─────────────────────────────────────────────────────────────────────────────────

export class MemoryRetriever {
  private store: MemoryStore;
  
  constructor(store?: MemoryStore) {
    this.store = store ?? getMemoryStore();
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // MAIN RETRIEVAL
  // ─────────────────────────────────────────────────────────────────────────────
  
  async retrieve(userId: string, query?: MemoryQuery): Promise<RetrievalResult> {
    const memories = await this.store.queryMemories(userId, {
      ...query,
      limit: query?.limit ?? DEFAULT_RETRIEVAL_CONFIG.maxMemories,
      maxSensitivity: query?.maxSensitivity ?? 'private', // Don't include sensitive by default
    });
    
    const profile = await this.store.getProfile(userId);
    const preferences = await this.store.getPreferences(userId);
    
    // Calculate relevance scores
    const relevanceScores = new Map<string, number>();
    for (const memory of memories) {
      const score = this.calculateRelevance(memory, query?.keywords ?? []);
      relevanceScores.set(memory.id, score);
    }
    
    // Sort by relevance
    memories.sort((a, b) => {
      const scoreA = relevanceScores.get(a.id) ?? 0;
      const scoreB = relevanceScores.get(b.id) ?? 0;
      return scoreB - scoreA;
    });
    
    return {
      memories,
      profile,
      preferences,
      relevanceScores,
    };
  }
  
  async retrieveForMessage(userId: string, message: string): Promise<RetrievalResult> {
    // Extract keywords from message
    const keywords = this.extractKeywords(message);
    
    // Determine relevant categories based on message content
    const categories = this.inferCategories(message);
    
    return this.retrieve(userId, {
      keywords: keywords.length > 0 ? keywords : undefined,
      categories: categories.length > 0 ? categories : undefined,
      limit: DEFAULT_RETRIEVAL_CONFIG.maxMemories,
    });
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // CONTEXT INJECTION
  // ─────────────────────────────────────────────────────────────────────────────
  
  async buildContextInjection(userId: string, message: string): Promise<ContextInjection> {
    // Get all memories for context, not just message-relevant ones
    const result = await this.retrieve(userId, {
      limit: DEFAULT_RETRIEVAL_CONFIG.maxMemories,
    });
    
    const injection: ContextInjection = {
      summary: '',
      facts: [],
      preferences: [],
      activeProjects: [],
      warnings: [],
    };
    
    // Check if memory is enabled
    if (result.preferences && !result.preferences.memoryEnabled) {
      return injection;
    }
    
    // Build summary
    const summaryParts: string[] = [];
    
    // Add user name if known
    if (result.profile?.name) {
      summaryParts.push(`The user's name is ${result.profile.name}.`);
    }
    
    // Add role/organization
    if (result.profile?.role || result.profile?.organization) {
      const rolePart = result.profile.role ? `works as ${result.profile.role}` : '';
      const orgPart = result.profile.organization ? `at ${result.profile.organization}` : '';
      if (rolePart || orgPart) {
        summaryParts.push(`They ${rolePart}${rolePart && orgPart ? ' ' : ''}${orgPart}.`);
      }
    }
    
    // Add location
    if (result.profile?.location) {
      summaryParts.push(`They are based in ${result.profile.location}.`);
    }
    
    // Add expertise
    if (result.profile?.expertiseAreas && result.profile.expertiseAreas.length > 0) {
      summaryParts.push(`They have expertise in: ${result.profile.expertiseAreas.join(', ')}.`);
    }
    
    injection.summary = summaryParts.join(' ');
    
    // Add relevant facts
    const factMemories = result.memories.filter(m => m.category === 'fact');
    for (const memory of factMemories.slice(0, 5)) {
      injection.facts.push(`${memory.key}: ${memory.value}`);
    }
    
    // Add preferences
    if (result.preferences) {
      if (result.preferences.tone !== 'friendly') {
        injection.preferences.push(`Preferred tone: ${result.preferences.tone}`);
      }
      if (result.preferences.verbosity !== 'balanced') {
        injection.preferences.push(`Preferred verbosity: ${result.preferences.verbosity}`);
      }
      if (result.preferences.formatting !== 'moderate') {
        injection.preferences.push(`Preferred formatting: ${result.preferences.formatting}`);
      }
    }
    
    // Add active projects
    if (result.profile?.activeProjects) {
      for (const project of result.profile.activeProjects.slice(0, 3)) {
        if (project.status === 'active') {
          injection.activeProjects.push(
            project.description 
              ? `${project.name}: ${project.description}`
              : project.name
          );
        }
      }
    }
    
    // Add project memories
    const projectMemories = result.memories.filter(m => m.category === 'project');
    for (const memory of projectMemories.slice(0, 3)) {
      if (!injection.activeProjects.some(p => p.includes(memory.value))) {
        injection.activeProjects.push(memory.value);
      }
    }
    
    // Add warnings (sensitive topics to avoid)
    if (result.preferences?.sensitiveTopics) {
      for (const topic of result.preferences.sensitiveTopics) {
        injection.warnings.push(`Avoid discussing: ${topic}`);
      }
    }
    
    return injection;
  }
  
  formatContextForLLM(injection: ContextInjection): string {
    if (!injection.summary && injection.facts.length === 0 && injection.preferences.length === 0) {
      return ''; // No context to inject
    }
    
    const parts: string[] = [];
    
    parts.push('<user_context>');
    
    if (injection.summary) {
      parts.push(injection.summary);
    }
    
    if (injection.facts.length > 0) {
      parts.push('');
      parts.push('Known facts:');
      for (const fact of injection.facts) {
        parts.push(`- ${fact}`);
      }
    }
    
    if (injection.activeProjects.length > 0) {
      parts.push('');
      parts.push('Active projects:');
      for (const project of injection.activeProjects) {
        parts.push(`- ${project}`);
      }
    }
    
    if (injection.preferences.length > 0) {
      parts.push('');
      parts.push('Communication preferences:');
      for (const pref of injection.preferences) {
        parts.push(`- ${pref}`);
      }
    }
    
    if (injection.warnings.length > 0) {
      parts.push('');
      parts.push('Important:');
      for (const warning of injection.warnings) {
        parts.push(`- ${warning}`);
      }
    }
    
    parts.push('</user_context>');
    
    return parts.join('\n');
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // RELEVANCE CALCULATION
  // ─────────────────────────────────────────────────────────────────────────────
  
  private calculateRelevance(memory: Memory, keywords: string[]): number {
    let score = 0;
    
    // Base score from reinforcement
    score += memory.reinforcementScore / 100 * 0.3;
    
    // Category weight
    const categoryWeight = DEFAULT_RETRIEVAL_CONFIG.categoryWeights[memory.category] ?? 1.0;
    score *= categoryWeight;
    
    // Recency bonus
    const daysSinceAccess = (Date.now() - new Date(memory.lastAccessedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceAccess < 1) score += 0.3;
    else if (daysSinceAccess < 7) score += 0.2;
    else if (daysSinceAccess < 30) score += 0.1;
    
    // Keyword match bonus
    if (keywords.length > 0) {
      const searchText = `${memory.key} ${memory.value} ${memory.context || ''}`.toLowerCase();
      const matchCount = keywords.filter(kw => searchText.includes(kw.toLowerCase())).length;
      score += (matchCount / keywords.length) * 0.4;
    }
    
    // Confidence bonus
    if (memory.confidence === 'explicit') score += 0.1;
    else if (memory.confidence === 'inferred') score += 0.05;
    
    return Math.min(1.0, score);
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // KEYWORD EXTRACTION
  // ─────────────────────────────────────────────────────────────────────────────
  
  private extractKeywords(message: string): string[] {
    // Simple keyword extraction - remove common words and short tokens
    const stopWords = new Set([
      'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
      'and', 'or', 'but', 'if', 'then', 'else', 'when', 'at', 'by', 'for',
      'with', 'about', 'against', 'between', 'into', 'through', 'during',
      'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in',
      'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once',
      'here', 'there', 'where', 'why', 'how', 'all', 'each', 'every', 'both',
      'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
      'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'i', 'me',
      'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours',
      'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her',
      'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their',
      'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this', 'that',
      'these', 'those', 'am', 'please', 'help', 'want', 'know', 'think',
      'like', 'get', 'make', 'go', 'see', 'come', 'take', 'give', 'tell',
    ]);
    
    const words = message
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));
    
    // Deduplicate
    return [...new Set(words)].slice(0, 10);
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // CATEGORY INFERENCE
  // ─────────────────────────────────────────────────────────────────────────────
  
  private inferCategories(message: string): MemoryCategory[] {
    const categories: MemoryCategory[] = [];
    const lowerMessage = message.toLowerCase();
    
    // Project-related
    if (/(?:project|building|developing|working on|app|website|product)/i.test(lowerMessage)) {
      categories.push('project');
    }
    
    // Skill-related
    if (/(?:code|program|language|framework|technology|tool)/i.test(lowerMessage)) {
      categories.push('skill');
    }
    
    // Goal-related
    if (/(?:goal|want to|trying to|hope to|planning to|objective)/i.test(lowerMessage)) {
      categories.push('goal');
    }
    
    // Preference-related
    if (/(?:prefer|like it when|always|never|please)/i.test(lowerMessage)) {
      categories.push('preference');
    }
    
    // Interest-related
    if (/(?:interested in|curious about|enjoy|hobby|passion)/i.test(lowerMessage)) {
      categories.push('interest');
    }
    
    return categories;
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // QUICK ACCESS METHODS
  // ─────────────────────────────────────────────────────────────────────────────
  
  async getUserName(userId: string): Promise<string | null> {
    const profile = await this.store.getProfile(userId);
    return profile?.name ?? null;
  }
  
  async getUserPreferences(userId: string): Promise<UserPreferences | null> {
    return this.store.getPreferences(userId);
  }
  
  async getUserProfile(userId: string): Promise<UserProfile | null> {
    return this.store.getProfile(userId);
  }
  
  async getActiveProjects(userId: string): Promise<string[]> {
    const profile = await this.store.getProfile(userId);
    const projectMemories = await this.store.getMemoriesByCategory(userId, 'project');
    
    const projects: string[] = [];
    
    // From profile
    if (profile?.activeProjects) {
      for (const p of profile.activeProjects) {
        if (p.status === 'active') {
          projects.push(p.name);
        }
      }
    }
    
    // From memories
    for (const memory of projectMemories.slice(0, 5)) {
      if (!projects.includes(memory.value)) {
        projects.push(memory.value);
      }
    }
    
    return projects;
  }
  
  async getExpertiseAreas(userId: string): Promise<string[]> {
    const profile = await this.store.getProfile(userId);
    const skillMemories = await this.store.getMemoriesByCategory(userId, 'skill');
    
    const skills = new Set<string>(profile?.expertiseAreas ?? []);
    
    for (const memory of skillMemories) {
      skills.add(memory.value);
    }
    
    return [...skills];
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let memoryRetriever: MemoryRetriever | null = null;

export function getMemoryRetriever(): MemoryRetriever {
  if (!memoryRetriever) {
    memoryRetriever = new MemoryRetriever();
  }
  return memoryRetriever;
}
