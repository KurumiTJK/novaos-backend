// ═══════════════════════════════════════════════════════════════════════════════
// API ROUTES — Express Endpoints for NovaOS
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ExecutionPipeline, type PipelineConfig } from '../pipeline/execution-pipeline.js';
import type { PipelineContext, ActionSource } from '../types/index.js';
import { storeManager } from '../storage/index.js';
import {
  auth,
  type AuthenticatedRequest,
  trackVeto,
  getRecentVetoCount,
} from '../auth/index.js';
import { conversations } from '../conversations/index.js';
import { getWebObserver } from '../services/web/index.js';
import { loadConfig, canVerify } from '../config/index.js';
import {
  getSwordStore,
  getSparkGenerator,
  type GoalEvent,
  type QuestEvent,
  type StepEvent,
  type SparkEvent,
} from '../core/sword/index.js';
import {
  getMemoryStore,
  getMemoryExtractor,
  getMemoryRetriever,
  type MemoryCategory,
  type CreateMemoryRequest,
  type UpdateMemoryRequest,
} from '../core/memory/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// REQUEST SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────────

const ChatRequestSchema = z.object({
  message: z.string().min(1).max(100000),
  conversationId: z.string().optional(),
  ackToken: z.string().optional(),
  context: z.object({
    timezone: z.string().optional(),
    locale: z.string().optional(),
  }).optional(),
});

const ParseCommandRequestSchema = z.object({
  command: z.string().min(1).max(10000),
  source: z.enum(['ui_button', 'command_parser', 'api_field']),
  conversationId: z.string().optional(),
});

