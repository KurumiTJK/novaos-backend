// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTION PIPELINE — Gate Orchestration
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  PipelineState,
  PipelineContext,
  PipelineResult,
  GateResults,
  Stance,
  GenerationConstraints,
  Generation,
} from '../types/index.js';

import {
  executeIntentGate,
  executeIntentGateAsync,
  executeShieldGate,
  executeLensGate,
  executeLensGateAsync,
  executeStanceGate,
  executeCapabilityGate,
  executeModelGate,
  executeModelGateAsync,
  executePersonalityGate,
  executeSparkGate,
  buildModelConstraints,
} from '../gates/index.js';

import { 
  ProviderManager, 
  NOVA_SYSTEM_PROMPT,
  type ProviderManagerConfig 
} from '../providers/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// SWORDGATE IMPORTS — Phase 13 Integration
// ─────────────────────────────────────────────────────────────────────────────────

import { SwordGate, type SwordGateOutput } from '../gates/sword/index.js';
import type { IRefinementStore, RefinementState } from '../services/spark-engine/store/types.js';
import type { UserId, Timestamp } from '../types/branded.js';
import { createUserId, createTimestamp } from '../types/branded.js';
import { ok, err, type AsyncAppResult } from '../types/result.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

const MAX_REGENERATIONS = 2;
const PIPELINE_TIMEOUT_MS = 30000;

// ─────────────────────────────────────────────────────────────────────────────────
// IN-MEMORY REFINEMENT STORE — Lightweight store for SwordGate
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Simple in-memory refinement store for SwordGate.
 * For production, replace with Redis-backed RefinementStore.
 */
class InMemoryRefinementStore implements IRefinementStore {
  private states = new Map<string, RefinementState>();

  async save(state: RefinementState): AsyncAppResult<RefinementState> {
    this.states.set(state.userId, state);
    return ok(state);
  }

  async get(userId: UserId): AsyncAppResult<RefinementState | null> {
    const state = this.states.get(userId) ?? null;
    
    // Check expiration
    if (state && new Date(state.expiresAt).getTime() < Date.now()) {
      this.states.delete(userId);
      return ok(null);
    }
    
    return ok(state);
  }

  async delete(userId: UserId): AsyncAppResult<boolean> {
    const existed = this.states.has(userId);
    this.states.delete(userId);
    return ok(existed);
  }

  async update(
    userId: UserId,
    updates: Partial<RefinementState>
  ): AsyncAppResult<RefinementState> {
    const existing = this.states.get(userId);
    if (!existing) {
      return err({
        code: 'NOT_FOUND',
        message: 'No refinement state found for user',
      });
    }
    
    const updated: RefinementState = {
      ...existing,
      ...updates,
      updatedAt: createTimestamp(),
    };
    this.states.set(userId, updated);
    return ok(updated);
  }

