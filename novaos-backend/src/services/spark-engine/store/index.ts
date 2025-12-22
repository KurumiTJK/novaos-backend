// ═══════════════════════════════════════════════════════════════════════════════
// SPARK ENGINE STORE MANAGER — Unified Store Access
// NovaOS Spark Engine — Phase 12: Secure Store Layer
// ═══════════════════════════════════════════════════════════════════════════════
//
// Unified manager for all Spark Engine stores providing:
//   - Single entry point for all store operations
//   - Cascade delete wiring between stores
//   - Configuration management
//   - Health checks and metrics
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { KeyValueStore } from '../../../storage/index.js';
import type { EncryptionService } from '../../../security/encryption/service.js';
import { getEncryptionService } from '../../../security/encryption/service.js';
import { ok, err, type AsyncAppResult } from '../../../types/result.js';
import type { GoalId, QuestId, StepId, SparkId, UserId } from '../../../types/branded.js';

import { GoalStore, createGoalStore } from './goal-store.js';
import { QuestStore, createQuestStore } from './quest-store.js';
import { StepStore, createStepStore } from './step-store.js';
import { SparkStore, createSparkStore } from './spark-store.js';
import { ReminderStore, createReminderStore } from './reminder-store.js';
import { RefinementStore, createRefinementStore } from './refinement-store.js';
import type {
  ISparkEngineStores,
  SecureStoreConfig,
  DEFAULT_SECURE_STORE_CONFIG,
} from './types.js';
import { StoreErrorCode } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// STORE MANAGER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Health check result for the store system.
 */
export interface StoreHealthCheck {
  readonly healthy: boolean;
  readonly stores: {
    readonly goals: boolean;
    readonly quests: boolean;
    readonly steps: boolean;
    readonly sparks: boolean;
    readonly reminders: boolean;
    readonly refinement: boolean;
  };
  readonly encryption: boolean;
  readonly backend: boolean;
  readonly latencyMs: number;
}

/**
 * Metrics for store operations.
 */
export interface StoreMetrics {
  readonly totalOperations: number;
  readonly failedOperations: number;
  readonly encryptionEnabled: boolean;
  readonly integrityCheckEnabled: boolean;
}

/**
 * Unified manager for all Spark Engine stores.
 *
 * Responsibilities:
 * - Initialize all stores with shared configuration
 * - Wire up cascade delete callbacks
 * - Provide unified access to all stores
 * - Health checks and metrics
 */
export class SparkEngineStoreManager implements ISparkEngineStores {
  readonly goals: GoalStore;
  readonly quests: QuestStore;
  readonly steps: StepStore;
  readonly sparks: SparkStore;
  readonly reminders: ReminderStore;
  readonly refinement: RefinementStore;

  private readonly store: KeyValueStore;
  private readonly config: SecureStoreConfig;
  private readonly encryption: EncryptionService;

  private operationCount = 0;
  private failureCount = 0;

