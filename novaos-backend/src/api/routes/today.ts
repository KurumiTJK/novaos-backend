// ═══════════════════════════════════════════════════════════════════════════════
// TODAY ROUTES — Today's Focus and Current Context
// NovaOS API Layer — Phase 14
// ═══════════════════════════════════════════════════════════════════════════════
//
// Endpoints:
//   GET    /today              Get today's focus (step, spark, goal context)
//   POST   /today/refresh      Refresh/regenerate today's spark
//
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, type Response, type RequestHandler } from 'express';
import { auth, type AuthenticatedRequest } from '../../auth/index.js';
import { createRateLimiter, RateLimitCategory } from '../../security/rate-limiting/index.js';
import { getSwordStore, getSparkGenerator } from '../../core/sword/index.js';
import { getLogger } from '../../logging/index.js';

// Middleware
import { asyncHandler } from '../middleware/error-handler.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'today-routes' });

// ─────────────────────────────────────────────────────────────────────────────────
// RATE LIMITERS
// ─────────────────────────────────────────────────────────────────────────────────

const sparkGenerationLimiter = createRateLimiter(RateLimitCategory.SPARK_GENERATION);

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

interface TodayResponse {
  // Current spark (if any)
  spark: Awaited<ReturnType<ReturnType<typeof getSwordStore>['getActiveSpark']>>;
  
  // Current step (if spark has one)
  step: Awaited<ReturnType<ReturnType<typeof getSwordStore>['getStep']>>;
  
  // Current quest (if step has one)
  quest: Awaited<ReturnType<ReturnType<typeof getSwordStore>['getQuest']>>;
  
  // Current goal
  goal: Awaited<ReturnType<ReturnType<typeof getSwordStore>['getGoal']>>;
  
  // Summary stats
  stats: {
    activeGoals: number;
    completedToday: number;
    currentStreak: number;
  };
  
  // Suggestions if no spark
  suggestions?: {
    message: string;
    actions: Array<{
      label: string;
      endpoint: string;
      method: string;
    }>;
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Get count of sparks completed today.
 */
async function getCompletedTodayCount(userId: string): Promise<number> {
  const store = getSwordStore();
  const sparks = await store.getUserSparks(userId, 100);
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  return sparks.filter((s) => {
    if (s.status !== 'completed' || !s.completedAt) return false;
    const completedDate = new Date(s.completedAt);
    return completedDate >= today;
  }).length;
}

/**
 * Calculate current streak (consecutive days with completed sparks).
 */
async function calculateStreak(userId: string): Promise<number> {
  const store = getSwordStore();
  const sparks = await store.getUserSparks(userId, 500);
  
  // Get completed sparks sorted by completion date
  const completedSparks = sparks
    .filter((s) => s.status === 'completed' && s.completedAt)
    .sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime());
  
  if (completedSparks.length === 0) return 0;
  
  // Get unique completion dates
  const completionDates = new Set<string>();
  for (const spark of completedSparks) {
    const date = new Date(spark.completedAt!);
    completionDates.add(date.toISOString().split('T')[0]!);
  }
  
  const sortedDates = Array.from(completionDates).sort().reverse();
  
  // Check if there's activity today or yesterday
  const today = new Date().toISOString().split('T')[0]!;
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]!;
  
  if (sortedDates[0] !== today && sortedDates[0] !== yesterday) {
    return 0; // Streak broken
  }
  
  // Count consecutive days
  let streak = 1;
  let currentDate = new Date(sortedDates[0]!);
  
  for (let i = 1; i < sortedDates.length; i++) {
    const prevDate = new Date(currentDate);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = prevDate.toISOString().split('T')[0]!;
    
    if (sortedDates[i] === prevDateStr) {
      streak++;
      currentDate = prevDate;
    } else {
      break;
    }
  }
  
  return streak;
}

// ─────────────────────────────────────────────────────────────────────────────────
// ROUTER FACTORY
// ─────────────────────────────────────────────────────────────────────────────────

