// ═══════════════════════════════════════════════════════════════════════════════
// NOVAOS BACKEND — Server Entry Point
// ═══════════════════════════════════════════════════════════════════════════════

import express from 'express';
import cors from 'cors';
import { createRouter, errorHandler } from './api/routes.js';
import { createHealthRouter } from './api/routes/health.js';
import { requestMiddleware } from './api/middleware/request.js';
import { storeManager } from './storage/index.js';
import { loadConfig, canVerify } from './config/index.js';
import { getLogger } from './logging/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// ENVIRONMENT CONFIG
// ─────────────────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const NODE_ENV = process.env.NODE_ENV ?? 'development';

// Provider configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PREFERRED_PROVIDER = (process.env.PREFERRED_PROVIDER as 'openai' | 'gemini' | 'mock') ?? 'openai';
const USE_MOCK = process.env.USE_MOCK_PROVIDER === 'true';

// Auth configuration
const REQUIRE_AUTH = process.env.REQUIRE_AUTH === 'true';

// Redis configuration
const REDIS_URL = process.env.REDIS_URL;

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'server' });

// ─────────────────────────────────────────────────────────────────────────────────
// SERVER SETUP
// ─────────────────────────────────────────────────────────────────────────────────

const app = express();

// Trust proxy (for correct IP detection behind load balancer)
app.set('trust proxy', 1);

// CORS
app.use(cors({
  origin: NODE_ENV === 'production'
    ? process.env.ALLOWED_ORIGINS?.split(',') ?? []
    : '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id'],
}));

// Body parsing
app.use(express.json({ limit: '1mb' }));

// Request ID and logging middleware
app.use(requestMiddleware);

// ─────────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────────

// Health routes at root level (before API prefix)
const healthRouter = createHealthRouter();
app.use('/', healthRouter);

// Simple root check for load balancers
app.get('/', (_req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'novaos-backend',
    version: '7.0.0',
    storage: storeManager.isUsingRedis() ? 'redis' : 'memory',
  });
});

// API routes
const router = createRouter({
  openaiApiKey: OPENAI_API_KEY,
  geminiApiKey: GEMINI_API_KEY,
  preferredProvider: PREFERRED_PROVIDER,
  useMockProvider: USE_MOCK,
  requireAuth: REQUIRE_AUTH,
});

app.use('/api/v1', router);

// Error handler (must be last)
app.use(errorHandler);

// ─────────────────────────────────────────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────────────────────────────────────────

async function startServer() {
  const startTime = Date.now();
  
  // Initialize storage (Redis or memory fallback)
  await storeManager.initialize(REDIS_URL);

  const config = loadConfig();
  
  const server = app.listen(PORT, () => {
    const providerStatus = USE_MOCK 
      ? 'mock' 
      : [OPENAI_API_KEY ? 'openai' : '', GEMINI_API_KEY ? 'gemini' : ''].filter(Boolean).join(', ') || 'none (mock fallback)';
    const storageStatus = storeManager.isUsingRedis() ? 'redis' : 'memory';
    const verifyStatus = canVerify() ? 'enabled' : 'disabled';
    const startupTime = Date.now() - startTime;
    
    // Structured log for startup
    logger.info('Server started', {
      port: PORT,
      environment: NODE_ENV,
      storage: storageStatus,
      verification: verifyStatus,
      startupMs: startupTime,
    });
    
    console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                     NOVAOS BACKEND v10.0.0                        ║
╠═══════════════════════════════════════════════════════════════════╣
║  Environment:  ${NODE_ENV.padEnd(49)}║
║  Port:         ${String(PORT).padEnd(49)}║
║  Providers:    ${providerStatus.padEnd(49)}║
║  Preferred:    ${PREFERRED_PROVIDER.padEnd(49)}║
║  Auth:         ${(REQUIRE_AUTH ? 'required' : 'optional').padEnd(49)}║
║  Storage:      ${storageStatus.padEnd(49)}║
║  Verification: ${verifyStatus.padEnd(49)}║
║  Mode:         ${config.staging.preferCheaperModels ? 'staging (cheaper)' : 'production'.padEnd(41)}║
╚═══════════════════════════════════════════════════════════════════╝

Health Endpoints:
  GET  /health                     Liveness check (Kubernetes)
  GET  /ready                      Readiness check (Kubernetes)
  GET  /status                     Detailed status

API Endpoints:
  POST /api/v1/chat                Main chat endpoint
  POST /api/v1/chat/enhanced       Chat with Memory + Sword integration
  GET  /api/v1/context             Preview user context
  GET  /api/v1/conversations       Conversation history

Sword (Path/Spark Engine):
  POST /api/v1/goals               Create goal
  GET  /api/v1/goals               List goals
  GET  /api/v1/goals/:id           Get goal + path
  POST /api/v1/goals/:id/transition Change goal status
  
  POST /api/v1/quests              Create quest (milestone)
  POST /api/v1/quests/:id/transition Change quest status
  
  POST /api/v1/steps               Create step
  POST /api/v1/steps/:id/transition Complete/skip step
  
  POST /api/v1/sparks/generate     Generate minimal action
  GET  /api/v1/sparks/active       Current active spark
  POST /api/v1/sparks/:id/transition Accept/complete spark
  
  GET  /api/v1/path/:goalId        Full path to goal
  POST /api/v1/path/:goalId/next-spark Auto-generate next spark

Memory (User Context):
  GET  /api/v1/profile             Get user profile
  PATCH /api/v1/profile            Update profile
  GET  /api/v1/preferences         Get preferences
  PATCH /api/v1/preferences        Update preferences
  
  GET  /api/v1/memories            List memories
  POST /api/v1/memories            Create memory
  PATCH /api/v1/memories/:id       Update memory
  DELETE /api/v1/memories/:id      Delete memory
  DELETE /api/v1/memories          Clear all/category
  
  POST /api/v1/memories/extract    Extract from message
  POST /api/v1/memories/context    Get LLM context

Admin:
  POST /api/v1/admin/block-user    Block a user
  POST /api/v1/admin/unblock-user  Unblock a user
  GET  /api/v1/admin/audit-logs    View audit logs

Ready to enforce the Nova Constitution. Startup: ${startupTime}ms
    `);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Shutdown initiated by ${signal}`);
    
    server.close(async () => {
      logger.info('HTTP server closed');
      
      await storeManager.disconnect();
      logger.info('Storage disconnected');
      
      logger.info('Server shutdown complete');
      process.exit(0);
    });
    
    // Force exit after 10 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  
  // Unhandled errors
  process.on('uncaughtException', (error) => {
    logger.fatal('Uncaught exception', error);
    process.exit(1);
  });
  
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', reason instanceof Error ? reason : new Error(String(reason)));
  });
}

startServer().catch((error) => {
  logger.fatal('Failed to start server', error instanceof Error ? error : new Error(String(error)));
  process.exit(1);
});

export { app };
