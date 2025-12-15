// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY EXTRACTOR — Extracts Learnable Facts from Conversations
// ═══════════════════════════════════════════════════════════════════════════════
//
// Analyzes conversation messages to identify:
// - Personal facts (name, role, location)
// - Projects being discussed
// - Skills and expertise areas
// - Interests and preferences
// - Goals and aspirations
//
// Uses pattern matching for common patterns and optionally LLM for deeper analysis.
//
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  Memory,
  MemoryCategory,
  ExtractedMemory,
  ExtractionResult,
  UserProfile,
  UserPreferences,
} from './types.js';
import { MemoryStore, getMemoryStore } from './store.js';
import { ProviderManager } from '../../providers/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// EXTRACTION PATTERNS
// ─────────────────────────────────────────────────────────────────────────────────

interface ExtractionPattern {
  pattern: RegExp;
  category: MemoryCategory;
  keyGenerator: (match: RegExpMatchArray) => string;
  valueGenerator: (match: RegExpMatchArray) => string;
  sensitivity: 'public' | 'private' | 'sensitive';
}

const EXTRACTION_PATTERNS: ExtractionPattern[] = [
  // Name patterns - names must start with capital, stop before lowercase words
  {
    pattern: /(?:my name is|i'm called|call me|i am)\s+([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)?)(?=\s+[a-z]|\s*$|\s+and\b|\s*[.,!?])/i,
    category: 'fact',
    keyGenerator: () => 'user.name',
    valueGenerator: (m) => m[1]!.trim(),
    sensitivity: 'private',
  },
  
  // Role/Job patterns
  {
    pattern: /(?:i work as|i'm a|i am a|my job is|my role is)\s+(?:an?\s+)?([^.,!?]+)/i,
    category: 'fact',
    keyGenerator: () => 'user.role',
    valueGenerator: (m) => m[1]!.trim(),
    sensitivity: 'private',
  },
  {
    pattern: /(?:i'm the|i am the)\s+([^.,!?]+)\s+(?:at|of|for)\s+([^.,!?]+)/i,
    category: 'fact',
    keyGenerator: () => 'user.role',
    valueGenerator: (m) => `${m[1]!.trim()} at ${m[2]!.trim()}`,
    sensitivity: 'private',
  },
  
  // Company/Organization patterns
  {
    pattern: /(?:i work (?:at|for)|my company is|i'm (?:at|with))\s+([^.,!?]+)/i,
    category: 'fact',
    keyGenerator: () => 'user.organization',
    valueGenerator: (m) => m[1]!.trim(),
    sensitivity: 'private',
  },
  
  // Location patterns
  {
    pattern: /(?:i live in|i'm from|i'm based in|i'm located in)\s+([^.,!?]+)/i,
    category: 'fact',
    keyGenerator: () => 'user.location',
    valueGenerator: (m) => m[1]!.trim(),
    sensitivity: 'private',
  },
  
  // Timezone patterns
  {
    pattern: /(?:my timezone is|i'm in)\s+((?:PST|EST|CST|MST|UTC|GMT)[+-]?\d*)/i,
    category: 'fact',
    keyGenerator: () => 'user.timezone',
    valueGenerator: (m) => m[1]!.trim().toUpperCase(),
    sensitivity: 'public',
  },
  
  // Project patterns
  {
    pattern: /(?:i'm working on|i'm building|my project|i'm developing)\s+(?:a\s+)?([^.,!?]+)/i,
    category: 'project',
    keyGenerator: (m) => `project.${m[1]!.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 30)}`,
    valueGenerator: (m) => m[1]!.trim(),
    sensitivity: 'private',
  },
  
  // Skill patterns
  {
    pattern: /(?:i know|i'm experienced (?:with|in)|i'm proficient in|i use)\s+([A-Za-z0-9#+]+)/i,
    category: 'skill',
    keyGenerator: (m) => `skill.${m[1]!.toLowerCase()}`,
    valueGenerator: (m) => m[1]!.trim(),
    sensitivity: 'public',
  },
  {
    pattern: /(?:i've been using|i work with|i code in)\s+([A-Za-z0-9#+]+)\s+for\s+(\d+)\s+years?/i,
    category: 'skill',
    keyGenerator: (m) => `skill.${m[1]!.toLowerCase()}`,
    valueGenerator: (m) => `${m[1]!.trim()} (${m[2]} years experience)`,
    sensitivity: 'public',
  },
  
  // Interest patterns
  {
    pattern: /(?:i'm interested in|i love|i enjoy|i'm passionate about)\s+([^.,!?]+)/i,
    category: 'interest',
    keyGenerator: (m) => `interest.${m[1]!.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 30)}`,
    valueGenerator: (m) => m[1]!.trim(),
    sensitivity: 'public',
  },
  
  // Goal patterns
  {
    pattern: /(?:i want to|i'm trying to|my goal is to|i hope to)\s+([^.,!?]+)/i,
    category: 'goal',
    keyGenerator: (m) => `goal.${Date.now().toString(36)}`,
    valueGenerator: (m) => m[1]!.trim(),
    sensitivity: 'private',
  },
  
  // Relationship patterns
  {
    pattern: /(?:my (?:wife|husband|partner|spouse|colleague|boss|manager|friend))\s+([A-Z][a-z]+)/i,
    category: 'relationship',
    keyGenerator: (m) => `relationship.${m[1]!.toLowerCase()}`,
    valueGenerator: (m) => m[0]!.trim(),
    sensitivity: 'sensitive',
  },
  
  // Preference patterns
  {
    pattern: /(?:i prefer|i like it when you|please (?:always|never))\s+([^.,!?]+)/i,
    category: 'preference',
    keyGenerator: (m) => `preference.${Date.now().toString(36)}`,
    valueGenerator: (m) => m[1]!.trim(),
    sensitivity: 'private',
  },
];

// Patterns to detect profile updates
interface ProfilePattern {
  pattern: RegExp;
  field: keyof UserProfile;
  valueExtractor: (match: RegExpMatchArray) => string | string[];
}

const PROFILE_PATTERNS: ProfilePattern[] = [
  {
    // Match name: starts with capital, followed by lowercase, optionally one more name part
    pattern: /(?:my name is|i'm called|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i,
    field: 'name',
    valueExtractor: (m) => {
      // Filter out common words that might be captured
      const name = m[1]!.trim();
      const parts = name.split(/\s+/).filter(part => 
        !['and', 'or', 'but', 'the', 'a', 'an'].includes(part.toLowerCase())
      );
      return parts.join(' ');
    },
  },
  {
    pattern: /(?:i work as|i'm a|i am a)\s+(?:an?\s+)?([^.,!?]+)/i,
    field: 'role',
    valueExtractor: (m) => m[1]!.trim(),
  },
  {
    pattern: /(?:i work (?:at|for)|my company is)\s+([^.,!?]+)/i,
    field: 'organization',
    valueExtractor: (m) => m[1]!.trim(),
  },
  {
    pattern: /(?:i live in|i'm based in)\s+([^.,!?]+)/i,
    field: 'location',
    valueExtractor: (m) => m[1]!.trim(),
  },
];

// ─────────────────────────────────────────────────────────────────────────────────
// MEMORY EXTRACTOR CLASS
// ─────────────────────────────────────────────────────────────────────────────────

export class MemoryExtractor {
  private store: MemoryStore;
  private providerManager: ProviderManager | null;
  
  constructor(store?: MemoryStore, providerManager?: ProviderManager) {
    this.store = store ?? getMemoryStore();
    this.providerManager = providerManager ?? null;
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // MAIN EXTRACTION
  // ─────────────────────────────────────────────────────────────────────────────
  
  async extractFromMessage(
    userId: string,
    message: string,
    conversationId?: string
  ): Promise<ExtractionResult> {
    const result: ExtractionResult = {
      memories: [],
      profileUpdates: {},
      preferenceUpdates: {},
    };
    
    // Check if memory is enabled for this user
    const preferences = await this.store.getPreferences(userId);
    if (preferences && !preferences.autoExtractFacts) {
      return result;
    }
    
    // Check for sensitive topics
    const sensitiveTopics = preferences?.sensitiveTopics ?? [];
    if (this.containsSensitiveTopic(message, sensitiveTopics)) {
      return result;
    }
    
    // Pattern-based extraction
    const patternMemories = this.extractFromPatterns(message, conversationId);
    
    // Deduplicate against existing memories
    for (const extracted of patternMemories) {
      const existing = await this.store.findMemoryByKey(userId, extracted.key);
      
      if (existing) {
        // Update existing if value is different
        if (existing.value !== extracted.value) {
          await this.store.updateMemory(existing.id, userId, {
            value: extracted.value,
            context: extracted.context,
          });
        }
      } else {
        result.memories.push(extracted);
      }
    }
    
    // Extract profile updates
    result.profileUpdates = this.extractProfileUpdates(message);
    
    // Extract preference signals
    result.preferenceUpdates = this.extractPreferenceSignals(message);
    
    return result;
  }
  
  async extractAndSave(
    userId: string,
    message: string,
    conversationId?: string
  ): Promise<{ saved: Memory[]; profileUpdated: boolean; preferencesUpdated: boolean }> {
    const result = await this.extractFromMessage(userId, message, conversationId);
    const saved: Memory[] = [];
    
    // Save new memories
    for (const extracted of result.memories) {
      const memory = await this.store.createMemory(userId, {
        category: extracted.category,
        key: extracted.key,
        value: extracted.value,
        context: extracted.context,
        confidence: extracted.confidence,
        sensitivity: extracted.sensitivity,
        conversationId,
      });
      saved.push(memory);
    }
    
    // Update profile
    let profileUpdated = false;
    if (Object.keys(result.profileUpdates).length > 0) {
      await this.store.updateProfile(userId, result.profileUpdates);
      profileUpdated = true;
    }
    
    // Update preferences
    let preferencesUpdated = false;
    if (Object.keys(result.preferenceUpdates).length > 0) {
      await this.store.updatePreferences(userId, result.preferenceUpdates);
      preferencesUpdated = true;
    }
    
    return { saved, profileUpdated, preferencesUpdated };
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // LLM-BASED EXTRACTION
  // ─────────────────────────────────────────────────────────────────────────────
  
  async extractWithLLM(
    userId: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    conversationId?: string
  ): Promise<ExtractionResult> {
    if (!this.providerManager) {
      // Fall back to pattern extraction for last user message
      const lastUserMessage = messages.filter(m => m.role === 'user').pop();
      if (lastUserMessage) {
        return this.extractFromMessage(userId, lastUserMessage.content, conversationId);
      }
      return { memories: [], profileUpdates: {}, preferenceUpdates: {} };
    }
    
    const prompt = this.buildExtractionPrompt(messages);
    const systemPrompt = `You are a memory extraction system. Extract personal facts, preferences, and context from conversations.
Output JSON only. Be conservative - only extract clear, explicit statements.`;
    
    try {
      const response = await this.providerManager.generate(prompt, systemPrompt);
      return this.parseExtractionResponse(response.text);
    } catch {
      // Fall back to pattern extraction
      const lastUserMessage = messages.filter(m => m.role === 'user').pop();
      if (lastUserMessage) {
        return this.extractFromMessage(userId, lastUserMessage.content, conversationId);
      }
      return { memories: [], profileUpdates: {}, preferenceUpdates: {} };
    }
  }
  
  private buildExtractionPrompt(messages: Array<{ role: string; content: string }>): string {
    const conversationText = messages
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');
    
    return `Analyze this conversation and extract any personal information the user has shared:

${conversationText}

Extract and return JSON with:
{
  "memories": [
    {
      "category": "fact|project|skill|interest|goal|preference|relationship",
      "key": "unique.identifier",
      "value": "the information",
      "confidence": "explicit|inferred",
      "sensitivity": "public|private|sensitive"
    }
  ],
  "profileUpdates": {
    "name": "if mentioned",
    "role": "if mentioned",
    "organization": "if mentioned",
    "location": "if mentioned"
  }
}

Only extract clear, explicit information. Do not infer or assume.`;
  }
  
  private parseExtractionResponse(response: string): ExtractionResult {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          memories: (parsed.memories || []).map((m: any) => ({
            category: m.category || 'fact',
            key: m.key || `extracted.${Date.now()}`,
            value: String(m.value || ''),
            confidence: m.confidence || 'inferred',
            sensitivity: m.sensitivity || 'private',
            context: 'Extracted from conversation',
          })),
          profileUpdates: parsed.profileUpdates || {},
          preferenceUpdates: parsed.preferenceUpdates || {},
        };
      }
    } catch {
      // Parse failed
    }
    
    return { memories: [], profileUpdates: {}, preferenceUpdates: {} };
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // PATTERN EXTRACTION
  // ─────────────────────────────────────────────────────────────────────────────
  
  private extractFromPatterns(message: string, conversationId?: string): ExtractedMemory[] {
    const memories: ExtractedMemory[] = [];
    const seenKeys = new Set<string>();
    
    for (const pattern of EXTRACTION_PATTERNS) {
      const match = message.match(pattern.pattern);
      if (match) {
        const key = pattern.keyGenerator(match);
        
        // Avoid duplicates
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        
        memories.push({
          category: pattern.category,
          key,
          value: pattern.valueGenerator(match),
          confidence: 'explicit',
          sensitivity: pattern.sensitivity,
          context: `Mentioned in conversation${conversationId ? ` (${conversationId})` : ''}`,
        });
      }
    }
    
    return memories;
  }
  
  private extractProfileUpdates(message: string): Partial<UserProfile> {
    const updates: Partial<UserProfile> = {};
    
    for (const pattern of PROFILE_PATTERNS) {
      const match = message.match(pattern.pattern);
      if (match) {
        const value = pattern.valueExtractor(match);
        (updates as any)[pattern.field] = value;
      }
    }
    
    return updates;
  }
  
  private extractPreferenceSignals(message: string): Partial<UserPreferences> {
    const updates: Partial<UserPreferences> = {};
    
    // Detect verbosity preference
    if (/(?:be brief|keep it short|just the answer|tldr|tl;dr)/i.test(message)) {
      updates.verbosity = 'concise';
    } else if (/(?:explain in detail|go deep|tell me more|comprehensive)/i.test(message)) {
      updates.verbosity = 'detailed';
    }
    
    // Detect tone preference
    if (/(?:be formal|formal tone|professional|business language)/i.test(message)) {
      updates.tone = 'formal';
    } else if (/(?:casual|relaxed|friendly|informal)/i.test(message)) {
      updates.tone = 'casual';
    } else if (/(?:technical|precise|exact)/i.test(message)) {
      updates.tone = 'technical';
    }
    
    // Detect formatting preference
    if (/(?:use bullet points|make a list|numbered list)/i.test(message)) {
      updates.formatting = 'rich';
    } else if (/(?:no bullets|prose|paragraph form|no lists)/i.test(message)) {
      updates.formatting = 'minimal';
    }
    
    // Detect clarification preference
    if (/(?:don't ask|just do it|no questions)/i.test(message)) {
      updates.askClarifyingQuestions = false;
    }
    
    return updates;
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────────────
  
  private containsSensitiveTopic(message: string, sensitiveTopics: string[]): boolean {
    const lowerMessage = message.toLowerCase();
    return sensitiveTopics.some(topic => lowerMessage.includes(topic.toLowerCase()));
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let memoryExtractor: MemoryExtractor | null = null;

export function getMemoryExtractor(): MemoryExtractor {
  if (!memoryExtractor) {
    memoryExtractor = new MemoryExtractor();
  }
  return memoryExtractor;
}

export function createMemoryExtractor(
  store?: MemoryStore,
  providerManager?: ProviderManager
): MemoryExtractor {
  return new MemoryExtractor(store, providerManager);
}
