// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT TYPES — Data Export & Portability (GDPR Compliance)
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORT FORMATS
// ─────────────────────────────────────────────────────────────────────────────────

export type ExportFormat = 'json' | 'markdown' | 'csv';

export type ExportScope = 
  | 'all'              // Everything
  | 'conversations'    // Conversations only
  | 'memories'         // Memories only  
  | 'goals'            // Goals/Sword data only
  | 'profile'          // Profile and preferences
  | 'search_history';  // Search history

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORT REQUEST
// ─────────────────────────────────────────────────────────────────────────────────

export interface ExportRequest {
  userId: string;
  scopes: ExportScope[];
  format: ExportFormat;
  
  // Optional filters
  startDate?: string;
  endDate?: string;
  
  // Options
  includeMetadata?: boolean;
  prettyPrint?: boolean;
  redactSensitive?: boolean;
}

export interface ExportOptions {
  includeMetadata: boolean;
  prettyPrint: boolean;
  redactSensitive: boolean;
  startDate?: Date;
  endDate?: Date;
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORT RESULT
// ─────────────────────────────────────────────────────────────────────────────────

export interface ExportResult {
  exportId: string;
  userId: string;
  format: ExportFormat;
  scopes: ExportScope[];
  
  // Content
  data: ExportedData;
  
  // File info
  filename: string;
  mimeType: string;
  sizeBytes: number;
  
  // Timing
  createdAt: string;
  expiresAt: string;
  
  // Stats
  stats: ExportStats;
}

export interface ExportStats {
  conversations: number;
  messages: number;
  memories: number;
  goals: number;
  quests: number;
  steps: number;
  sparks: number;
  searchHistory: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTED DATA STRUCTURE
// ─────────────────────────────────────────────────────────────────────────────────

export interface ExportedData {
  // Metadata
  exportVersion: string;
  exportedAt: string;
  userId: string;
  scopes: ExportScope[];
  
  // Profile
  profile?: ExportedProfile;
  preferences?: ExportedPreferences;
  
  // Conversations
  conversations?: ExportedConversation[];
  
  // Memory
  memories?: ExportedMemory[];
  
  // Sword
  goals?: ExportedGoal[];
  
  // Search
  searchHistory?: ExportedSearchEntry[];
}

export interface ExportedProfile {
  name?: string;
  role?: string;
  organization?: string;
  location?: string;
  timezone?: string;
  preferredTone: string;
  preferredDepth: string;
  preferredFormat: string;
  expertiseAreas: string[];
  expertiseLevel: string;
  interests: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ExportedPreferences {
  tone: string;
  verbosity: string;
  formatting: string;
  proactiveReminders: boolean;
  suggestNextSteps: boolean;
  askClarifyingQuestions: boolean;
  riskTolerance: string;
  memoryEnabled: boolean;
  autoExtractFacts: boolean;
  defaultMode: string;
  showConfidenceLevel: boolean;
  showSources: boolean;
  updatedAt: string;
}

export interface ExportedConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  tags?: string[];
  messages: ExportedMessage[];
}

export interface ExportedMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface ExportedMemory {
  id: string;
  category: string;
  key: string;
  value: string;
  context?: string;
  confidence: string;
  sensitivity: string;
  createdAt: string;
  updatedAt: string;
  reinforcementScore: number;
}

export interface ExportedGoal {
  id: string;
  title: string;
  description: string;
  desiredOutcome: string;
  interestLevel: string;
  status: string;
  progress: number;
  targetDate?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  motivations: string[];
  constraints: string[];
  successCriteria: string[];
  tags: string[];
  quests: ExportedQuest[];
}

export interface ExportedQuest {
  id: string;
  title: string;
  description: string;
  outcome: string;
  status: string;
  priority: string;
  progress: number;
  order: number;
  estimatedMinutes?: number;
  targetDate?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  riskLevel: string;
  steps: ExportedStep[];
}

export interface ExportedStep {
  id: string;
  title: string;
  description?: string;
  type: string;
  status: string;
  order: number;
  estimatedMinutes?: number;
  createdAt: string;
  completedAt?: string;
  completionNotes?: string;
  sparks: ExportedSpark[];
}

export interface ExportedSpark {
  id: string;
  action: string;
  rationale: string;
  estimatedMinutes: number;
  status: string;
  createdAt: string;
  completedAt?: string;
}

export interface ExportedSearchEntry {
  query: string;
  scope: string;
  resultCount: number;
  timestamp: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// IMPORT TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface ImportRequest {
  userId: string;
  data: string;  // JSON string
  
  // Options
  overwrite?: boolean;      // Replace existing data
  mergeStrategy?: MergeStrategy;
  dryRun?: boolean;         // Validate only, don't import
}

export type MergeStrategy = 
  | 'skip'      // Skip if exists
  | 'replace'   // Replace if exists
  | 'newest'    // Keep newest by timestamp
  | 'merge';    // Merge arrays, keep newer scalars

export interface ImportResult {
  success: boolean;
  dryRun: boolean;
  
  // Counts
  imported: ImportCounts;
  skipped: ImportCounts;
  errors: ImportError[];
  
  // Timing
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export interface ImportCounts {
  conversations: number;
  messages: number;
  memories: number;
  goals: number;
  quests: number;
  steps: number;
  sparks: number;
  profile: number;
  preferences: number;
}

export interface ImportError {
  type: string;
  id?: string;
  message: string;
  details?: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────────
// DELETION TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface DeletionRequest {
  userId: string;
  
  // Confirmation
  confirmation: string;  // Must match userId
  
  // Options
  exportFirst?: boolean;  // Export before deletion
  scheduledAt?: string;   // Schedule for later (GDPR grace period)
}

export interface DeletionResult {
  success: boolean;
  userId: string;
  
  // What was deleted
  deleted: DeletionCounts;
  
  // Export if requested
  exportId?: string;
  
  // Timing
  deletedAt: string;
  scheduledAt?: string;
}

export interface DeletionCounts {
  conversations: number;
  messages: number;
  memories: number;
  goals: number;
  quests: number;
  steps: number;
  sparks: number;
  searchHistory: number;
  indexDocuments: number;
  profile: boolean;
  preferences: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORT JOB TRACKING
// ─────────────────────────────────────────────────────────────────────────────────

export type ExportJobStatus = 
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'expired';

export interface ExportJob {
  id: string;
  userId: string;
  status: ExportJobStatus;
  request: ExportRequest;
  
  // Progress
  progress: number;
  currentScope?: ExportScope;
  
  // Result
  result?: ExportResult;
  error?: string;
  
  // Timing
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  expiresAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────────

export interface ExportConfig {
  // Export settings
  maxExportSizeMB: number;
  exportTTLHours: number;
  maxConcurrentExports: number;
  
  // Deletion settings
  deletionGracePeriodDays: number;
  requireConfirmation: boolean;
  
  // Rate limits
  maxExportsPerDay: number;
  maxImportsPerDay: number;
}

export const DEFAULT_EXPORT_CONFIG: ExportConfig = {
  maxExportSizeMB: 100,
  exportTTLHours: 48,
  maxConcurrentExports: 2,
  deletionGracePeriodDays: 30,
  requireConfirmation: true,
  maxExportsPerDay: 5,
  maxImportsPerDay: 3,
};

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

export const EXPORT_VERSION = '1.0.0';

export const MIME_TYPES: Record<ExportFormat, string> = {
  json: 'application/json',
  markdown: 'text/markdown',
  csv: 'text/csv',
};

export const FILE_EXTENSIONS: Record<ExportFormat, string> = {
  json: '.json',
  markdown: '.md',
  csv: '.csv',
};
