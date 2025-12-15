// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY MODULE — User Profile, Preferences, and Context Learning
// ═══════════════════════════════════════════════════════════════════════════════
//
// Nova's memory system enables personalization while respecting privacy.
//
// Components:
// - Store: Persistence for memories, profile, preferences
// - Extractor: Learns facts from conversations
// - Retriever: Retrieves relevant context for LLM injection
//
// ═══════════════════════════════════════════════════════════════════════════════

// Types
export type {
  MemoryCategory,
  MemoryConfidence,
  MemorySensitivity,
  Memory,
  MemorySource,
  UserProfile,
  ProjectContext,
  UserPreferences,
  ExtractedMemory,
  ExtractionResult,
  MemoryQuery,
  RetrievalResult,
  ContextInjection,
  CreateMemoryRequest,
  UpdateMemoryRequest,
  MemoryStats,
} from './types.js';

export {
  DEFAULT_PREFERENCES,
  DEFAULT_PROFILE,
  MEMORY_DECAY_CONFIG,
} from './types.js';

// Store
export {
  MemoryStore,
  getMemoryStore,
} from './store.js';

// Extractor
export {
  MemoryExtractor,
  getMemoryExtractor,
  createMemoryExtractor,
} from './extractor.js';

// Retriever
export {
  MemoryRetriever,
  getMemoryRetriever,
} from './retriever.js';
