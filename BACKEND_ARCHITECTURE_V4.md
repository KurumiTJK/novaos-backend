# NovaOS Backend Architecture v4

**Version 4.0** — Production Ready

---

## 1. Type System — Canonical IDs & Typed State

### 1.1 Gate IDs (Canonical, Machine-Safe)

```typescript
// Canonical gate identifiers - NO STRINGS, NO AMBIGUITY
type GateId = 
  | 'intent' 
  | 'shield' 
  | 'lens' 
  | 'stance' 
  | 'capability' 
  | 'model' 
  | 'personality' 
  | 'spark';

const GATE_ORDER: GateId[] = [
  'intent',
  'shield', 
  'lens',
  'stance',
  'capability',
  'model',
  'personality',
  'spark',
];

// Regeneration only re-runs these gates
const REGENERATION_GATES: GateId[] = ['model', 'personality', 'spark'];
```

### 1.2 Pipeline State (Typed, Not `unknown`)

```typescript
interface PipelineState {
  // Input
  input: UserInput;
  
  // Gate outputs (each gate writes to its field)
  intent?: Intent;
  risk?: RiskSummary;
  verification?: VerificationPlan;
  stance?: Stance;
  capabilities?: CapabilityCheckResult;
  generation?: GenerationResult;
  validated?: ValidatedOutput;
  spark?: SparkDecision;
  
  // Control flow
  pendingAck?: PendingAcknowledgment;
  injections?: Injection[];
  
  // Metadata
  regenerationCount: number;
  degraded: boolean;
  stoppedAt?: GateId;
  stoppedReason?: string;
}

interface GateResult<T> {
  gateId: GateId;
  status: 'pass' | 'soft_fail' | 'hard_fail';
  output: T;
  action: 'continue' | 'regenerate' | 'degrade' | 'stop' | 'await_ack';
  failureReason?: string;
  executionTimeMs: number;
}

// Results stored by ID, not array scanning
type GateResults = Partial<Record<GateId, GateResult<unknown>>>;
```

### 1.3 User Input with Explicit Actions

```typescript
interface UserInput {
  userId: string;
  sessionId: string;
  message: string;
  
  // EXPLICIT action requests - not inferred from NL
  requestedActions?: RequestedAction[];
  
  // Soft veto acknowledgment token
  ackToken?: string;
  ackText?: string;
  
  // Hints (optional, advisory only)
  intentHints?: IntentHint[];
}

// Actions must come from UI affordances or strict parser
interface RequestedAction {
  type: ActionType;
  params: Record<string, unknown>;
  source: 'ui_button' | 'command_parser' | 'api_field';
}

type ActionType = 
  | 'set_reminder'
  | 'create_path'
  | 'generate_spark'
  | 'search_web'
  | 'end_conversation'
  | 'override_veto';
```

---

## 2. Execution Pipeline — Deterministic, Typed

### 2.1 Pipeline Executor

```typescript
class ExecutionPipeline {
  private gates: Map<GateId, Gate<unknown, unknown>> = new Map([
    ['intent', new IntentGate()],
    ['shield', new ShieldGate()],
    ['lens', new LensGate()],
    ['stance', new StanceGate()],
    ['capability', new CapabilityGate()],
    ['model', new ModelGate()],
    ['personality', new PersonalityGate()],
    ['spark', new SparkGate()],
  ]);

  async execute(input: UserInput): Promise<PipelineResult> {
    const context: PipelineContext = {
      requestId: generateId(),
      userId: input.userId,
      policyVersion: POLICY_VERSION,
      capabilityMatrixVersion: CAPABILITY_MATRIX_VERSION,
      constraintsVersion: CONSTRAINTS_VERSION,
      verificationPolicyVersion: VERIFICATION_POLICY_VERSION,
      freshnessPolicyVersion: FRESHNESS_POLICY_VERSION,
    };

    let state: PipelineState = {
      input,
      regenerationCount: 0,
      degraded: false,
    };

    const results: GateResults = {};

    for (const gateId of GATE_ORDER) {
      const gate = this.gates.get(gateId)!;
      const result = await gate.execute(state, context);
      
      results[gateId] = result;
      state = this.applyResult(state, gateId, result);
      
      this.logGateResult(context.requestId, gateId, result);

      switch (result.action) {
        case 'stop':
          state.stoppedAt = gateId;
          state.stoppedReason = result.failureReason;
          return this.buildStoppedResponse(state, results, context);
        
        case 'await_ack':
          return this.buildAwaitAckResponse(state, results, context);
        
        case 'regenerate':
          return this.executeRegeneration(state, results, context);
        
        case 'degrade':
          state.degraded = true;
          break;
        
        case 'continue':
        default:
          break;
      }
    }

    return this.buildResponse(state, results, context);
  }

  private async executeRegeneration(
    state: PipelineState,
    results: GateResults,
    context: PipelineContext
  ): Promise<PipelineResult> {
    // Max 2 regeneration attempts
    if (state.regenerationCount >= 2) {
      state.degraded = true;
      return this.buildDegradedResponse(state, results, context, 'max_regenerations');
    }

    state.regenerationCount++;

    // Only re-run model → personality → spark
    for (const gateId of REGENERATION_GATES) {
      const gate = this.gates.get(gateId)!;
      const result = await gate.execute(state, context);
      
      results[gateId] = result;
      state = this.applyResult(state, gateId, result);

      if (result.action === 'stop') {
        return this.buildStoppedResponse(state, results, context);
      }
      
      if (result.action === 'regenerate') {
        // Recursive regeneration
        return this.executeRegeneration(state, results, context);
      }
    }

    return this.buildResponse(state, results, context);
  }

  private applyResult(state: PipelineState, gateId: GateId, result: GateResult<unknown>): PipelineState {
    // Type-safe state updates
    switch (gateId) {
      case 'intent':
        return { ...state, intent: result.output as Intent };
      case 'shield':
        return { ...state, risk: result.output as RiskSummary };
      case 'lens':
        return { ...state, verification: result.output as VerificationPlan };
      case 'stance':
        return { ...state, stance: result.output as Stance };
      case 'capability':
        return { ...state, capabilities: result.output as CapabilityCheckResult };
      case 'model':
        return { ...state, generation: result.output as GenerationResult };
      case 'personality':
        return { ...state, validated: result.output as ValidatedOutput };
      case 'spark':
        return { ...state, spark: result.output as SparkDecision };
      default:
        return state;
    }
  }
}
```

