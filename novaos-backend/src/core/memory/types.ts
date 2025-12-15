// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY TYPES — User Profile, Preferences, Learned Context
// ═══════════════════════════════════════════════════════════════════════════════
//
// Nova's memory system enables personalization while respecting privacy.
// Memory is used to:
// - Remember user preferences (communication style, expertise level)
// - Track ongoing projects and goals
// - Learn key facts mentioned in conversation
// - Provide relevant context for better responses
//
// Privacy principles:
// - User controls what is remembered
// - User can view, edit, and delete memories
// - Sensitive information requires explicit consent
// - Memories decay over time if not reinforced
//
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// MEMORY CATEGORIES
// ─────────────────────────────────────────────────────────────────────────────────

export type MemoryCategory =
  | 'preference'      // How user likes to interact (style, format, depth)
  | 'fact'            // Personal facts (name, role, location, etc.)
  | 'project'         // Ongoing work or initiatives
  | 'skill'           // User's expertise areas
  | 'interest'        // Topics user cares about
  | 'relationship'    // People user mentions
  | 'goal'            // Aspirations and objectives (links to Sword)
  | 'context';        // Situational context for current period

export type MemoryConfidence = 'explicit' | 'inferred' | 'uncertain';

export type MemorySensitivity = 'public' | 'private' | 'sensitive';

// ─────────────────────────────────────────────────────────────────────────────────
// CORE MEMORY STRUCTURE
// ─────────────────────────────────────────────────────────────────────────────────

export interface Memory {
  id: string;
  userId: string;
  
  // Content
  category: MemoryCategory;
  key: string;           // Normalized identifier (e.g., "user.name", "project.novaos")
  value: string;         // The remembered information
  context?: string;      // How/when this was learned
  
  // Metadata
  confidence: MemoryConfidence;
  sensitivity: MemorySensitivity;
  source: MemorySource;
  
  // Lifecycle
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
  accessCount: number;
  
  // Decay
  reinforcementScore: number;  // 0-100, decays over time
  expiresAt?: string;          // Optional hard expiration
  
  // Relations
  relatedMemoryIds?: string[];
  conversationId?: string;     // Where this was learned
}

export interface MemorySource {
  type: 'explicit' | 'extracted' | 'inferred' | 'imported';
  conversationId?: string;
  messageId?: string;
  timestamp: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// USER PROFILE (aggregated view)
// ─────────────────────────────────────────────────────────────────────────────────

export interface UserProfile {
  userId: string;
  
  // Identity
  name?: string;
  role?: string;
  organization?: string;
  location?: string;
  timezone?: string;
  
  // Communication preferences
  preferredTone: 'formal' | 'casual' | 'technical' | 'friendly';
  preferredDepth: 'brief' | 'moderate' | 'detailed';
  preferredFormat: 'prose' | 'bullets' | 'structured';
  
  // Expertise
  expertiseAreas: string[];
  expertiseLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  
  // Interests
  interests: string[];
  
  // Active context
  activeProjects: ProjectContext[];
  currentGoals: string[];  // Goal IDs from Sword
  
