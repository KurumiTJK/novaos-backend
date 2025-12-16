// ═══════════════════════════════════════════════════════════════════════════════
// SEARCH HISTORY — Track User Searches and Provide Suggestions
// ═══════════════════════════════════════════════════════════════════════════════

import { getStore, type KeyValueStore } from '../storage/index.js';
import type {
  SearchHistoryEntry,
  SearchSuggestion,
  SearchScope,
  SearchFilters,
  SearchConfig,
} from './types.js';
import { DEFAULT_SEARCH_CONFIG } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

const HISTORY_TTL = 90 * 24 * 60 * 60; // 90 days

// ─────────────────────────────────────────────────────────────────────────────────
// KEY GENERATION
// ─────────────────────────────────────────────────────────────────────────────────

function historyKey(userId: string): string {
  return `search:user:${userId}:history`;
}

function historyEntryKey(entryId: string): string {
  return `search:history:${entryId}`;
}

function popularQueriesKey(userId: string): string {
  return `search:user:${userId}:popular`;
}

function generateId(): string {
  return `sh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────────────────────────────────────────────────────────────────
// SEARCH HISTORY STORE
// ─────────────────────────────────────────────────────────────────────────────────

export class SearchHistoryStore {
  private store: KeyValueStore;
  private config: SearchConfig;
  
  constructor(store?: KeyValueStore, config?: Partial<SearchConfig>) {
    this.store = store ?? getStore();
    this.config = { ...DEFAULT_SEARCH_CONFIG, ...config };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // HISTORY MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Record a search query in history.
   */
  async recordSearch(
    userId: string,
    query: string,
    scope: SearchScope,
    resultCount: number,
    filters?: SearchFilters
  ): Promise<SearchHistoryEntry> {
    const id = generateId();
    const entry: SearchHistoryEntry = {
      id,
      userId,
      query: query.trim(),
      scope,
      filters,
      resultCount,
      timestamp: new Date().toISOString(),
    };
    
    // Store entry
    await this.store.set(
      historyEntryKey(id),
      JSON.stringify(entry),
      HISTORY_TTL
    );
    
    // Add to user's history list
    await this.addToHistory(userId, id);
    
    // Update popular queries
    await this.updatePopularQueries(userId, query.trim());
    
    return entry;
  }
  
  /**
   * Get user's search history.
   */
  async getHistory(
    userId: string,
    options?: {
      limit?: number;
      offset?: number;
      scope?: SearchScope;
    }
  ): Promise<SearchHistoryEntry[]> {
    const { limit = 20, offset = 0, scope } = options ?? {};
    
    const entryIds = await this.getHistoryIds(userId);
    const entries: SearchHistoryEntry[] = [];
    
    for (const entryId of entryIds) {
      const data = await this.store.get(historyEntryKey(entryId));
      if (!data) continue;
      
      const entry: SearchHistoryEntry = JSON.parse(data);
      
      // Filter by scope if specified
      if (scope && entry.scope !== scope) continue;
      
      entries.push(entry);
    }
    
    // Sort by timestamp descending (most recent first)
    entries.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    
    return entries.slice(offset, offset + limit);
  }
  
  /**
   * Get a specific history entry.
   */
  async getHistoryEntry(entryId: string): Promise<SearchHistoryEntry | null> {
    const data = await this.store.get(historyEntryKey(entryId));
    return data ? JSON.parse(data) : null;
  }
  
  /**
   * Delete a history entry.
   */
  async deleteHistoryEntry(userId: string, entryId: string): Promise<boolean> {
    const entry = await this.getHistoryEntry(entryId);
    if (!entry || entry.userId !== userId) return false;
    
    await this.store.delete(historyEntryKey(entryId));
    await this.removeFromHistory(userId, entryId);
    
    return true;
  }
  
  /**
   * Clear all search history for a user.
   */
  async clearHistory(userId: string): Promise<number> {
    const entryIds = await this.getHistoryIds(userId);
    let count = 0;
    
    for (const entryId of entryIds) {
      await this.store.delete(historyEntryKey(entryId));
      count++;
    }
    
    await this.store.delete(historyKey(userId));
    await this.store.delete(popularQueriesKey(userId));
    
    return count;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // SUGGESTIONS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Get search suggestions based on history and popular queries.
   */
  async getSuggestions(
    userId: string,
    prefix?: string,
    limit: number = 10
  ): Promise<SearchSuggestion[]> {
    const popular = await this.getPopularQueries(userId);
    
    // Filter by prefix if provided
    let suggestions = popular;
    if (prefix && prefix.length > 0) {
      const lowerPrefix = prefix.toLowerCase();
      suggestions = popular.filter(s => 
        s.query.toLowerCase().startsWith(lowerPrefix) ||
        s.query.toLowerCase().includes(lowerPrefix)
      );
    }
    
    // Sort by score (frequency + recency)
    suggestions.sort((a, b) => b.score - a.score);
    
    return suggestions.slice(0, limit);
  }
  
  /**
   * Get recent unique queries.
   */
  async getRecentQueries(
    userId: string,
    limit: number = 10
  ): Promise<string[]> {
    const history = await this.getHistory(userId, { limit: 50 });
    const seen = new Set<string>();
    const recent: string[] = [];
    
    for (const entry of history) {
      const lowerQuery = entry.query.toLowerCase();
      if (!seen.has(lowerQuery)) {
        seen.add(lowerQuery);
        recent.push(entry.query);
        if (recent.length >= limit) break;
      }
    }
    
    return recent;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // POPULAR QUERIES
  // ═══════════════════════════════════════════════════════════════════════════════
  
  private async getPopularQueries(userId: string): Promise<SearchSuggestion[]> {
    const data = await this.store.get(popularQueriesKey(userId));
    return data ? JSON.parse(data) : [];
  }
  
  private async updatePopularQueries(userId: string, query: string): Promise<void> {
    const popular = await this.getPopularQueries(userId);
    const lowerQuery = query.toLowerCase();
    
    // Find existing entry
    const existing = popular.find(p => p.query.toLowerCase() === lowerQuery);
    
    if (existing) {
      // Increment score
      existing.score += 1;
      existing.query = query; // Update case
    } else {
      // Add new entry
      popular.push({
        query,
        score: 1,
      });
    }
    
    // Keep only top entries
    popular.sort((a, b) => b.score - a.score);
    const trimmed = popular.slice(0, 100);
    
    await this.store.set(
      popularQueriesKey(userId),
      JSON.stringify(trimmed),
      HISTORY_TTL
    );
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // ANALYTICS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Get search statistics for a user.
   */
  async getSearchStats(userId: string): Promise<{
    totalSearches: number;
    uniqueQueries: number;
    avgResultCount: number;
    searchesByScope: Record<SearchScope, number>;
    searchesByDay: Array<{ date: string; count: number }>;
  }> {
    const history = await this.getHistory(userId, { limit: 1000 });
    
    const uniqueQueries = new Set(
      history.map(h => h.query.toLowerCase())
    );
    
    const searchesByScope: Record<SearchScope, number> = {
      all: 0,
      conversations: 0,
      messages: 0,
      memories: 0,
    };
    
    const byDay = new Map<string, number>();
    let totalResults = 0;
    
    for (const entry of history) {
      searchesByScope[entry.scope]++;
      totalResults += entry.resultCount;
      
      const day = entry.timestamp.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    
    const searchesByDay = Array.from(byDay.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30); // Last 30 days
    
    return {
      totalSearches: history.length,
      uniqueQueries: uniqueQueries.size,
      avgResultCount: history.length > 0 
        ? Math.round(totalResults / history.length) 
        : 0,
      searchesByScope,
      searchesByDay,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  private async getHistoryIds(userId: string): Promise<string[]> {
    const data = await this.store.get(historyKey(userId));
    return data ? JSON.parse(data) : [];
  }
  
  private async addToHistory(userId: string, entryId: string): Promise<void> {
    const ids = await this.getHistoryIds(userId);
    
    // Add at beginning (most recent first)
    ids.unshift(entryId);
    
    // Enforce max entries
    if (ids.length > this.config.maxHistoryEntries) {
      // Remove oldest entries
      const removed = ids.splice(this.config.maxHistoryEntries);
      
      // Clean up removed entries
      for (const id of removed) {
        await this.store.delete(historyEntryKey(id));
      }
    }
    
    await this.store.set(historyKey(userId), JSON.stringify(ids), HISTORY_TTL);
  }
  
  private async removeFromHistory(userId: string, entryId: string): Promise<void> {
    const ids = await this.getHistoryIds(userId);
    const filtered = ids.filter(id => id !== entryId);
    await this.store.set(historyKey(userId), JSON.stringify(filtered), HISTORY_TTL);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let searchHistoryStore: SearchHistoryStore | null = null;

export function getSearchHistoryStore(): SearchHistoryStore {
  if (!searchHistoryStore) {
    searchHistoryStore = new SearchHistoryStore();
  }
  return searchHistoryStore;
}
