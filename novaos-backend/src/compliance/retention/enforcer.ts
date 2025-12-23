// ═══════════════════════════════════════════════════════════════════════════════
// RETENTION ENFORCER — Retention Policy Enforcement Service
// NovaOS Compliance Layer — Phase 16
// ═══════════════════════════════════════════════════════════════════════════════
//
// GDPR Article 5(1)(e) — Storage Limitation Principle:
//   - Find data past retention period
//   - Delete, archive, or anonymize based on policy
//   - Track enforcement jobs
//   - Audit all retention actions
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { KeyValueStore } from '../../storage/index.js';
import { ok, err, type AsyncAppResult } from '../../types/result.js';
import type { Timestamp } from '../../types/branded.js';
import { createTimestamp } from '../../types/branded.js';
import { RetentionKeys } from '../keys.js';
import type {
  RetentionPolicy,
  RetentionCategory,
  RetentionAction,
  RetentionJob,
  RetentionJobId,
  RetentionJobStatus,
  RetentionJobResults,
  CategoryJobResult,
  RetentionCandidate,
  RetentionEnforcerConfig,
  IRetentionEnforcer,
} from './types.js';
import {
  RetentionErrorCode,
  ALL_RETENTION_CATEGORIES,
  DEFAULT_ENFORCER_CONFIG,
  createRetentionJobId,
  isPastRetention,
  daysPastRetention,
} from './types.js';
import { RetentionPolicyManager } from './policy-manager.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Candidate finder for a category.
 * Returns entities that may be past retention.
 */
export interface CandidateFinder {
  /**
   * Find candidates in a category that may be past retention.
   * Should return entities with their creation/completion timestamp.
   */
  findCandidates(
    category: RetentionCategory,
    options?: { limit?: number; beforeDate?: Date }
  ): AsyncAppResult<readonly RetentionCandidateInfo[]>;
}

/**
 * Information about a retention candidate.
 */
export interface RetentionCandidateInfo {
  /** Entity ID */
  entityId: string;
  /** User ID (if applicable) */
  userId?: string;
  /** Timestamp to check against retention */
  timestamp: Timestamp;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Processor for a category.
 * Handles the actual deletion/archival/anonymization.
 */
export interface CategoryProcessor {
  /**
   * Delete an entity.
   */
  delete(entityId: string): AsyncAppResult<boolean>;

  /**
   * Archive an entity.
   */
  archive?(entityId: string): AsyncAppResult<boolean>;

  /**
   * Anonymize an entity (remove PII, keep aggregates).
   */
  anonymize?(entityId: string): AsyncAppResult<boolean>;

  /**
   * Flag an entity for manual review.
   */
  flag?(entityId: string): AsyncAppResult<boolean>;
}

/**
 * Registry of candidate finders and processors by category.
 */
export interface CategoryRegistry {
  finders: Partial<Record<RetentionCategory, CandidateFinder>>;
  processors: Partial<Record<RetentionCategory, CategoryProcessor>>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR HELPER
// ═══════════════════════════════════════════════════════════════════════════════

function retentionError(
  code: string,
  message: string,
  context?: Record<string, unknown>
): { code: string; message: string; context?: Record<string, unknown> } {
  return { code, message, context };
}

// ═══════════════════════════════════════════════════════════════════════════════
// RETENTION ENFORCER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Service for enforcing retention policies.
 */
export class RetentionEnforcer implements IRetentionEnforcer {
  private readonly store: KeyValueStore;
  private readonly policyManager: RetentionPolicyManager;
  private readonly registry: CategoryRegistry;
  private readonly config: RetentionEnforcerConfig;

  private runningJob: RetentionJobId | null = null;