---

## 3. Gate Implementations

### 3.1 IntentGate

```typescript
class IntentGate implements Gate<PipelineState, Intent> {
  readonly gateId: GateId = 'intent';

  async execute(state: PipelineState, context: PipelineContext): Promise<GateResult<Intent>> {
    const start = Date.now();
    
    try {
      const intent = await this.classifyIntent(state.input);
      
      return {
        gateId: this.gateId,
        status: 'pass',
        output: intent,
        action: 'continue',
        executionTimeMs: Date.now() - start,
      };
    } catch (error) {
      return {
        gateId: this.gateId,
        status: 'hard_fail',
        output: null,
        action: 'stop',
        failureReason: 'Intent classification failed: unparseable input',
        executionTimeMs: Date.now() - start,
      };
    }
  }
}
```

### 3.2 ShieldGate — With Soft Veto Handshake

```typescript
class ShieldGate implements Gate<PipelineState, RiskSummary> {
  readonly gateId: GateId = 'shield';

  async execute(state: PipelineState, context: PipelineContext): Promise<GateResult<RiskSummary>> {
    const start = Date.now();
    const { input, intent } = state;

    // Check for pending acknowledgment
    if (input.ackToken) {
      const valid = await this.validateAckToken(input.ackToken, input.ackText);
      if (valid) {
        // Acknowledgment valid, proceed with logged override
        await this.logAckOverride(context.requestId, input.ackToken, input.ackText);
        return {
          gateId: this.gateId,
          status: 'pass',
          output: { interventionLevel: 'none', overrideApplied: true },
          action: 'continue',
          executionTimeMs: Date.now() - start,
        };
      }
    }

    const risk = await this.assessRisk(input, intent);

    // Hard veto - pipeline stops
    if (risk.interventionLevel === 'veto' && risk.vetoType === 'hard') {
      return {
        gateId: this.gateId,
        status: 'hard_fail',
        output: risk,
        action: 'stop',
        failureReason: `Hard veto: ${risk.reason}`,
        executionTimeMs: Date.now() - start,
      };
    }

    // Soft veto - await acknowledgment
    if (risk.interventionLevel === 'veto' && risk.vetoType === 'soft') {
      const ackToken = this.generateAckToken(context.requestId, risk);
      
      return {
        gateId: this.gateId,
        status: 'soft_fail',
        output: {
          ...risk,
          pendingAck: {
            ackToken,
            requiredText: 'I understand the risks and want to proceed',
            expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 min
            auditId: risk.auditId,
          },
        },
        action: 'await_ack',
        failureReason: `Soft veto requires acknowledgment: ${risk.reason}`,
        executionTimeMs: Date.now() - start,
      };
    }

    // Check if Control mode requires resources
    if (risk.controlTrigger) {
      risk.requiredPrependResources = true;
      risk.crisisResources = CRISIS_RESOURCES;
    }

    return {
      gateId: this.gateId,
      status: risk.interventionLevel !== 'none' ? 'soft_fail' : 'pass',
      output: risk,
      action: 'continue',
      executionTimeMs: Date.now() - start,
    };
  }

  private generateAckToken(requestId: string, risk: RiskSummary): string {
    // Cryptographically signed token
    const payload = {
      requestId,
      reason: risk.reason,
      auditId: risk.auditId,
      createdAt: Date.now(),
    };
    return signToken(payload, ACK_TOKEN_SECRET);
  }

  private async validateAckToken(token: string, ackText: string): Promise<boolean> {
    try {
      const payload = verifyToken(token, ACK_TOKEN_SECRET);
      const expectedText = 'I understand the risks and want to proceed';
      return ackText === expectedText && payload.createdAt > Date.now() - 10 * 60 * 1000;
    } catch {
      return false;
    }
  }
}

interface PendingAcknowledgment {
  ackToken: string;
  requiredText: string;
  expiresAt: Date;
  auditId: string;
}
```

### 3.3 LensGate — Stakes-Based Outcomes

