// ═══════════════════════════════════════════════════════════════════════════════
// SPARK ENGINE STORE — Barrel Exports
// NovaOS Spark Engine — Phase 12: Secure Store Layer
// ═══════════════════════════════════════════════════════════════════════════════

// Types
export type {
  StoredEntity,
  EntityMetadata,
  RawStoredEntity,
  SecureStoreConfig,
  SaveOptions,
  GetOptions,
  ListOptions,
  SaveResult,
  DeleteResult,
  ListResult,
  IGoalStore,
  IQuestStore,
  IStepStore,
  ISparkStore,
  IReminderStore,
  IRefinementStore,
  ISparkEngineStores,
  RefinementState,
  StoreErrorCode,
} from './types.js';

export {
  DEFAULT_SECURE_STORE_CONFIG,
  StoreErrorCode as StoreErrorCodes,
  isStoredEntity,
  isEntityMetadata,
} from './types.js';

// Base store
export { SecureStore, computeIntegrityHash, verifyIntegrity } from './secure-store.js';

// Entity stores
export { GoalStore, createGoalStore } from './goal-store.js';
export { QuestStore, createQuestStore } from './quest-store.js';
export { StepStore, createStepStore } from './step-store.js';
export { SparkStore, createSparkStore } from './spark-store.js';
export { ReminderStore, createReminderStore } from './reminder-store.js';
export { RefinementStore, createRefinementStore } from './refinement-store.js';

// Store manager
export {
  SparkEngineStoreManager,
  createStoreManager,
  getStoreManager,
  resetStoreManager,
  type StoreHealthCheck,
  type StoreMetrics,
} from './index.js';
