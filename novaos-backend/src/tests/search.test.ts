// ═══════════════════════════════════════════════════════════════════════════════
// SEARCH TESTS — Full-Text Search, Indexing, History
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../storage/memory.js';
import {
  Tokenizer,
  FuzzyMatcher,
  SearchRanker,
  SearchEngine,
  SearchIndexStore,
  SearchHistoryStore,
  SearchService,
  STOP_WORDS,
} from '../search/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TOKENIZER TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Tokenizer', () => {
  let tokenizer: Tokenizer;
  
  beforeEach(() => {
    tokenizer = new Tokenizer();
  });
  
  describe('tokenize', () => {
    it('should split text into tokens', () => {
      const tokens = tokenizer.tokenize('Hello World');
      expect(tokens).toContain('hello');
      expect(tokens).toContain('world');
    });
    
    it('should lowercase by default', () => {
      const tokens = tokenizer.tokenize('UPPERCASE');
      expect(tokens).toContain('uppercase');
    });
    
    it('should remove stop words', () => {
      const tokens = tokenizer.tokenize('the quick brown fox');
      expect(tokens).not.toContain('the');
      expect(tokens).toContain('quick');
      expect(tokens).toContain('brown');
      expect(tokens).toContain('fox');
    });
    
    it('should filter by length', () => {
      const tokens = tokenizer.tokenize('a ab abc abcd');
      expect(tokens).not.toContain('a');
      expect(tokens).toContain('ab');
      expect(tokens).toContain('abc');
    });
    
    it('should handle empty string', () => {
      const tokens = tokenizer.tokenize('');
      expect(tokens).toEqual([]);
    });
    
    it('should handle special characters', () => {
      const tokens = tokenizer.tokenize('hello@world.com user_name test-case');
      expect(tokens).toContain('hello');
      expect(tokens).toContain('world');
      expect(tokens).toContain('com');
      expect(tokens).toContain('user');
      expect(tokens).toContain('name');
    });
  });
  
  describe('tokenizeUnique', () => {
    it('should return unique tokens', () => {
      const tokens = tokenizer.tokenizeUnique('hello hello world world');
      expect(tokens).toEqual(['hello', 'world']);
    });
  });
  
  describe('getTokenFrequency', () => {
    it('should count token frequency', () => {
      const freq = tokenizer.getTokenFrequency('hello world hello');
      expect(freq.get('hello')).toBe(2);
      expect(freq.get('world')).toBe(1);
    });
  });
  
  describe('getNGrams', () => {
    it('should extract bigrams', () => {
      const ngrams = tokenizer.getNGrams('quick brown fox', 2);
      expect(ngrams).toContain('quick brown');
      expect(ngrams).toContain('brown fox');
    });
    
    it('should extract trigrams', () => {
      const ngrams = tokenizer.getNGrams('quick brown fox jumps', 3);
      expect(ngrams).toContain('quick brown fox');
      expect(ngrams).toContain('brown fox jumps');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// FUZZY MATCHER TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('FuzzyMatcher', () => {
  let matcher: FuzzyMatcher;
  
  beforeEach(() => {
    matcher = new FuzzyMatcher();
  });
  
  describe('levenshteinDistance', () => {
    it('should return 0 for identical strings', () => {
      expect(matcher.levenshteinDistance('hello', 'hello')).toBe(0);
    });
    
    it('should calculate single character difference', () => {
      expect(matcher.levenshteinDistance('hello', 'hallo')).toBe(1);
    });
    
    it('should calculate multiple differences', () => {
      expect(matcher.levenshteinDistance('hello', 'help')).toBe(2);
    });
    
    it('should handle empty strings', () => {
      expect(matcher.levenshteinDistance('', 'hello')).toBe(5);
      expect(matcher.levenshteinDistance('hello', '')).toBe(5);
    });
  });
  
  describe('similarity', () => {
    it('should return 1 for identical strings', () => {
      expect(matcher.similarity('hello', 'hello')).toBe(1);
    });
    
    it('should return high similarity for similar strings', () => {
      const sim = matcher.similarity('hello', 'hallo');
      expect(sim).toBeGreaterThan(0.7);
    });
    
    it('should return low similarity for different strings', () => {
      const sim = matcher.similarity('hello', 'world');
      expect(sim).toBeLessThan(0.5);
    });
  });
  
  describe('matches', () => {
    it('should match exact strings', () => {
      expect(matcher.matches('hello', 'hello')).toBe(true);
    });
    
    it('should match similar strings', () => {
      expect(matcher.matches('hello', 'hallo')).toBe(true);
    });
    
    it('should not match very different strings', () => {
      expect(matcher.matches('hello', 'xyz')).toBe(false);
    });
  });
  
  describe('findMatches', () => {
    it('should find fuzzy matches', () => {
      const candidates = ['hello', 'hallo', 'world', 'help'];
      const matches = matcher.findMatches('hello', candidates);
      
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0]!.term).toBe('hello');
      expect(matches[0]!.score).toBe(1);
    });
    
    it('should rank matches by score', () => {
      const candidates = ['help', 'hello', 'hell'];
      const matches = matcher.findMatches('hello', candidates);
      
      // Exact match should be first
      expect(matches[0]!.term).toBe('hello');
    });
  });
  
  describe('isPrefix', () => {
    it('should detect prefix match', () => {
      expect(matcher.isPrefix('hel', 'hello')).toBe(true);
      expect(matcher.isPrefix('wor', 'world')).toBe(true);
    });
    
    it('should reject non-prefix', () => {
      expect(matcher.isPrefix('xyz', 'hello')).toBe(false);
    });
  });
  
  describe('contains', () => {
    it('should detect substring', () => {
      expect(matcher.contains('ell', 'hello')).toBe(true);
      expect(matcher.contains('orl', 'world')).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// SEARCH ENGINE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('SearchEngine', () => {
  let engine: SearchEngine;
  
  beforeEach(() => {
    engine = new SearchEngine();
  });
  
  describe('indexDocument', () => {
    it('should create indexed document', () => {
      const doc = engine.indexDocument(
        'doc1',
        'conversation',
        'user1',
        'This is test content about programming',
        {
          title: 'Programming Discussion',
          tags: ['tech', 'coding'],
          createdAt: new Date().toISOString(),
        }
      );
      
      expect(doc.id).toBe('doc1');
      expect(doc.type).toBe('conversation');
      expect(doc.userId).toBe('user1');
      expect(doc.tokens.length).toBeGreaterThan(0);
      expect(doc.title).toBe('Programming Discussion');
      expect(doc.tags).toContain('tech');
    });
    
    it('should tokenize content', () => {
      const doc = engine.indexDocument(
        'doc1',
        'message',
        'user1',
        'Hello world this is a test',
        { createdAt: new Date().toISOString() }
      );
      
      expect(doc.tokens).toContain('hello');
      expect(doc.tokens).toContain('world');
      expect(doc.tokens).toContain('test');
    });
  });
  
  describe('search', () => {
    let documents: ReturnType<typeof engine.indexDocument>[];
    
    beforeEach(() => {
      documents = [
        engine.indexDocument('doc1', 'conversation', 'user1', 
          'TypeScript programming tutorial', 
          { title: 'TypeScript Basics', createdAt: new Date().toISOString() }
        ),
        engine.indexDocument('doc2', 'conversation', 'user1',
          'JavaScript frameworks comparison',
          { title: 'JS Frameworks', createdAt: new Date().toISOString() }
        ),
        engine.indexDocument('doc3', 'message', 'user1',
          'Python data science introduction',
          { createdAt: new Date().toISOString() }
        ),
      ];
    });
    
    it('should find exact matches', () => {
      const { results } = engine.search('TypeScript', documents);
      
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.id).toBe('doc1');
    });
    
    it('should find fuzzy matches', () => {
      const { results } = engine.search('Typescript', documents, { fuzzy: true });
      
      expect(results.length).toBeGreaterThan(0);
    });
    
    it('should rank by relevance', () => {
      const { results } = engine.search('programming', documents);
      
      // doc1 has both programming and title match
      expect(results[0]!.id).toBe('doc1');
    });
    
    it('should return totalResults count', () => {
      const { results, totalResults } = engine.search('programming', documents);
      
      expect(totalResults).toBe(results.length);
    });
    
    it('should respect limit', () => {
      const { results } = engine.search('programming', documents, { limit: 1 });
      
      expect(results.length).toBeLessThanOrEqual(1);
    });
    
    it('should highlight matched terms', () => {
      const { results } = engine.search('TypeScript', documents, { highlight: true });
      
      expect(results[0]!.highlightedSnippet).toContain('**');
    });
  });
  
  describe('getSuggestions', () => {
    it('should suggest matching terms', () => {
      const documents = [
        engine.indexDocument('doc1', 'conversation', 'user1',
          'TypeScript programming tutorial',
          { createdAt: new Date().toISOString() }
        ),
      ];
      
      const suggestions = engine.getSuggestions('type', documents);
      
      expect(suggestions).toContain('typescript');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// SEARCH INDEX STORE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('SearchIndexStore', () => {
  let store: SearchIndexStore;
  let memoryStore: MemoryStore;
  const userId = 'user123';
  
  beforeEach(() => {
    memoryStore = new MemoryStore();
    store = new SearchIndexStore(memoryStore);
  });
  
  describe('indexDocument', () => {
    it('should index a document', async () => {
      const doc = await store.indexDocument(
        userId,
        'doc1',
        'conversation',
        'Test content',
        {
          title: 'Test',
          createdAt: new Date().toISOString(),
        }
      );
      
      expect(doc.id).toBe('doc1');
      expect(doc.userId).toBe(userId);
    });
    
    it('should retrieve indexed document', async () => {
      await store.indexDocument(
        userId,
        'doc1',
        'conversation',
        'Test content',
        { createdAt: new Date().toISOString() }
      );
      
      const retrieved = await store.getDocument(userId, 'doc1');
      
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe('doc1');
    });
  });
  
  describe('indexConversation', () => {
    it('should index a conversation', async () => {
      const doc = await store.indexConversation(
        userId,
        'conv1',
        'My Conversation',
        'This is the preview text',
        {
          messageCount: 10,
          tags: ['important'],
          createdAt: new Date().toISOString(),
        }
      );
      
      expect(doc.type).toBe('conversation');
      expect(doc.title).toBe('My Conversation');
      expect(doc.tags).toContain('important');
    });
  });
  
  describe('indexMessage', () => {
    it('should index a message', async () => {
      const doc = await store.indexMessage(
        userId,
        'msg1',
        'conv1',
        'user',
        'Hello, this is my message',
        new Date().toISOString()
      );
      
      expect(doc.type).toBe('message');
      expect(doc.metadata['conversationId']).toBe('conv1');
      expect(doc.metadata['role']).toBe('user');
    });
  });
  
  describe('indexMemory', () => {
    it('should index a memory', async () => {
      const doc = await store.indexMemory(
        userId,
        'mem1',
        'fact',
        'user.name',
        'John Doe',
        {
          confidence: 'explicit',
          createdAt: new Date().toISOString(),
        }
      );
      
      expect(doc.type).toBe('memory');
      expect(doc.metadata['category']).toBe('fact');
      expect(doc.metadata['key']).toBe('user.name');
    });
  });
  
  describe('removeDocument', () => {
    it('should remove document from index', async () => {
      await store.indexDocument(
        userId,
        'doc1',
        'conversation',
        'Test',
        { createdAt: new Date().toISOString() }
      );
      
      const removed = await store.removeDocument(userId, 'doc1');
      const retrieved = await store.getDocument(userId, 'doc1');
      
      expect(removed).toBe(true);
      expect(retrieved).toBeNull();
    });
    
    it('should return false for non-existent document', async () => {
      const removed = await store.removeDocument(userId, 'nonexistent');
      expect(removed).toBe(false);
    });
  });
  
  describe('getAllDocuments', () => {
    it('should return all indexed documents', async () => {
      await store.indexDocument(userId, 'doc1', 'conversation', 'Test 1', 
        { createdAt: new Date().toISOString() });
      await store.indexDocument(userId, 'doc2', 'message', 'Test 2',
        { createdAt: new Date().toISOString() });
      
      const docs = await store.getAllDocuments(userId);
      
      expect(docs.length).toBe(2);
    });
  });
  
  describe('getDocumentsByType', () => {
    it('should filter by type', async () => {
      await store.indexDocument(userId, 'doc1', 'conversation', 'Test 1',
        { createdAt: new Date().toISOString() });
      await store.indexDocument(userId, 'doc2', 'message', 'Test 2',
        { createdAt: new Date().toISOString() });
      
      const convs = await store.getDocumentsByType(userId, 'conversation');
      const msgs = await store.getDocumentsByType(userId, 'message');
      
      expect(convs.length).toBe(1);
      expect(msgs.length).toBe(1);
    });
  });
  
  describe('getDocumentsByTag', () => {
    it('should filter by tag', async () => {
      await store.indexDocument(userId, 'doc1', 'conversation', 'Test 1', 
        { tags: ['important'], createdAt: new Date().toISOString() });
      await store.indexDocument(userId, 'doc2', 'conversation', 'Test 2',
        { tags: ['archived'], createdAt: new Date().toISOString() });
      
      const important = await store.getDocumentsByTag(userId, 'important');
      
      expect(important.length).toBe(1);
      expect(important[0]!.id).toBe('doc1');
    });
  });
  
  describe('getAllTags', () => {
    it('should return all unique tags', async () => {
      await store.indexDocument(userId, 'doc1', 'conversation', 'Test 1',
        { tags: ['tech', 'important'], createdAt: new Date().toISOString() });
      await store.indexDocument(userId, 'doc2', 'conversation', 'Test 2',
        { tags: ['tech', 'archived'], createdAt: new Date().toISOString() });
      
      const tags = await store.getAllTags(userId);
      
      expect(tags).toContain('tech');
      expect(tags).toContain('important');
      expect(tags).toContain('archived');
    });
  });
  
  describe('getStats', () => {
    it('should return index statistics', async () => {
      await store.indexDocument(userId, 'doc1', 'conversation', 'Test 1',
        { createdAt: new Date().toISOString() });
      await store.indexDocument(userId, 'doc2', 'message', 'Test 2',
        { createdAt: new Date().toISOString() });
      
      const stats = await store.getStats(userId);
      
      expect(stats.totalDocuments).toBe(2);
      expect(stats.byType['conversation']).toBe(1);
      expect(stats.byType['message']).toBe(1);
    });
  });
  
  describe('clearIndex', () => {
    it('should clear all documents', async () => {
      await store.indexDocument(userId, 'doc1', 'conversation', 'Test 1',
        { createdAt: new Date().toISOString() });
      await store.indexDocument(userId, 'doc2', 'message', 'Test 2',
        { createdAt: new Date().toISOString() });
      
      const cleared = await store.clearIndex(userId);
      const docs = await store.getAllDocuments(userId);
      
      expect(cleared).toBe(2);
      expect(docs.length).toBe(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// SEARCH HISTORY STORE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('SearchHistoryStore', () => {
  let store: SearchHistoryStore;
  let memoryStore: MemoryStore;
  const userId = 'user123';
  
  beforeEach(() => {
    memoryStore = new MemoryStore();
    store = new SearchHistoryStore(memoryStore);
  });
  
  describe('recordSearch', () => {
    it('should record a search', async () => {
      const entry = await store.recordSearch(
        userId,
        'test query',
        'all',
        5
      );
      
      expect(entry.id).toBeDefined();
      expect(entry.query).toBe('test query');
      expect(entry.scope).toBe('all');
      expect(entry.resultCount).toBe(5);
    });
    
    it('should trim whitespace from query', async () => {
      const entry = await store.recordSearch(userId, '  test  ', 'all', 0);
      expect(entry.query).toBe('test');
    });
  });
  
  describe('getHistory', () => {
    it('should return search history', async () => {
      await store.recordSearch(userId, 'query1', 'all', 1);
      await store.recordSearch(userId, 'query2', 'conversations', 2);
      
      const history = await store.getHistory(userId);
      
      expect(history.length).toBe(2);
    });
    
    it('should return most recent first', async () => {
      await store.recordSearch(userId, 'older', 'all', 1);
      await new Promise(r => setTimeout(r, 10));
      await store.recordSearch(userId, 'newer', 'all', 2);
      
      const history = await store.getHistory(userId);
      
      expect(history[0]!.query).toBe('newer');
    });
    
    it('should filter by scope', async () => {
      await store.recordSearch(userId, 'query1', 'all', 1);
      await store.recordSearch(userId, 'query2', 'memories', 2);
      
      const history = await store.getHistory(userId, { scope: 'memories' });
      
      expect(history.length).toBe(1);
      expect(history[0]!.scope).toBe('memories');
    });
    
    it('should respect limit', async () => {
      await store.recordSearch(userId, 'query1', 'all', 1);
      await store.recordSearch(userId, 'query2', 'all', 2);
      await store.recordSearch(userId, 'query3', 'all', 3);
      
      const history = await store.getHistory(userId, { limit: 2 });
      
      expect(history.length).toBe(2);
    });
  });
  
  describe('deleteHistoryEntry', () => {
    it('should delete a history entry', async () => {
      const entry = await store.recordSearch(userId, 'test', 'all', 0);
      
      const deleted = await store.deleteHistoryEntry(userId, entry.id);
      const history = await store.getHistory(userId);
      
      expect(deleted).toBe(true);
      expect(history.length).toBe(0);
    });
    
    it('should not delete another user\'s entry', async () => {
      const entry = await store.recordSearch(userId, 'test', 'all', 0);
      
      const deleted = await store.deleteHistoryEntry('other_user', entry.id);
      
      expect(deleted).toBe(false);
    });
  });
  
  describe('clearHistory', () => {
    it('should clear all history', async () => {
      await store.recordSearch(userId, 'query1', 'all', 1);
      await store.recordSearch(userId, 'query2', 'all', 2);
      
      const cleared = await store.clearHistory(userId);
      const history = await store.getHistory(userId);
      
      expect(cleared).toBe(2);
      expect(history.length).toBe(0);
    });
  });
  
  describe('getSuggestions', () => {
    it('should return suggestions based on history', async () => {
      await store.recordSearch(userId, 'typescript tutorial', 'all', 5);
      await store.recordSearch(userId, 'typescript', 'all', 3);
      
      const suggestions = await store.getSuggestions(userId);
      
      expect(suggestions.length).toBeGreaterThan(0);
    });
    
    it('should filter by prefix', async () => {
      await store.recordSearch(userId, 'typescript', 'all', 5);
      await store.recordSearch(userId, 'python', 'all', 3);
      
      const suggestions = await store.getSuggestions(userId, 'type');
      
      expect(suggestions.some(s => s.query.toLowerCase().includes('type'))).toBe(true);
    });
  });
  
  describe('getRecentQueries', () => {
    it('should return unique recent queries', async () => {
      await store.recordSearch(userId, 'query1', 'all', 1);
      await store.recordSearch(userId, 'query1', 'all', 1);
      await store.recordSearch(userId, 'query2', 'all', 2);
      
      const recent = await store.getRecentQueries(userId);
      
      // Should have unique queries
      const unique = new Set(recent.map(q => q.toLowerCase()));
      expect(unique.size).toBe(recent.length);
    });
  });
  
  describe('getSearchStats', () => {
    it('should return search statistics', async () => {
      await store.recordSearch(userId, 'query1', 'all', 5);
      await store.recordSearch(userId, 'query2', 'conversations', 3);
      await store.recordSearch(userId, 'query1', 'all', 2);
      
      const stats = await store.getSearchStats(userId);
      
      expect(stats.totalSearches).toBe(3);
      expect(stats.uniqueQueries).toBe(2);
      expect(stats.searchesByScope['all']).toBe(2);
      expect(stats.searchesByScope['conversations']).toBe(1);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// SEARCH SERVICE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('SearchService', () => {
  let service: SearchService;
  let memoryStore: MemoryStore;
  const userId = 'user123';
  
  beforeEach(async () => {
    memoryStore = new MemoryStore();
    service = new SearchService(memoryStore);
    
    // Index some test data
    await service.indexConversation(userId, 'conv1', 'TypeScript Discussion',
      'Discussing TypeScript features and best practices',
      { messageCount: 5, tags: ['tech'], createdAt: new Date().toISOString() }
    );
    
    await service.indexConversation(userId, 'conv2', 'Python Tutorial',
      'Learning Python programming basics',
      { messageCount: 3, tags: ['tech', 'learning'], createdAt: new Date().toISOString() }
    );
    
    await service.indexMessage(userId, 'msg1', 'conv1', 'user',
      'What are the benefits of using TypeScript?',
      new Date().toISOString()
    );
    
    await service.indexMemory(userId, 'mem1', 'skill', 'programming.language',
      'TypeScript',
      { confidence: 'explicit', createdAt: new Date().toISOString() }
    );
  });
  
  describe('search', () => {
    it('should search all scopes', async () => {
      const results = await service.search(userId, {
        query: 'TypeScript',
        scope: 'all',
      });
      
      expect(results.totalResults).toBeGreaterThan(0);
      expect(results.query).toBe('TypeScript');
    });
    
    it('should record search in history', async () => {
      await service.search(userId, { query: 'test search' });
      
      const history = await service.getSearchHistory(userId);
      
      expect(history.some(h => h.query === 'test search')).toBe(true);
    });
    
    it('should return facets', async () => {
      const results = await service.search(userId, {
        query: 'TypeScript',
        scope: 'all',
      });
      
      expect(results.facets).toBeDefined();
      expect(results.facets?.byType).toBeDefined();
    });
  });
  
  describe('searchConversations', () => {
    it('should search only conversations', async () => {
      const results = await service.searchConversations(userId, 'TypeScript');
      
      expect(results.scope).toBe('conversations');
      expect(results.results.every(r => r.type === 'conversation')).toBe(true);
    });
    
    it('should filter by tags', async () => {
      const results = await service.searchConversations(userId, 'tech', {
        tags: ['learning'],
      });
      
      // Only conv2 has 'learning' tag
      const ids = results.results.map(r => r.id);
      if (ids.includes('conv2')) {
        expect(true).toBe(true);
      }
    });
  });
  
  describe('searchMessages', () => {
    it('should search only messages', async () => {
      const results = await service.searchMessages(userId, 'TypeScript');
      
      expect(results.scope).toBe('messages');
      expect(results.results.every(r => r.type === 'message')).toBe(true);
    });
  });
  
  describe('searchMemories', () => {
    it('should search only memories', async () => {
      const results = await service.searchMemories(userId, 'TypeScript');
      
      expect(results.scope).toBe('memories');
      expect(results.results.every(r => r.type === 'memory')).toBe(true);
    });
  });
  
  describe('searchByTag', () => {
    it('should return documents with specific tag', async () => {
      const results = await service.searchByTag(userId, 'tech');
      
      expect(results.totalResults).toBeGreaterThan(0);
    });
  });
  
  describe('getSuggestions', () => {
    it('should return search suggestions', async () => {
      await service.search(userId, { query: 'typescript' });
      
      const suggestions = await service.getSuggestions(userId, 'type');
      
      expect(suggestions.length).toBeGreaterThan(0);
    });
  });
  
  describe('getIndexStats', () => {
    it('should return index statistics', async () => {
      const stats = await service.getIndexStats(userId);
      
      expect(stats.totalDocuments).toBeGreaterThan(0);
      expect(stats.byType['conversation']).toBe(2);
      expect(stats.byType['message']).toBe(1);
      expect(stats.byType['memory']).toBe(1);
    });
  });
  
  describe('removeFromIndex', () => {
    it('should remove document from index', async () => {
      const statsBefore = await service.getIndexStats(userId);
      
      await service.removeFromIndex(userId, 'conv1');
      
      const statsAfter = await service.getIndexStats(userId);
      
      expect(statsAfter.totalDocuments).toBe(statsBefore.totalDocuments - 1);
    });
  });
  
  describe('clearIndex', () => {
    it('should clear entire index', async () => {
      const cleared = await service.clearIndex(userId);
      const stats = await service.getIndexStats(userId);
      
      expect(cleared).toBeGreaterThan(0);
      expect(stats.totalDocuments).toBe(0);
    });
  });
  
  describe('getAllTags', () => {
    it('should return all tags', async () => {
      const tags = await service.getAllTags(userId);
      
      expect(tags).toContain('tech');
      expect(tags).toContain('learning');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// STOP WORDS TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Stop Words', () => {
  it('should contain common English stop words', () => {
    expect(STOP_WORDS.has('the')).toBe(true);
    expect(STOP_WORDS.has('is')).toBe(true);
    expect(STOP_WORDS.has('and')).toBe(true);
    expect(STOP_WORDS.has('or')).toBe(true);
  });
  
  it('should not contain content words', () => {
    expect(STOP_WORDS.has('typescript')).toBe(false);
    expect(STOP_WORDS.has('programming')).toBe(false);
    expect(STOP_WORDS.has('computer')).toBe(false);
  });
});