```typescript
class LensGate implements Gate<PipelineState, VerificationPlan> {
  readonly gateId: GateId = 'lens';

  async execute(state: PipelineState, context: PipelineContext): Promise<GateResult<VerificationPlan>> {
    const start = Date.now();
    const { input, intent, risk } = state;

    // Determine verification requirements
    const needs = this.checkVerificationRequired(input, intent);
    
    if (!needs.required) {
      return {
        gateId: this.gateId,
        status: 'pass',
        output: { required: false, mode: 'none', plan: null },
        action: 'continue',
        executionTimeMs: Date.now() - start,
      };
    }

    // Check if verification can proceed
    const canVerify = await this.canVerify(needs);

    if (!canVerify) {
      // STAKES-BASED DECISION
      const stakes = this.determineStakes(needs, risk);

      if (stakes === 'high' || stakes === 'critical') {
        // High stakes + cannot verify = STOP with options
        return {
          gateId: this.gateId,
          status: 'hard_fail',
          output: {
            required: true,
            mode: 'blocked',
            plan: null,
            userOptions: [
              { id: 'enable_web', label: 'Enable web access' },
              { id: 'provide_source', label: 'Provide a source URL' },
              { id: 'proceed_unverified', label: 'Proceed without verification (not recommended)', requiresAck: true },
              { id: 'stop', label: 'Cancel this request' },
            ],
          },
          action: 'stop',
          failureReason: `High-stakes request requires verification but web unavailable. Domain: ${needs.reasonCodes.join(', ')}`,
          executionTimeMs: Date.now() - start,
        };
      }

      // Low/medium stakes + cannot verify = DEGRADE
      return {
        gateId: this.gateId,
        status: 'soft_fail',
        output: {
          required: true,
          mode: 'degraded',
          plan: {
            verificationStatus: 'skipped',
            confidence: 'low',
            verified: false,
            freshnessWarning: 'Could not verify against current sources',
            numericPrecisionAllowed: false, // No precise numbers
            actionRecommendationsAllowed: false, // No "buy/sell/do X"
          },
        },
        action: 'degrade',
        failureReason: 'Verification unavailable, degrading output',
        executionTimeMs: Date.now() - start,
      };
    }

    // Can verify - build verification plan
    const plan = await this.buildVerificationPlan(needs);

    return {
      gateId: this.gateId,
      status: 'pass',
      output: {
        required: true,
        mode: needs.mode,
        plan,
      },
      action: 'continue',
      executionTimeMs: Date.now() - start,
    };
  }

  private determineStakes(needs: VerificationNeeds, risk: RiskSummary): StakesLevel {
    // Health/legal/financial are always high stakes
    const highStakesDomains = ['health_claim', 'legal_claim', 'financial_claim'];
    if (needs.reasonCodes.some(code => highStakesDomains.includes(code))) {
      return 'high';
    }

    // Inherit from Shield risk assessment
    if (risk?.stakesLevel) {
      return risk.stakesLevel;
    }

    return 'low';
  }

  // Verification triggers with allowlists
  checkVerificationRequired(input: UserInput, intent: Intent): VerificationNeeds {
    const matchedTriggers: VerificationTrigger[] = [];

    for (const trigger of VERIFICATION_POLICY.triggers) {
      // Skip if in allowlisted context
      if (this.isAllowlistedContext(input, intent, trigger)) {
        continue;
      }

      if (this.matchesTrigger(input, trigger)) {
        matchedTriggers.push(trigger);
      }
    }

    const requiredTriggers = matchedTriggers.filter(t => t.required);

    return {
      required: requiredTriggers.length > 0,
      reasonCodes: requiredTriggers.map(t => t.type),
      mode: requiredTriggers.length > 0 ? 'web' : 'none',
      triggers: matchedTriggers,
    };
  }

  // ALLOWLIST: Don't verify in these contexts
  private isAllowlistedContext(input: UserInput, intent: Intent, trigger: VerificationTrigger): boolean {
    // Code blocks - don't verify numbers in code
    if (this.isInCodeBlock(input.message, trigger)) {
      return true;
    }

    // User-provided text processing
    if (intent?.type === 'rewrite' || intent?.type === 'summarize' || intent?.type === 'translate') {
      return true;
    }

    // Hypotheticals and examples
    if (intent?.isHypothetical) {
      return true;
    }

    return false;
  }

  private isInCodeBlock(message: string, trigger: VerificationTrigger): boolean {
    // Check if trigger match is inside ```...``` or `...`
    const codeBlockRegex = /```[\s\S]*?```|`[^`]+`/g;
    const codeBlocks = message.match(codeBlockRegex) || [];
    
    for (const pattern of trigger.patterns || []) {
      const match = message.match(pattern);
      if (match) {
        const matchIndex = message.indexOf(match[0]);
        for (const block of codeBlocks) {
          const blockStart = message.indexOf(block);
          const blockEnd = blockStart + block.length;
          if (matchIndex >= blockStart && matchIndex < blockEnd) {
            return true;
          }
        }
      }
    }
    return false;
  }
}

interface VerificationPlan {
  required: boolean;
  mode: 'web' | 'internal' | 'degraded' | 'blocked' | 'none';
  plan: {
    verificationStatus: 'pending' | 'complete' | 'partial' | 'skipped';
    confidence: ConfidenceLevel;
    verified: boolean;
    freshnessWarning?: string;
    numericPrecisionAllowed: boolean;
    actionRecommendationsAllowed: boolean;
    sourcesToCheck?: string[];
  } | null;
  userOptions?: UserOption[];
}
```

### 3.4 CapabilityGate — No Content Injection

```typescript
class CapabilityGate implements Gate<PipelineState, CapabilityCheckResult> {
  readonly gateId: GateId = 'capability';

