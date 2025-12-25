// ═══════════════════════════════════════════════════════════════════════════════
// SPARK GENERATOR — Generate Sparks for Steps
// NovaOS Spark Engine — Phase 10: Spark Generation
// ═══════════════════════════════════════════════════════════════════════════════
//
// "Spark — produces a minimal, low-friction action that creates immediate
// forward motion. Sword exists to convert intention into motion without
// relying on motivation or willpower." — Nova Constitution §2.3
//
// This module implements ISparkGenerator:
//   - Generates sparks from steps at configurable escalation levels
//   - Selects activities and generates appropriate action text
//   - Sanitizes resource URLs for safe display
//   - Enforces escalation bounds from configuration
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { AsyncAppResult, AppResult } from '../../../types/result.js';
import { ok, err, appError } from '../../../types/result.js';
import { createSparkId, createTimestamp } from '../../../types/branded.js';
import type { ResourceId } from '../../../types/branded.js';

import type { ISparkGenerator } from '../interfaces.js';
import type { Step, Spark, StepResource, Activity } from '../types.js';

import type {
  SparkGenerationConfig,
  SparkGenerationDiagnostics,
  SparkGenerationResult,
} from './types.js';
import {
  DEFAULT_SPARK_GENERATION_CONFIG,
  SparkGenerationErrorCode,
} from './types.js';

import {
  clampEscalationLevel,
  getVariantForLevel,
  selectActivity,
  estimateMinutes,
  shouldShowSkipOption,
} from './escalation.js';

import {
  generateAction,
  generateFallbackActionWithMetadata,
  appendUrlToAction,
} from './action-generator.js';

import { sanitizeUrl, sanitizeDisplayUrl } from './url-sanitizer.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SPARK GENERATOR CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * SparkGenerator — Generates sparks for steps with escalation support.
 *
 * Implements ISparkGenerator interface from Phase 8.
 *
 * Usage:
 * ```typescript
 * const generator = new SparkGenerator(config);
 * const result = await generator.generateSpark(step, escalationLevel);
 * if (result.ok) {
 *   const spark = result.value;
 * }
 * ```
 */
export class SparkGenerator implements ISparkGenerator {
  private readonly config: SparkGenerationConfig;

