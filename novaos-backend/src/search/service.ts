// ═══════════════════════════════════════════════════════════════════════════════
// SEARCH SERVICE — High-Level Search Operations
// ═══════════════════════════════════════════════════════════════════════════════

import type { KeyValueStore } from '../storage/index.js';
import type {
  SearchQuery,
  SearchResults,
  SearchResult,
  SearchFacets,
  SearchScope,
  SearchableType,
  IndexedDocument,
  IndexStats,
  SearchSuggestion,
  SearchConfig,
} from './types.js';
import { DEFAULT_SEARCH_CONFIG } from './types.js';
import { SearchEngine, getSearchEngine } from './engine.js';
import { SearchIndexStore, getSearchIndexStore } from './index-store.js';
import { SearchHistoryStore, getSearchHistoryStore } from './history.js';

// ─────────────────────────────────────────────────────────────────────────────────
// SEARCH SERVICE
// ─────────────────────────────────────────────────────────────────────────────────

export class SearchService {
  private engine: SearchEngine;
  private indexStore: SearchIndexStore;
  private historyStore: SearchHistoryStore;
  private config: SearchConfig;
  
  constructor(
    store?: KeyValueStore,
    config?: Partial<SearchConfig>
  ) {
    this.config = { ...DEFAULT_SEARCH_CONFIG, ...config };
    this.engine = getSearchEngine();
    this.indexStore = store 
      ? new SearchIndexStore(store, config)
      : getSearchIndexStore();
    this.historyStore = store
      ? new SearchHistoryStore(store, config)
      : getSearchHistoryStore();
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // SEARCH
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Execute a search query.
   */
  async search(userId: string, query: SearchQuery): Promise<SearchResults> {
    const startTime = Date.now();
    
    const {
      query: queryText,
      scope = 'all',
      filters,
      limit = this.config.defaultLimit,
      offset = 0,
      fuzzy = this.config.defaultFuzzy,
      highlight = true,
      minScore = 0.1,
    } = query;
    
    // Validate
    if (!queryText || queryText.trim().length === 0) {
      return this.emptyResults(queryText, scope, limit, offset, Date.now() - startTime);
    }
    
    // Get documents based on scope
    let documents = await this.getDocumentsForScope(userId, scope);
    
    // Apply filters
    documents = this.applyFilters(documents, filters);
    
    // Execute search
    const { results, totalResults } = this.engine.search(
      queryText,
      documents,
      { fuzzy, minScore, limit, offset, highlight }
    );
    
    // Calculate facets
    const facets = this.calculateFacets(documents, results);
    
    // Record in history
    await this.historyStore.recordSearch(
      userId,
      queryText,
      scope,
      totalResults,
      filters
    );
    
    const searchTimeMs = Date.now() - startTime;
    
    return {
      query: queryText,
      scope,
      totalResults,
      results,
      facets,
      limit,
      offset,
      hasMore: offset + results.length < totalResults,
      searchTimeMs,
    };
  }
  
  /**
   * Search conversations only.
   */
  async searchConversations(
    userId: string,
    queryText: string,
    options?: {
      limit?: number;
      offset?: number;
      tags?: string[];
      startDate?: string;
      endDate?: string;
    }
  ): Promise<SearchResults> {
    return this.search(userId, {
      query: queryText,
      scope: 'conversations',
      filters: {
        tags: options?.tags,
        startDate: options?.startDate,
        endDate: options?.endDate,
      },
      limit: options?.limit,
      offset: options?.offset,
    });
  }
  
  /**
   * Search messages only.
   */
  async searchMessages(
    userId: string,
    queryText: string,
    options?: {
      limit?: number;
      offset?: number;
      conversationIds?: string[];
      startDate?: string;
      endDate?: string;
    }
  ): Promise<SearchResults> {
    return this.search(userId, {
      query: queryText,
      scope: 'messages',
      filters: {
        conversationIds: options?.conversationIds,
        startDate: options?.startDate,
        endDate: options?.endDate,
      },
      limit: options?.limit,
      offset: options?.offset,
    });
  }
  
  /**
   * Search memories only.
   */
  async searchMemories(
    userId: string,
    queryText: string,
    options?: {
      limit?: number;
      offset?: number;
      categories?: string[];
      confidence?: ('explicit' | 'inferred' | 'uncertain')[];
    }
  ): Promise<SearchResults> {
    return this.search(userId, {
      query: queryText,
      scope: 'memories',
      filters: {
        categories: options?.categories,
        memoryConfidence: options?.confidence,
      },
      limit: options?.limit,
      offset: options?.offset,
    });
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // INDEXING
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Index a conversation.
   */
  async indexConversation(
    userId: string,
    conversationId: string,
    title: string,
    messagePreview: string,
    metadata: {
      messageCount: number;
      tags?: string[];
      createdAt: string;
      updatedAt?: string;
    }
  ): Promise<void> {
    await this.indexStore.indexConversation(
      userId,
      conversationId,
      title,
      messagePreview,
      metadata
    );
  }
  
  /**
   * Index a message.
   */
  async indexMessage(
    userId: string,
    messageId: string,
    conversationId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    timestamp: string
  ): Promise<void> {
    await this.indexStore.indexMessage(
      userId,
      messageId,
      conversationId,
      role,
      content,
      timestamp
    );
  }
  
  /**
   * Index a memory.
   */
  async indexMemory(
    userId: string,
    memoryId: string,
    category: string,
    key: string,
    value: string,
    metadata: {
      confidence: string;
      tags?: string[];
      createdAt: string;
      updatedAt?: string;
    }
  ): Promise<void> {
    await this.indexStore.indexMemory(
      userId,
      memoryId,
      category,
      key,
      value,
      metadata
    );
  }
  
  /**
   * Remove a document from the index.
   */
  async removeFromIndex(userId: string, docId: string): Promise<boolean> {
    return this.indexStore.removeDocument(userId, docId);
  }
  
  /**
   * Get index statistics.
   */
  async getIndexStats(userId: string): Promise<IndexStats> {
    return this.indexStore.getStats(userId);
  }
  
  /**
   * Clear the search index.
   */
  async clearIndex(userId: string): Promise<number> {
    return this.indexStore.clearIndex(userId);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // SUGGESTIONS & HISTORY
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Get search suggestions based on prefix.
   */
  async getSuggestions(
    userId: string,
    prefix?: string,
    limit?: number
  ): Promise<SearchSuggestion[]> {
    return this.historyStore.getSuggestions(userId, prefix, limit);
  }
  
  /**
   * Get recent searches.
   */
  async getRecentSearches(
    userId: string,
    limit?: number
  ): Promise<string[]> {
    return this.historyStore.getRecentQueries(userId, limit);
  }
  
  /**
   * Get search history.
   */
  async getSearchHistory(
    userId: string,
    options?: {
      limit?: number;
      offset?: number;
      scope?: SearchScope;
    }
  ) {
    return this.historyStore.getHistory(userId, options);
  }
  
  /**
   * Clear search history.
   */
  async clearSearchHistory(userId: string): Promise<number> {
    return this.historyStore.clearHistory(userId);
  }
  
  /**
   * Get search statistics.
   */
  async getSearchStats(userId: string) {
    return this.historyStore.getSearchStats(userId);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // TAGS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Get all tags for a user.
   */
  async getAllTags(userId: string): Promise<string[]> {
    return this.indexStore.getAllTags(userId);
  }
  
  /**
   * Search by tag.
   */
  async searchByTag(
    userId: string,
    tag: string,
    options?: {
      limit?: number;
      offset?: number;
    }
  ): Promise<SearchResults> {
    const startTime = Date.now();
    const { limit = this.config.defaultLimit, offset = 0 } = options ?? {};
    
    const documents = await this.indexStore.getDocumentsByTag(userId, tag);
    
    // Convert to search results
    const results: SearchResult[] = documents
      .slice(offset, offset + limit)
      .map(doc => ({
        id: doc.id,
        type: doc.type,
        title: doc.title ?? doc.content.slice(0, 50),
        snippet: doc.content.slice(0, 200),
        score: 1.0,
        matchedTerms: [tag],
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        data: this.buildResultData(doc),
      }));
    
    return {
      query: `tag:${tag}`,
      scope: 'all',
      totalResults: documents.length,
      results,
      limit,
      offset,
      hasMore: offset + results.length < documents.length,
      searchTimeMs: Date.now() - startTime,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  private async getDocumentsForScope(
    userId: string,
    scope: SearchScope
  ): Promise<IndexedDocument[]> {
    switch (scope) {
      case 'conversations':
        return this.indexStore.getDocumentsByType(userId, 'conversation');
      case 'messages':
        return this.indexStore.getDocumentsByType(userId, 'message');
      case 'memories':
        return this.indexStore.getDocumentsByType(userId, 'memory');
      case 'all':
      default:
        return this.indexStore.getAllDocuments(userId);
    }
  }
  
  private applyFilters(
    documents: IndexedDocument[],
    filters?: SearchQuery['filters']
  ): IndexedDocument[] {
    if (!filters) return documents;
    
    return documents.filter(doc => {
      // Time range
      if (filters.startDate) {
        if (new Date(doc.createdAt) < new Date(filters.startDate)) {
          return false;
        }
      }
      
      if (filters.endDate) {
        if (new Date(doc.createdAt) > new Date(filters.endDate)) {
          return false;
        }
      }
      
      // Tags
      if (filters.tags && filters.tags.length > 0) {
        if (!doc.tags || !filters.tags.some(t => doc.tags!.includes(t))) {
          return false;
        }
      }
      
      // Categories (for memories)
      if (filters.categories && filters.categories.length > 0) {
        const category = doc.metadata['category'] as string | undefined;
        if (!category || !filters.categories.includes(category)) {
          return false;
        }
      }
      
      // Conversation filter
      if (filters.conversationIds && filters.conversationIds.length > 0) {
        const convId = doc.metadata['conversationId'] as string | undefined;
        if (!convId || !filters.conversationIds.includes(convId)) {
          return false;
        }
      }
      
      // Memory confidence
      if (filters.memoryConfidence && filters.memoryConfidence.length > 0) {
        const confidence = doc.metadata['confidence'] as string | undefined;
        if (!confidence || !filters.memoryConfidence.includes(confidence as any)) {
          return false;
        }
      }
      
      // Memory sensitivity
      if (filters.memorySensitivity && filters.memorySensitivity.length > 0) {
        const sensitivity = doc.metadata['sensitivity'] as string | undefined;
        if (!sensitivity || !filters.memorySensitivity.includes(sensitivity as any)) {
          return false;
        }
      }
      
      return true;
    });
  }
  
  private calculateFacets(
    allDocuments: IndexedDocument[],
    results: SearchResult[]
  ): SearchFacets {
    // Type counts from results
    const byType: Record<SearchableType, number> = {
      conversation: 0,
      message: 0,
      memory: 0,
    };
    
    for (const result of results) {
      byType[result.type]++;
    }
    
    // Tag counts from all documents
    const byTag: Record<string, number> = {};
    for (const doc of allDocuments) {
      if (doc.tags) {
        for (const tag of doc.tags) {
          byTag[tag] = (byTag[tag] ?? 0) + 1;
        }
      }
    }
    
    // Category counts (memories only)
    const byCategory: Record<string, number> = {};
    for (const doc of allDocuments) {
      if (doc.type === 'memory') {
        const category = doc.metadata['category'] as string;
        if (category) {
          byCategory[category] = (byCategory[category] ?? 0) + 1;
        }
      }
    }
    
    // Date facets (last 30 days)
    const byDate: Array<{ date: string; count: number }> = [];
    const dateCounts = new Map<string, number>();
    
    for (const result of results) {
      const date = result.createdAt.slice(0, 10);
      dateCounts.set(date, (dateCounts.get(date) ?? 0) + 1);
    }
    
    for (const [date, count] of dateCounts) {
      byDate.push({ date, count });
    }
    byDate.sort((a, b) => b.date.localeCompare(a.date));
    
    return {
      byType,
      byTag: Object.keys(byTag).length > 0 ? byTag : undefined,
      byCategory: Object.keys(byCategory).length > 0 ? byCategory : undefined,
      byDate: byDate.length > 0 ? byDate.slice(0, 30) : undefined,
    };
  }
  
  private emptyResults(
    query: string,
    scope: SearchScope,
    limit: number,
    offset: number,
    searchTimeMs: number
  ): SearchResults {
    return {
      query,
      scope,
      totalResults: 0,
      results: [],
      limit,
      offset,
      hasMore: false,
      searchTimeMs,
    };
  }
  
  private buildResultData(doc: IndexedDocument): SearchResult['data'] {
    switch (doc.type) {
      case 'conversation':
        return {
          type: 'conversation',
          conversationId: doc.id,
          messageCount: (doc.metadata['messageCount'] as number) ?? 0,
          lastMessage: doc.metadata['lastMessage'] as string | undefined,
          tags: doc.tags,
        };
      
      case 'message':
        return {
          type: 'message',
          messageId: doc.id,
          conversationId: doc.metadata['conversationId'] as string,
          role: doc.metadata['role'] as 'user' | 'assistant' | 'system',
          content: doc.content,
        };
      
      case 'memory':
        return {
          type: 'memory',
          memoryId: doc.id,
          category: doc.metadata['category'] as string,
          key: doc.metadata['key'] as string,
          value: doc.content,
          confidence: doc.metadata['confidence'] as string,
        };
      
      default:
        return {
          type: 'conversation',
          conversationId: doc.id,
          messageCount: 0,
        };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let searchService: SearchService | null = null;

export function getSearchService(): SearchService {
  if (!searchService) {
    searchService = new SearchService();
  }
  return searchService;
}
