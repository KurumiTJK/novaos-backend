// ═══════════════════════════════════════════════════════════════════════════════
// NOVAOS TYPES — Single Source of Truth (Implementation-Aligned)
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// CORE ENUMS & LITERALS
// ─────────────────────────────────────────────────────────────────────────────────

export type GateId =
  | 'intent'
  | 'shield'
  | 'lens'
  | 'stance'
  | 'capability'
  | 'model'
  | 'personality'
  | 'spark';

export type Stance = 'control' | 'shield' | 'lens' | 'sword';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type StakesLevel = 'low' | 'medium' | 'high' | 'critical';

export type GateStatus = 'pass' | 'soft_fail' | 'hard_fail';

export type GateAction = 'continue' | 'regenerate' | 'stop' | 'await_ack' | 'degrade';

export type VetoType = 'soft' | 'hard';

export type ControlMode = 'crisis_detected' | 'self_harm_risk' | 'legal_boundary' | 'external_threat';

export type RiskLevel = 'safe' | 'low' | 'elevated' | 'high' | 'critical';

// ─────────────────────────────────────────────────────────────────────────────────
// ACTION SOURCES
// ─────────────────────────────────────────────────────────────────────────────────

export interface ActionSource {
  type: 'ui_button' | 'command_parser' | 'api_field' | 'nl_inference';
  action: string;
  timestamp: number;
  params?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────────
// PIPELINE CONTEXT
// ─────────────────────────────────────────────────────────────────────────────────

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface PipelineContext {
  userId: string;
  conversationId: string;
  requestId?: string;
  timestamp: number;
  actionSources: ActionSource[];
  timezone?: string;
  locale?: string;
  ackTokenValid?: boolean;
  conversationHistory?: ConversationMessage[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// PIPELINE STATE
// ─────────────────────────────────────────────────────────────────────────────────

export interface PipelineState {
  userMessage: string;
  normalizedInput: string;
  gateResults: GateResults;
  flags: PipelineFlags;
  timestamps: PipelineTimestamps;

  // Gate outputs (set during pipeline execution)
  intent?: Intent;
  shieldResult?: ShieldResult;
  lensResult?: LensResult;
  stance?: Stance;
  capabilities?: CapabilityResult;
  generation?: Generation;
  validatedOutput?: ValidatedOutput;
  spark?: Spark;
}

export interface PipelineFlags {
  ackTokenValid?: boolean;
  regenerationAttempt?: number;
  degraded?: boolean;
  crisisResourcesProvided?: boolean;
}

export interface PipelineTimestamps {
  pipelineStart: number;
  pipelineEnd?: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// GATE RESULT WRAPPER
// ─────────────────────────────────────────────────────────────────────────────────

export interface GateResult<T> {
  gateId: GateId;
  status: GateStatus;
  output: T;
  action: GateAction;
  failureReason?: string;
  executionTimeMs: number;
}

export interface GateResults {
  intent?: GateResult<Intent>;
  shield?: GateResult<ShieldResult>;
  lens?: GateResult<LensResult>;
  stance?: GateResult<StanceResult>;
  capability?: GateResult<CapabilityResult>;
  model?: GateResult<Generation>;
  personality?: GateResult<ValidatedOutput>;
  spark?: GateResult<SparkResult>;
}

// ─────────────────────────────────────────────────────────────────────────────────
// INTENT GATE TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface Intent {
  type: IntentType;
  complexity: 'low' | 'medium' | 'high';
  isHypothetical: boolean;
  domains: string[];
  confidence: number;
}

export type IntentType = 
  | 'question'
  | 'action'
  | 'planning'
  | 'rewrite'
  | 'summarize'
  | 'translate'
  | 'conversation';

// ─────────────────────────────────────────────────────────────────────────────────
// SHIELD GATE TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface ShieldResult {
  riskLevel: RiskLevel;
  vetoType?: VetoType;
  controlMode?: ControlMode;
  triggers?: string[];
  message?: string;
  ackToken?: string;
  threatenedInterests?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// LENS GATE TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface LensResult {
  needsVerification: boolean;
  verified: boolean;
  domain?: string;
  stakes: StakesLevel;
  confidence?: number;
  status?: 'verified' | 'degraded' | 'stopped';
  message?: string;
  freshnessWindow?: string;
  sources?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// STANCE GATE TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface StanceResult {
  stance: Stance;
  reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CAPABILITY GATE TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface CapabilityResult {
  allowedCapabilities: string[];
  deniedCapabilities: string[];
  explicitActions?: ActionSource[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// MODEL GATE TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface Generation {
  text: string;
  model?: string;
  tokensUsed?: number;
  constraints?: GenerationConstraints;
  fallbackUsed?: boolean;
}

export interface GenerationConstraints {
  bannedPhrases?: string[];
  maxWe?: number;
  tone?: string;
  numericPrecisionAllowed?: boolean;
  actionRecommendationsAllowed?: boolean;
  mustInclude?: string[];
  mustNotInclude?: string[];
  mustPrepend?: string;
}

export interface ModelProvider {
  generate(prompt: string, systemPrompt: string, constraints?: GenerationConstraints): Promise<Generation>;
}

// ─────────────────────────────────────────────────────────────────────────────────
// PERSONALITY GATE TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface ValidatedOutput {
  text: string;
  violations: LinguisticViolation[];
  edited: boolean;
  edits?: Edit[];
  regenerationConstraints?: GenerationConstraints;
}

export interface LinguisticViolation {
  type: string;
  phrase: string;
  severity: 'low' | 'medium' | 'high';
  canSurgicalEdit: boolean;
}

export interface Edit {
  original: string;
  replacement: string;
  reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// SPARK GATE TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface Spark {
  action: string;
  rationale: string;
  timeEstimate?: string;
  category?: string;
}

export interface SparkResult {
  eligible: boolean;
  spark?: Spark;
  ineligibilityReason?: string;
}

export type SparkIneligibilityReason =
  | 'not_sword_stance'
  | 'shield_intervention_active'
  | 'control_mode_active'
  | 'high_stakes_decision'
  | 'rate_limit_reached'
  | 'recent_spark_ignored'
  | 'information_incomplete';

// ─────────────────────────────────────────────────────────────────────────────────
// PIPELINE RESULT
// ─────────────────────────────────────────────────────────────────────────────────

export interface PipelineResult {
  status: 'success' | 'stopped' | 'await_ack' | 'degraded' | 'error';
  response: string;
  stance: Stance;
  gateResults: GateResults;
  spark?: Spark;
  ackToken?: string;
  ackMessage?: string;
  metadata?: {
    requestId?: string;
    totalTimeMs?: number;
    regenerations?: number;
    degradationReason?: string;
    error?: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// CRISIS RESOURCES
// ─────────────────────────────────────────────────────────────────────────────────

export interface CrisisResource {
  name: string;
  action: string;
  phone?: string;
  url?: string;
  available?: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// INVARIANT TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface Invariant {
  id: string;
  description: string;
  check: (state: PipelineState) => boolean;
}

export interface InvariantCheckResult {
  valid: boolean;
  violations: string[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// AUDIT TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  requestId: string;
  timestamp: number;
  event: string;
  stateHash: string;
  encryptedSnapshot?: string;
  previousHash?: string;
}

export interface AuditStorage {
  store(entry: AuditEntry): Promise<void>;
  getByRequestId(requestId: string): Promise<AuditEntry[]>;
  getChain(startId: string, limit?: number): Promise<AuditEntry[]>;
}