  async execute(state: PipelineState, context: PipelineContext): Promise<GateResult<CapabilityCheckResult>> {
    const start = Date.now();
    const { input, stance, risk } = state;

    // Get requested actions from EXPLICIT sources only
    const requestedActions = this.getExplicitActions(input);

    const violations: CapabilityViolation[] = [];
    const allowed: RequestedAction[] = [];

    for (const action of requestedActions) {
      const rule = CAPABILITY_MATRIX[stance][action.type];

      if (!rule || rule.level === 'blocked') {
        violations.push({
          action: action.type,
          stance,
          reason: `Action '${action.type}' is blocked in ${stance} stance`,
        });
        continue;
      }

      // Check preconditions
      if (rule.precondition) {
        const met = this.checkPrecondition(rule.precondition, state);
        if (!met) {
          violations.push({
            action: action.type,
            stance,
            reason: `Precondition '${rule.precondition}' not met`,
            preconditionFailed: rule.precondition,
          });
          continue;
        }
      }

      allowed.push(action);
    }

    // Hard fail if blocked capabilities requested
    if (violations.some(v => !v.preconditionFailed)) {
      return {
        gateId: this.gateId,
        status: 'hard_fail',
        output: { allowed: [], violations },
        action: 'stop',
        failureReason: violations.map(v => v.reason).join('; '),
        executionTimeMs: Date.now() - start,
      };
    }

    // Soft fail if preconditions not met
    if (violations.length > 0) {
      return {
        gateId: this.gateId,
        status: 'soft_fail',
        output: { allowed, violations },
        action: 'continue', // Continue but action won't execute
        failureReason: violations.map(v => v.reason).join('; '),
        executionTimeMs: Date.now() - start,
      };
    }

    return {
      gateId: this.gateId,
      status: 'pass',
      output: { allowed, violations: [] },
      action: 'continue',
      executionTimeMs: Date.now() - start,
    };
  }

  // ONLY get actions from explicit sources, NOT natural language
  private getExplicitActions(input: UserInput): RequestedAction[] {
    // Actions must come from:
    // 1. UI button clicks (requestedActions with source='ui_button')
    // 2. Strict command parser (requestedActions with source='command_parser')
    // 3. API fields (requestedActions with source='api_field')
    
    // NEVER infer actions from natural language here
    return (input.requestedActions || []).filter(a => 
      ['ui_button', 'command_parser', 'api_field'].includes(a.source)
    );
  }
}
```

### 3.5 ModelGate — Structured Constraints

```typescript
class ModelGate implements Gate<PipelineState, GenerationResult> {
  readonly gateId: GateId = 'model';

  async execute(state: PipelineState, context: PipelineContext): Promise<GateResult<GenerationResult>> {
    const start = Date.now();
    const { input, intent, risk, verification, stance, validated } = state;

    // Build generation constraints
    const constraints = this.buildConstraints(state, context);

    // Select model
    const model = this.selectModel(stance, intent?.complexity);

    try {
      // Build system prompt with constraints
      const systemPrompt = this.buildSystemPrompt(constraints);
      
      const response = await this.invokeModel(model, systemPrompt, input.message);

      return {
        gateId: this.gateId,
        status: 'pass',
        output: {
          text: response.text,
          model,
          tokensUsed: response.tokensUsed,
          constraints, // Pass constraints for audit
        },
        action: 'continue',
        executionTimeMs: Date.now() - start,
      };
    } catch (error) {
      // Try fallback model
      const fallbackResult = await this.tryFallback(constraints, input.message);
      
      if (fallbackResult) {
        return {
          gateId: this.gateId,
          status: 'soft_fail',
          output: { ...fallbackResult, fallbackUsed: true },
          action: 'continue',
          executionTimeMs: Date.now() - start,
        };
      }

      return {
        gateId: this.gateId,
        status: 'hard_fail',
        output: null,
        action: 'stop',
        failureReason: 'All models unavailable',
        executionTimeMs: Date.now() - start,
      };
    }
  }

  // STRUCTURED constraints, not string soup
  private buildConstraints(state: PipelineState, context: PipelineContext): GenerationConstraints {
    const constraints: GenerationConstraints = {
      bannedPhrases: [...LINGUISTIC_CONSTRAINTS.praise.banned, ...LINGUISTIC_CONSTRAINTS.dependencyLanguage.banned],
      maxWe: LINGUISTIC_CONSTRAINTS.firstPersonPlural.maxPerResponse,
      tone: 'neutral',
      numericPrecisionAllowed: true,
      actionRecommendationsAllowed: true,
    };

    // Apply verification degradation
    if (state.verification?.plan) {
      constraints.numericPrecisionAllowed = state.verification.plan.numericPrecisionAllowed;
      constraints.actionRecommendationsAllowed = state.verification.plan.actionRecommendationsAllowed;
    }

    // Apply freshness restrictions for immediate domains
    if (state.verification?.plan?.verificationStatus === 'skipped') {
      const domain = this.detectDomain(state.input.message);
      if (IMMEDIATE_DOMAINS.includes(domain)) {
        constraints.numericPrecisionAllowed = false;
        constraints.mustInclude = ['Please verify current data with your broker/source'];
        constraints.mustNotInclude = ['buy', 'sell', 'invest', 'recommend'];
      }
    }

    // Apply Shield-required resources (Shield owns this, not CapabilityGate)
    if (state.risk?.requiredPrependResources) {
      constraints.mustPrepend = this.formatCrisisResources(state.risk.crisisResources);
    }

    // Apply regeneration constraints from PersonalityGate
    if (state.validated?.regenerationConstraints) {
      constraints.bannedPhrases.push(...state.validated.regenerationConstraints.bannedPhrases);
      if (state.validated.regenerationConstraints.maxWe !== undefined) {
        constraints.maxWe = state.validated.regenerationConstraints.maxWe;
      }
    }

    return constraints;
  }

