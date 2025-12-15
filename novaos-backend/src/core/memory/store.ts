// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY STORE — Persistence for User Memories, Profile, Preferences
// ═══════════════════════════════════════════════════════════════════════════════

import { getStore, type KeyValueStore } from '../../storage/index.js';
import type {
  Memory,
  MemoryCategory,
  MemoryConfidence,
  MemorySensitivity,
  MemorySource,
  UserProfile,
  UserPreferences,
  CreateMemoryRequest,
  UpdateMemoryRequest,
  MemoryQuery,
  MemoryStats,
  DEFAULT_PREFERENCES,
  DEFAULT_PROFILE,
  MEMORY_DECAY_CONFIG,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

const MEMORY_TTL = 730 * 24 * 60 * 60;       // 2 years max
const PROFILE_TTL = 365 * 24 * 60 * 60;      // 1 year
const PREFERENCES_TTL = 365 * 24 * 60 * 60;  // 1 year

// ─────────────────────────────────────────────────────────────────────────────────
// KEY GENERATION
// ─────────────────────────────────────────────────────────────────────────────────

function memoryKey(id: string): string {
  return `memory:item:${id}`;
}

function userMemoriesKey(userId: string): string {
  return `memory:user:${userId}:items`;
}

function userMemoriesByCategoryKey(userId: string, category: MemoryCategory): string {
  return `memory:user:${userId}:category:${category}`;
}

function profileKey(userId: string): string {
  return `memory:user:${userId}:profile`;
}

function preferencesKey(userId: string): string {
  return `memory:user:${userId}:preferences`;
}

function generateId(): string {
  return `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────────────────────────────────────────────────────────────────
// MEMORY STORE CLASS
// ─────────────────────────────────────────────────────────────────────────────────

export class MemoryStore {
  private store: KeyValueStore;
  
  constructor(store?: KeyValueStore) {
    this.store = store ?? getStore();
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // MEMORY CRUD
  // ═══════════════════════════════════════════════════════════════════════════════
  
  async createMemory(userId: string, request: CreateMemoryRequest): Promise<Memory> {
    const id = generateId();
    const now = new Date().toISOString();
    
    const source: MemorySource = {
      type: request.conversationId ? 'extracted' : 'explicit',
      conversationId: request.conversationId,
      timestamp: now,
    };
    
    const memory: Memory = {
      id,
      userId,
      category: request.category,
      key: this.normalizeKey(request.key),
      value: request.value,
      context: request.context,
      confidence: request.confidence ?? 'explicit',
      sensitivity: request.sensitivity ?? 'private',
      source,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      reinforcementScore: 100,
      expiresAt: request.expiresAt,
    };
    
    // Save memory
    await this.store.set(memoryKey(id), JSON.stringify(memory), MEMORY_TTL);
    
    // Add to user's memory list
    await this.addToUserMemories(userId, id);
    
    // Add to category index
    await this.addToCategoryIndex(userId, request.category, id);
    
    // Update profile stats
    await this.incrementMemoryCount(userId);
    
    return memory;
  }
  
  async getMemory(id: string): Promise<Memory | null> {
    const data = await this.store.get(memoryKey(id));
    if (!data) return null;
    
    const memory: Memory = JSON.parse(data);
    
    // Check expiration
    if (memory.expiresAt && new Date(memory.expiresAt) < new Date()) {
      await this.deleteMemory(id, memory.userId);
      return null;
    }
    
    // Check decay
    if (memory.reinforcementScore < 10) {
      // Memory has decayed too much
      await this.deleteMemory(id, memory.userId);
      return null;
    }
    
    // Update access stats
    memory.lastAccessedAt = new Date().toISOString();
    memory.accessCount += 1;
    memory.reinforcementScore = Math.min(100, memory.reinforcementScore + 5);
    await this.store.set(memoryKey(id), JSON.stringify(memory), MEMORY_TTL);
    
    return memory;
  }
  
  async updateMemory(id: string, userId: string, updates: UpdateMemoryRequest): Promise<Memory | null> {
    const memory = await this.getMemory(id);
    if (!memory || memory.userId !== userId) return null;
    
    const updated: Memory = {
      ...memory,
      value: updates.value ?? memory.value,
      context: updates.context ?? memory.context,
      confidence: updates.confidence ?? memory.confidence,
      sensitivity: updates.sensitivity ?? memory.sensitivity,
      expiresAt: updates.expiresAt ?? memory.expiresAt,
      updatedAt: new Date().toISOString(),
      reinforcementScore: Math.min(100, memory.reinforcementScore + 20), // Confirmed
    };
    
    await this.store.set(memoryKey(id), JSON.stringify(updated), MEMORY_TTL);
    return updated;
  }
  
  async deleteMemory(id: string, userId: string): Promise<boolean> {
    const memory = await this.store.get(memoryKey(id));
    if (!memory) return false;
    
    const parsed: Memory = JSON.parse(memory);
    if (parsed.userId !== userId) return false;
    
    await this.store.delete(memoryKey(id));
    await this.removeFromUserMemories(userId, id);
    await this.removeFromCategoryIndex(userId, parsed.category, id);
    await this.decrementMemoryCount(userId);
    
    return true;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // MEMORY QUERIES
  // ═══════════════════════════════════════════════════════════════════════════════
  
  async queryMemories(userId: string, query: MemoryQuery = {}): Promise<Memory[]> {
    const allIds = await this.getUserMemoryIds(userId);
    const memories: Memory[] = [];
    
    for (const id of allIds) {
      const memory = await this.getMemory(id);
      if (!memory) continue;
      
      // Filter by category
      if (query.categories && !query.categories.includes(memory.category)) {
        continue;
      }
      
      // Filter by confidence
      if (query.minConfidence) {
        const confidenceOrder = ['uncertain', 'inferred', 'explicit'];
        const minIndex = confidenceOrder.indexOf(query.minConfidence);
        const memIndex = confidenceOrder.indexOf(memory.confidence);
        if (memIndex < minIndex) continue;
      }
      
      // Filter by sensitivity
      if (query.maxSensitivity) {
        const sensitivityOrder = ['public', 'private', 'sensitive'];
        const maxIndex = sensitivityOrder.indexOf(query.maxSensitivity);
        const memIndex = sensitivityOrder.indexOf(memory.sensitivity);
        if (memIndex > maxIndex) continue;
      }
      
      // Filter by keywords
      if (query.keywords && query.keywords.length > 0) {
        const searchText = `${memory.key} ${memory.value} ${memory.context || ''}`.toLowerCase();
        const hasMatch = query.keywords.some(kw => searchText.includes(kw.toLowerCase()));
        if (!hasMatch) continue;
      }
      
      // Filter expired unless requested
      if (!query.includeExpired && memory.expiresAt && new Date(memory.expiresAt) < new Date()) {
        continue;
      }
      
      memories.push(memory);
      
      if (query.limit && memories.length >= query.limit) {
        break;
      }
    }
    
    // Sort by relevance (reinforcement score + recency)
    return memories.sort((a, b) => {
      const scoreA = a.reinforcementScore + this.recencyBonus(a.lastAccessedAt);
      const scoreB = b.reinforcementScore + this.recencyBonus(b.lastAccessedAt);
      return scoreB - scoreA;
    });
  }
  
  async getMemoriesByCategory(userId: string, category: MemoryCategory): Promise<Memory[]> {
    const ids = await this.getCategoryMemoryIds(userId, category);
    const memories: Memory[] = [];
    
    for (const id of ids) {
      const memory = await this.getMemory(id);
      if (memory) memories.push(memory);
    }
    
    return memories.sort((a, b) => b.reinforcementScore - a.reinforcementScore);
  }
  
  async findMemoryByKey(userId: string, key: string): Promise<Memory | null> {
    const normalizedKey = this.normalizeKey(key);
    const allIds = await this.getUserMemoryIds(userId);
    
    for (const id of allIds) {
      const memory = await this.getMemory(id);
      if (memory && memory.key === normalizedKey) {
        return memory;
      }
    }
    
    return null;
  }
  
  async getMemoryStats(userId: string): Promise<MemoryStats> {
    const allIds = await this.getUserMemoryIds(userId);
    const stats: MemoryStats = {
      total: 0,
      byCategory: {} as Record<MemoryCategory, number>,
      byConfidence: {} as Record<MemoryConfidence, number>,
      bySensitivity: {} as Record<MemorySensitivity, number>,
      averageReinforcementScore: 0,
    };
    
    let totalScore = 0;
    let oldest: string | undefined;
    let newest: string | undefined;
    
    for (const id of allIds) {
      const data = await this.store.get(memoryKey(id));
      if (!data) continue;
      
      const memory: Memory = JSON.parse(data);
      stats.total++;
      
      stats.byCategory[memory.category] = (stats.byCategory[memory.category] || 0) + 1;
      stats.byConfidence[memory.confidence] = (stats.byConfidence[memory.confidence] || 0) + 1;
      stats.bySensitivity[memory.sensitivity] = (stats.bySensitivity[memory.sensitivity] || 0) + 1;
      
      totalScore += memory.reinforcementScore;
      
      if (!oldest || memory.createdAt < oldest) oldest = memory.createdAt;
      if (!newest || memory.createdAt > newest) newest = memory.createdAt;
    }
    
    stats.oldestMemory = oldest;
    stats.newestMemory = newest;
    stats.averageReinforcementScore = stats.total > 0 ? Math.round(totalScore / stats.total) : 0;
    
    return stats;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // USER PROFILE
  // ═══════════════════════════════════════════════════════════════════════════════
  
  async getProfile(userId: string): Promise<UserProfile | null> {
    const data = await this.store.get(profileKey(userId));
    return data ? JSON.parse(data) : null;
  }
  
  async getOrCreateProfile(userId: string): Promise<UserProfile> {
    let profile = await this.getProfile(userId);
    
    if (!profile) {
      const now = new Date().toISOString();
      profile = {
        userId,
        preferredTone: 'friendly',
        preferredDepth: 'moderate',
        preferredFormat: 'prose',
        expertiseAreas: [],
        expertiseLevel: 'intermediate',
        interests: [],
        activeProjects: [],
        currentGoals: [],
        totalMemories: 0,
        lastInteraction: now,
        createdAt: now,
        updatedAt: now,
      };
      await this.store.set(profileKey(userId), JSON.stringify(profile), PROFILE_TTL);
    }
    
    return profile;
  }
  
  async updateProfile(userId: string, updates: Partial<UserProfile>): Promise<UserProfile> {
    const profile = await this.getOrCreateProfile(userId);
    
    const updated: UserProfile = {
      ...profile,
      ...updates,
      userId: profile.userId, // Prevent userId change
      createdAt: profile.createdAt, // Preserve creation date
      updatedAt: new Date().toISOString(),
      lastInteraction: new Date().toISOString(),
    };
    
    await this.store.set(profileKey(userId), JSON.stringify(updated), PROFILE_TTL);
    return updated;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // USER PREFERENCES
  // ═══════════════════════════════════════════════════════════════════════════════
  
  async getPreferences(userId: string): Promise<UserPreferences | null> {
    const data = await this.store.get(preferencesKey(userId));
    return data ? JSON.parse(data) : null;
  }
  
  async getOrCreatePreferences(userId: string): Promise<UserPreferences> {
    let preferences = await this.getPreferences(userId);
    
    if (!preferences) {
      preferences = {
        userId,
        tone: 'friendly',
        verbosity: 'balanced',
        formatting: 'moderate',
        proactiveReminders: true,
        suggestNextSteps: true,
        askClarifyingQuestions: true,
        riskTolerance: 'moderate',
        financialAlerts: true,
        healthAlerts: true,
        memoryEnabled: true,
        autoExtractFacts: true,
        sensitiveTopics: [],
        defaultMode: 'snapshot',
        showConfidenceLevel: false,
        showSources: true,
        updatedAt: new Date().toISOString(),
      };
      await this.store.set(preferencesKey(userId), JSON.stringify(preferences), PREFERENCES_TTL);
    }
    
    return preferences;
  }
  
  async updatePreferences(userId: string, updates: Partial<UserPreferences>): Promise<UserPreferences> {
    const preferences = await this.getOrCreatePreferences(userId);
    
    const updated: UserPreferences = {
      ...preferences,
      ...updates,
      userId: preferences.userId, // Prevent userId change
      updatedAt: new Date().toISOString(),
    };
    
    await this.store.set(preferencesKey(userId), JSON.stringify(updated), PREFERENCES_TTL);
    return updated;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // BULK OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  async clearAllMemories(userId: string): Promise<number> {
    const allIds = await this.getUserMemoryIds(userId);
    let count = 0;
    
    for (const id of allIds) {
      const deleted = await this.deleteMemory(id, userId);
      if (deleted) count++;
    }
    
    return count;
  }
  
  async clearCategoryMemories(userId: string, category: MemoryCategory): Promise<number> {
    const memories = await this.getMemoriesByCategory(userId, category);
    let count = 0;
    
    for (const memory of memories) {
      const deleted = await this.deleteMemory(memory.id, userId);
      if (deleted) count++;
    }
    
    return count;
  }
  
  async decayMemories(userId: string): Promise<{ decayed: number; forgotten: number }> {
    const allIds = await this.getUserMemoryIds(userId);
    let decayed = 0;
    let forgotten = 0;
    
    const now = new Date();
    
    for (const id of allIds) {
      const data = await this.store.get(memoryKey(id));
      if (!data) continue;
      
      const memory: Memory = JSON.parse(data);
      const lastAccess = new Date(memory.lastAccessedAt);
      const daysSinceAccess = (now.getTime() - lastAccess.getTime()) / (1000 * 60 * 60 * 24);
      
      if (daysSinceAccess < 1) continue; // Skip recently accessed
      
      // Calculate decay
      const baseDecay = 2; // Points per day
      const categoryMultiplier = {
        preference: 0.5,
        fact: 0.3,
        project: 1.5,
        skill: 0.2,
        interest: 1.0,
        relationship: 0.7,
        goal: 1.2,
        context: 3.0,
      }[memory.category] ?? 1.0;
      
      const decay = baseDecay * categoryMultiplier * Math.floor(daysSinceAccess);
      const newScore = Math.max(0, memory.reinforcementScore - decay);
      
      if (newScore < 10) {
        // Memory should be forgotten
        await this.deleteMemory(id, userId);
        forgotten++;
      } else if (newScore !== memory.reinforcementScore) {
        // Update decay
        memory.reinforcementScore = newScore;
        await this.store.set(memoryKey(id), JSON.stringify(memory), MEMORY_TTL);
        decayed++;
      }
    }
    
    return { decayed, forgotten };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  private normalizeKey(key: string): string {
    return key.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9.]/g, '');
  }
  
  private recencyBonus(lastAccessed: string): number {
    const days = (Date.now() - new Date(lastAccessed).getTime()) / (1000 * 60 * 60 * 24);
    if (days < 1) return 30;
    if (days < 7) return 20;
    if (days < 30) return 10;
    return 0;
  }
  
  private async getUserMemoryIds(userId: string): Promise<string[]> {
    const data = await this.store.get(userMemoriesKey(userId));
    return data ? JSON.parse(data) : [];
  }
  
  private async addToUserMemories(userId: string, memoryId: string): Promise<void> {
    const ids = await this.getUserMemoryIds(userId);
    if (!ids.includes(memoryId)) {
      ids.push(memoryId);
      await this.store.set(userMemoriesKey(userId), JSON.stringify(ids), MEMORY_TTL);
    }
  }
  
  private async removeFromUserMemories(userId: string, memoryId: string): Promise<void> {
    const ids = await this.getUserMemoryIds(userId);
    const filtered = ids.filter(id => id !== memoryId);
    await this.store.set(userMemoriesKey(userId), JSON.stringify(filtered), MEMORY_TTL);
  }
  
  private async getCategoryMemoryIds(userId: string, category: MemoryCategory): Promise<string[]> {
    const data = await this.store.get(userMemoriesByCategoryKey(userId, category));
    return data ? JSON.parse(data) : [];
  }
  
  private async addToCategoryIndex(userId: string, category: MemoryCategory, memoryId: string): Promise<void> {
    const ids = await this.getCategoryMemoryIds(userId, category);
    if (!ids.includes(memoryId)) {
      ids.push(memoryId);
      await this.store.set(userMemoriesByCategoryKey(userId, category), JSON.stringify(ids), MEMORY_TTL);
    }
  }
  
  private async removeFromCategoryIndex(userId: string, category: MemoryCategory, memoryId: string): Promise<void> {
    const ids = await this.getCategoryMemoryIds(userId, category);
    const filtered = ids.filter(id => id !== memoryId);
    await this.store.set(userMemoriesByCategoryKey(userId, category), JSON.stringify(filtered), MEMORY_TTL);
  }
  
  private async incrementMemoryCount(userId: string): Promise<void> {
    const profile = await this.getOrCreateProfile(userId);
    profile.totalMemories++;
    await this.store.set(profileKey(userId), JSON.stringify(profile), PROFILE_TTL);
  }
  
  private async decrementMemoryCount(userId: string): Promise<void> {
    const profile = await this.getOrCreateProfile(userId);
    profile.totalMemories = Math.max(0, profile.totalMemories - 1);
    await this.store.set(profileKey(userId), JSON.stringify(profile), PROFILE_TTL);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let memoryStore: MemoryStore | null = null;

export function getMemoryStore(): MemoryStore {
  if (!memoryStore) {
    memoryStore = new MemoryStore();
  }
  return memoryStore;
}
