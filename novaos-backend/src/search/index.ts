// ═══════════════════════════════════════════════════════════════════════════════
// SEARCH MODULE — Full-Text Search for Conversations & Memories
// ═══════════════════════════════════════════════════════════════════════════════

// Types
export type {
  SearchableType,
  SearchScope,
  SearchQuery,
  SearchFilters,
  SearchResults,
  SearchResult,
  ConversationResult,
  MessageResult,
  MemoryResult,
  SearchFacets,
  DateFacet,
  IndexedDocument,
  IndexStats,
  SearchHistoryEntry,
  SearchSuggestion,
  TokenizerOptions,
  FuzzyMatchOptions,
  RankingFactors,
  SearchConfig,
} from './types.js';

// Constants
export {
  DEFAULT_TOKENIZER_OPTIONS,
  DEFAULT_FUZZY_OPTIONS,
  STOP_WORDS,
  FIELD_BOOSTS,
  DEFAULT_SEARCH_CONFIG,
} from './types.js';

// Engine
export {
  Tokenizer,
  FuzzyMatcher,
  SearchRanker,
  SearchEngine,
  getSearchEngine,
} from './engine.js';

// Index Store
export {
  SearchIndexStore,
  getSearchIndexStore,
} from './index-store.js';

// History
export {
  SearchHistoryStore,
  getSearchHistoryStore,
} from './history.js';

// Service
export {
  SearchService,
  getSearchService,
} from './service.js';
