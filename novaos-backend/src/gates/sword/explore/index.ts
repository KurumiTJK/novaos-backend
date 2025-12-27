// ═══════════════════════════════════════════════════════════════════════════════
// EXPLORE MODULE — Exports
// NovaOS Gates — Phase 14A: SwordGate Explore Module
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────────

export type {
  ExploreState,
  ExploreStage,
  ExploreMessage,
  ExploreAssistantIntent,
  ExploreContext,
  ExploreConfig,
  ClarityDetectionResult,
  ClaritySignal,
  ExploreFlowInput,
  ExploreFlowOutput,
  ExploreTransitionReason,
} from './types.js';

export {
  DEFAULT_EXPLORE_CONFIG,
  isExploreStage,
  isExploreTerminal,
  canContinueExploring,
  createEmptyExploreContext,
  buildExploreContext,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// Explore Store
// ─────────────────────────────────────────────────────────────────────────────────

export { ExploreStore, createExploreStore } from './explore-store.js';

// ─────────────────────────────────────────────────────────────────────────────────
// Clarity Detector
// ─────────────────────────────────────────────────────────────────────────────────

export { ClarityDetector, createClarityDetector } from './clarity-detector.js';

// ─────────────────────────────────────────────────────────────────────────────────
// Explore Flow
// ─────────────────────────────────────────────────────────────────────────────────

export { ExploreFlow, createExploreFlow } from './explore-flow.js';