  constructor(config?: Partial<SparkGenerationConfig>) {
    this.config = { ...DEFAULT_SPARK_GENERATION_CONFIG, ...config };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ISparkGenerator Implementation
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Generate a spark for a step at the given escalation level.
   *
   * @param step - The step to generate a spark for
   * @param escalationLevel - Escalation level (0-3)
   * @returns Generated spark (not yet saved)
   */
  async generateSpark(step: Step, escalationLevel: number): AsyncAppResult<Spark> {
    // Clamp escalation level to bounds
    const { level: clampedLevel, clamped } = clampEscalationLevel(
      escalationLevel,
      this.config.maxEscalationLevel
    );

    // Get variant for this level
    const variant = getVariantForLevel(clampedLevel);

    // Try to generate from activities
    const result = this.generateFromStep(step, clampedLevel);

    if (!result.ok) {
      return result;
    }

    const { action, diagnostics } = result.value;

    // Find the resource for URL
    const resourceInfo = this.findResource(step, diagnostics.activityIndex);

    // Sanitize URL if present
    const urlResult = resourceInfo?.url ? sanitizeUrl(resourceInfo.url) : null;
    const sanitizedUrl = urlResult?.safe ? urlResult.sanitizedUrl : undefined;

    // Build final action text with optional URL
    const finalActionText = appendUrlToAction(
      action.text,
      sanitizedUrl,
      this.config.includeResourceUrls
    );

    // Create the Spark entity
    const now = createTimestamp();
    const spark: Spark = {
      id: createSparkId(),
      stepId: step.id,
      action: finalActionText,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      variant,
      escalationLevel: clampedLevel,
      resourceId: resourceInfo?.id,
      resourceUrl: sanitizedUrl,
      resourceSection: resourceInfo?.section,
      estimatedMinutes: action.estimatedMinutes,
    };

    return ok(spark);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Internal Generation Logic
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Generate action from step's activities.
   */
  private generateFromStep(
    step: Step,
    escalationLevel: number
  ): AppResult<SparkGenerationResult> {
    const variant = getVariantForLevel(escalationLevel);

    // Explicit check for missing/empty activities - use fallback immediately
    if (!step.activities || step.activities.length === 0) {
      const fallbackAction = generateFallbackActionWithMetadata(
        step.title,
        escalationLevel,
        this.config
      );

      const diagnostics: SparkGenerationDiagnostics = {
        requestedEscalationLevel: escalationLevel,
        actualEscalationLevel: escalationLevel,
        escalationClamped: false,
        activityIndex: -1,
        hasResource: false,
        urlSanitized: false,
        generatedAt: new Date().toISOString(),
      };

      return ok({ action: fallbackAction, diagnostics });
    }

    // Select activity based on variant
    const selection = selectActivity(step.activities, variant);

    // No suitable activity found - use fallback
    if (!selection) {
      const fallbackAction = generateFallbackActionWithMetadata(
        step.title,
        escalationLevel,
        this.config
      );

      const diagnostics: SparkGenerationDiagnostics = {
        requestedEscalationLevel: escalationLevel,
        actualEscalationLevel: escalationLevel,
        escalationClamped: false,
        activityIndex: -1,
        hasResource: false,
        urlSanitized: false,
        generatedAt: new Date().toISOString(),
      };

      return ok({ action: fallbackAction, diagnostics });
    }

    const { activity, index } = selection;

    // Find resource for this activity
    const resource = this.findResourceById(step.resources, activity.resourceId);

    // Generate action
    const action = generateAction(activity, resource, escalationLevel, this.config);

    // Check URL sanitization if resource present
    const urlResult = resource?.url ? sanitizeUrl(resource.url) : null;

    const diagnostics: SparkGenerationDiagnostics = {
      requestedEscalationLevel: escalationLevel,
      actualEscalationLevel: escalationLevel,
      escalationClamped: false,
      activityIndex: index,
      hasResource: resource !== undefined,
      urlSanitized: urlResult?.safe === true && urlResult.originalUrl !== urlResult.sanitizedUrl,
      originalUrl: urlResult && !urlResult.safe ? urlResult.originalUrl : undefined,
      generatedAt: new Date().toISOString(),
    };

    return ok({ action, diagnostics });
  }

  /**
   * Find resource by ID from step's resources.
   */
  private findResourceById(
    resources: readonly StepResource[] | undefined,
    resourceId: ResourceId | undefined
  ): StepResource | undefined {
    if (!resources || resources.length === 0 || !resourceId) {
      return undefined;
    }

    return resources.find(r => r.id === resourceId);
  }

  /**
   * Find resource info for a spark based on activity index.
   */
  private findResource(
    step: Step,
    activityIndex: number
  ): { id: ResourceId; url: string; section?: string } | undefined {
    // No activities or invalid index
    if (!step.activities || activityIndex < 0 || activityIndex >= step.activities.length) {
      // Fallback to first resource if available
      if (step.resources && step.resources.length > 0) {
        const firstResource = step.resources[0]!;
        return {
          id: firstResource.id,
          url: firstResource.url,
        };
      }
      return undefined;
    }

    const activity = step.activities[activityIndex]!;
    const resource = this.findResourceById(step.resources, activity.resourceId);

    if (!resource) {
      return undefined;
    }

    return {
      id: resource.id,
      url: resource.url,
      section: activity.section,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Configuration Access
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get the current configuration.
   */
  getConfig(): SparkGenerationConfig {
    return { ...this.config };
  }

  /**
   * Get maximum escalation level from config.
   */
  getMaxEscalationLevel(): number {
    return this.config.maxEscalationLevel;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a SparkGenerator with default configuration.
 */
export function createSparkGenerator(
  config?: Partial<SparkGenerationConfig>
): SparkGenerator {
  return new SparkGenerator(config);
}

/**
 * Create a SparkGenerator from SwordLimitsConfig.
 *
 * Maps config from schema.ts to SparkGenerationConfig.
 */
export function createSparkGeneratorFromLimits(limits: {
  maxEscalationLevel?: number;
  minSparkMinutes?: number;
  maxSparkMinutes?: number;
}): SparkGenerator {
  // Only include defined properties to avoid overriding defaults with undefined
  // Use Object.fromEntries to filter out undefined values
  const config = Object.fromEntries(
    Object.entries({
      maxEscalationLevel: limits.maxEscalationLevel,
      minSparkMinutes: limits.minSparkMinutes,
      maxSparkMinutes: limits.maxSparkMinutes,
    }).filter(([_, v]) => v !== undefined)
  ) as Partial<SparkGenerationConfig>;
  
  return new SparkGenerator(config);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STANDALONE GENERATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a spark without instantiating the class.
 *
 * Convenience function for simple use cases.
 */
export async function generateSparkForStep(
  step: Step,
  escalationLevel: number,
  config?: Partial<SparkGenerationConfig>
): AsyncAppResult<Spark> {
  const generator = new SparkGenerator(config);
  return generator.generateSpark(step, escalationLevel);
}

/**
 * Generate multiple sparks at different escalation levels.
 *
 * Useful for previewing all variants.
 */
export async function generateSparkVariants(
  step: Step,
  config?: Partial<SparkGenerationConfig>
): AsyncAppResult<readonly Spark[]> {
  const generator = new SparkGenerator(config);
  const maxLevel = generator.getMaxEscalationLevel();
  const sparks: Spark[] = [];

  for (let level = 0; level <= maxLevel; level++) {
    const result = await generator.generateSpark(step, level);
    if (!result.ok) {
      return result;
    }
    sparks.push(result.value);
  }

  return ok(sparks);
}
