// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT MODULE — Data Export & Portability
// ═══════════════════════════════════════════════════════════════════════════════

// Types
export type {
  ExportFormat,
  ExportScope,
  ExportRequest,
  ExportOptions,
  ExportResult,
  ExportedData,
  ExportedProfile,
  ExportedPreferences,
  ExportedConversation,
  ExportedMessage,
  ExportedMemory,
  ExportedGoal,
  ExportedQuest,
  ExportedStep,
  ExportedSpark,
  ExportedSearchEntry,
  ExportStats,
  ImportRequest,
  ImportResult,
  ImportCounts,
  ImportError,
  MergeStrategy,
  DeletionRequest,
  DeletionResult,
  DeletionCounts,
  ExportJob,
  ExportJobStatus,
  ExportConfig,
} from './types.js';

// Constants
export {
  EXPORT_VERSION,
  MIME_TYPES,
  FILE_EXTENSIONS,
  DEFAULT_EXPORT_CONFIG,
} from './types.js';

// Formatters
export {
  JsonFormatter,
  MarkdownFormatter,
  CsvFormatter,
  getFormatter,
  type ExportFormatter,
} from './formatters.js';

// Service
export {
  ExportService,
  getExportService,
} from './service.js';