const RegisterRequestSchema = z.object({
  email: z.string().email(),
  tier: z.enum(['free', 'pro', 'enterprise']).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────────
// ERROR CLASS
// ─────────────────────────────────────────────────────────────────────────────────

export class ClientError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'ClientError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// ROUTER CONFIG
// ─────────────────────────────────────────────────────────────────────────────────

export interface RouterConfig extends PipelineConfig {
  requireAuth?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────
// ROUTER FACTORY
// ─────────────────────────────────────────────────────────────────────────────────

export function createRouter(config: RouterConfig = {}): Router {
  const router = Router();
  const pipeline = new ExecutionPipeline(config);
  const requireAuth = config.requireAuth ?? false;

  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLIC ENDPOINTS (no auth)
  // ─────────────────────────────────────────────────────────────────────────────

  router.get('/health', (_req: Request, res: Response) => {
    const config = loadConfig();
    res.json({
      status: 'healthy',
      version: '10.0.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      storage: storeManager.isUsingRedis() ? 'redis' : 'memory',
      verification: canVerify() ? 'enabled' : 'disabled',
    });
  });

  router.get('/version', (_req: Request, res: Response) => {
    const config = loadConfig();
    res.json({
      api: '10.0.0',
      constitution: '1.2',
      gates: ['intent', 'shield', 'lens', 'stance', 'capability', 'model', 'personality', 'spark'],
      features: [
        'auth',
        'rate-limiting',
        'abuse-detection',
        'redis-persistence',
        'audit-logging',
        'conversation-history',
        'structured-logging',
        'sword-path-spark',
        'memory-system',
        'pipeline-integration',
        config.features.verificationEnabled ? 'verification' : null,
        config.features.webFetchEnabled ? 'web-fetch' : null,
      ].filter(Boolean),
    });
  });

  router.get('/providers', (_req: Request, res: Response) => {
    res.json({
      available: pipeline.getAvailableProviders(),
      preferred: config.preferredProvider ?? 'openai',
      useMock: config.useMockProvider ?? false,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // AUTH ENDPOINTS
  // ─────────────────────────────────────────────────────────────────────────────

  // Register/get token (simplified - production would use proper auth)
  router.post('/auth/register', (req: Request, res: Response, next: NextFunction) => {
    try {
      const parseResult = RegisterRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ClientError(
          `Invalid request: ${parseResult.error.issues.map(i => i.message).join(', ')}`
        );
      }

      const { email, tier = 'free' } = parseResult.data;
      const userId = `user_${Buffer.from(email).toString('base64').slice(0, 16)}`;

      const token = auth.generateToken({ userId, email, tier });
      const apiKey = auth.generateApiKey(userId, tier);

      res.json({
        userId,
        token,
        apiKey,
        tier,
        expiresIn: '24h',
      });
    } catch (error) {
      next(error);
    }
  });

  // Verify token
  router.get('/auth/verify', auth.middleware(true), (req: AuthenticatedRequest, res: Response) => {
    res.json({
      valid: true,
      user: req.user,
    });
  });

  // Get current user status
  router.get('/auth/status', auth.middleware(false), async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId ?? 'anonymous';
    const blocked = await auth.isUserBlocked(userId);
    const recentVetos = await getRecentVetoCount(userId);

    res.json({
      authenticated: !!req.user && req.userId !== 'anonymous',
      userId,
      tier: req.user?.tier ?? 'free',
      blocked: blocked.blocked,
      blockedReason: blocked.reason,
      blockedUntil: blocked.until,
      recentVetos,
      storage: storeManager.isUsingRedis() ? 'redis' : 'memory',
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PROTECTED ENDPOINTS
  // ─────────────────────────────────────────────────────────────────────────────

  // Apply auth, rate limiting, and abuse detection to chat endpoints
  const protectedMiddleware = [
    auth.middleware(requireAuth),
    auth.rateLimit(),
    auth.abuseDetection(),
  ];

  // ─────────────────────────────────────────────────────────────────────────────
  // CHAT ENDPOINT
  // ─────────────────────────────────────────────────────────────────────────────

  router.post('/chat', ...protectedMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      // Validate request
      const parseResult = ChatRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ClientError(
          `Invalid request: ${parseResult.error.issues.map(i => i.message).join(', ')}`
        );
      }

      const { message, conversationId, ackToken, context: reqContext } = parseResult.data;
      const userId = req.userId ?? 'anonymous';
      const requestId = crypto.randomUUID();

      // Get or create conversation and session
      const convId = conversationId ?? crypto.randomUUID();
      const conversation = await conversations.getOrCreate(userId, convId);
      
      let session = await auth.session.get(convId);
      if (!session) {
        session = await auth.session.create(userId, convId);
      }

      // Store user message
      await conversations.addUserMessage(convId, message);

      // Build context from conversation history
      const contextWindow = await conversations.buildContext(convId);

      // Build pipeline context
      const pipelineContext: PipelineContext = {
        userId,
        conversationId: convId,
        requestId,
        timestamp: Date.now(),
        actionSources: [],
        timezone: reqContext?.timezone,
        locale: reqContext?.locale,
        conversationHistory: contextWindow.messages.slice(0, -1).map(m => ({
          role: m.role,
          content: m.content,
        })),
      };

      // Validate ack token if provided
      if (ackToken) {
        const valid = await auth.ackTokens.validate(ackToken, userId);
        if (valid) {
          pipelineContext.ackTokenValid = true;
        } else {
          throw new ClientError('Invalid or expired acknowledgment token');
        }
      }

      // Execute pipeline
      const result = await pipeline.execute(message, pipelineContext);

      // Store assistant message (if response generated)
      if (result.response) {
        await conversations.addAssistantMessage(convId, result.response, {
          stance: result.stance,
          status: result.status,
          tokensUsed: result.gateResults.model?.output?.tokensUsed,
        });
      }

      // Track veto if shield stopped or awaited
      if (result.status === 'stopped' || result.status === 'await_ack') {
        await trackVeto(userId);
      }

      // Update session
      await auth.session.update(convId, {
        messageCount: 1,
        tokenCount: result.gateResults.model?.output?.tokensUsed ?? 0,
      });

      // Track token usage
      if (result.gateResults.model?.output?.tokensUsed) {
        await auth.trackTokenUsage(userId, result.gateResults.model.output.tokensUsed);
      }

      // Store ack token if returned
      if (result.ackToken) {
        await auth.ackTokens.store(result.ackToken, userId);
      }

      // Audit log
      await auth.audit.log({
        userId,
        action: 'chat',
        requestId,
        stance: result.stance,
        status: result.status,
        details: {
          messageLength: message.length,
          tokensUsed: result.gateResults.model?.output?.tokensUsed,
          contextTruncated: contextWindow.truncated,
        },
      });

      // Get updated conversation info
      const updatedConv = await conversations.get(convId);

      // Include conversation info in response
      res.json({
        ...result,
        conversation: {
          id: convId,
          title: updatedConv?.title ?? conversation.title,
          messageCount: updatedConv?.messageCount ?? conversation.messageCount + 2,
          contextTruncated: contextWindow.truncated,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // ENHANCED CHAT ENDPOINT (with Memory + Sword integration)
  // ─────────────────────────────────────────────────────────────────────────────

  router.post('/chat/enhanced', ...protectedMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const parseResult = ChatRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ClientError(
          `Invalid request: ${parseResult.error.issues.map(i => i.message).join(', ')}`
        );
      }

      const { message, conversationId, context: reqContext } = parseResult.data;
      const userId = req.userId ?? 'anonymous';
      const requestId = crypto.randomUUID();

      // Import enhanced pipeline dynamically to avoid circular deps
      const { createEnhancedPipeline } = await import('../pipeline/enhanced-pipeline.js');
      const enhancedPipeline = createEnhancedPipeline({
        enableMemory: true,
        enableSword: true,
        enableAutoExtract: true,
        enableSparkSuggestions: true,
      });

      // Execute enhanced pipeline
      const result = await enhancedPipeline.execute(message, {
        userId,
        conversationId,
        requestId,
        timestamp: Date.now(),
        actionSources: [],
        timezone: reqContext?.timezone,
        locale: reqContext?.locale,
      });

      // Track veto if shield stopped
      if (result.status === 'stopped' || result.status === 'await_ack') {
        await trackVeto(userId);
      }

      // Track token usage
      if (result.gateResults.model?.output?.tokensUsed) {
        await auth.trackTokenUsage(userId, result.gateResults.model.output.tokensUsed);
      }

      // Audit log
      await auth.audit.log({
        userId,
        action: 'chat_enhanced',
        requestId,
        stance: result.stance,
        status: result.status,
        details: {
          messageLength: message.length,
          tokensUsed: result.gateResults.model?.output?.tokensUsed,
          memoriesExtracted: result.hooks?.post.memoriesExtracted,
          sparkSuggested: !!result.sparkSuggested,
        },
      });

      res.json({
        status: result.status,
        response: result.response,
        stance: result.stance,
        conversationId: result.conversationId,
        metadata: result.metadata,
        
        // Enhanced features
        context: {
          userName: result.context?.user.profile?.name,
          activeGoals: result.context?.sword.activeGoals.map(g => ({
            title: g.title,
            progress: g.progress,
          })),
          currentSpark: result.context?.sword.currentSpark ? {
            action: result.context.sword.currentSpark.action,
            status: result.context.sword.currentSpark.status,
          } : null,
        },
        
        // Spark suggestion if any
        sparkSuggested: result.sparkSuggested,
        
        // Post-processing results
        processing: {
          memoriesExtracted: result.hooks?.post.memoriesExtracted ?? 0,
          profileUpdated: result.hooks?.post.profileUpdated ?? false,
          goalProgressUpdated: result.hooks?.post.goalProgressUpdated ?? false,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // CONTEXT PREVIEW ENDPOINT
  // ─────────────────────────────────────────────────────────────────────────────

  router.get('/context', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { getContextBuilder } = await import('../core/context/index.js');
      const builder = getContextBuilder();
      
      const conversationId = req.query.conversationId as string | undefined;
      const context = await builder.build(req.userId!, conversationId ?? null, '');
      const formatted = builder.formatForLLM(context);
      
      res.json({
        context,
        formatted,
      });
    } catch (error) {
      next(error);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PARSE COMMAND ENDPOINT
  // ─────────────────────────────────────────────────────────────────────────────

  router.post('/parse-command', ...protectedMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const parseResult = ParseCommandRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ClientError(
          `Invalid request: ${parseResult.error.issues.map(i => i.message).join(', ')}`
        );
      }

      const { command, source, conversationId } = parseResult.data;

      const actionSource: ActionSource = {
        type: source,
        action: command,
        timestamp: Date.now(),
      };

      const pipelineContext: PipelineContext = {
        userId: req.userId ?? 'anonymous',
        conversationId: conversationId ?? crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        timestamp: Date.now(),
        actionSources: [actionSource],
      };

      const result = await pipeline.execute(command, pipelineContext);

      res.json({
        ...result,
        parsedAction: actionSource,
      });
    } catch (error) {
      next(error);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // CONVERSATION ENDPOINTS
  // ─────────────────────────────────────────────────────────────────────────────

  // List user's conversations
  router.get('/conversations', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { limit = 20, offset = 0 } = req.query;
      const userId = req.userId!;

      const convList = await conversations.list(userId, Number(limit), Number(offset));

      res.json({
        conversations: convList,
        count: convList.length,
        offset: Number(offset),
      });
    } catch (error) {
      next(error);
    }
  });

  // Get single conversation with messages
  router.get('/conversations/:id', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const { messagesLimit = 100 } = req.query;

      const conversation = await conversations.get(id);
      if (!conversation) {
        throw new ClientError('Conversation not found', 404);
      }

      // Verify ownership
      if (conversation.userId !== req.userId) {
        throw new ClientError('Conversation not found', 404);
      }

      const messages = await conversations.getMessages(id, Number(messagesLimit));

      res.json({
        ...conversation,
        messages,
      });
    } catch (error) {
      next(error);
    }
  });

  // Get conversation messages only
  router.get('/conversations/:id/messages', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const { limit = 100, offset = 0 } = req.query;

      const conversation = await conversations.get(id);
      if (!conversation || conversation.userId !== req.userId) {
        throw new ClientError('Conversation not found', 404);
      }

      const messages = await conversations.getMessages(id, Number(limit));

      res.json({
        conversationId: id,
        messages: messages.slice(Number(offset)),
        count: messages.length,
      });
    } catch (error) {
      next(error);
    }
  });

  // Update conversation (title, tags)
  router.patch('/conversations/:id', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const { title, tags } = req.body;

      const conversation = await conversations.get(id);
      if (!conversation || conversation.userId !== req.userId) {
        throw new ClientError('Conversation not found', 404);
      }

      let updated = conversation;
      if (title) {
        updated = await conversations.updateTitle(id, title) ?? conversation;
      }
      if (tags && Array.isArray(tags)) {
        for (const tag of tags) {
          updated = await conversations.addTag(id, tag as string) ?? updated;
        }
      }

      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  // Delete conversation
  router.delete('/conversations/:id', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;

      const conversation = await conversations.get(id);
      if (!conversation || conversation.userId !== req.userId) {
        throw new ClientError('Conversation not found', 404);
      }

      await conversations.delete(id);

      await auth.audit.log({
        userId: req.userId!,
        action: 'delete_conversation',
        details: { conversationId: id },
      });

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // WEB/VERIFICATION METRICS
  // ─────────────────────────────────────────────────────────────────────────────

  router.get('/metrics/web', auth.middleware(true), async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const observer = getWebObserver();
      const metrics = observer.getMetrics();
      
      res.json({
        metrics,
        recentEvents: observer.getRecentEvents(20),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/config', auth.middleware(true), async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const config = loadConfig();
      
      // Return safe subset of config (no secrets)
      res.json({
        environment: config.env.environment,
        features: {
          verificationEnabled: config.features.verificationEnabled,
          webFetchEnabled: config.features.webFetchEnabled,
          authRequired: config.features.authRequired,
          debugMode: config.features.debugMode,
          redactPII: config.features.redactPII,
        },
        verification: {
          enabled: config.verification.enabled,
          required: config.verification.required,
          cacheTTLSeconds: config.verification.cacheTTLSeconds,
          maxVerificationsPerRequest: config.verification.maxVerificationsPerRequest,
        },
        webFetch: {
          maxResponseSizeBytes: config.webFetch.maxResponseSizeBytes,
          maxRedirects: config.webFetch.maxRedirects,
          totalTimeoutMs: config.webFetch.totalTimeoutMs,
          allowlistEnabled: config.webFetch.allowlist.length > 0,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SWORD ENDPOINTS — Goals, Quests, Steps, Sparks (Constitution §2.3)
  // ─────────────────────────────────────────────────────────────────────────────

  const swordStore = getSwordStore();
  const sparkGenerator = getSparkGenerator();

  // ─── GOALS ───

  router.post('/goals', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { title, description, desiredOutcome, interestLevel, targetDate, motivations, constraints, successCriteria, tags } = req.body;
      
      if (!title || !description || !desiredOutcome) {
        throw new ClientError('title, description, and desiredOutcome required');
      }

      const goal = await swordStore.createGoal(req.userId!, {
        title,
        description,
        desiredOutcome,
        interestLevel,
        targetDate,
        motivations,
        constraints,
        successCriteria,
        tags,
      });

      res.status(201).json({ goal });
    } catch (error) {
      next(error);
    }
  });

  router.get('/goals', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const status = req.query.status as string | undefined;
      const goals = await swordStore.getUserGoals(req.userId!, status as any);
      res.json({ goals });
    } catch (error) {
      next(error);
    }
  });

  router.get('/goals/:id', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const goal = await swordStore.getGoal(req.params.id!);
      if (!goal || goal.userId !== req.userId) {
        throw new ClientError('Goal not found', 404);
      }
      
      const quests = await swordStore.getQuestsForGoal(goal.id);
      const path = await swordStore.getPath(goal.id, req.userId!);
      
      res.json({ goal, quests, path });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/goals/:id', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const goal = await swordStore.getGoal(req.params.id!);
      if (!goal || goal.userId !== req.userId) {
        throw new ClientError('Goal not found', 404);
      }

      const { title, description, desiredOutcome, targetDate, motivations, constraints, successCriteria, tags } = req.body;
      
      const updated = await swordStore.updateGoal(req.params.id!, {
        title,
        description,
        desiredOutcome,
        targetDate,
        motivations,
        constraints,
        successCriteria,
        tags,
      });

      res.json({ goal: updated });
    } catch (error) {
      next(error);
    }
  });

  router.post('/goals/:id/transition', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const goal = await swordStore.getGoal(req.params.id!);
      if (!goal || goal.userId !== req.userId) {
        throw new ClientError('Goal not found', 404);
      }

      const event = req.body as GoalEvent;
      if (!event.type) {
        throw new ClientError('event type required');
      }

      const result = await swordStore.transitionGoalState(req.params.id!, event);
      if (!result?.success) {
        throw new ClientError(result?.error ?? 'Transition failed');
      }

      res.json({ goal: result.entity, transition: { from: result.previousStatus, to: result.newStatus } });
    } catch (error) {
      next(error);
    }
  });

  // ─── QUESTS ───

  router.post('/quests', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { goalId, title, description, outcome, priority, estimatedMinutes, targetDate, order } = req.body;
      
      if (!goalId || !title || !description || !outcome) {
        throw new ClientError('goalId, title, description, and outcome required');
      }

      const quest = await swordStore.createQuest(req.userId!, {
        goalId,
        title,
        description,
        outcome,
        priority,
        estimatedMinutes,
        targetDate,
        order,
      });

      if (!quest) {
        throw new ClientError('Goal not found or access denied', 404);
      }

      res.status(201).json({ quest });
    } catch (error) {
      next(error);
    }
  });

  router.get('/quests/:id', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const quest = await swordStore.getQuest(req.params.id!);
      if (!quest || quest.userId !== req.userId) {
        throw new ClientError('Quest not found', 404);
      }
      
      const steps = await swordStore.getStepsForQuest(quest.id);
      
      res.json({ quest, steps });
    } catch (error) {
      next(error);
    }
  });

  router.post('/quests/:id/transition', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const quest = await swordStore.getQuest(req.params.id!);
      if (!quest || quest.userId !== req.userId) {
        throw new ClientError('Quest not found', 404);
      }

      const event = req.body as QuestEvent;
      if (!event.type) {
        throw new ClientError('event type required');
      }

      const result = await swordStore.transitionQuestState(req.params.id!, event);
      if (!result?.success) {
        throw new ClientError(result?.error ?? 'Transition failed');
      }

      res.json({ quest: result.entity, transition: { from: result.previousStatus, to: result.newStatus } });
    } catch (error) {
      next(error);
    }
  });

  // ─── STEPS ───

  router.post('/steps', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { questId, title, description, type, estimatedMinutes, sparkPrompt, verificationRequired, order } = req.body;
      
      if (!questId || !title) {
        throw new ClientError('questId and title required');
      }

      // Verify quest ownership
      const quest = await swordStore.getQuest(questId);
      if (!quest || quest.userId !== req.userId) {
        throw new ClientError('Quest not found or access denied', 404);
      }

      const step = await swordStore.createStep({
        questId,
        title,
        description,
        type,
        estimatedMinutes,
        sparkPrompt,
        verificationRequired,
        order,
      });

      res.status(201).json({ step });
    } catch (error) {
      next(error);
    }
  });

  router.post('/steps/:id/transition', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const step = await swordStore.getStep(req.params.id!);
      if (!step) {
        throw new ClientError('Step not found', 404);
      }

      // Verify ownership via quest
      const quest = await swordStore.getQuest(step.questId);
      if (!quest || quest.userId !== req.userId) {
        throw new ClientError('Access denied', 403);
      }

      const event = req.body as StepEvent;
      if (!event.type) {
        throw new ClientError('event type required');
      }

      const result = await swordStore.transitionStepState(req.params.id!, event);
      if (!result?.success) {
        throw new ClientError(result?.error ?? 'Transition failed');
      }

      res.json({ step: result.entity, transition: { from: result.previousStatus, to: result.newStatus } });
    } catch (error) {
      next(error);
    }
  });

  // ─── SPARKS ───

  router.post('/sparks/generate', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { stepId, questId, goalId, context, maxMinutes, frictionLevel } = req.body;

      const spark = await sparkGenerator.generate(req.userId!, {
        stepId,
        questId,
        goalId,
        context,
        maxMinutes,
        frictionLevel,
      });

      res.status(201).json({ spark });
    } catch (error) {
      next(error);
    }
  });

  router.get('/sparks/active', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const spark = await swordStore.getActiveSpark(req.userId!);
      res.json({ spark });
    } catch (error) {
      next(error);
    }
  });

  router.get('/sparks', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const sparks = await swordStore.getUserSparks(req.userId!, limit);
      res.json({ sparks });
    } catch (error) {
      next(error);
    }
  });

  router.post('/sparks/:id/transition', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const spark = await swordStore.getSpark(req.params.id!);
      if (!spark || spark.userId !== req.userId) {
        throw new ClientError('Spark not found', 404);
      }

      const event = req.body as SparkEvent;
      if (!event.type) {
        throw new ClientError('event type required');
      }

      const result = await swordStore.transitionSparkState(req.params.id!, event);
      if (!result?.success) {
        throw new ClientError(result?.error ?? 'Transition failed');
      }

      res.json({ spark: result.entity, transition: { from: result.previousStatus, to: result.newStatus } });
    } catch (error) {
      next(error);
    }
  });

  // ─── PATH (combined view) ───

  router.get('/path/:goalId', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const path = await swordStore.getPath(req.params.goalId!, req.userId!);
      if (!path) {
        throw new ClientError('Goal not found or access denied', 404);
      }

      res.json({ path });
    } catch (error) {
      next(error);
    }
  });

  router.post('/path/:goalId/next-spark', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const spark = await sparkGenerator.generateNextSpark(req.userId!, req.params.goalId!);
      if (!spark) {
        throw new ClientError('Could not generate spark for this goal', 400);
      }

      res.json({ spark });
    } catch (error) {
      next(error);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // MEMORY ENDPOINTS — User Profile, Preferences, Learned Context
  // ─────────────────────────────────────────────────────────────────────────────

  const memoryStore = getMemoryStore();
  const memoryExtractor = getMemoryExtractor();
  const memoryRetriever = getMemoryRetriever();

  // ─── PROFILE ───

  router.get('/profile', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const profile = await memoryStore.getOrCreateProfile(req.userId!);
      res.json({ profile });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/profile', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { name, role, organization, location, timezone, expertiseAreas, expertiseLevel, interests } = req.body;
      
      const profile = await memoryStore.updateProfile(req.userId!, {
        name,
        role,
        organization,
        location,
        timezone,
        expertiseAreas,
        expertiseLevel,
        interests,
      });

      res.json({ profile });
    } catch (error) {
      next(error);
    }
  });

  // ─── PREFERENCES ───

  router.get('/preferences', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const preferences = await memoryStore.getOrCreatePreferences(req.userId!);
      res.json({ preferences });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/preferences', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const {
        tone, verbosity, formatting,
        proactiveReminders, suggestNextSteps, askClarifyingQuestions,
        riskTolerance, financialAlerts, healthAlerts,
        memoryEnabled, autoExtractFacts, sensitiveTopics,
        defaultMode, showConfidenceLevel, showSources,
      } = req.body;
      
      const preferences = await memoryStore.updatePreferences(req.userId!, {
        tone,
        verbosity,
        formatting,
        proactiveReminders,
        suggestNextSteps,
        askClarifyingQuestions,
        riskTolerance,
        financialAlerts,
        healthAlerts,
        memoryEnabled,
        autoExtractFacts,
        sensitiveTopics,
        defaultMode,
        showConfidenceLevel,
        showSources,
      });

      res.json({ preferences });
    } catch (error) {
      next(error);
    }
  });

  // ─── MEMORIES ───

  router.get('/memories', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const category = req.query.category as MemoryCategory | undefined;
      const keywords = req.query.keywords ? String(req.query.keywords).split(',') : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      
      const memories = await memoryStore.queryMemories(req.userId!, {
        categories: category ? [category] : undefined,
        keywords,
        limit,
      });

      res.json({ memories });
    } catch (error) {
      next(error);
    }
  });

  router.get('/memories/stats', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const stats = await memoryStore.getMemoryStats(req.userId!);
      res.json({ stats });
    } catch (error) {
      next(error);
    }
  });

  router.post('/memories', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { category, key, value, context, confidence, sensitivity, expiresAt } = req.body;
      
      if (!category || !key || !value) {
        throw new ClientError('category, key, and value required');
      }

      const memory = await memoryStore.createMemory(req.userId!, {
        category,
        key,
        value,
        context,
        confidence,
        sensitivity,
        expiresAt,
      });

      res.status(201).json({ memory });
    } catch (error) {
      next(error);
    }
  });

  router.get('/memories/:id', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const memory = await memoryStore.getMemory(req.params.id!);
      if (!memory || memory.userId !== req.userId) {
        throw new ClientError('Memory not found', 404);
      }

      res.json({ memory });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/memories/:id', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { value, context, confidence, sensitivity, expiresAt } = req.body;
      
      const memory = await memoryStore.updateMemory(req.params.id!, req.userId!, {
        value,
        context,
        confidence,
        sensitivity,
        expiresAt,
      });

      if (!memory) {
        throw new ClientError('Memory not found', 404);
      }

      res.json({ memory });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/memories/:id', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const deleted = await memoryStore.deleteMemory(req.params.id!, req.userId!);
      if (!deleted) {
        throw new ClientError('Memory not found', 404);
      }

      res.json({ deleted: true });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/memories', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const category = req.query.category as MemoryCategory | undefined;
      
      let count: number;
      if (category) {
        count = await memoryStore.clearCategoryMemories(req.userId!, category);
      } else {
        count = await memoryStore.clearAllMemories(req.userId!);
      }

      res.json({ deleted: count });
    } catch (error) {
      next(error);
    }
  });

  // ─── MEMORY EXTRACTION ───

  router.post('/memories/extract', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { message, conversationId } = req.body;
      
      if (!message) {
        throw new ClientError('message required');
      }

      const result = await memoryExtractor.extractAndSave(req.userId!, message, conversationId);

      res.json({
        saved: result.saved.length,
        memories: result.saved,
        profileUpdated: result.profileUpdated,
        preferencesUpdated: result.preferencesUpdated,
      });
    } catch (error) {
      next(error);
    }
  });

  // ─── CONTEXT RETRIEVAL ───

  router.post('/memories/context', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { message } = req.body;
      
      const injection = await memoryRetriever.buildContextInjection(req.userId!, message || '');
      const formatted = memoryRetriever.formatContextForLLM(injection);

      res.json({
        injection,
        formatted,
      });
    } catch (error) {
      next(error);
    }
  });

  // ─── MEMORY DECAY ───

  router.post('/memories/decay', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await memoryStore.decayMemories(req.userId!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // ADMIN ENDPOINTS (would be more restricted in production)
  // ─────────────────────────────────────────────────────────────────────────────

  router.post('/admin/block-user', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { targetUserId, reason, durationMinutes } = req.body;
      
      if (!targetUserId || !reason) {
        throw new ClientError('targetUserId and reason required');
      }

      const durationMs = (durationMinutes ?? 60) * 60 * 1000;
      await auth.blockUser(targetUserId, reason, durationMs);

      await auth.audit.log({
        userId: req.userId!,
        action: 'admin_block_user',
        details: { targetUserId, reason, durationMinutes },
      });

      res.json({
        success: true,
        blockedUntil: Date.now() + durationMs,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/admin/unblock-user', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { targetUserId } = req.body;
      
      if (!targetUserId) {
        throw new ClientError('targetUserId required');
      }

      const unblocked = await auth.unblockUser(targetUserId);

      await auth.audit.log({
        userId: req.userId!,
        action: 'admin_unblock_user',
        details: { targetUserId },
      });

      res.json({
        success: unblocked,
      });
    } catch (error) {
      next(error);
    }
  });

  // Audit logs endpoint
  router.get('/admin/audit-logs', auth.middleware(true), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { userId: targetUserId, limit = 100 } = req.query;

      let logs;
      if (targetUserId && typeof targetUserId === 'string') {
        logs = await auth.audit.getUserLogs(targetUserId, Number(limit));
      } else {
        logs = await auth.audit.getGlobalLogs(Number(limit));
      }

      res.json({
        logs,
        count: logs.length,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

// ─────────────────────────────────────────────────────────────────────────────────
// ERROR HANDLER MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────────

export function errorHandler(
  error: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('[API] Error:', error);

  if (error instanceof ClientError) {
    res.status(error.statusCode).json({
      error: error.message,
      code: 'CLIENT_ERROR',
    });
    return;
  }

  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : error.message;

  res.status(500).json({
    error: message,
    code: 'INTERNAL_ERROR',
  });
}
