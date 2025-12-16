// ═══════════════════════════════════════════════════════════════════════════════
// SEARCH TYPES — Full-Text Search for Conversations & Memories
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// SEARCHABLE CONTENT TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export type SearchableType = 'conversation' | 'message' | 'memory';

export type SearchScope = 'all' | 'conversations' | 'messages' | 'memories';

// ─────────────────────────────────────────────────────────────────────────────────
// SEARCH QUERY
// ─────────────────────────────────────────────────────────────────────────────────

export interface SearchQuery {
  // Query text
  query: string;
  
  // Scope
  scope?: SearchScope;
  
  // Filters
  filters?: SearchFilters;
  
  // Pagination
  limit?: number;
  offset?: number;
  
  // Options
  fuzzy?: boolean;           // Enable fuzzy matching
  highlight?: boolean;       // Include highlighted snippets
  minScore?: number;         // Minimum relevance score (0-1)
}

export interface SearchFilters {
  // Time range
  startDate?: string;
  endDate?: string;
  
  // Content filters
  tags?: string[];
  categories?: string[];     // For memories
  
  // Conversation filters
  conversationIds?: string[];
  
  // Memory-specific
  memoryConfidence?: ('explicit' | 'inferred' | 'uncertain')[];
  memorySensitivity?: ('public' | 'private' | 'sensitive')[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// SEARCH RESULTS
// ─────────────────────────────────────────────────────────────────────────────────

export interface SearchResults {
  // Query info
  query: string;
  scope: SearchScope;
  totalResults: number;
  
  // Results
  results: SearchResult[];
  
  // Facets (aggregations)
  facets?: SearchFacets;
  
  // Pagination
  limit: number;
  offset: number;
  hasMore: boolean;
  
  // Performance
  searchTimeMs: number;
}

export interface SearchResult {
  // Identity
  id: string;
  type: SearchableType;
  
  // Content
  title: string;
  snippet: string;
  highlightedSnippet?: string;
  
  // Relevance
  score: number;              // 0-1, higher = more relevant
  matchedTerms: string[];
  
  // Metadata
  createdAt: string;
  updatedAt?: string;
  
  // Type-specific data
  data: ConversationResult | MessageResult | MemoryResult;
}

export interface ConversationResult {
  type: 'conversation';
  conversationId: string;
  messageCount: number;
  lastMessage?: string;
  tags?: string[];
}

export interface MessageResult {
  type: 'message';
  messageId: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface MemoryResult {
  type: 'memory';
  memoryId: string;
  category: string;
  key: string;
  value: string;
  confidence: string;
}

export interface SearchFacets {
  byType: Record<SearchableType, number>;
  byTag?: Record<string, number>;
  byCategory?: Record<string, number>;
  byDate?: DateFacet[];
}

export interface DateFacet {
  date: string;      // YYYY-MM-DD
  count: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// SEARCH INDEX
// ─────────────────────────────────────────────────────────────────────────────────

export interface IndexedDocument {
  id: string;
  type: SearchableType;
  userId: string;
  
  // Searchable content
  content: string;
  title?: string;
  tags?: string[];
  
  // Tokenized content (for fast matching)
  tokens: string[];
  
  // Metadata
  createdAt: string;
  updatedAt: string;
  
  // Type-specific
  metadata: Record<string, unknown>;
}

export interface IndexStats {
  totalDocuments: number;
  byType: Record<SearchableType, number>;
  lastIndexed?: string;
  indexSizeBytes?: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// SEARCH HISTORY
// ─────────────────────────────────────────────────────────────────────────────────

export interface SearchHistoryEntry {
  id: string;
  userId: string;
  query: string;
  scope: SearchScope;
  filters?: SearchFilters;
  resultCount: number;
  timestamp: string;
}

export interface SearchSuggestion {
  query: string;
  score: number;            // Based on frequency + recency
  resultCount?: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// TOKENIZATION
// ─────────────────────────────────────────────────────────────────────────────────

export interface TokenizerOptions {
  lowercase?: boolean;
  removeStopWords?: boolean;
  stemming?: boolean;
  minLength?: number;
  maxLength?: number;
}

export const DEFAULT_TOKENIZER_OPTIONS: TokenizerOptions = {
  lowercase: true,
  removeStopWords: true,
  stemming: false,        // Simplified - no stemming
  minLength: 2,
  maxLength: 50,
};

// Common English stop words
export const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that',
  'the', 'to', 'was', 'were', 'will', 'with', 'you', 'your',
  'i', 'me', 'my', 'we', 'our', 'they', 'them', 'their',
  'this', 'these', 'those', 'what', 'which', 'who', 'whom',
  'can', 'could', 'would', 'should', 'have', 'had', 'do', 'does', 'did',
  'but', 'if', 'then', 'so', 'than', 'too', 'very', 'just',
  'about', 'into', 'over', 'after', 'before', 'between',
]);

// ─────────────────────────────────────────────────────────────────────────────────
// FUZZY MATCHING
// ─────────────────────────────────────────────────────────────────────────────────

export interface FuzzyMatchOptions {
  maxDistance?: number;      // Max Levenshtein distance
  caseSensitive?: boolean;
  threshold?: number;        // Min similarity (0-1)
}

export const DEFAULT_FUZZY_OPTIONS: FuzzyMatchOptions = {
  maxDistance: 2,
  caseSensitive: false,
  threshold: 0.6,
};

// ─────────────────────────────────────────────────────────────────────────────────
// RANKING
// ─────────────────────────────────────────────────────────────────────────────────

export interface RankingFactors {
  termFrequency: number;     // How often term appears in document
  documentFrequency: number; // How many docs contain term (inverse)
  fieldBoost: number;        // Title vs content boost
  recencyBoost: number;      // Recent docs get boost
  exactMatchBoost: number;   // Exact phrase match
}

export const FIELD_BOOSTS: Record<string, number> = {
  title: 2.0,
  tags: 1.5,
  content: 1.0,
  key: 1.8,                  // Memory key
  value: 1.2,                // Memory value
};

// ─────────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────────

export interface SearchConfig {
  // Index settings
  maxIndexSize: number;          // Max documents per user
  indexTTL: number;              // Seconds
  
  // Query settings
  defaultLimit: number;
  maxLimit: number;
  defaultFuzzy: boolean;
  
  // History settings
  maxHistoryEntries: number;
  historyTTL: number;            // Seconds
  
  // Performance
  maxTokensPerDocument: number;
  searchTimeoutMs: number;
}

export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  maxIndexSize: 10000,
  indexTTL: 30 * 24 * 60 * 60,   // 30 days
  defaultLimit: 20,
  maxLimit: 100,
  defaultFuzzy: true,
  maxHistoryEntries: 100,
  historyTTL: 90 * 24 * 60 * 60, // 90 days
  maxTokensPerDocument: 1000,
  searchTimeoutMs: 5000,
};
