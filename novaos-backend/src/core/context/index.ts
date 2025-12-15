// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXT MODULE — Unified Context Building and Pipeline Integration
// ═══════════════════════════════════════════════════════════════════════════════

// Builder
export {
  ContextBuilder,
  getContextBuilder,
  type UnifiedContext,
  type GoalSummary,
  type MessageSummary,
  type ContextBuildOptions,
} from './builder.js';

// Hooks
export {
  PipelineHooks,
  getPipelineHooks,
  type PreGenerationResult,
  type PostGenerationResult,
  type HookOptions,
} from './hooks.js';