  // Stats
  totalMemories: number;
  lastInteraction: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectContext {
  id: string;
  name: string;
  description?: string;
  status: 'active' | 'paused' | 'completed';
  techStack?: string[];
  lastMentioned: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// PREFERENCES
// ─────────────────────────────────────────────────────────────────────────────────

export interface UserPreferences {
  userId: string;
  
  // Response style
  tone: 'formal' | 'casual' | 'technical' | 'friendly';
  verbosity: 'concise' | 'balanced' | 'detailed';
  formatting: 'minimal' | 'moderate' | 'rich';
  
  // Behavior
  proactiveReminders: boolean;
  suggestNextSteps: boolean;
  askClarifyingQuestions: boolean;
  
  // Shield settings (Constitution §2.1)
  riskTolerance: 'conservative' | 'moderate' | 'aggressive';
  financialAlerts: boolean;
  healthAlerts: boolean;
  
  // Privacy
  memoryEnabled: boolean;
  autoExtractFacts: boolean;
  sensitiveTopics: string[];  // Topics to never remember
  
  // Lens settings (Constitution §2.2)
  defaultMode: 'snapshot' | 'expansion';
  showConfidenceLevel: boolean;
  showSources: boolean;
  
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// MEMORY EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────────

export interface ExtractedMemory {
  category: MemoryCategory;
  key: string;
  value: string;
  confidence: MemoryConfidence;
  sensitivity: MemorySensitivity;
  context: string;
}

export interface ExtractionResult {
  memories: ExtractedMemory[];
  profileUpdates: Partial<UserProfile>;
  preferenceUpdates: Partial<UserPreferences>;
}

// ─────────────────────────────────────────────────────────────────────────────────
// MEMORY RETRIEVAL
// ─────────────────────────────────────────────────────────────────────────────────

export interface MemoryQuery {
  categories?: MemoryCategory[];
  keywords?: string[];
  minConfidence?: MemoryConfidence;
  maxSensitivity?: MemorySensitivity;
  limit?: number;
  includeExpired?: boolean;
}

export interface RetrievalResult {
  memories: Memory[];
  profile: UserProfile | null;
  preferences: UserPreferences | null;
  relevanceScores: Map<string, number>;
}

export interface ContextInjection {
  summary: string;           // Natural language summary for LLM
  facts: string[];           // Key facts to include
  preferences: string[];     // Relevant preferences
  activeProjects: string[];  // Current project context
  warnings: string[];        // Things to be careful about
}

// ─────────────────────────────────────────────────────────────────────────────────
// MEMORY OPERATIONS
// ─────────────────────────────────────────────────────────────────────────────────

export interface CreateMemoryRequest {
  category: MemoryCategory;
  key: string;
  value: string;
  context?: string;
  confidence?: MemoryConfidence;
  sensitivity?: MemorySensitivity;
  expiresAt?: string;
  conversationId?: string;
}

export interface UpdateMemoryRequest {
  value?: string;
  context?: string;
  confidence?: MemoryConfidence;
  sensitivity?: MemorySensitivity;
  expiresAt?: string;
}

export interface MemoryStats {
  total: number;
  byCategory: Record<MemoryCategory, number>;
  byConfidence: Record<MemoryConfidence, number>;
  bySensitivity: Record<MemorySensitivity, number>;
  oldestMemory?: string;
  newestMemory?: string;
  averageReinforcementScore: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// DEFAULT VALUES
// ─────────────────────────────────────────────────────────────────────────────────

export const DEFAULT_PREFERENCES: Omit<UserPreferences, 'userId' | 'updatedAt'> = {
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
};

export const DEFAULT_PROFILE: Omit<UserProfile, 'userId' | 'createdAt' | 'updatedAt' | 'lastInteraction'> = {
  preferredTone: 'friendly',
  preferredDepth: 'moderate',
  preferredFormat: 'prose',
  expertiseAreas: [],
  expertiseLevel: 'intermediate',
  interests: [],
  activeProjects: [],
  currentGoals: [],
  totalMemories: 0,
};

// ─────────────────────────────────────────────────────────────────────────────────
// MEMORY DECAY CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────────

export const MEMORY_DECAY_CONFIG = {
  // Base decay rate per day (percentage points)
  baseDecayRate: 2,
  
  // Minimum reinforcement score before memory is forgotten
  forgetThreshold: 10,
  
  // How much accessing a memory reinforces it
  accessReinforcement: 5,
  
  // How much explicit confirmation reinforces
  confirmReinforcement: 20,
  
  // Category-specific decay multipliers
  categoryDecay: {
    preference: 0.5,    // Preferences decay slowly
    fact: 0.3,          // Facts are stable
    project: 1.5,       // Projects can become stale
    skill: 0.2,         // Skills persist
    interest: 1.0,      // Interests change normally
    relationship: 0.7,  // Relationships are fairly stable
    goal: 1.2,          // Goals can change
    context: 3.0,       // Context decays quickly
  } as Record<MemoryCategory, number>,
  
  // TTL by category (days) - after this, memory expires regardless of score
  categoryTTL: {
    preference: 365,
    fact: 730,          // 2 years
    project: 180,
    skill: 365,
    interest: 365,
    relationship: 365,
    goal: 90,
    context: 30,
  } as Record<MemoryCategory, number>,
};