  constructor(
    store: KeyValueStore,
    policyManager: RetentionPolicyManager,
    registry: CategoryRegistry,
    config: Partial<RetentionEnforcerConfig> = {}
  ) {
    this.store = store;
    this.policyManager = policyManager;
    this.registry = registry;
    this.config = { ...DEFAULT_ENFORCER_CONFIG, ...config };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // IRetentionEnforcer Implementation
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get current retention policies.
   */
  getPolicies(): readonly RetentionPolicy[] {
    return this.policyManager.getAllPolicies();
  }

  /**
   * Get policy for a category.
   */
  getPolicy(category: RetentionCategory): RetentionPolicy | undefined {
    return this.policyManager.getPolicy(category);
  }

  /**
   * Find entities past retention for a category.
   */
  async findCandidates(
    category: RetentionCategory,
    options?: { limit?: number }
  ): AsyncAppResult<readonly RetentionCandidate[]> {
    const { limit = this.config.batchSize } = options ?? {};

    // Get policy
    const policy = this.policyManager.getPolicy(category);
    if (!policy) {
      return err(
        retentionError(
          RetentionErrorCode.POLICY_NOT_FOUND,
          `No retention policy for category: ${category}`,
          { category }
        )
      );
    }

    if (!policy.enabled) {
      return ok([]); // Policy disabled, no candidates
    }

    // Get finder
    const finder = this.registry.finders[category];
    if (!finder) {
      return ok([]); // No finder registered, skip
    }

    // Find candidates
    const result = await finder.findCandidates(category, { limit });
    if (!result.ok) {
      return err(result.error);
    }

    // Filter to only those past retention
    const candidates: RetentionCandidate[] = [];
    for (const info of result.value) {
      if (isPastRetention(info.timestamp, policy.retentionDays)) {
        candidates.push({
          category,
          entityId: info.entityId,
          userId: info.userId as any,
          timestamp: info.timestamp,
          daysPastRetention: daysPastRetention(info.timestamp, policy.retentionDays),
          policy,
        });
      }
    }

    return ok(candidates);
  }

  /**
   * Process a single candidate.
   */
  async processCandidate(
    candidate: RetentionCandidate,
    dryRun: boolean = false
  ): AsyncAppResult<{ action: RetentionAction; success: boolean }> {
    const { category, entityId, policy } = candidate;

    // Get processor
    const processor = this.registry.processors[category];
    if (!processor) {
      return ok({ action: policy.action, success: false });
    }

    if (dryRun) {
      return ok({ action: policy.action, success: true });
    }

    // Execute action based on policy
    let success = false;
    switch (policy.action) {
      case 'delete':
        // Archive first if required
        if (policy.archiveBeforeDelete && processor.archive) {
          const archiveResult = await processor.archive(entityId);
          if (!archiveResult.ok || !archiveResult.value) {
            return err(
              retentionError(
                RetentionErrorCode.ARCHIVE_FAILED,
                `Failed to archive before delete: ${entityId}`,
                { category, entityId }
              )
            );
          }
        }
        const deleteResult = await processor.delete(entityId);
        success = deleteResult.ok && deleteResult.value;
        break;

      case 'archive':
        if (processor.archive) {
          const archiveResult = await processor.archive(entityId);
          success = archiveResult.ok && archiveResult.value;
        }
        break;

      case 'anonymize':
        if (processor.anonymize) {
          const anonymizeResult = await processor.anonymize(entityId);
          success = anonymizeResult.ok && anonymizeResult.value;
        }
        break;

      case 'flag':
        if (processor.flag) {
          const flagResult = await processor.flag(entityId);
          success = flagResult.ok && flagResult.value;
        }
        break;
    }

    return ok({ action: policy.action, success });
  }

  /**
   * Run retention enforcement for all categories.
   */
  async runEnforcement(options?: {
    categories?: readonly RetentionCategory[];
    dryRun?: boolean;
    batchSize?: number;
  }): AsyncAppResult<RetentionJobResults> {
    const {
      categories = ALL_RETENTION_CATEGORIES,
      dryRun = this.config.dryRunByDefault,
      batchSize = this.config.batchSize,
    } = options ?? {};

    // Check if already running
    if (this.runningJob) {
      return err(
        retentionError(
          RetentionErrorCode.JOB_ALREADY_RUNNING,
          `Retention job already running: ${this.runningJob}`
        )
      );
    }

    const startTime = Date.now();
    const perCategory: Record<RetentionCategory, CategoryJobResult> = {} as any;
    let totalProcessed = 0;
    let totalDeleted = 0;
    let totalArchived = 0;
    let totalAnonymized = 0;
    let totalFlagged = 0;
    let totalErrors = 0;

    // Skip configured categories
    const categoriesToProcess = categories.filter(
      c => !this.config.skipCategories?.includes(c)
    );

    for (const category of categoriesToProcess) {
      const policy = this.policyManager.getPolicy(category);
      if (!policy || !policy.enabled) {
        continue;
      }

      // Find candidates
      const candidatesResult = await this.findCandidates(category, { limit: batchSize });
      if (!candidatesResult.ok) {
        perCategory[category] = {
          found: 0,
          processed: 0,
          failed: 1,
          action: policy.action,
        };
        totalErrors++;
        continue;
      }

      const candidates = candidatesResult.value;
      let processed = 0;
      let failed = 0;

      // Process each candidate
      for (const candidate of candidates) {
        const result = await this.processCandidate(candidate, dryRun);

        if (result.ok && result.value.success) {
          processed++;
          totalProcessed++;

          switch (result.value.action) {
            case 'delete':
              totalDeleted++;
              break;
            case 'archive':
              totalArchived++;
              break;
            case 'anonymize':
              totalAnonymized++;
              break;
            case 'flag':
              totalFlagged++;
              break;
          }
        } else {
          failed++;
          totalErrors++;
        }

        // Delay between batches
        if (processed > 0 && processed % batchSize === 0) {
          await this.delay(this.config.batchDelayMs);
        }
      }

      perCategory[category] = {
        found: candidates.length,
        processed,
        failed,
        action: policy.action,
      };

      // Update last run timestamp
      if (!dryRun) {
        await this.updateLastRun(category);
      }
    }

    const results: RetentionJobResults = {
      totalProcessed,
      deleted: totalDeleted,
      archived: totalArchived,
      anonymized: totalAnonymized,
      flagged: totalFlagged,
      errors: totalErrors,
      perCategory,
      durationMs: Date.now() - startTime,
    };

    return ok(results);
  }

  /**
   * Schedule a retention job.
   */
  async scheduleJob(
    categories: readonly RetentionCategory[],
    options?: { dryRun?: boolean; runAt?: Date }
  ): AsyncAppResult<RetentionJob> {
    const now = createTimestamp();
    const jobId = createRetentionJobId();

    const job: RetentionJob = {
      id: jobId,
      categories,
      status: 'pending',
      scheduledAt: now,
      dryRun: options?.dryRun ?? this.config.dryRunByDefault,
    };

    // Store job
    await this.saveJob(job);

    // Add to recent jobs index
    await this.addToRecentJobs(jobId, now);

    return ok(job);
  }

  /**
   * Get job status.
   */
  async getJob(jobId: RetentionJobId): AsyncAppResult<RetentionJob | null> {
    try {
      const key = RetentionKeys.job(jobId);
      const data = await this.store.get(key);
      if (!data) {
        return ok(null);
      }
      return ok(JSON.parse(data) as RetentionJob);
    } catch (error) {
      return err(
        retentionError(
          RetentionErrorCode.BACKEND_ERROR,
          `Failed to get job: ${error instanceof Error ? error.message : String(error)}`,
          { jobId }
        )
      );
    }
  }

  /**
   * Get recent jobs.
   */
  async getRecentJobs(limit: number = 10): AsyncAppResult<readonly RetentionJob[]> {
    try {
      const key = RetentionKeys.recentJobs();
      const jobIds = await this.store.zrevrange(key, 0, limit - 1);

      if (jobIds.length === 0) {
        return ok([]);
      }

      const jobs: RetentionJob[] = [];
      for (const id of jobIds) {
        const result = await this.getJob(id as RetentionJobId);
        if (result.ok && result.value) {
          jobs.push(result.value);
        }
      }

      return ok(jobs);
    } catch (error) {
      return err(
        retentionError(
          RetentionErrorCode.BACKEND_ERROR,
          `Failed to get recent jobs: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ADDITIONAL METHODS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Run a scheduled job.
   */
  async runJob(jobId: RetentionJobId): AsyncAppResult<RetentionJobResults> {
    // Get job
    const jobResult = await this.getJob(jobId);
    if (!jobResult.ok) {
      return err(jobResult.error);
    }
    if (!jobResult.value) {
      return err(
        retentionError(
          RetentionErrorCode.JOB_NOT_FOUND,
          `Job not found: ${jobId}`,
          { jobId }
        )
      );
    }

    const job = jobResult.value;

    // Check status
    if (job.status !== 'pending') {
      return err(
        retentionError(
          RetentionErrorCode.JOB_ALREADY_RUNNING,
          `Job not in pending state: ${job.status}`,
          { jobId, status: job.status }
        )
      );
    }

    // Mark as running
    this.runningJob = jobId;
    await this.updateJobStatus(jobId, 'running', { startedAt: createTimestamp() });

    try {
      // Run enforcement
      const results = await this.runEnforcement({
        categories: job.categories,
        dryRun: job.dryRun,
      });

      // Mark as completed
      this.runningJob = null;
      if (results.ok) {
        await this.updateJobStatus(jobId, 'completed', {
          completedAt: createTimestamp(),
          results: results.value,
        });
        return results;
      } else {
        await this.updateJobStatus(jobId, 'failed', {
          completedAt: createTimestamp(),
          errorMessage: results.error.message,
        });
        return results;
      }
    } catch (error) {
      this.runningJob = null;
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.updateJobStatus(jobId, 'failed', {
        completedAt: createTimestamp(),
        errorMessage,
      });
      return err(
        retentionError(
          RetentionErrorCode.BACKEND_ERROR,
          `Job failed: ${errorMessage}`,
          { jobId }
        )
      );
    }
  }

  /**
   * Get last run timestamp for a category.
   */
  async getLastRun(category: RetentionCategory): AsyncAppResult<Timestamp | null> {
    try {
      const key = RetentionKeys.lastRun(category);
      const data = await this.store.get(key);
      return ok(data as Timestamp | null);
    } catch (error) {
      return err(
        retentionError(
          RetentionErrorCode.BACKEND_ERROR,
          `Failed to get last run: ${error instanceof Error ? error.message : String(error)}`,
          { category }
        )
      );
    }
  }

  /**
   * Check if enforcement is currently running.
   */
  isRunning(): boolean {
    return this.runningJob !== null;
  }

  /**
   * Get currently running job ID.
   */
  getRunningJobId(): RetentionJobId | null {
    return this.runningJob;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  private async saveJob(job: RetentionJob): AsyncAppResult<void> {
    try {
      const key = RetentionKeys.job(job.id);
      await this.store.set(key, JSON.stringify(job));
      return ok(undefined);
    } catch (error) {
      return err(
        retentionError(
          RetentionErrorCode.BACKEND_ERROR,
          `Failed to save job: ${error instanceof Error ? error.message : String(error)}`,
          { jobId: job.id }
        )
      );
    }
  }

  private async updateJobStatus(
    jobId: RetentionJobId,
    status: RetentionJobStatus,
    updates: Partial<RetentionJob>
  ): AsyncAppResult<void> {
    const jobResult = await this.getJob(jobId);
    if (!jobResult.ok || !jobResult.value) {
      return err(jobResult.error ?? retentionError(RetentionErrorCode.JOB_NOT_FOUND, 'Job not found'));
    }

    const updated: RetentionJob = {
      ...jobResult.value,
      status,
      ...updates,
    };

    return this.saveJob(updated);
  }

  private async addToRecentJobs(jobId: RetentionJobId, timestamp: Timestamp): AsyncAppResult<void> {
    try {
      const key = RetentionKeys.recentJobs();
      const score = new Date(timestamp).getTime();
      await this.store.zadd(key, score, jobId);

      // Trim to keep only last 100 jobs
      await this.store.zremrangebyrank(key, 0, -101);

      return ok(undefined);
    } catch (error) {
      return err(
        retentionError(
          RetentionErrorCode.BACKEND_ERROR,
          `Failed to add to recent jobs: ${error instanceof Error ? error.message : String(error)}`,
          { jobId }
        )
      );
    }
  }

  private async updateLastRun(category: RetentionCategory): AsyncAppResult<void> {
    try {
      const key = RetentionKeys.lastRun(category);
      await this.store.set(key, createTimestamp());
      return ok(undefined);
    } catch (error) {
      return err(
        retentionError(
          RetentionErrorCode.BACKEND_ERROR,
          `Failed to update last run: ${error instanceof Error ? error.message : String(error)}`,
          { category }
        )
      );
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a RetentionEnforcer instance.
 */
export function createRetentionEnforcer(
  store: KeyValueStore,
  policyManager: RetentionPolicyManager,
  registry: CategoryRegistry,
  config?: Partial<RetentionEnforcerConfig>
): RetentionEnforcer {
  return new RetentionEnforcer(store, policyManager, registry, config);
}
