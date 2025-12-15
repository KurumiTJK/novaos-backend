// ═══════════════════════════════════════════════════════════════════════════════
// NOVAOS v4 TYPES — UPDATED
// Single source of truth for all types (with fix additions)
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
  | 'spark'
  | 'invariant'; // Added for InvariantGate

export type Stance = 'control' | 'shield' | 'lens' | 'sword';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type StakesLevel = 'low' | 'medium' | 'high' | 'critical';

export type ActionSource = 'ui_button' | 'command_parser' | 'api_field';

export type ActionType = 
  | 'set_reminder'
  | 'create_path'
  | 'generate_spark'
  | 'search_web'
  | 'end_conversation'
  | 'override_veto';

export type GateStatus = 'pass' | 'soft_fail' | 'hard_fail';

export type GateAction = 'continue' | 'regenerate' | 'stop' | 'await_ack';

export type InterventionLevel = 'none' | 'nudge' | 'friction' | 'veto';

export type VetoType = 'soft' | 'hard';

export type VerificationTrigger = 
  | 'temporal_claim'
  | 'health_claim'
  | 'legal_claim'
  | 'financial_claim'
  | 'numeric_claim'
  | 'public_figure_claim';

export type SparkIneligibilityReason =
  | 'not_sword_stance'
  | 'shield_intervention_active'
  | 'control_mode_active'
  | 'high_stakes_decision'
  | 'rate_limit_reached'
  | 'recent_spark_ignored'
  | 'information_incomplete';

// ─────────────────────────────────────────────────────────────────────────────────
// INPUT TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface UserInput {
  userId: string;
  sessionId: string;
  message: string;
  requestedActions?: RequestedAction[];
  ackToken?: string;      // For soft veto override
  ackText?: string;       // User's acknowledgment text
  sourceUrl?: string;     // User-provided source for verification
  context?: {
    previousMessages?: string[];
    attachments?: Attachment[];
  };
}

export interface RequestedAction {
  type: ActionType;
  params: Record<string, unknown>;
  source: ActionSource;
}

export interface Attachment {
  type: 'image' | 'document' | 'url';
  data: string;
  mimeType?: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// PIPELINE CONTEXT
// ─────────────────────────────────────────────────────────────────────────────────

export interface PipelineContext {
  requestId: string;
  userId: string;
  sessionId: string;
  policyVersion: string;
  capabilityMatrixVersion: string;
  constraintsVersion: string;
  verificationPolicyVersion: string;
  freshnessPolicyVersion: string;
  startTime: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// PIPELINE STATE — Typed per gate
// ─────────────────────────────────────────────────────────────────────────────────

export interface PipelineState {
  input: UserInput;
  
  // Gate outputs (set by respective gates)
  intent?: Intent;
  risk?: RiskSummary;
  verification?: VerificationPlan;
  stance?: Stance;
  capabilities?: CapabilityCheckResult;
  generation?: GenerationResult;
  validated?: ValidatedOutput;
  spark?: SparkDecision;
  
  // Pipeline control
  regenerationCount: number;
  degraded: boolean;
  stoppedAt?: GateId;
  stoppedReason?: string;
  
  // Soft veto state
  pendingAck?: PendingAck;
  
