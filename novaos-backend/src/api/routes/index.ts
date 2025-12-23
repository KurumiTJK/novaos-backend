// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES INDEX — API Route Registration
// NovaOS API Layer — Phase 14
// ═══════════════════════════════════════════════════════════════════════════════
//
// This module exports all route factories and provides a combined router
// that can be mounted at /api/v1 (or v2 for new modular routes).
//
// Usage:
//   import { createApiRouter } from './api/routes/index.js';
//   app.use('/api/v1', createApiRouter());
//
// Or mount individual routers:
//   import { createGoalRouter } from './api/routes/index.js';
//   app.use('/api/v1/goals', createGoalRouter());
//
// ═══════════════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import { auth } from '../../auth/index.js';
import { getLogger } from '../../logging/index.js';

// Route factories
import { createGoalRouter } from './goals.js';
import { createQuestRouter } from './quests.js';
import { createStepRouter } from './steps.js';
import { createSparkRouter } from './sparks.js';
import { createReminderRouter } from './reminders.js';
import { createTodayRouter } from './today.js';
import { createProgressRouter } from './progress.js';
import { createUserRouter } from './user.js';

// ─────────────────────────────────────────────────────────────────────────────────
// RE-EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export { createGoalRouter } from './goals.js';
export { createQuestRouter } from './quests.js';
export { createStepRouter } from './steps.js';
export { createSparkRouter } from './sparks.js';
export { createReminderRouter } from './reminders.js';
export { createTodayRouter } from './today.js';
export { createProgressRouter } from './progress.js';
export { createUserRouter } from './user.js';

// Existing routes (if needed for backward compatibility)
export { createHealthRouter } from './health.js';
export { createSchedulerRouter } from './scheduler.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'api-routes' });

// ─────────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Options for creating the API router.
 */
export interface ApiRouterOptions {
  /**
   * Whether to require authentication for all routes.
   * Individual routes may override this.
   * @default true
   */
  readonly requireAuth?: boolean;
  
  /**
   * Whether to include health routes in the API router.
   * Usually health routes are mounted separately at root.
   * @default false
   */
  readonly includeHealth?: boolean;
  
  /**
   * Whether to include scheduler routes.
   * @default false
   */
  readonly includeScheduler?: boolean;
  
  /**
   * Route prefix for Sword routes (goals, quests, steps, sparks).
   * @default '' (no prefix)
   */
  readonly swordPrefix?: string;
  
  /**
   * Enable/disable specific route groups.
   */
  readonly routes?: {
    readonly goals?: boolean;
    readonly quests?: boolean;
    readonly steps?: boolean;
    readonly sparks?: boolean;
    readonly reminders?: boolean;
    readonly today?: boolean;
    readonly progress?: boolean;
    readonly user?: boolean;
  };
}

/**
 * Default router options.
 */
const DEFAULT_OPTIONS: Required<ApiRouterOptions> = {
  requireAuth: true,
  includeHealth: false,
  includeScheduler: false,
  swordPrefix: '',
  routes: {
    goals: true,
    quests: true,
    steps: true,
    sparks: true,
    reminders: true,
    today: true,
    progress: true,
    user: true,
  },
};

// ─────────────────────────────────────────────────────────────────────────────────
// COMBINED ROUTER FACTORY
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create the combined API router with all Sword routes.
 * 
 * @example
 * // Mount at /api/v1 with all routes
 * app.use('/api/v1', createApiRouter());
 * 
 * @example
 * // Mount at /api/v2 with specific routes
 * app.use('/api/v2', createApiRouter({
 *   routes: { goals: true, sparks: true }
 * }));
 */
