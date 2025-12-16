// ═══════════════════════════════════════════════════════════════════════════════
// SEARCH INDEX STORE — Persistence for Search Index
// ═══════════════════════════════════════════════════════════════════════════════

import { getStore, type KeyValueStore } from '../storage/index.js';
import type {
  IndexedDocument,
  SearchableType,
  IndexStats,
  SearchConfig,
} from './types.js';
import { DEFAULT_SEARCH_CONFIG } from './types.js';
import { SearchEngine, Tokenizer } from './engine.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

const INDEX_TTL = 30 * 24 * 60 * 60; // 30 days

// ─────────────────────────────────────────────────────────────────────────────────
// KEY GENERATION
// ─────────────────────────────────────────────────────────────────────────────────

function documentKey(userId: string, docId: string): string {
  return `search:user:${userId}:doc:${docId}`;
}

function userIndexKey(userId: string): string {
  return `search:user:${userId}:index`;
}

function typeIndexKey(userId: string, type: SearchableType): string {
  return `search:user:${userId}:type:${type}`;
}

function tagIndexKey(userId: string, tag: string): string {
  return `search:user:${userId}:tag:${tag.toLowerCase()}`;
}

function statsKey(userId: string): string {
  return `search:user:${userId}:stats`;
}

// ─────────────────────────────────────────────────────────────────────────────────
// SEARCH INDEX STORE
// ─────────────────────────────────────────────────────────────────────────────────

export class SearchIndexStore {
  private store: KeyValueStore;
  private engine: SearchEngine;
  private tokenizer: Tokenizer;
  private config: SearchConfig;
  
