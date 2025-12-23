// ═══════════════════════════════════════════════════════════════════════════════
// PROGRESS ROUTES — Goal Progress and Analytics
// NovaOS API Layer — Phase 14
// ═══════════════════════════════════════════════════════════════════════════════
//
// Endpoints:
//   GET    /progress              Get overall progress summary
//   GET    /progress/:goalId      Get detailed progress for a goal
//
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, type Response } from 'express';
import { auth, type AuthenticatedRequest } from '../../auth/index.js';
import { getSwordStore } from '../../core/sword/index.js';
import { getLogger } from '../../logging/index.js';
import type { GoalId } from '../../types/branded.js';

// Middleware
import {
  asyncHandler,
  NotFoundError,
  ValidationError,
} from '../middleware/error-handler.js';

// Schemas
import { GoalIdSchema } from '../schemas/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'progress-routes' });

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

interface GoalProgress {
  goalId: string;
  goalTitle: string;
  goalStatus: string;
  
  // Quest progress
  quests: {
    total: number;
    completed: number;
    active: number;
    blocked: number;
    notStarted: number;
    skipped: number;
  };
  
  // Step progress
  steps: {
    total: number;
    completed: number;
    active: number;
    pending: number;
    skipped: number;
  };
  
  // Spark progress
  sparks: {
    total: number;
    completed: number;
    skipped: number;
    expired: number;
  };
  
  // Time tracking
  time: {
    estimatedMinutes: number;
    actualMinutes: number;
    remainingMinutes: number;
  };
  
  // Percentages
  percentComplete: number;
  
  // Activity
  activity: {
    lastActivityAt: string | null;
    daysSinceLastActivity: number | null;
    streakDays: number;
  };
  
  // Timeline
  timeline: {
    createdAt: string;
    targetDate: string | null;
    daysRemaining: number | null;
    onTrack: boolean | null;
  };
}

interface OverallProgress {
  // Goal summary
  goals: {
    total: number;
    active: number;
    completed: number;
    paused: number;
    abandoned: number;
  };
  
  // Aggregate stats
  totalSparksCompleted: number;
  totalTimeMinutes: number;
  currentStreak: number;
  longestStreak: number;
  
  // Recent activity
  recentActivity: Array<{
    type: 'spark_completed' | 'step_completed' | 'quest_completed' | 'goal_completed';
    entityId: string;
    title: string;
    completedAt: string;
  }>;
  