export function createApiRouter(options: ApiRouterOptions = {}): Router {
  const opts = {
    ...DEFAULT_OPTIONS,
    ...options,
    routes: { ...DEFAULT_OPTIONS.routes, ...options.routes },
  };
  
  const router = Router();
  const prefix = opts.swordPrefix;
  
  logger.info('Creating API router', {
    routes: Object.entries(opts.routes)
      .filter(([_, enabled]) => enabled)
      .map(([name]) => name),
  });
  
  // ─── SWORD ROUTES ───
  
  if (opts.routes.goals) {
    router.use(`${prefix}/goals`, createGoalRouter());
    logger.debug('Mounted goals router', { path: `${prefix}/goals` });
  }
  
  if (opts.routes.quests) {
    router.use(`${prefix}/quests`, createQuestRouter());
    logger.debug('Mounted quests router', { path: `${prefix}/quests` });
  }
  
  if (opts.routes.steps) {
    router.use(`${prefix}/steps`, createStepRouter());
    logger.debug('Mounted steps router', { path: `${prefix}/steps` });
  }
  
  if (opts.routes.sparks) {
    router.use(`${prefix}/sparks`, createSparkRouter());
    logger.debug('Mounted sparks router', { path: `${prefix}/sparks` });
  }
  
  // ─── UTILITY ROUTES ───
  
  if (opts.routes.reminders) {
    router.use('/reminders', createReminderRouter());
    logger.debug('Mounted reminders router', { path: '/reminders' });
  }
  
  if (opts.routes.today) {
    router.use('/today', createTodayRouter());
    logger.debug('Mounted today router', { path: '/today' });
  }
  
  if (opts.routes.progress) {
    router.use('/progress', createProgressRouter());
    logger.debug('Mounted progress router', { path: '/progress' });
  }
  
  // ─── USER/GDPR ROUTES ───
  
  if (opts.routes.user) {
    router.use('/me', createUserRouter());
    logger.debug('Mounted user router', { path: '/me' });
  }
  
  // ─── OPTIONAL: HEALTH ROUTES ───
  
  if (opts.includeHealth) {
    const { createHealthRouter } = require('./health.js');
    router.use('/health', createHealthRouter());
    logger.debug('Mounted health router', { path: '/health' });
  }
  
  // ─── OPTIONAL: SCHEDULER ROUTES ───
  
  if (opts.includeScheduler) {
    const { createSchedulerRouter } = require('./scheduler.js');
    router.use('/scheduler', createSchedulerRouter());
    logger.debug('Mounted scheduler router', { path: '/scheduler' });
  }
  
  return router;
}

// ─────────────────────────────────────────────────────────────────────────────────
// ROUTE MAP (for documentation/introspection)
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Map of all available routes for documentation.
 */
export const ROUTE_MAP = {
  goals: {
    'POST /goals': 'Create a new goal',
    'GET /goals': 'List goals with filters and pagination',
    'GET /goals/:id': 'Get a goal by ID',
    'PATCH /goals/:id': 'Update a goal',
    'DELETE /goals/:id': 'Delete a goal',
    'POST /goals/:id/transition': 'Transition goal state',
    'GET /goals/:id/quests': 'List quests for goal',
  },
  quests: {
    'POST /quests': 'Create a new quest',
    'GET /quests': 'List quests with filters',
    'GET /quests/:id': 'Get a quest by ID',
    'PATCH /quests/:id': 'Update a quest',
    'POST /quests/:id/transition': 'Transition quest state',
    'GET /quests/:id/steps': 'List steps for quest',
  },
  steps: {
    'POST /steps': 'Create a new step',
    'GET /steps/:id': 'Get a step by ID',
    'PATCH /steps/:id': 'Update a step',
    'POST /steps/:id/transition': 'Transition step state',
    'POST /steps/:id/complete': 'Complete a step',
    'POST /steps/:id/skip': 'Skip a step',
    'GET /steps/:id/sparks': 'List sparks for step',
  },
  sparks: {
    'POST /sparks/generate': 'Generate a new spark',
    'GET /sparks/active': 'Get active spark',
    'GET /sparks': 'List sparks with filters',
    'GET /sparks/:id': 'Get a spark by ID',
    'POST /sparks/:id/accept': 'Accept a suggested spark',
    'POST /sparks/:id/complete': 'Complete a spark',
    'POST /sparks/:id/skip': 'Skip a spark',
    'POST /sparks/:id/transition': 'Transition spark state',
  },
  reminders: {
    'GET /reminders/config': 'Get reminder configuration',
    'PATCH /reminders/config': 'Update reminder configuration',
    'POST /reminders/pause': 'Pause reminders',
    'POST /reminders/resume': 'Resume reminders',
    'GET /reminders/status': 'Get reminder status',
  },
  today: {
    'GET /today': 'Get today\'s focus',
    'POST /today/refresh': 'Refresh today\'s spark',
  },
  progress: {
    'GET /progress': 'Get overall progress',
    'GET /progress/:goalId': 'Get goal progress',
  },
  user: {
    'GET /me': 'Get current user',
    'POST /me/export': 'Export user data (GDPR)',
    'DELETE /me': 'Delete user data (GDPR)',
    'GET /me/deletion-preview': 'Preview deletion',
  },
} as const;

/**
 * Get all routes as a flat list.
 */
export function getAllRoutes(): Array<{ method: string; path: string; description: string }> {
  const routes: Array<{ method: string; path: string; description: string }> = [];
  
  for (const [group, endpoints] of Object.entries(ROUTE_MAP)) {
    for (const [endpoint, description] of Object.entries(endpoints)) {
      const [method, path] = endpoint.split(' ');
      routes.push({ method: method!, path: path!, description });
    }
  }
  
  return routes;
}

// ─────────────────────────────────────────────────────────────────────────────────
// DEFAULT EXPORT
// ─────────────────────────────────────────────────────────────────────────────────

export default createApiRouter;