  constructor(store?: KeyValueStore, config?: Partial<SearchConfig>) {
    this.store = store ?? getStore();
    this.engine = new SearchEngine();
    this.tokenizer = new Tokenizer();
    this.config = { ...DEFAULT_SEARCH_CONFIG, ...config };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // INDEXING
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Index a document for search.
   */
  async indexDocument(
    userId: string,
    id: string,
    type: SearchableType,
    content: string,
    metadata: {
      title?: string;
      tags?: string[];
      createdAt: string;
      updatedAt?: string;
      extra?: Record<string, unknown>;
    }
  ): Promise<IndexedDocument> {
    // Create indexed document
    const doc = this.engine.indexDocument(
      id,
      type,
      userId,
      content,
      metadata
    );
    
    // Limit tokens per document
    if (doc.tokens.length > this.config.maxTokensPerDocument) {
      doc.tokens = doc.tokens.slice(0, this.config.maxTokensPerDocument);
    }
    
    // Store document
    await this.store.set(
      documentKey(userId, id),
      JSON.stringify(doc),
      INDEX_TTL
    );
    
    // Add to user index
    await this.addToIndex(userId, id);
    
    // Add to type index
    await this.addToTypeIndex(userId, type, id);
    
    // Add to tag indexes
    if (metadata.tags) {
      for (const tag of metadata.tags) {
        await this.addToTagIndex(userId, tag, id);
      }
    }
    
    // Update stats
    await this.incrementDocCount(userId, type);
    
    return doc;
  }
  
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
  ): Promise<IndexedDocument> {
    return this.indexDocument(
      userId,
      conversationId,
      'conversation',
      `${title}\n${messagePreview}`,
      {
        title,
        tags: metadata.tags,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        extra: {
          messageCount: metadata.messageCount,
          lastMessage: messagePreview.slice(0, 200),
        },
      }
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
  ): Promise<IndexedDocument> {
    return this.indexDocument(
      userId,
      messageId,
      'message',
      content,
      {
        createdAt: timestamp,
        extra: {
          conversationId,
          role,
        },
      }
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
  ): Promise<IndexedDocument> {
    return this.indexDocument(
      userId,
      memoryId,
      'memory',
      `${key}: ${value}`,
      {
        title: key,
        tags: metadata.tags,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        extra: {
          category,
          key,
          confidence: metadata.confidence,
        },
      }
    );
  }
  
  /**
   * Remove a document from the index.
   */
  async removeDocument(userId: string, docId: string): Promise<boolean> {
    const docData = await this.store.get(documentKey(userId, docId));
    if (!docData) return false;
    
    const doc: IndexedDocument = JSON.parse(docData);
    
    // Remove from main index
    await this.removeFromIndex(userId, docId);
    
    // Remove from type index
    await this.removeFromTypeIndex(userId, doc.type, docId);
    
    // Remove from tag indexes
    if (doc.tags) {
      for (const tag of doc.tags) {
        await this.removeFromTagIndex(userId, tag, docId);
      }
    }
    
    // Delete document
    await this.store.delete(documentKey(userId, docId));
    
    // Update stats
    await this.decrementDocCount(userId, doc.type);
    
    return true;
  }
  
  /**
   * Update an existing document in the index.
   */
  async updateDocument(
    userId: string,
    id: string,
    type: SearchableType,
    content: string,
    metadata: {
      title?: string;
      tags?: string[];
      createdAt: string;
      updatedAt?: string;
      extra?: Record<string, unknown>;
    }
  ): Promise<IndexedDocument> {
    // Remove old document
    await this.removeDocument(userId, id);
    
    // Re-index
    return this.indexDocument(userId, id, type, content, metadata);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // RETRIEVAL
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Get a single indexed document.
   */
  async getDocument(userId: string, docId: string): Promise<IndexedDocument | null> {
    const data = await this.store.get(documentKey(userId, docId));
    return data ? JSON.parse(data) : null;
  }
  
  /**
   * Get all indexed documents for a user.
   */
  async getAllDocuments(userId: string): Promise<IndexedDocument[]> {
    const docIds = await this.getIndexDocIds(userId);
    const documents: IndexedDocument[] = [];
    
    for (const docId of docIds) {
      const doc = await this.getDocument(userId, docId);
      if (doc) {
        documents.push(doc);
      }
    }
    
    return documents;
  }
  
  /**
   * Get documents by type.
   */
  async getDocumentsByType(
    userId: string,
    type: SearchableType
  ): Promise<IndexedDocument[]> {
    const docIds = await this.getTypeDocIds(userId, type);
    const documents: IndexedDocument[] = [];
    
    for (const docId of docIds) {
      const doc = await this.getDocument(userId, docId);
      if (doc) {
        documents.push(doc);
      }
    }
    
    return documents;
  }
  
  /**
   * Get documents by tag.
   */
  async getDocumentsByTag(
    userId: string,
    tag: string
  ): Promise<IndexedDocument[]> {
    const docIds = await this.getTagDocIds(userId, tag);
    const documents: IndexedDocument[] = [];
    
    for (const docId of docIds) {
      const doc = await this.getDocument(userId, docId);
      if (doc) {
        documents.push(doc);
      }
    }
    
    return documents;
  }
  
  /**
   * Get all unique tags for a user.
   */
  async getAllTags(userId: string): Promise<string[]> {
    const documents = await this.getAllDocuments(userId);
    const tags = new Set<string>();
    
    for (const doc of documents) {
      if (doc.tags) {
        for (const tag of doc.tags) {
          tags.add(tag);
        }
      }
    }
    
    return Array.from(tags).sort();
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // STATS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Get index statistics.
   */
  async getStats(userId: string): Promise<IndexStats> {
    const data = await this.store.get(statsKey(userId));
    
    if (data) {
      return JSON.parse(data);
    }
    
    // Calculate from scratch
    const documents = await this.getAllDocuments(userId);
    const byType: Record<SearchableType, number> = {
      conversation: 0,
      message: 0,
      memory: 0,
    };
    
    for (const doc of documents) {
      byType[doc.type]++;
    }
    
    const stats: IndexStats = {
      totalDocuments: documents.length,
      byType,
      lastIndexed: documents.length > 0
        ? documents.reduce((a, b) => 
            new Date(a.updatedAt) > new Date(b.updatedAt) ? a : b
          ).updatedAt
        : undefined,
    };
    
    // Cache stats
    await this.store.set(statsKey(userId), JSON.stringify(stats), INDEX_TTL);
    
    return stats;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // BULK OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Clear all indexed documents for a user.
   */
  async clearIndex(userId: string): Promise<number> {
    const docIds = await this.getIndexDocIds(userId);
    let count = 0;
    
    for (const docId of docIds) {
      const removed = await this.removeDocument(userId, docId);
      if (removed) count++;
    }
    
    // Clear stats
    await this.store.delete(statsKey(userId));
    
    return count;
  }
  
  /**
   * Clear documents of a specific type.
   */
  async clearTypeIndex(userId: string, type: SearchableType): Promise<number> {
    const documents = await this.getDocumentsByType(userId, type);
    let count = 0;
    
    for (const doc of documents) {
      const removed = await this.removeDocument(userId, doc.id);
      if (removed) count++;
    }
    
    return count;
  }
  
  /**
   * Rebuild index from scratch.
   */
  async rebuildIndex(
    userId: string,
    documents: Array<{
      id: string;
      type: SearchableType;
      content: string;
      metadata: {
        title?: string;
        tags?: string[];
        createdAt: string;
        updatedAt?: string;
        extra?: Record<string, unknown>;
      };
    }>
  ): Promise<number> {
    // Clear existing
    await this.clearIndex(userId);
    
    // Re-index all
    let count = 0;
    for (const doc of documents) {
      await this.indexDocument(
        userId,
        doc.id,
        doc.type,
        doc.content,
        doc.metadata
      );
      count++;
    }
    
    return count;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  private async getIndexDocIds(userId: string): Promise<string[]> {
    const data = await this.store.get(userIndexKey(userId));
    return data ? JSON.parse(data) : [];
  }
  
  private async addToIndex(userId: string, docId: string): Promise<void> {
    const ids = await this.getIndexDocIds(userId);
    if (!ids.includes(docId)) {
      ids.push(docId);
      
      // Enforce max size
      if (ids.length > this.config.maxIndexSize) {
        ids.shift(); // Remove oldest
      }
      
      await this.store.set(userIndexKey(userId), JSON.stringify(ids), INDEX_TTL);
    }
  }
  
  private async removeFromIndex(userId: string, docId: string): Promise<void> {
    const ids = await this.getIndexDocIds(userId);
    const filtered = ids.filter(id => id !== docId);
    await this.store.set(userIndexKey(userId), JSON.stringify(filtered), INDEX_TTL);
  }
  
  private async getTypeDocIds(userId: string, type: SearchableType): Promise<string[]> {
    const data = await this.store.get(typeIndexKey(userId, type));
    return data ? JSON.parse(data) : [];
  }
  
  private async addToTypeIndex(userId: string, type: SearchableType, docId: string): Promise<void> {
    const ids = await this.getTypeDocIds(userId, type);
    if (!ids.includes(docId)) {
      ids.push(docId);
      await this.store.set(typeIndexKey(userId, type), JSON.stringify(ids), INDEX_TTL);
    }
  }
  
  private async removeFromTypeIndex(userId: string, type: SearchableType, docId: string): Promise<void> {
    const ids = await this.getTypeDocIds(userId, type);
    const filtered = ids.filter(id => id !== docId);
    await this.store.set(typeIndexKey(userId, type), JSON.stringify(filtered), INDEX_TTL);
  }
  
  private async getTagDocIds(userId: string, tag: string): Promise<string[]> {
    const data = await this.store.get(tagIndexKey(userId, tag));
    return data ? JSON.parse(data) : [];
  }
  
  private async addToTagIndex(userId: string, tag: string, docId: string): Promise<void> {
    const ids = await this.getTagDocIds(userId, tag);
    if (!ids.includes(docId)) {
      ids.push(docId);
      await this.store.set(tagIndexKey(userId, tag), JSON.stringify(ids), INDEX_TTL);
    }
  }
  
  private async removeFromTagIndex(userId: string, tag: string, docId: string): Promise<void> {
    const ids = await this.getTagDocIds(userId, tag);
    const filtered = ids.filter(id => id !== docId);
    await this.store.set(tagIndexKey(userId, tag), JSON.stringify(filtered), INDEX_TTL);
  }
  
  private async incrementDocCount(userId: string, type: SearchableType): Promise<void> {
    const stats = await this.getStats(userId);
    stats.totalDocuments++;
    stats.byType[type]++;
    stats.lastIndexed = new Date().toISOString();
    await this.store.set(statsKey(userId), JSON.stringify(stats), INDEX_TTL);
  }
  
  private async decrementDocCount(userId: string, type: SearchableType): Promise<void> {
    const stats = await this.getStats(userId);
    stats.totalDocuments = Math.max(0, stats.totalDocuments - 1);
    stats.byType[type] = Math.max(0, stats.byType[type] - 1);
    await this.store.set(statsKey(userId), JSON.stringify(stats), INDEX_TTL);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let searchIndexStore: SearchIndexStore | null = null;

export function getSearchIndexStore(): SearchIndexStore {
  if (!searchIndexStore) {
    searchIndexStore = new SearchIndexStore();
  }
  return searchIndexStore;
}