  // Safety state
  crisisResourcesProvided?: boolean;
  sessionEnded?: boolean;
}

export interface PendingAck {
  ackToken: string;
  requiredText: string;
  expiresAt: Date;
  auditId: string;
  reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// GATE RESULTS
// ─────────────────────────────────────────────────────────────────────────────────

export interface GateResult<T> {
  gateId: GateId;
  status: GateStatus;
  output: T;
  action: GateAction;
  failureReason?: string;
  executionTimeMs: number;
}

export type GateResults = Partial<{
  intent: GateResult<Intent>;
  shield: GateResult<RiskSummary>;
  lens: GateResult<VerificationPlan>;
  stance: GateResult<Stance>;
  capability: GateResult<CapabilityCheckResult>;
  model: GateResult<GenerationResult>;
  personality: GateResult<ValidatedOutput>;
  spark: GateResult<SparkDecision>;
  invariant: GateResult<InvariantGateOutput>;
}>;

// ─────────────────────────────────────────────────────────────────────────────────
// INTENT GATE TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface Intent {
  type: 'conversation' | 'question' | 'action' | 'planning' | 'rewrite' | 'summarize' | 'translate';
  complexity: 'low' | 'medium' | 'high';
  isHypothetical: boolean;
  domains: string[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// SHIELD GATE TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface RiskSummary {
  stakesLevel: StakesLevel;
  interventionLevel: InterventionLevel;
  vetoType?: VetoType;
  reason?: string;
  triggers: string[];
  
  // Control mode
  controlTrigger?: boolean;
  requiredPrependResources?: boolean;
  crisisResources?: CrisisResource[];
  
  // Override tracking
  overrideApplied?: boolean;
  overrideAuditId?: string;
}

export interface CrisisResource {
  name: string;
  action: string;
  phone?: string;
  url?: string;
  available?: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// LENS GATE TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface VerificationPlan {
  required: boolean;
  mode: 'verified' | 'degraded' | 'skipped' | 'stopped';
  plan?: {
    triggers: VerificationTrigger[];
    domain: string;
    verificationStatus: 'complete' | 'partial' | 'failed' | 'skipped' | 'unavailable' | 'not_required';
    verified: boolean;
    confidence: ConfidenceLevel;
    citations: Citation[];
    freshnessWarning?: string;
  };
  userOptions?: UserOption[];
}

export interface Citation {
  url: string;
  title: string;
  domain: string;
  accessedAt: Date;
  relevanceScore: number;
}

export interface UserOption {
  id: string;
  label: string;
  requiresAck?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CAPABILITY GATE TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface CapabilityCheckResult {
  allowedActions: ActionType[];
  blockedActions: BlockedAction[];
  preconditionsChecked: PreconditionResult[];
}

export interface BlockedAction {
  action: ActionType;
  reason: string;
  stanceRequired?: Stance;
}

export interface PreconditionResult {
  precondition: string;
  met: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────
// MODEL GATE TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface GenerationResult {
  text: string;
  model: string;
  fallbackUsed: boolean;
  constraints: GenerationConstraints;
  tokensUsed: number;
}

export interface GenerationConstraints {
  bannedPhrases: string[];
  maxWe: number;
  tone?: string;
  numericPrecisionAllowed: boolean;
  actionRecommendationsAllowed: boolean;
  mustInclude?: string[];
  mustNotInclude?: string[];
  mustPrepend?: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// PERSONALITY GATE TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface ValidatedOutput {
  text: string;
  violations: LinguisticViolation[];
  editsApplied: boolean;
}

export interface LinguisticViolation {
  type: string;
  phrase: string;
  severity: 'low' | 'medium' | 'high';
  canSurgicalEdit: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────
// SPARK GATE TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface SparkDecision {
  spark: Spark | null;
  reason: SparkIneligibilityReason | null;
}

export interface Spark {
  action: string;
  duration: string;
  frictionLevel: number;
  prerequisites: string[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// INVARIANT GATE TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface Invariant {
  id: string;
  description: string;
  test: (state: PipelineState, results: GateResults, response?: { text: string }) => boolean;
}

export interface InvariantResult {
  invariantId: string;
  description: string;
  passed: boolean;
}

export interface InvariantGateOutput {
  violations: InvariantResult[];
  criticalViolations: InvariantResult[];
  nonCriticalViolations: InvariantResult[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// PIPELINE RESULT
// ─────────────────────────────────────────────────────────────────────────────────

export interface PipelineResult {
  success: boolean;
  stopped?: boolean;
  message?: string;
  stoppedReason?: string;
  stoppedAt?: GateId;
  
  // Soft veto
  pendingAck?: {
    ackToken: string;
    requiredText: string;
    expiresAt: Date;
  };
  auditId?: string;
  
  // User options (for Lens stop)
  userOptions?: UserOption[];
  
  // Response metadata
  stance?: Stance;
  confidence?: ConfidenceLevel;
  verified?: boolean;
  freshnessWarning?: string;
  spark?: Spark;
  
  // Transparency
  transparency?: TransparencyInfo;
  debug?: DebugInfo;
}

export interface TransparencyInfo {
  modelUsed: string;
  fallbackUsed: boolean;
  verificationStatus: string;
  regenerationCount: number;
  degraded: boolean;
  degradeReason?: string;
  violations: LinguisticViolation[];
}

export interface DebugInfo {
  gates: GateDebugInfo[];
  policyVersions: Record<string, string>;
  totalLatencyMs: number;
}

export interface GateDebugInfo {
  gateId: GateId;
  status: GateStatus;
  action: GateAction;
  executionTimeMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// AUDIT TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface ResponseAudit {
  requestId: string;
  userId: string;
  timestamp: Date;
  
  // Policy versions
  policyVersion: string;
  capabilityMatrixVersion: string;
  constraintsVersion: string;
  verificationPolicyVersion: string;
  freshnessPolicyVersion: string;
  
  // Hashes (FULL, not truncated)
  inputHash: string;
  outputHash: string;
  
  // Snapshot
  snapshotStorageRef: string;
  snapshotEncrypted: boolean;
  snapshotKeyVersion: number;
  redactionApplied: boolean;
  redactedPatterns: string[];
  
  // Execution
  gatesExecuted: GateAuditEntry[];
  
  // Decisions
  stance: Stance;
  model: string;
  interventionApplied?: RiskSummary;
  ackOverrideApplied: boolean;
  
  // Outcome
  responseGenerated: boolean;
  regenerationCount: number;
  degradationApplied: boolean;
  stoppedAt?: GateId;
  stoppedReason?: string;
  
  // Violations
  trustViolations: TrustViolation[];
  linguisticViolations: LinguisticViolation[];
}

export interface GateAuditEntry {
  gateId: GateId;
  status: GateStatus;
  action: GateAction;
  executionTimeMs: number;
}

export interface TrustViolation {
  type: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  correctionApplied: boolean;
}