  // Per-goal progress
  goalProgress: GoalProgress[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Parse and validate goal ID from params.
 */
function parseGoalId(id: string): GoalId {
  const result = GoalIdSchema.safeParse(id);
  if (!result.success) {
    throw new ValidationError('Invalid goal ID format');
  }
  return result.data;
}

/**
 * Calculate progress for a single goal.
 */
async function calculateGoalProgress(
  goalId: GoalId,
  userId: string
): Promise<GoalProgress> {
  const store = getSwordStore();
  
  // Get goal
  const goal = await store.getGoal(goalId);
  if (!goal || goal.userId !== userId) {
    throw new NotFoundError('Goal', goalId);
  }
  
  // Get quests for goal
  const quests = await store.getQuestsForGoal(goalId);
  
  // Get steps for all quests
  const allSteps = await Promise.all(
    quests.map((q) => store.getStepsForQuest(q.id))
  );
  const steps = allSteps.flat();
  
  // Get sparks for all steps
  const allSparks = await Promise.all(
    steps.map((s) => store.getSparksForStep(s.id))
  );
  const sparks = allSparks.flat();
  
  // Calculate quest stats
  const questStats = {
    total: quests.length,
    completed: quests.filter((q) => q.status === 'completed').length,
    active: quests.filter((q) => q.status === 'active').length,
    blocked: quests.filter((q) => q.status === 'blocked').length,
    notStarted: quests.filter((q) => q.status === 'not_started').length,
    skipped: quests.filter((q) => q.status === 'skipped').length,
  };
  
  // Calculate step stats
  const stepStats = {
    total: steps.length,
    completed: steps.filter((s) => s.status === 'completed').length,
    active: steps.filter((s) => s.status === 'active').length,
    pending: steps.filter((s) => s.status === 'pending').length,
    skipped: steps.filter((s) => s.status === 'skipped').length,
  };
  
  // Calculate spark stats
  const sparkStats = {
    total: sparks.length,
    completed: sparks.filter((s) => s.status === 'completed').length,
    skipped: sparks.filter((s) => s.status === 'skipped').length,
    expired: sparks.filter((s) => s.status === 'expired').length,
  };
  
  // Calculate time
  const estimatedMinutes = steps.reduce((sum, s) => sum + (s.estimatedMinutes || 0), 0);
  const actualMinutes = sparks
    .filter((s) => s.status === 'completed')
    .reduce((sum, s) => sum + (s.actualMinutes || s.estimatedMinutes || 0), 0);
  const completedStepMinutes = steps
    .filter((s) => s.status === 'completed')
    .reduce((sum, s) => sum + (s.estimatedMinutes || 0), 0);
  const remainingMinutes = estimatedMinutes - completedStepMinutes;
  
  // Calculate percent complete
  const percentComplete = stepStats.total > 0
    ? Math.round((stepStats.completed / stepStats.total) * 100)
    : 0;
  
  // Find last activity
  const allDates = [
    ...sparks.filter((s) => s.completedAt).map((s) => new Date(s.completedAt!)),
    ...steps.filter((s) => s.completedAt).map((s) => new Date(s.completedAt!)),
  ];
  const lastActivityAt = allDates.length > 0
    ? new Date(Math.max(...allDates.map((d) => d.getTime()))).toISOString()
    : null;
  
  const daysSinceLastActivity = lastActivityAt
    ? Math.floor((Date.now() - new Date(lastActivityAt).getTime()) / 86400000)
    : null;
  
  // Calculate streak (simplified - would need more data for accurate streak)
  const completedSparkDates = sparks
    .filter((s) => s.status === 'completed' && s.completedAt)
    .map((s) => new Date(s.completedAt!).toISOString().split('T')[0]!);
  const uniqueDates = [...new Set(completedSparkDates)].sort().reverse();
  let streakDays = 0;
  const today = new Date().toISOString().split('T')[0]!;
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]!;
  
  if (uniqueDates[0] === today || uniqueDates[0] === yesterday) {
    streakDays = 1;
    let currentDate = new Date(uniqueDates[0]!);
    for (let i = 1; i < uniqueDates.length; i++) {
      const prevDate = new Date(currentDate);
      prevDate.setDate(prevDate.getDate() - 1);
      if (uniqueDates[i] === prevDate.toISOString().split('T')[0]) {
        streakDays++;
        currentDate = prevDate;
      } else {
        break;
      }
    }
  }
  
  // Timeline
  const daysRemaining = goal.targetDate
    ? Math.ceil((new Date(goal.targetDate).getTime() - Date.now()) / 86400000)
    : null;
  
  // On track calculation (rough heuristic)
  let onTrack: boolean | null = null;
  if (daysRemaining !== null && stepStats.total > 0) {
    const daysElapsed = Math.ceil((Date.now() - new Date(goal.createdAt).getTime()) / 86400000);
    const totalDays = daysElapsed + daysRemaining;
    const expectedProgress = (daysElapsed / totalDays) * 100;
    onTrack = percentComplete >= expectedProgress - 10; // 10% tolerance
  }
  
  return {
    goalId,
    goalTitle: goal.title,
    goalStatus: goal.status,
    quests: questStats,
    steps: stepStats,
    sparks: sparkStats,
    time: {
      estimatedMinutes,
      actualMinutes,
      remainingMinutes,
    },
    percentComplete,
    activity: {
      lastActivityAt,
      daysSinceLastActivity,
      streakDays,
    },
    timeline: {
      createdAt: goal.createdAt,
      targetDate: goal.targetDate || null,
      daysRemaining,
      onTrack,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// ROUTER FACTORY
// ─────────────────────────────────────────────────────────────────────────────────

export function createProgressRouter(): Router {
  const router = Router();

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET OVERALL PROGRESS
  // GET /progress
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get(
    '/',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      
      const store = getSwordStore();
      
      // Get all goals
      const allGoals = await store.getUserGoals(userId);
      
      // Calculate goal stats
      const goalStats = {
        total: allGoals.length,
        active: allGoals.filter((g) => g.status === 'active').length,
        completed: allGoals.filter((g) => g.status === 'completed').length,
        paused: allGoals.filter((g) => g.status === 'paused').length,
        abandoned: allGoals.filter((g) => g.status === 'abandoned').length,
      };
      
      // Get all sparks
      const allSparks = await store.getUserSparks(userId, 1000);
      const completedSparks = allSparks.filter((s) => s.status === 'completed');
      
      // Calculate totals
      const totalSparksCompleted = completedSparks.length;
      const totalTimeMinutes = completedSparks.reduce(
        (sum, s) => sum + (s.actualMinutes || s.estimatedMinutes || 0),
        0
      );
      
      // Calculate streak
      const completedDates = completedSparks
        .filter((s) => s.completedAt)
        .map((s) => new Date(s.completedAt!).toISOString().split('T')[0]!);
      const uniqueDates = [...new Set(completedDates)].sort().reverse();
      
      let currentStreak = 0;
      const today = new Date().toISOString().split('T')[0]!;
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]!;
      
      if (uniqueDates[0] === today || uniqueDates[0] === yesterday) {
        currentStreak = 1;
        let currentDate = new Date(uniqueDates[0]!);
        for (let i = 1; i < uniqueDates.length; i++) {
          const prevDate = new Date(currentDate);
          prevDate.setDate(prevDate.getDate() - 1);
          if (uniqueDates[i] === prevDate.toISOString().split('T')[0]) {
            currentStreak++;
            currentDate = prevDate;
          } else {
            break;
          }
        }
      }
      
      // Calculate longest streak (simplified)
      let longestStreak = currentStreak;
      let tempStreak = 0;
      for (let i = 0; i < uniqueDates.length - 1; i++) {
        const curr = new Date(uniqueDates[i]!);
        const next = new Date(uniqueDates[i + 1]!);
        const diffDays = Math.round((curr.getTime() - next.getTime()) / 86400000);
        
        if (diffDays === 1) {
          tempStreak++;
          longestStreak = Math.max(longestStreak, tempStreak + 1);
        } else {
          tempStreak = 0;
        }
      }
      
      // Get recent activity (last 10 completed sparks)
      const recentActivity = completedSparks
        .filter((s) => s.completedAt)
        .sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime())
        .slice(0, 10)
        .map((s) => ({
          type: 'spark_completed' as const,
          entityId: s.id,
          title: s.action,
          completedAt: s.completedAt!,
        }));
      
      // Get progress for active goals
      const activeGoals = allGoals.filter((g) => g.status === 'active');
      const goalProgress = await Promise.all(
        activeGoals.slice(0, 5).map((g) => calculateGoalProgress(g.id, userId))
      );
      
      const response: OverallProgress = {
        goals: goalStats,
        totalSparksCompleted,
        totalTimeMinutes,
        currentStreak,
        longestStreak,
        recentActivity,
        goalProgress,
      };
      
      res.json({
        ...response,
        _links: {
          self: '/api/v1/progress',
          goals: '/api/v1/goals',
          sparks: '/api/v1/sparks',
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET GOAL PROGRESS
  // GET /progress/:goalId
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get(
    '/:goalId',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      const goalId = parseGoalId(req.params.goalId!);
      
      const progress = await calculateGoalProgress(goalId, userId);
      
      res.json({
        ...progress,
        _links: {
          self: `/api/v1/progress/${goalId}`,
          goal: `/api/v1/goals/${goalId}`,
          path: `/api/v1/path/${goalId}`,
        },
      });
    })
  );

  return router;
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export default createProgressRouter;
