// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY MODULE TESTS — Store, Extractor, Retriever
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MemoryStore,
  MemoryExtractor,
  MemoryRetriever,
  type Memory,
  type UserProfile,
  type UserPreferences,
} from '../core/memory/index.js';
import { MemoryStore as Store } from '../storage/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// MEMORY STORE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('MemoryStore', () => {
  let store: MemoryStore;
  let backingStore: Store;
  
  beforeEach(() => {
    backingStore = new Store();
    store = new MemoryStore(backingStore);
  });
  
  describe('Memory CRUD', () => {
    it('should create a memory', async () => {
      const memory = await store.createMemory('user-1', {
        category: 'fact',
        key: 'user.name',
        value: 'John Doe',
        confidence: 'explicit',
      });
      
      expect(memory.id).toBeDefined();
      expect(memory.userId).toBe('user-1');
      expect(memory.category).toBe('fact');
      expect(memory.key).toBe('user.name');
      expect(memory.value).toBe('John Doe');
      expect(memory.reinforcementScore).toBe(100);
    });
    
    it('should retrieve a memory', async () => {
      const created = await store.createMemory('user-1', {
        category: 'skill',
        key: 'skill.typescript',
        value: 'TypeScript',
      });
      
      const retrieved = await store.getMemory(created.id);
      
      expect(retrieved).toBeDefined();
      expect(retrieved?.value).toBe('TypeScript');
      expect(retrieved?.accessCount).toBe(1); // Incremented on access
    });
    
    it('should update a memory', async () => {
      const created = await store.createMemory('user-1', {
        category: 'fact',
        key: 'user.location',
        value: 'New York',
      });
      
      const updated = await store.updateMemory(created.id, 'user-1', {
        value: 'San Francisco',
        context: 'User moved',
      });
      
      expect(updated?.value).toBe('San Francisco');
      expect(updated?.context).toBe('User moved');
      // Reinforcement stays at 100 (max)
      expect(updated!.reinforcementScore).toBe(100);
    });
    
    it('should delete a memory', async () => {
      const created = await store.createMemory('user-1', {
        category: 'fact',
        key: 'test.memory',
        value: 'Test',
      });
      
      const deleted = await store.deleteMemory(created.id, 'user-1');
      expect(deleted).toBe(true);
      
      const retrieved = await store.getMemory(created.id);
      expect(retrieved).toBeNull();
    });
    
    it('should not delete memory of another user', async () => {
      const created = await store.createMemory('user-1', {
        category: 'fact',
        key: 'test.memory',
        value: 'Test',
      });
      
      const deleted = await store.deleteMemory(created.id, 'user-2');
      expect(deleted).toBe(false);
    });
  });
  
  describe('Memory Queries', () => {
    beforeEach(async () => {
      await store.createMemory('user-1', { category: 'fact', key: 'user.name', value: 'John' });
      await store.createMemory('user-1', { category: 'fact', key: 'user.role', value: 'Engineer' });
      await store.createMemory('user-1', { category: 'skill', key: 'skill.python', value: 'Python' });
      await store.createMemory('user-1', { category: 'project', key: 'project.app', value: 'Mobile App' });
      await store.createMemory('user-2', { category: 'fact', key: 'user.name', value: 'Jane' });
    });
    
    it('should query all memories for user', async () => {
      const memories = await store.queryMemories('user-1');
      expect(memories.length).toBe(4);
    });
    
    it('should filter by category', async () => {
      const memories = await store.queryMemories('user-1', {
        categories: ['fact'],
      });
      expect(memories.length).toBe(2);
      expect(memories.every(m => m.category === 'fact')).toBe(true);
    });
    
    it('should filter by keywords', async () => {
      const memories = await store.queryMemories('user-1', {
        keywords: ['python', 'engineer'],
      });
      expect(memories.length).toBe(2);
    });
    
    it('should limit results', async () => {
      const memories = await store.queryMemories('user-1', { limit: 2 });
      expect(memories.length).toBe(2);
    });
    
    it('should get memories by category', async () => {
      const skills = await store.getMemoriesByCategory('user-1', 'skill');
      expect(skills.length).toBe(1);
      expect(skills[0]?.value).toBe('Python');
    });
    
    it('should find memory by key', async () => {
      const memory = await store.findMemoryByKey('user-1', 'user.name');
      expect(memory).toBeDefined();
      expect(memory?.value).toBe('John');
    });
  });
  
  describe('Memory Stats', () => {
    it('should calculate memory statistics', async () => {
      await store.createMemory('user-1', { category: 'fact', key: 'f1', value: 'v1' });
      await store.createMemory('user-1', { category: 'fact', key: 'f2', value: 'v2' });
      await store.createMemory('user-1', { category: 'skill', key: 's1', value: 'v3' });
      
      const stats = await store.getMemoryStats('user-1');
      
      expect(stats.total).toBe(3);
      expect(stats.byCategory.fact).toBe(2);
      expect(stats.byCategory.skill).toBe(1);
      expect(stats.averageReinforcementScore).toBeGreaterThan(0);
    });
  });
  
  describe('User Profile', () => {
    it('should create profile on first access', async () => {
      const profile = await store.getOrCreateProfile('user-1');
      
      expect(profile.userId).toBe('user-1');
      expect(profile.preferredTone).toBe('friendly');
      expect(profile.totalMemories).toBe(0);
    });
    
    it('should update profile', async () => {
      await store.getOrCreateProfile('user-1');
      
      const updated = await store.updateProfile('user-1', {
        name: 'John Doe',
        role: 'Engineer',
        expertiseAreas: ['TypeScript', 'Python'],
      });
      
      expect(updated.name).toBe('John Doe');
      expect(updated.role).toBe('Engineer');
      expect(updated.expertiseAreas).toContain('TypeScript');
    });
  });
  
  describe('User Preferences', () => {
    it('should create preferences on first access', async () => {
      const preferences = await store.getOrCreatePreferences('user-1');
      
      expect(preferences.userId).toBe('user-1');
      expect(preferences.tone).toBe('friendly');
      expect(preferences.memoryEnabled).toBe(true);
    });
    
    it('should update preferences', async () => {
      await store.getOrCreatePreferences('user-1');
      
      const updated = await store.updatePreferences('user-1', {
        tone: 'formal',
        verbosity: 'concise',
        sensitiveTopics: ['health', 'finances'],
      });
      
      expect(updated.tone).toBe('formal');
      expect(updated.verbosity).toBe('concise');
      expect(updated.sensitiveTopics).toContain('health');
    });
  });
  
  describe('Bulk Operations', () => {
    it('should clear all memories for user', async () => {
      await store.createMemory('user-1', { category: 'fact', key: 'f1', value: 'v1' });
      await store.createMemory('user-1', { category: 'fact', key: 'f2', value: 'v2' });
      await store.createMemory('user-2', { category: 'fact', key: 'f3', value: 'v3' });
      
      const count = await store.clearAllMemories('user-1');
      
      expect(count).toBe(2);
      
      const remaining = await store.queryMemories('user-1');
      expect(remaining.length).toBe(0);
      
      // Other user unaffected
      const other = await store.queryMemories('user-2');
      expect(other.length).toBe(1);
    });
    
    it('should clear category memories', async () => {
      await store.createMemory('user-1', { category: 'fact', key: 'f1', value: 'v1' });
      await store.createMemory('user-1', { category: 'skill', key: 's1', value: 'v2' });
      
      const count = await store.clearCategoryMemories('user-1', 'fact');
      
      expect(count).toBe(1);
      
      const remaining = await store.queryMemories('user-1');
      expect(remaining.length).toBe(1);
      expect(remaining[0]?.category).toBe('skill');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// MEMORY EXTRACTOR TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('MemoryExtractor', () => {
  let store: MemoryStore;
  let extractor: MemoryExtractor;
  
  beforeEach(() => {
    const backingStore = new Store();
    store = new MemoryStore(backingStore);
    extractor = new MemoryExtractor(store);
  });
  
  describe('Pattern Extraction', () => {
    it('should extract name', async () => {
      const result = await extractor.extractFromMessage('user-1', 'My name is John Smith');
      
      expect(result.memories.length).toBeGreaterThan(0);
      const nameMemory = result.memories.find(m => m.key === 'user.name');
      expect(nameMemory?.value).toBe('John Smith');
    });
    
    it('should extract role', async () => {
      const result = await extractor.extractFromMessage('user-1', "I work as a software engineer");
      
      const roleMemory = result.memories.find(m => m.key === 'user.role');
      expect(roleMemory?.value).toBe('software engineer');
    });
    
    it('should extract company', async () => {
      const result = await extractor.extractFromMessage('user-1', 'I work at Google');
      
      const orgMemory = result.memories.find(m => m.key === 'user.organization');
      expect(orgMemory?.value).toBe('Google');
    });
    
    it('should extract location', async () => {
      const result = await extractor.extractFromMessage('user-1', "I'm based in San Francisco");
      
      const locMemory = result.memories.find(m => m.key === 'user.location');
      expect(locMemory?.value).toBe('San Francisco');
    });
    
    it('should extract skills', async () => {
      const result = await extractor.extractFromMessage('user-1', 'I know Python and I use TypeScript');
      
      expect(result.memories.some(m => m.category === 'skill')).toBe(true);
    });
    
    it('should extract projects', async () => {
      const result = await extractor.extractFromMessage('user-1', "I'm working on a mobile app");
      
      const projectMemory = result.memories.find(m => m.category === 'project');
      expect(projectMemory?.value).toContain('mobile app');
    });
    
    it('should extract interests', async () => {
      const result = await extractor.extractFromMessage('user-1', "I'm interested in machine learning");
      
      const interestMemory = result.memories.find(m => m.category === 'interest');
      expect(interestMemory?.value).toBe('machine learning');
    });
  });
  
  describe('Profile Updates', () => {
    it('should detect profile updates', async () => {
      const result = await extractor.extractFromMessage(
        'user-1',
        "My name is Alice and I work at Anthropic"
      );
      
      expect(result.profileUpdates.name).toBe('Alice');
      expect(result.profileUpdates.organization).toBe('Anthropic');
    });
  });
  
  describe('Preference Signals', () => {
    it('should detect verbosity preference', async () => {
      const result = await extractor.extractFromMessage('user-1', 'Please be brief in your responses');
      expect(result.preferenceUpdates.verbosity).toBe('concise');
      
      const result2 = await extractor.extractFromMessage('user-1', 'Explain in detail please');
      expect(result2.preferenceUpdates.verbosity).toBe('detailed');
    });
    
    it('should detect tone preference', async () => {
      const result = await extractor.extractFromMessage('user-1', 'Please use a formal tone');
      expect(result.preferenceUpdates.tone).toBe('formal');
    });
    
    it('should detect formatting preference', async () => {
      const result = await extractor.extractFromMessage('user-1', 'Use bullet points please');
      expect(result.preferenceUpdates.formatting).toBe('rich');
    });
  });
  
  describe('Extract and Save', () => {
    it('should save extracted memories', async () => {
      const { saved, profileUpdated } = await extractor.extractAndSave(
        'user-1',
        "My name is Bob and I'm a designer"
      );
      
      expect(saved.length).toBeGreaterThan(0);
      expect(profileUpdated).toBe(true);
      
      // Verify saved - check for either name or role
      const memories = await store.queryMemories('user-1');
      expect(memories.some(m => m.value.includes('Bob') || m.value.includes('designer'))).toBe(true);
    });
    
    it('should not duplicate existing memories', async () => {
      await extractor.extractAndSave('user-1', 'My name is Carol');
      await extractor.extractAndSave('user-1', 'My name is Carol');
      
      const memories = await store.queryMemories('user-1', {
        keywords: ['carol'],
      });
      expect(memories.length).toBe(1);
    });
    
    it('should update existing memory if value changes', async () => {
      await extractor.extractAndSave('user-1', 'I live in New York');
      await extractor.extractAndSave('user-1', 'I live in Boston');
      
      const memory = await store.findMemoryByKey('user-1', 'user.location');
      expect(memory?.value).toBe('Boston');
    });
  });
  
  describe('Privacy Controls', () => {
    it('should respect disabled auto-extraction', async () => {
      await store.updatePreferences('user-1', {
        autoExtractFacts: false,
      });
      
      const result = await extractor.extractFromMessage('user-1', 'My name is Dave');
      
      expect(result.memories.length).toBe(0);
    });
    
    it('should skip sensitive topics', async () => {
      await store.updatePreferences('user-1', {
        sensitiveTopics: ['salary', 'health'],
      });
      
      const result = await extractor.extractFromMessage(
        'user-1',
        'My salary is 100k and I have health issues'
      );
      
      expect(result.memories.length).toBe(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// MEMORY RETRIEVER TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('MemoryRetriever', () => {
  let store: MemoryStore;
  let retriever: MemoryRetriever;
  
  beforeEach(async () => {
    const backingStore = new Store();
    store = new MemoryStore(backingStore);
    retriever = new MemoryRetriever(store);
    
    // Set up test data
    await store.updateProfile('user-1', {
      name: 'Test User',
      role: 'Developer',
      organization: 'TestCo',
      expertiseAreas: ['JavaScript', 'Python'],
    });
    
    await store.createMemory('user-1', {
      category: 'project',
      key: 'project.webapp',
      value: 'Building a web application',
    });
    
    await store.createMemory('user-1', {
      category: 'skill',
      key: 'skill.react',
      value: 'React expertise',
    });
    
    await store.updatePreferences('user-1', {
      tone: 'casual',
      verbosity: 'concise',
    });
  });
  
  describe('Retrieval', () => {
    it('should retrieve memories with profile and preferences', async () => {
      const result = await retriever.retrieve('user-1');
      
      expect(result.memories.length).toBeGreaterThan(0);
      expect(result.profile?.name).toBe('Test User');
      expect(result.preferences?.tone).toBe('casual');
    });
    
    it('should retrieve for message with relevant keywords', async () => {
      const result = await retriever.retrieveForMessage('user-1', 'Tell me about my React project');
      
      expect(result.memories.some(m => m.value.includes('React') || m.value.includes('web'))).toBe(true);
    });
  });
  
  describe('Context Injection', () => {
    it('should build context injection', async () => {
      const injection = await retriever.buildContextInjection('user-1', 'Hello!');
      
      expect(injection.summary).toContain('Test User');
      expect(injection.activeProjects.length).toBeGreaterThan(0);
    });
    
    it('should format context for LLM', async () => {
      const injection = await retriever.buildContextInjection('user-1', 'Hello!');
      const formatted = retriever.formatContextForLLM(injection);
      
      expect(formatted).toContain('<user_context>');
      expect(formatted).toContain('Test User');
      expect(formatted).toContain('</user_context>');
    });
    
    it('should include preferences in context', async () => {
      const injection = await retriever.buildContextInjection('user-1', 'Hello!');
      
      expect(injection.preferences.some(p => p.includes('casual') || p.includes('concise'))).toBe(true);
    });
    
    it('should return empty context if memory disabled', async () => {
      await store.updatePreferences('user-1', {
        memoryEnabled: false,
      });
      
      const injection = await retriever.buildContextInjection('user-1', 'Hello!');
      
      expect(injection.summary).toBe('');
      expect(injection.facts.length).toBe(0);
    });
  });
  
  describe('Quick Access Methods', () => {
    it('should get user name', async () => {
      const name = await retriever.getUserName('user-1');
      expect(name).toBe('Test User');
    });
    
    it('should get active projects', async () => {
      const projects = await retriever.getActiveProjects('user-1');
      expect(projects.length).toBeGreaterThan(0);
    });
    
    it('should get expertise areas', async () => {
      const expertise = await retriever.getExpertiseAreas('user-1');
      expect(expertise).toContain('JavaScript');
      expect(expertise).toContain('React expertise');
    });
  });
});