  async advanceStage(userId: UserId): AsyncAppResult<RefinementState> {
    const existing = this.states.get(userId);
    if (!existing) {
      return err({
        code: 'NOT_FOUND',
        message: 'No refinement state found for user',
      });
    }
    
    const stageOrder: RefinementState['stage'][] = ['initial', 'clarifying', 'confirming', 'complete'];
    const currentIndex = stageOrder.indexOf(existing.stage);
    const nextStage = stageOrder[currentIndex + 1] ?? 'complete';
    
    return this.update(userId, { stage: nextStage });
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// PIPELINE CONFIG
// ─────────────────────────────────────────────────────────────────────────────────

export interface PipelineConfig extends ProviderManagerConfig {
  useMockProvider?: boolean;
  systemPrompt?: string;
  enableLensSearch?: boolean;
  enableSwordGate?: boolean;  // ← NEW: Option to enable/disable SwordGate
}

// ─────────────────────────────────────────────────────────────────────────────────
// PIPELINE CLASS
// ─────────────────────────────────────────────────────────────────────────────────

export class ExecutionPipeline {
  private providerManager: ProviderManager | null = null;
  private useMock: boolean;
  private systemPrompt: string;
  private enableLensSearch: boolean;
  private enableSwordGate: boolean;
  
  // SwordGate components (lazy initialized)
  private swordGate: SwordGate | null = null;
  private refinementStore: IRefinementStore | null = null;

  constructor(config: PipelineConfig = {}) {
    this.systemPrompt = config.systemPrompt ?? NOVA_SYSTEM_PROMPT;
    this.enableLensSearch = config.enableLensSearch ?? true;
    this.enableSwordGate = config.enableSwordGate ?? true;  // ← Enabled by default
    
    // Determine mock mode
    const hasConfigKeys = !!(config.openaiApiKey || config.geminiApiKey);
    
    if (config.useMockProvider !== undefined) {
      this.useMock = config.useMockProvider;
    } else if (hasConfigKeys) {
      this.useMock = false;
    } else {
      this.useMock = true;
    }

    // Initialize provider manager if not using mock
    if (!this.useMock) {
      this.providerManager = new ProviderManager({
        openaiApiKey: config.openaiApiKey,
        geminiApiKey: config.geminiApiKey,
        preferredProvider: config.preferredProvider,
        enableFallback: config.enableFallback ?? true,
      });
    }
  }

  /**
   * Lazy initialization of SwordGate.
   * Creates the gate on first use to avoid initialization overhead.
   */
  private getSwordGate(): SwordGate {
    if (!this.swordGate) {
      // Create in-memory refinement store
      this.refinementStore = new InMemoryRefinementStore();
      
      // Initialize SwordGate
      this.swordGate = new SwordGate(
        this.refinementStore,
        {
          useLlmModeDetection: !this.useMock && !!process.env.OPENAI_API_KEY,
        },
        {
          openaiApiKey: process.env.OPENAI_API_KEY,
          // sparkEngine and rateLimiter can be added later for full functionality
        }
      );
      
      console.log('[PIPELINE] SwordGate initialized');
    }
    return this.swordGate;
  }

  /**
   * Check if user has an active refinement session.
   * This is used to route follow-up messages back to SwordGate
   * even if they don't match the initial learning intent pattern.
   */
  private async checkActiveRefinement(userId: string): Promise<boolean> {
    // Ensure refinement store is initialized
    if (!this.refinementStore) {
      // Initialize lazily if needed
      this.refinementStore = new InMemoryRefinementStore();
    }
    
    try {
      const result = await this.refinementStore.get(userId as UserId);
      const hasActive = result.ok && result.value !== null;
      
      if (hasActive) {
        console.log(`[PIPELINE] Active refinement found for user ${userId}, stage: ${result.value?.stage}`);
      }
      
      return hasActive;
    } catch (error) {
      console.error('[PIPELINE] Error checking refinement state:', error);
      return false;
    }
  }

  async execute(
    userMessage: string,
    context: PipelineContext
  ): Promise<PipelineResult> {
    const pipelineStart = Date.now();
    const requestId = context.requestId ?? crypto.randomUUID();

    // Initialize state
    const state: PipelineState = {
      userMessage,
      normalizedInput: userMessage.trim(),
      gateResults: {} as GateResults,
      flags: {},
      timestamps: {
        pipelineStart: Date.now(),
      },
    };

    try {
      return await this.executePipeline(state, { ...context, requestId });
    } catch (error) {
      console.error('[PIPELINE] Error:', error);
      return {
        status: 'error',
        response: 'An error occurred processing your request. Please try again.',
        stance: 'shield',
        gateResults: state.gateResults,
        metadata: {
          requestId,
          totalTimeMs: Date.now() - pipelineStart,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  private async executePipeline(
    state: PipelineState,
    context: PipelineContext
  ): Promise<PipelineResult> {
    const pipelineStart = state.timestamps.pipelineStart;

    // ─── STAGE 1: INTENT (ASYNC - LLM POWERED) ───
    state.gateResults.intent = await executeIntentGateAsync(state, context);
    state.intent = state.gateResults.intent.output;

    // ─── STAGE 2: SHIELD (ASYNC - LLM POWERED) ───
    state.gateResults.shield = await executeShieldGate(state, context);
    state.shieldResult = state.gateResults.shield.output;

    // Check for hard veto (stop immediately)
    if (state.gateResults.shield.action === 'stop') {
      state.stance = state.shieldResult.controlMode ? 'control' : 'shield';
      return {
        status: 'stopped',
        response: state.shieldResult.message ?? 'Request cannot be processed.',
        stance: state.stance,
        gateResults: state.gateResults,
        metadata: {
          requestId: context.requestId,
          totalTimeMs: Date.now() - pipelineStart,
        },
      };
    }

    // Check for soft veto (await acknowledgment)
    if (state.gateResults.shield.action === 'await_ack') {
      if (context.ackTokenValid) {
        state.flags.ackTokenValid = true;
      } else {
        state.stance = 'shield';
        return {
          status: 'await_ack',
          response: state.shieldResult.message ?? 'Acknowledgment required.',
          stance: 'shield',
          gateResults: state.gateResults,
          ackToken: state.shieldResult.ackToken,
          ackMessage: 'Please acknowledge to proceed with this high-stakes request.',
          metadata: {
            requestId: context.requestId,
            totalTimeMs: Date.now() - pipelineStart,
          },
        };
      }
    }

    // ─── STAGE 3: LENS (ASYNC - LLM POWERED WITH TIERED VERIFICATION) ───
    const shouldUseAsyncLens = !this.useMock && 
                               this.providerManager !== null &&
                               !!process.env.OPENAI_API_KEY && 
                               this.enableLensSearch !== false;
    
    if (shouldUseAsyncLens) {
      try {
        state.gateResults.lens = await executeLensGateAsync(state, context, {
          enableSearch: this.enableLensSearch,
          userTimezone: context.timezone,
        });
        state.lensResult = state.gateResults.lens.output;
      } catch (lensError) {
        console.error('[PIPELINE] Lens gate error, falling back to sync:', lensError);
        state.gateResults.lens = executeLensGate(state, context);
        state.lensResult = state.gateResults.lens.output;
      }
    } else {
      state.gateResults.lens = executeLensGate(state, context);
      state.lensResult = state.gateResults.lens.output;
    }

    // ─── STAGE 4: STANCE ───
    state.gateResults.stance = executeStanceGate(state, context);
    state.stance = state.gateResults.stance.output.stance;

    // ─── STAGE 5: CAPABILITY ───
    state.gateResults.capability = executeCapabilityGate(state, context);
    state.capabilities = state.gateResults.capability.output;

    // ═══════════════════════════════════════════════════════════════════════════
    // STAGE 5.5: SWORDGATE — Goal Creation Flow (Phase 13)
    // ═══════════════════════════════════════════════════════════════════════════
    //
    // Route to SwordGate if:
    //   1. User has an ACTIVE refinement session (multi-turn flow), OR
    //   2. This is a NEW learning intent (stance=sword + domain=education)
    //
    // This ensures follow-up messages like "i am new" or "beginner" are
    // routed back to SwordGate even if they don't match the education intent.
    //
    // SwordGate handles: capture → refine → suggest → create
    // If suppressModelGeneration is true, return SwordGate's response directly.
    //
    // ═══════════════════════════════════════════════════════════════════════════
    
    // Check 1: Does user have an ACTIVE refinement session?
    const hasActiveRefinement = context.userId 
      ? await this.checkActiveRefinement(context.userId)
      : false;
    
    // Check 2: Is this a NEW learning intent?
    const isLearningIntent = 
      state.intent?.primaryDomain === 'education' &&
      (state.intent?.type === 'action' || state.intent?.type === 'planning');
    
    // Route to SwordGate if EITHER condition is true
    const shouldUseSwordGate = 
      this.enableSwordGate &&
      context.userId &&
      (hasActiveRefinement || (state.stance === 'sword' && isLearningIntent));
    
    if (shouldUseSwordGate) {
      try {
        const routeReason = hasActiveRefinement 
          ? 'active refinement session' 
          : 'education + action intent';
        console.log(`[PIPELINE] Routing to SwordGate (${routeReason})`);
        
        // Build a compatible state object for SwordGate
        // SwordGate expects a different PipelineState type with state.input
        const swordCompatibleState = {
          ...state,
          input: {
            userId: context.userId,
            message: state.userMessage,
            sessionId: context.sessionId,
          },
          // SwordGate's PipelineState also expects these fields
          regenerationCount: 0,
          degraded: false,
        };
        
        const swordGate = this.getSwordGate();
        // Cast to any to bridge the two different PipelineState types
        const swordResult = await swordGate.execute(swordCompatibleState as any, context as any);
        
        const swordOutput = swordResult.output as SwordGateOutput;
        
        // If SwordGate wants to handle the response directly, return early
        if (swordOutput.suppressModelGeneration && swordOutput.responseMessage) {
          console.log(`[PIPELINE] SwordGate mode: ${swordOutput.mode}, suppressing LLM`);
          
          // Convert SwordGateOutput to SparkResult for type compatibility
          state.gateResults.spark = {
            gateId: 'spark',
            status: swordResult.status,
            output: {
              eligible: true,
              spark: swordOutput.createdGoal ? {
                action: swordOutput.responseMessage,
                rationale: `Goal creation via SwordGate: ${swordOutput.mode}`,
                category: 'immediate' as const,
              } : undefined,
            },
            action: swordResult.action,
            executionTimeMs: swordResult.executionTimeMs,
          };
          
          return {
            status: 'success',
            response: swordOutput.responseMessage,
            stance: 'sword',
            gateResults: state.gateResults,
            metadata: {
              requestId: context.requestId,
              totalTimeMs: Date.now() - pipelineStart,
              // Note: swordMode and refinementProgress stored in gateResults.spark
            },
          };
        }
        
        // Store a compatible spark result for passthrough case
        state.gateResults.spark = {
          gateId: 'spark',
          status: 'pass',
          output: {
            eligible: false,
            ineligibilityReason: 'sword_gate_passthrough',
          },
          action: 'continue',
          executionTimeMs: swordResult.executionTimeMs,
        };
        
        // Continue with normal LLM generation
        console.log(`[PIPELINE] SwordGate mode: ${swordOutput.mode}, continuing to LLM`);
        
      } catch (swordError) {
        console.error('[PIPELINE] SwordGate error, falling back to normal flow:', swordError);
        // Continue with normal spark gate on error
      }
    }

    // ─── STAGE 6-7: GENERATION LOOP ───
    let regenerationCount = 0;

    // ─── INJECT LENS EVIDENCE INTO PROMPT ───
    let augmentedMessage = state.userMessage;
    const lensResult = state.lensResult as any;
    
    let evidenceContext = '';
    let errorContext = '';
    
    // Structure 1: Direct fetchResults from orchestrator
    if (lensResult?.fetchResults?.length > 0) {
      const successfulFetches = lensResult.fetchResults.filter((f: any) => f.result?.ok);
      const failedFetches = lensResult.fetchResults.filter((f: any) => f.result && !f.result.ok);
      
      if (successfulFetches.length > 0) {
        const evidenceLines = successfulFetches.map((fetch: any) => {
          const data = fetch.result.data;
          if (!data) return null;
          
          if (data.type === 'stock') {
            const price = data.price ?? 0;
            const change = data.change ?? 0;
            const changePercent = data.changePercent ?? 0;
            const dayLow = data.dayLow ?? 0;
            const dayHigh = data.dayHigh ?? 0;
            const prevClose = data.previousClose ?? 0;
            return `LIVE STOCK DATA for ${data.symbol}:\n` +
                   `• Current Price: $${price.toFixed(2)} ${data.currency || 'USD'}\n` +
                   `• Change: ${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%)\n` +
                   `• Day Range: $${dayLow.toFixed(2)} - $${dayHigh.toFixed(2)}\n` +
                   `• Previous Close: $${prevClose.toFixed(2)}\n` +
                   `• Exchange: ${data.exchange || 'Unknown'}\n` +
                   `• Data Source: ${fetch.result.provider} (fetched just now)`;
          } else if (data.type === 'weather') {
            const tempF = data.temperatureFahrenheit ?? data.temperature ?? 0;
            const tempC = data.temperatureCelsius ?? 0;
            const feelsLikeF = data.feelsLikeFahrenheit ?? 0;
            const condition = data.condition ?? data.conditions ?? 'Unknown';
            const humidity = data.humidity ?? 0;
            const windMph = data.windSpeedMph ?? 0;
            const windDir = data.windDirection ?? '';
            return `LIVE WEATHER DATA for ${data.location}:\n` +
                   `• Temperature: ${tempF}°F (${tempC}°C)\n` +
                   `• Feels Like: ${feelsLikeF}°F\n` +
                   `• Conditions: ${condition}\n` +
                   `• Humidity: ${humidity}%\n` +
                   `• Wind: ${windMph} mph ${windDir}\n` +
                   `• Data Source: ${fetch.result.provider}`;
          } else if (data.type === 'crypto') {
            const price = data.priceUsd ?? data.price ?? 0;
            const change = data.change24h ?? data.changePercent24h ?? 0;
            const marketCap = data.marketCapUsd ?? data.marketCap ?? 0;
            return `LIVE CRYPTO DATA for ${data.symbol} (${data.name || data.symbol}):\n` +
                   `• Current Price: $${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
                   `• 24h Change: ${change >= 0 ? '+' : ''}${change.toFixed(2)}%\n` +
                   `• Market Cap: $${(marketCap / 1e9).toFixed(2)}B\n` +
                   `• Data Source: ${fetch.result.provider}`;
          } else if (data.type === 'fx') {
            const fromCurrency = data.baseCurrency ?? data.from ?? '???';
            const toCurrency = data.quoteCurrency ?? data.to ?? '???';
            const rate = data.rate ?? 0;
            return `LIVE EXCHANGE RATE:\n` +
                   `• ${fromCurrency}/${toCurrency}: ${rate.toFixed(4)}\n` +
                   `• 1 ${fromCurrency} = ${rate.toFixed(4)} ${toCurrency}\n` +
                   `• Data Source: ${fetch.result.provider}`;
          } else if (data.type === 'time') {
            const timezone = data.timezone ?? data.location ?? 'Unknown';
            const localTime = data.localTime ?? data.time ?? data.formatted ?? 'Unknown';
            const abbr = data.abbreviation ?? '';
            
            let formattedTime = localTime;
            let datePart = '';
            try {
              const parts = localTime.split(' ');
              datePart = parts[0] || '';
              const timePart = parts[1] || localTime;
              const [hours, minutes] = timePart.split(':').map(Number);
              const period = hours >= 12 ? 'PM' : 'AM';
              const hour12 = hours % 12 || 12;
              formattedTime = `${hour12}:${String(minutes).padStart(2, '0')} ${period}`;
            } catch {
              // Keep original if parsing fails
            }
            
            const isLocalTime = timezone === 'America/Los_Angeles' || abbr === 'PST' || abbr === 'PDT';
            const locationName = timezone.split('/')[1]?.replace('_', ' ') || timezone;
            
            if (isLocalTime) {
              return `===== ANSWER THIS QUESTION ONLY =====\n` +
                     `The user asked for the CURRENT TIME (their local time).\n` +
                     `ANSWER: The current time is ${formattedTime}.\n` +
                     `DO NOT mention any other timezone from earlier in the conversation.\n` +
                     `DO NOT calculate or convert times. Just state the current local time.\n` +
                     `===================================`;
            } else {
              return `===== ANSWER THIS QUESTION ONLY =====\n` +
                     `The user asked for the time in ${locationName}.\n` +
                     `ANSWER: The current time in ${locationName} is ${formattedTime}.\n` +
                     `DO NOT reference any other timezones or previous questions.\n` +
                     `===================================`;
            }
          }
          
          return `LIVE DATA:\n${JSON.stringify(data, null, 2)}`;
        }).filter(Boolean);
        
        if (evidenceLines.length > 0) {
          evidenceContext = evidenceLines.join('\n\n');
        }
      }
      
      if (failedFetches.length > 0) {
        const errorMessages = failedFetches
          .filter((f: any) => f.result?.error?.message)
          .map((f: any) => f.result.error.message);
        
        if (errorMessages.length > 0) {
          errorContext = errorMessages.join('\n');
        }
      }
    }
    
    // Structure 2: evidencePack.items (legacy format)
    else if (lensResult?.evidencePack?.items?.length > 0) {
      const evidenceItems = lensResult.evidencePack.items;
      const evidenceLines = evidenceItems
        .slice(0, 5)
        .map((item: any, i: number) => {
          const content = item.excerpt || item.snippet || '';
          if (!content || content.length < 10) return null;
          return `[Source ${i + 1}: ${item.title || item.url}]\n${content}`;
        })
        .filter(Boolean);
      
      if (evidenceLines.length > 0) {
        evidenceContext = evidenceLines.join('\n\n');
      }
    }
    
    // Structure 3: evidence.formattedContext (alternative format)
    else if (lensResult?.evidence?.formattedContext) {
      evidenceContext = lensResult.evidence.formattedContext;
    }
    
    // Inject evidence into the prompt if we have any
    if (evidenceContext) {
      augmentedMessage = `IMPORTANT INSTRUCTION: You have access to LIVE, REAL-TIME data that was just retrieved. You MUST use this data to answer the user's question. Do NOT say you cannot provide real-time information - the verified data is provided below.

===== VERIFIED LIVE DATA =====
${evidenceContext}
===== END LIVE DATA =====

USER QUESTION: ${state.userMessage}

Remember: Use the live data above to give a specific, accurate answer. Include the actual numbers from the data.`;
    }
    // If no evidence but we have error context (like typo suggestions), inject that
    else if (errorContext) {
      augmentedMessage = `IMPORTANT: The data lookup encountered an issue. Please relay this message to the user:

===== DATA LOOKUP ERROR =====
${errorContext}
===== END ERROR =====

USER QUESTION: ${state.userMessage}

Relay the error message above to help the user. If there's a suggestion (like "Did you mean..."), include that in your response.`;
    }

    while (regenerationCount <= MAX_REGENERATIONS) {
      // ─── STAGE 6: MODEL ───
      if (this.useMock || !this.providerManager) {
        state.gateResults.model = executeModelGate(state, context);
      } else {
        state.gateResults.model = await executeModelGateAsync(
          state,
          context,
          (prompt, systemPrompt, constraints) => 
            this.providerManager!.generate(augmentedMessage, systemPrompt, constraints, {
              conversationHistory: context.conversationHistory ? [...context.conversationHistory] : undefined,
            }),
          this.systemPrompt
        );
      }
      state.generation = state.gateResults.model.output;

      // ─── STAGE 7: PERSONALITY ───
      state.gateResults.personality = executePersonalityGate(state, context);
      state.validatedOutput = state.gateResults.personality.output;

      // Check if regeneration needed
      if (
        state.gateResults.personality.action === 'regenerate' &&
        regenerationCount < MAX_REGENERATIONS
      ) {
        regenerationCount++;
        state.flags.regenerationAttempt = regenerationCount;
        continue;
      }

      break;
    }

    // ─── STAGE 8: SPARK (only if not already handled by SwordGate) ───
    if (!state.gateResults.spark) {
      state.gateResults.spark = executeSparkGate(state, context);
      if (state.gateResults.spark.output.spark) {
        state.spark = state.gateResults.spark.output.spark;
      }
    }

    // ─── BUILD FINAL RESPONSE ───
    const finalText = state.validatedOutput?.text ?? state.generation?.text ?? '';

    // Check degradation
    if (state.lensResult?.status === 'degraded') {
      return {
        status: 'degraded',
        response: finalText,
        stance: state.stance,
        gateResults: state.gateResults,
        spark: state.spark,
        metadata: {
          requestId: context.requestId,
          totalTimeMs: Date.now() - pipelineStart,
          regenerations: regenerationCount,
          degradationReason: state.lensResult.message 
            ?? `Unverified ${state.lensResult.domain ?? 'information'}`,
        },
      };
    }

    return {
      status: 'success',
      response: finalText,
      stance: state.stance,
      gateResults: state.gateResults,
      spark: state.spark,
      metadata: {
        requestId: context.requestId,
        totalTimeMs: Date.now() - pipelineStart,
        regenerations: regenerationCount,
      },
    };
  }

  getAvailableProviders(): string[] {
    return this.providerManager?.getAvailableProviders() ?? ['mock'];
  }
}