  private buildSystemPrompt(constraints: GenerationConstraints): string {
    let prompt = STYLE_CONTRACT;

    if (constraints.bannedPhrases.length > 0) {
      prompt += `\n\nBANNED PHRASES (do not use):\n${constraints.bannedPhrases.map(p => `- "${p}"`).join('\n')}`;
    }

    if (constraints.maxWe !== undefined) {
      prompt += `\n\nMAX "WE" USAGE: ${constraints.maxWe} times per response`;
    }

    if (!constraints.numericPrecisionAllowed) {
      prompt += `\n\nNUMERIC PRECISION: Do NOT quote specific numbers, prices, percentages, or statistics. Use ranges or direct user to verify.`;
    }

    if (!constraints.actionRecommendationsAllowed) {
      prompt += `\n\nACTION RECOMMENDATIONS: Do NOT recommend specific actions like buy/sell/invest. Provide information only.`;
    }

    if (constraints.mustInclude?.length) {
      prompt += `\n\nMUST INCLUDE in response:\n${constraints.mustInclude.map(p => `- "${p}"`).join('\n')}`;
    }

    if (constraints.mustNotInclude?.length) {
      prompt += `\n\nMUST NOT INCLUDE:\n${constraints.mustNotInclude.map(p => `- "${p}"`).join('\n')}`;
    }

    if (constraints.mustPrepend) {
      prompt += `\n\nMUST PREPEND to response:\n${constraints.mustPrepend}`;
    }

    return prompt;
  }
}

interface GenerationConstraints {
  bannedPhrases: string[];
  maxWe: number;
  tone: 'neutral' | 'direct' | 'warm';
  numericPrecisionAllowed: boolean;
  actionRecommendationsAllowed: boolean;
  mustInclude?: string[];
  mustNotInclude?: string[];
  mustPrepend?: string;
}

const IMMEDIATE_DOMAINS = ['stock_prices', 'crypto_prices', 'weather', 'breaking_news'];
```

### 3.6 PersonalityGate — With Regeneration Constraints

```typescript
class PersonalityGate implements Gate<PipelineState, ValidatedOutput> {
  readonly gateId: GateId = 'personality';

  async execute(state: PipelineState, context: PipelineContext): Promise<GateResult<ValidatedOutput>> {
    const start = Date.now();
    const { generation } = state;

    if (!generation?.text) {
      return {
        gateId: this.gateId,
        status: 'hard_fail',
        output: null,
        action: 'stop',
        failureReason: 'No generation to validate',
        executionTimeMs: Date.now() - start,
      };
    }

    const violations = this.detectViolations(generation.text);

    // High-severity violations -> regenerate with specific constraints
    const highSeverity = violations.filter(v => v.severity === 'high');
    if (highSeverity.length > 0) {
      // Build STRUCTURED regeneration constraints
      const regenerationConstraints: GenerationConstraints = {
        bannedPhrases: highSeverity.map(v => v.phrase),
        maxWe: 0, // If "we" was a problem, ban it entirely
        tone: 'neutral',
        numericPrecisionAllowed: generation.constraints?.numericPrecisionAllowed ?? true,
        actionRecommendationsAllowed: generation.constraints?.actionRecommendationsAllowed ?? true,
      };

      return {
        gateId: this.gateId,
        status: 'hard_fail',
        output: {
          text: generation.text,
          violations,
          edited: false,
          regenerationConstraints, // Passed to next ModelGate run
        },
        action: 'regenerate',
        failureReason: `High-severity violations: ${highSeverity.map(v => v.type).join(', ')}`,
        executionTimeMs: Date.now() - start,
      };
    }

    // Low/medium violations -> surgical edit
    let processedText = generation.text;
    const edits: Edit[] = [];

    for (const violation of violations.filter(v => v.canSurgicalEdit)) {
      const result = this.surgicalEdit(processedText, violation);
      processedText = result.text;
      edits.push(result.edit);
    }

    return {
      gateId: this.gateId,
      status: violations.length > 0 ? 'soft_fail' : 'pass',
      output: {
        text: processedText,
        violations,
        edited: edits.length > 0,
        edits,
      },
      action: 'continue',
      executionTimeMs: Date.now() - start,
    };
  }
}
```

### 3.7 SparkGate — Only After Sword Stance

```typescript
class SparkGate implements Gate<PipelineState, SparkDecision> {
  readonly gateId: GateId = 'spark';

