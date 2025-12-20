// ═══════════════════════════════════════════════════════════════════════════════
// ENTITIES — Resolved Entity Types
// From Phase 1 types (stub for Phase 6)
// ═══════════════════════════════════════════════════════════════════════════════

import type { LiveCategory } from './categories.js';

/**
 * Raw entity mention extracted from query.
 */
export interface RawEntityMention {
  readonly rawText: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly confidence: number;
}

/**
 * Resolved entity with canonical form.
 */
export interface ResolvedEntity {
  readonly raw: RawEntityMention;
  readonly canonicalForm: string;
  readonly category: LiveCategory;
  readonly provider?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Ambiguous entity requiring clarification.
 */
export interface AmbiguousEntity {
  readonly raw: RawEntityMention;
  readonly candidates: readonly ResolvedEntity[];
  readonly clarificationPrompt: string;
}

/**
 * Failed entity resolution.
 */
export interface FailedEntity {
  readonly raw: RawEntityMention;
  readonly reason: string;
}

/**
 * Complete entity resolution result.
 */
export interface ResolvedEntities {
  readonly resolved: readonly ResolvedEntity[];
  readonly ambiguous: readonly AmbiguousEntity[];
  readonly failed: readonly FailedEntity[];
}

/**
 * Create empty resolved entities.
 */
export function createEmptyEntities(): ResolvedEntities {
  return {
    resolved: [],
    ambiguous: [],
    failed: [],
  };
}