export function createTodayRouter(): Router {
  const router = Router();

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET TODAY'S FOCUS
  // GET /today
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get(
    '/',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      
      const store = getSwordStore();
      
      // Get active spark
      const spark = await store.getActiveSpark(userId);
      
      // Get associated entities if spark exists
      let step = null;
      let quest = null;
      let goal = null;
      
      if (spark) {
        if (spark.stepId) {
          step = await store.getStep(spark.stepId);
          if (step) {
            quest = await store.getQuest(step.questId);
          }
        }
        if (spark.goalId) {
          goal = await store.getGoal(spark.goalId);
        }
      }
      
      // Get stats
      const activeGoals = await store.getUserGoals(userId, 'active');
      const completedToday = await getCompletedTodayCount(userId);
      const currentStreak = await calculateStreak(userId);
      
      // Build response
      const response: Partial<TodayResponse> = {
        spark,
        step,
        quest,
        goal,
        stats: {
          activeGoals: activeGoals.length,
          completedToday,
          currentStreak,
        },
      };
      
      // Add suggestions if no spark
      if (!spark) {
        if (activeGoals.length === 0) {
          response.suggestions = {
            message: 'Create a goal to get started with your first spark!',
            actions: [
              {
                label: 'Create Goal',
                endpoint: '/api/v1/goals',
                method: 'POST',
              },
            ],
          };
        } else {
          response.suggestions = {
            message: 'Generate a spark to make progress on your goals!',
            actions: [
              {
                label: 'Generate Spark',
                endpoint: '/api/v1/sparks/generate',
                method: 'POST',
              },
              {
                label: 'Auto-generate from Goal',
                endpoint: `/api/v1/path/${activeGoals[0]!.id}/next-spark`,
                method: 'POST',
              },
            ],
          };
        }
      }
      
      res.json({
        ...response,
        _links: {
          self: '/api/v1/today',
          refresh: '/api/v1/today/refresh',
          sparks: '/api/v1/sparks',
          goals: '/api/v1/goals',
          spark: spark ? `/api/v1/sparks/${spark.id}` : undefined,
          complete: spark ? `/api/v1/sparks/${spark.id}/complete` : undefined,
          skip: spark ? `/api/v1/sparks/${spark.id}/skip` : undefined,
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // REFRESH TODAY'S SPARK
  // POST /today/refresh
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.post(
    '/refresh',
    auth.middleware(true),
    sparkGenerationLimiter as RequestHandler,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      
      logger.info('Refreshing today\'s spark', {
        userId,
        requestId: req.requestId,
      });
      
      const store = getSwordStore();
      const generator = getSparkGenerator();
      
      // Check for active goals
      const activeGoals = await store.getUserGoals(userId, 'active');
      
      if (activeGoals.length === 0) {
        res.status(400).json({
          error: 'No active goals',
          message: 'Create a goal first to generate sparks',
          _links: {
            createGoal: '/api/v1/goals',
          },
        });
        return;
      }
      
      // Try to generate from the first active goal's path
      const primaryGoal = activeGoals[0]!;
      const spark = await generator.generateNextSpark(userId, primaryGoal.id);
      
      if (!spark) {
        // Fallback: generate directly for the goal
        const fallbackSpark = await generator.generate(userId, {
          goalId: primaryGoal.id,
          context: 'Daily refresh - auto-generated',
        });
        
        res.status(201).json({
          spark: fallbackSpark,
          refreshed: true,
          source: 'goal_fallback',
          _links: {
            self: `/api/v1/sparks/${fallbackSpark.id}`,
            complete: `/api/v1/sparks/${fallbackSpark.id}/complete`,
            skip: `/api/v1/sparks/${fallbackSpark.id}/skip`,
            today: '/api/v1/today',
          },
        });
        return;
      }
      
      res.status(201).json({
        spark,
        refreshed: true,
        source: 'path',
        _links: {
          self: `/api/v1/sparks/${spark.id}`,
          complete: `/api/v1/sparks/${spark.id}/complete`,
          skip: `/api/v1/sparks/${spark.id}/skip`,
          today: '/api/v1/today',
        },
      });
    })
  );

  return router;
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export default createTodayRouter;