  async execute(state: PipelineState, context: PipelineContext): Promise<GateResult<SparkDecision>> {
    const start = Date.now();
    const { stance, risk, intent } = state;

    // INVARIANT: Only run for Sword stance
    if (stance !== 'sword') {
      return {
        gateId: this.gateId,
        status: 'pass',
        output: { spark: null, reason: 'not_sword_stance' },
        action: 'continue',
        executionTimeMs: Date.now() - start,
      };
    }

    // Check eligibility
    const metrics = await this.getSparkMetrics(context.userId);
    const eligibility = this.checkEligibility(state, metrics);

    if (!eligibility.eligible) {
      return {
        gateId: this.gateId,
        status: 'pass', // Not a failure, just ineligible
        output: { spark: null, reason: eligibility.reason },
        action: 'continue',
        executionTimeMs: Date.now() - start,
      };
    }

    // Generate Spark
    const spark = await this.generateSpark(state, context);

    return {
      gateId: this.gateId,
      status: 'pass',
      output: { spark, reason: null },
      action: 'continue',
      executionTimeMs: Date.now() - start,
    };
  }
}
```

---

## 4. Audit Logger — With Hashes and Encryption

```typescript
interface ResponseAudit {
  // Identification
  requestId: string;
  userId: string;
  timestamp: Date;
  
  // Policy versions
  policyVersion: string;
  capabilityMatrixVersion: string;
  constraintsVersion: string;
  verificationPolicyVersion: string;
  freshnessPolicyVersion: string;
  
  // Content hashes (for reconstruction without storing PII)
  inputHash: string;
  outputHash: string;
  
  // Snapshot storage (encrypted, optional)
  snapshotStorageRef?: string;
  snapshotEncrypted: boolean;
  redactionApplied: boolean;
  
  // Gate execution
  gatesExecuted: GateAuditEntry[];
  
  // Decisions
  stance: Stance;
  model: string;
  interventionApplied?: InterventionDecision;
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

class AuditLogger {
  async logResponse(
    state: PipelineState,
    results: GateResults,
    context: PipelineContext,
    response: Response
  ): Promise<void> {
    // Hash input and output
    const inputHash = this.hashContent(state.input.message);
    const outputHash = this.hashContent(response.text);
    
    // Optionally store encrypted snapshot
    let snapshotStorageRef: string | undefined;
    let redactionApplied = false;
    
    if (this.shouldStoreSnapshot(state, response)) {
      const snapshot = {
        input: this.redactPII(state.input.message),
        output: this.redactPII(response.text),
        constraints: state.generation?.constraints,
      };
      redactionApplied = true;
      
      const encrypted = await this.encrypt(JSON.stringify(snapshot));
      snapshotStorageRef = await this.storeSnapshot(encrypted);
    }

    const audit: ResponseAudit = {
      requestId: context.requestId,
      userId: context.userId,
      timestamp: new Date(),
      
      policyVersion: context.policyVersion,
      capabilityMatrixVersion: context.capabilityMatrixVersion,
      constraintsVersion: context.constraintsVersion,
      verificationPolicyVersion: context.verificationPolicyVersion,
      freshnessPolicyVersion: context.freshnessPolicyVersion,
      
      inputHash,
      outputHash,
      snapshotStorageRef,
      snapshotEncrypted: !!snapshotStorageRef,
      redactionApplied,
      
      gatesExecuted: Object.values(results).map(r => ({
        gateId: r.gateId,
        status: r.status,
        action: r.action,
        executionTimeMs: r.executionTimeMs,
      })),
      
      stance: state.stance,
      model: state.generation?.model,
      interventionApplied: state.risk?.interventionLevel !== 'none' ? state.risk : undefined,
      ackOverrideApplied: state.risk?.overrideApplied ?? false,
      
      responseGenerated: !state.stoppedAt,
      regenerationCount: state.regenerationCount,
      degradationApplied: state.degraded,
      stoppedAt: state.stoppedAt,
      stoppedReason: state.stoppedReason,
      
      trustViolations: this.extractTrustViolations(results),
      linguisticViolations: state.validated?.violations || [],
    };
    
    await this.store(audit);
  }

  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  private redactPII(text: string): string {
    // Redact common PII patterns
    return text
      .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]')
      .replace(/\b\d{16}\b/g, '[CARD]')
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]')
      .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE]');
  }
}
```

---

## 5. Invariant Suite

```typescript
// FORMAL INVARIANTS - Unit testable, must never break