  constructor(
    store: KeyValueStore,
    config: Partial<SecureStoreConfig> = {},
    encryption?: EncryptionService
  ) {
    this.store = store;
    this.encryption = encryption ?? getEncryptionService();
    this.config = {
      encryptionEnabled: true,
      integrityCheckEnabled: true,
      sensitiveFields: undefined,
      defaultTtlSeconds: 0,
      completedGoalTtlSeconds: 30 * 24 * 60 * 60,
      expiredReminderTtlSeconds: 24 * 60 * 60,
      refinementStateTtlSeconds: 60 * 60,
      ...config,
    };

    // Initialize all stores
    this.goals = createGoalStore(store, this.config, this.encryption);
    this.quests = createQuestStore(store, this.config, this.encryption);
    this.steps = createStepStore(store, this.config, this.encryption);
    this.sparks = createSparkStore(store, this.config, this.encryption);
    this.reminders = createReminderStore(store, this.config, this.encryption);
    this.refinement = createRefinementStore(store, this.config, this.encryption);

    // Wire up cascade delete callbacks
    this.wireCascadeDeletes();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CASCADE DELETE WIRING
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Wire up cascade delete callbacks between stores.
   *
   * Hierarchy:
   *   Goal → Quest → Step → Spark → Reminder
   *
   * When a parent is deleted, all children are deleted.
   */
  private wireCascadeDeletes(): void {
    // Goal delete → delete all quests (which cascades to steps, sparks, reminders)
    this.goals.setCascadeDeleteCallback(async (goalId: GoalId): Promise<number> => {
      let count = 0;

      // Get all quests for this goal
      const questsResult = await this.quests.getByGoal(goalId, { limit: 1000 });
      if (questsResult.ok) {
        for (const quest of questsResult.value.items) {
          const result = await this.quests.delete(quest.id);
          if (result.ok && result.value.deleted) {
            count += 1 + (result.value.cascadeCount ?? 0);
          }
        }
      }

      return count;
    });

    // Quest delete → delete all steps (which cascades to sparks, reminders)
    this.quests.setCascadeDeleteCallback(async (questId: QuestId): Promise<number> => {
      let count = 0;

      // Get all steps for this quest
      const stepsResult = await this.steps.getByQuest(questId, { limit: 1000 });
      if (stepsResult.ok) {
        for (const step of stepsResult.value.items) {
          const result = await this.steps.delete(step.id);
          if (result.ok && result.value.deleted) {
            count += 1 + (result.value.cascadeCount ?? 0);
          }
        }
      }

      return count;
    });

    // Step delete → delete all sparks (which cascades to reminders)
    this.steps.setCascadeDeleteCallback(async (stepId: StepId): Promise<number> => {
      let count = 0;

      // Get all sparks for this step
      const sparksResult = await this.sparks.getByStep(stepId, { limit: 1000 });
      if (sparksResult.ok) {
        for (const spark of sparksResult.value.items) {
          const result = await this.sparks.delete(spark.id);
          if (result.ok && result.value.deleted) {
            count += 1 + (result.value.cascadeCount ?? 0);
          }
        }
      }

      return count;
    });

    // Spark delete → delete all reminders
    this.sparks.setCascadeDeleteCallback(async (sparkId: SparkId): Promise<number> => {
      const result = await this.reminders.deleteBySpark(sparkId);
      return result.ok ? result.value : 0;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HEALTH & METRICS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Perform health check on all stores.
   */
  async healthCheck(): AsyncAppResult<StoreHealthCheck> {
    const start = Date.now();

    try {
      // Test backend connectivity
      const testKey = `health:${Date.now()}`;
      await this.store.set(testKey, 'test', 5);
      const testValue = await this.store.get(testKey);
      const backendHealthy = testValue === 'test';
      await this.store.delete(testKey);

      // Test encryption service
      let encryptionHealthy = false;
      try {
        const testData = 'encryption-test';
        const encrypted = this.encryption.encrypt(testData);
        const decrypted = this.encryption.decryptToString(encrypted);
        encryptionHealthy = decrypted === testData;
      } catch {
        encryptionHealthy = false;
      }

      const latencyMs = Date.now() - start;

      const result: StoreHealthCheck = {
        healthy: backendHealthy && encryptionHealthy,
        stores: {
          goals: backendHealthy,
          quests: backendHealthy,
          steps: backendHealthy,
          sparks: backendHealthy,
          reminders: backendHealthy,
          refinement: backendHealthy,
        },
        encryption: encryptionHealthy,
        backend: backendHealthy,
        latencyMs,
      };

      return ok(result);
    } catch (error) {
      return ok({
        healthy: false,
        stores: {
          goals: false,
          quests: false,
          steps: false,
          sparks: false,
          reminders: false,
          refinement: false,
        },
        encryption: false,
        backend: false,
        latencyMs: Date.now() - start,
      });
    }
  }

  /**
   * Get store metrics.
   */
  getMetrics(): StoreMetrics {
    return {
      totalOperations: this.operationCount,
      failedOperations: this.failureCount,
      encryptionEnabled: this.config.encryptionEnabled,
      integrityCheckEnabled: this.config.integrityCheckEnabled,
    };
  }

  /**
   * Get store configuration.
   */
  getConfig(): Readonly<SecureStoreConfig> {
    return { ...this.config };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CONVENIENCE METHODS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Delete all data for a user.
   * Use with caution - this is irreversible.
   */
  async deleteAllUserData(userId: UserId): AsyncAppResult<number> {
    let count = 0;

    // Delete all goals (cascades to quests, steps, sparks, reminders)
    const goalsResult = await this.goals.getByUser(userId, { limit: 1000 });
    if (goalsResult.ok) {
      for (const goal of goalsResult.value.items) {
        const result = await this.goals.delete(goal.id);
        if (result.ok && result.value.deleted) {
          count += 1 + (result.value.cascadeCount ?? 0);
        }
      }
    }

    // Delete refinement state
    const refinementResult = await this.refinement.delete(userId);
    if (refinementResult.ok && refinementResult.value) {
      count++;
    }

    return ok(count);
  }

  /**
   * Get summary statistics for a user.
   */
  async getUserStats(userId: UserId): AsyncAppResult<{
    totalGoals: number;
    activeGoals: number;
    totalReminders: number;
    pendingReminders: number;
    hasActiveRefinement: boolean;
  }> {
    try {
      // Count goals
      const goalsResult = await this.goals.countByUser(userId);
      const totalGoals = goalsResult.ok ? goalsResult.value : 0;

      // Count active goals
      const activeGoalsResult = await this.goals.getActiveGoals(userId);
      const activeGoals = activeGoalsResult.ok ? activeGoalsResult.value.length : 0;

      // Count pending reminders
      const pendingResult = await this.reminders.countPendingByUser(userId);
      const pendingReminders = pendingResult.ok ? pendingResult.value : 0;

      // Check refinement
      const refinementResult = await this.refinement.hasActiveRefinement(userId);
      const hasActiveRefinement = refinementResult.ok ? refinementResult.value : false;

      return ok({
        totalGoals,
        activeGoals,
        totalReminders: pendingReminders, // Only tracking pending for now
        pendingReminders,
        hasActiveRefinement,
      });
    } catch (error) {
      return err({
        code: StoreErrorCode.BACKEND_ERROR,
        message: `Failed to get user stats: ${error instanceof Error ? error.message : String(error)}`,
        context: { userId },
      });
    }
  }

  /**
   * Clean up expired data across all stores.
   */
  async cleanupExpired(): AsyncAppResult<number> {
    let cleaned = 0;

    // Expire overdue reminders
    const expireResult = await this.reminders.expireOverdue();
    if (expireResult.ok) {
      cleaned += expireResult.value;
    }

    // Note: Other entities rely on Redis TTL for cleanup
    // Could add explicit cleanup for completed goals here if needed

    return ok(cleaned);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY & SINGLETON
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Singleton instance of the store manager.
 */
let storeManagerInstance: SparkEngineStoreManager | null = null;

/**
 * Create a new SparkEngineStoreManager instance.
 */
export function createStoreManager(
  store: KeyValueStore,
  config?: Partial<SecureStoreConfig>,
  encryption?: EncryptionService
): SparkEngineStoreManager {
  return new SparkEngineStoreManager(store, config, encryption);
}

/**
 * Get or create the singleton store manager.
 * Uses the provided store on first call, subsequent calls return the same instance.
 */
export function getStoreManager(
  store?: KeyValueStore,
  config?: Partial<SecureStoreConfig>,
  encryption?: EncryptionService
): SparkEngineStoreManager {
  if (!storeManagerInstance) {
    if (!store) {
      throw new Error('Store is required for initial StoreManager creation');
    }
    storeManagerInstance = createStoreManager(store, config, encryption);
  }
  return storeManagerInstance;
}

/**
 * Reset the singleton store manager (for testing).
 */
export function resetStoreManager(): void {
  storeManagerInstance = null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

export type { ISparkEngineStores, SecureStoreConfig };