const PIPELINE_INVARIANTS: Invariant[] = [
  {
    id: 'hard_veto_stops',
    description: 'If intervention.level === "veto" && vetoType === "hard", pipeline must stop',
    test: (state: PipelineState, results: GateResults) => {
      const shieldResult = results.shield?.output as RiskSummary;
      if (shieldResult?.interventionLevel === 'veto' && shieldResult?.vetoType === 'hard') {
        return state.stoppedAt === 'shield';
      }
      return true;
    },
  },
  
  {
    id: 'sword_only_spark',
    description: 'If stance !== "sword", SparkGate must not generate spark',
    test: (state: PipelineState, results: GateResults) => {
      if (state.stance !== 'sword') {
        const sparkResult = results.spark?.output as SparkDecision;
        return sparkResult?.spark === null;
      }
      return true;
    },
  },
  
  {
    id: 'lens_degradation_rules',
    description: 'If Lens required verification and mode is "none", must either stop or mark confidence <= low and verified=false',
    test: (state: PipelineState, results: GateResults) => {
      const lensResult = results.lens?.output as VerificationPlan;
      if (lensResult?.required && lensResult?.mode === 'none') {
        // Either stopped at lens or degraded
        if (state.stoppedAt === 'lens') return true;
        if (state.degraded && lensResult.plan?.confidence === 'low' && !lensResult.plan?.verified) return true;
        return false;
      }
      return true;
    },
  },
  
  {
    id: 'control_resources',
    description: 'If Control trigger fired, provide_resources must be present in final output',
    test: (state: PipelineState, results: GateResults, response: Response) => {
      const shieldResult = results.shield?.output as RiskSummary;
      if (shieldResult?.controlTrigger) {
        return response.text.includes('988') || // Crisis line
               response.crisisResourcesProvided === true;
      }
      return true;
    },
  },
  
  {
    id: 'personality_regeneration_limit',
    description: 'If Personality high-severity violations, regenerate <= 2 times then degrade',
    test: (state: PipelineState, results: GateResults) => {
      const personalityResult = results.personality?.output as ValidatedOutput;
      if (personalityResult?.violations?.some(v => v.severity === 'high')) {
        return state.regenerationCount <= 2;
      }
      return true;
    },
  },
  
  {
    id: 'soft_veto_requires_ack',
    description: 'If soft veto triggered without ackToken, pipeline must await_ack',
    test: (state: PipelineState, results: GateResults) => {
      const shieldResult = results.shield?.output as RiskSummary;
      if (shieldResult?.interventionLevel === 'veto' && shieldResult?.vetoType === 'soft') {
        if (!state.input.ackToken) {
          return results.shield?.action === 'await_ack';
        }
      }
      return true;
    },
  },
  
  {
    id: 'no_nl_action_inference',
    description: 'RequestedActions must only come from explicit sources, never NL inference',
    test: (state: PipelineState, results: GateResults) => {
      const actions = state.input.requestedActions || [];
      return actions.every(a => ['ui_button', 'command_parser', 'api_field'].includes(a.source));
    },
  },
  
  {
    id: 'immediate_domain_unverified',
    description: 'For immediate domains, if unverified, no numeric precision in output',
    test: (state: PipelineState, results: GateResults, response: Response) => {
      const lensResult = results.lens?.output as VerificationPlan;
      if (lensResult?.plan?.verificationStatus === 'skipped') {
        const domain = detectDomain(state.input.message);
        if (IMMEDIATE_DOMAINS.includes(domain)) {
          // Check response doesn't contain precise numbers
          const hasPreciseNumbers = /\$[\d,]+\.\d{2}|\b\d+\.\d{2}%/.test(response.text);
          return !hasPreciseNumbers;
        }
      }
      return true;
    },
  },
];

// Invariant runner
class InvariantChecker {
  async check(
    state: PipelineState,
    results: GateResults,
    response: Response
  ): Promise<InvariantResult[]> {
    const failures: InvariantResult[] = [];

    for (const invariant of PIPELINE_INVARIANTS) {
      const passed = invariant.test(state, results, response);
      if (!passed) {
        failures.push({
          invariantId: invariant.id,
          description: invariant.description,
          passed: false,
        });
        
        // Log invariant violation
        this.logViolation(invariant, state, results);
      }
    }

    return failures;
  }
}
```

---

## 6. API Endpoints

```typescript
// Chat endpoint with explicit action support
app.post('/api/v1/chat', async (req, res) => {
  const input: UserInput = {
    userId: req.user.id,
    sessionId: req.body.sessionId,
    message: req.body.message,
    
    // EXPLICIT actions only
    requestedActions: req.body.requestedActions?.map(a => ({
      ...a,
      source: 'api_field' as const,
    })),
    
    // Soft veto acknowledgment
    ackToken: req.body.ackToken,
    ackText: req.body.ackText,
    
    // Optional hints
    intentHints: req.body.intentHints,
  };

  const result = await pipeline.execute(input);

  // Handle await_ack response
  if (result.pendingAck) {
    return res.status(200).json({
      type: 'await_ack',
      message: result.message,
      ackRequired: {
        token: result.pendingAck.ackToken,
        requiredText: result.pendingAck.requiredText,
        expiresAt: result.pendingAck.expiresAt,
      },
      reason: result.pendingAck.reason,
    });
  }

  // Handle stop response
  if (result.stopped) {
    return res.status(200).json({
      type: 'stopped',
      message: result.message,
      reason: result.stoppedReason,
      userOptions: result.userOptions,
    });
  }

  // Success response
  return res.status(200).json({
    type: 'success',
    message: result.message,
    stance: result.stance,
    confidence: result.confidence,
    verified: result.verified,
    freshnessWarning: result.freshnessWarning,
    spark: result.spark,
    transparency: result.transparency,
    debug: req.query.debug === 'true' ? result.debug : undefined,
  });
});

// Command parser endpoint (strict grammar)
app.post('/api/v1/parse-command', async (req, res) => {
  const { text } = req.body;
  
  // Strict command grammar
  const commands = parseCommands(text); // Returns only recognized commands
  
  return res.json({
    commands: commands.map(c => ({
      ...c,
      source: 'command_parser' as const,
    })),
  });
});
```

---

## 7. Complete Type Definitions

```typescript
// ─────────────────────────────────────────────────────────────────────────────────
// CORE TYPES
// ─────────────────────────────────────────────────────────────────────────────────

type GateId = 'intent' | 'shield' | 'lens' | 'stance' | 'capability' | 'model' | 'personality' | 'spark';
type Stance = 'control' | 'shield' | 'lens' | 'sword';
type ConfidenceLevel = 'high' | 'medium' | 'low' | 'inference' | 'speculation';
type StakesLevel = 'low' | 'medium' | 'high' | 'critical';
type VetoType = 'soft' | 'hard';

// ─────────────────────────────────────────────────────────────────────────────────
// INPUT TYPES
// ─────────────────────────────────────────────────────────────────────────────────

interface UserInput {
  userId: string;
  sessionId: string;
  message: string;
  requestedActions?: RequestedAction[];
  ackToken?: string;
  ackText?: string;
  intentHints?: IntentHint[];
}

interface RequestedAction {
  type: ActionType;
  params: Record<string, unknown>;
  source: 'ui_button' | 'command_parser' | 'api_field';
}

type ActionType = 
  | 'set_reminder'
  | 'create_path'
  | 'generate_spark'
  | 'search_web'
  | 'end_conversation'
  | 'override_veto';

// ─────────────────────────────────────────────────────────────────────────────────
// GATE OUTPUT TYPES
// ─────────────────────────────────────────────────────────────────────────────────

interface Intent {
  type: 'question' | 'action' | 'planning' | 'rewrite' | 'summarize' | 'translate' | 'conversation';
  complexity: 'low' | 'medium' | 'high';
  isHypothetical: boolean;
  domains: string[];
}

interface RiskSummary {
  interventionLevel: 'none' | 'nudge' | 'friction' | 'veto';
  vetoType?: VetoType;
  stakesLevel: StakesLevel;
  reason: string;
  auditId: string;
  controlTrigger?: ControlTrigger;
  requiredPrependResources?: boolean;
  crisisResources?: CrisisResource[];
  pendingAck?: PendingAcknowledgment;
  overrideApplied?: boolean;
}

interface VerificationPlan {
  required: boolean;
  mode: 'web' | 'internal' | 'degraded' | 'blocked' | 'none';
  plan: {
    verificationStatus: 'pending' | 'complete' | 'partial' | 'skipped';
    confidence: ConfidenceLevel;
    verified: boolean;
    freshnessWarning?: string;
    numericPrecisionAllowed: boolean;
    actionRecommendationsAllowed: boolean;
    sourcesToCheck?: string[];
  } | null;
  userOptions?: UserOption[];
}

interface CapabilityCheckResult {
  allowed: RequestedAction[];
  violations: CapabilityViolation[];
}

interface GenerationResult {
  text: string;
  model: string;
  tokensUsed: number;
  constraints: GenerationConstraints;
  fallbackUsed?: boolean;
}

interface ValidatedOutput {
  text: string;
  violations: LinguisticViolation[];
  edited: boolean;
  edits?: Edit[];
  regenerationConstraints?: GenerationConstraints;
}

interface SparkDecision {
  spark: Spark | null;
  reason: SparkIneligibilityReason | null;
}

// ─────────────────────────────────────────────────────────────────────────────────
// PIPELINE TYPES
// ─────────────────────────────────────────────────────────────────────────────────

interface PipelineState {
  input: UserInput;
  intent?: Intent;
  risk?: RiskSummary;
  verification?: VerificationPlan;
  stance?: Stance;
  capabilities?: CapabilityCheckResult;
  generation?: GenerationResult;
  validated?: ValidatedOutput;
  spark?: SparkDecision;
  pendingAck?: PendingAcknowledgment;
  injections?: Injection[];
  regenerationCount: number;
  degraded: boolean;
  stoppedAt?: GateId;
  stoppedReason?: string;
}

interface GateResult<T> {
  gateId: GateId;
  status: 'pass' | 'soft_fail' | 'hard_fail';
  output: T;
  action: 'continue' | 'regenerate' | 'degrade' | 'stop' | 'await_ack';
  failureReason?: string;
  executionTimeMs: number;
}

interface PipelineContext {
  requestId: string;
  userId: string;
  policyVersion: string;
  capabilityMatrixVersion: string;
  constraintsVersion: string;
  verificationPolicyVersion: string;
  freshnessPolicyVersion: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTRAINT TYPES
// ─────────────────────────────────────────────────────────────────────────────────

interface GenerationConstraints {
  bannedPhrases: string[];
  maxWe: number;
  tone: 'neutral' | 'direct' | 'warm';
  numericPrecisionAllowed: boolean;
  actionRecommendationsAllowed: boolean;
  mustInclude?: string[];
  mustNotInclude?: string[];
  mustPrepend?: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// VERSION CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

const POLICY_VERSION = '4.0.0';
const CAPABILITY_MATRIX_VERSION = '4.0.0';
const CONSTRAINTS_VERSION = '4.0.0';
const VERIFICATION_POLICY_VERSION = '4.0.0';
const FRESHNESS_POLICY_VERSION = '4.0.0';
```

---

*Nova v4: Production ready. Type safe. Invariant tested.*
