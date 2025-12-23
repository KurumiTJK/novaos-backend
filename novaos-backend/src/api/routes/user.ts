// ═══════════════════════════════════════════════════════════════════════════════
// USER ROUTES — GDPR Compliance: Export & Delete
// NovaOS API Layer — Phase 14
// ═══════════════════════════════════════════════════════════════════════════════
//
// Endpoints:
//   GET    /me                 Get current user info
//   POST   /me/export          Export all user data (GDPR Article 20)
//   DELETE /me                 Delete all user data (GDPR Article 17)
//
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, type Response } from 'express';
import { z } from 'zod';
import { auth, type AuthenticatedRequest } from '../../auth/index.js';
import { getSwordStore } from '../../core/sword/index.js';
import { getLogger } from '../../logging/index.js';

// Middleware
import {
  asyncHandler,
  ValidationError,
} from '../middleware/error-handler.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'user-routes' });

// ─────────────────────────────────────────────────────────────────────────────────
// SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Schema for deletion confirmation.
 * Requires explicit confirmation and optional feedback.
 */
const DeleteAccountSchema = z.object({
  confirm: z.literal(true, {
    errorMap: () => ({ message: 'Must confirm deletion with confirm: true' }),
  }),
  confirmPhrase: z.literal('DELETE MY ACCOUNT', {
    errorMap: () => ({ message: 'Must include confirmPhrase: "DELETE MY ACCOUNT"' }),
  }),
  reason: z.enum([
    'not_useful',
    'too_complicated',
    'privacy_concerns',
    'switching_service',
    'other',
  ]).optional(),
  feedback: z.string().max(2000).trim().optional(),
});

/**
 * Schema for export request.
 */
const ExportDataSchema = z.object({
  format: z.enum(['json', 'csv']).optional().default('json'),
  includeDeleted: z.boolean().optional().default(false),
});

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

interface UserDataExport {
  exportedAt: string;
  userId: string;
  format: 'json' | 'csv';
  
  // User profile (if available)
  profile?: {
    email?: string;
    createdAt?: string;
    tier?: string;
  };
  
  // All user data
  data: {
    goals: unknown[];
    quests: unknown[];
    steps: unknown[];
    sparks: unknown[];
    reminderConfig?: unknown;
  };
  
  // Metadata
  metadata: {
    totalGoals: number;
    totalQuests: number;
    totalSteps: number;
    totalSparks: number;
    dataRangeStart: string | null;
    dataRangeEnd: string | null;
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Collect all user data for export.
 */
async function collectUserData(userId: string): Promise<UserDataExport['data']> {
  const store = getSwordStore();
  
  // Get all goals
  const goals = await store.getUserGoals(userId);
  
  // Get all quests for each goal
  const questArrays = await Promise.all(
    goals.map((g) => store.getQuestsForGoal(g.id))
  );
  const quests = questArrays.flat();
  
  // Get all steps for each quest
  const stepArrays = await Promise.all(
    quests.map((q) => store.getStepsForQuest(q.id))
  );
  const steps = stepArrays.flat();
  
  // Get all sparks
  const sparks = await store.getUserSparks(userId, 10000);
  
  // Get reminder config if available
  let reminderConfig: unknown = null;
  try {
    const { getReminderService } = await import('../../core/sword/index.js');
    const service = getReminderService();
    if (service) {
      reminderConfig = await service.getUserConfig(userId);
    }
  } catch {
    // Reminder service not available
  }
  
  return {
    goals,
    quests,
    steps,
    sparks,
    reminderConfig,
  };
}

/**
 * Calculate date range of data.
 */
function calculateDataRange(data: UserDataExport['data']): { start: string | null; end: string | null } {
  const allDates: Date[] = [];
  
  for (const goal of data.goals as Array<{ createdAt: string }>) {
    allDates.push(new Date(goal.createdAt));
  }
  
  for (const spark of data.sparks as Array<{ createdAt: string }>) {
    allDates.push(new Date(spark.createdAt));
  }
  
  if (allDates.length === 0) {
    return { start: null, end: null };
  }
  
  const timestamps = allDates.map((d) => d.getTime());
  return {
    start: new Date(Math.min(...timestamps)).toISOString(),
    end: new Date(Math.max(...timestamps)).toISOString(),
  };
}

/**
 * Convert data to CSV format.
 */
function convertToCSV(data: UserDataExport['data']): string {
  const sections: string[] = [];
  
  // Goals CSV
  if ((data.goals as unknown[]).length > 0) {
    sections.push('# GOALS');
    sections.push(arrayToCSV(data.goals as Record<string, unknown>[]));
  }
  
  // Quests CSV
  if ((data.quests as unknown[]).length > 0) {
    sections.push('\n# QUESTS');
    sections.push(arrayToCSV(data.quests as Record<string, unknown>[]));
  }
  
  // Steps CSV
  if ((data.steps as unknown[]).length > 0) {
    sections.push('\n# STEPS');
    sections.push(arrayToCSV(data.steps as Record<string, unknown>[]));
  }
  
  // Sparks CSV
  if ((data.sparks as unknown[]).length > 0) {
    sections.push('\n# SPARKS');
    sections.push(arrayToCSV(data.sparks as Record<string, unknown>[]));
  }
  
  return sections.join('\n');
}

/**
 * Convert array of objects to CSV string.
 */
function arrayToCSV(arr: Record<string, unknown>[]): string {
  if (arr.length === 0) return '';
  
  // Get all unique keys
  const keys = [...new Set(arr.flatMap((obj) => Object.keys(obj)))];
  
  // Header row
  const header = keys.map(escapeCSV).join(',');
  
  // Data rows
  const rows = arr.map((obj) => 
    keys.map((key) => escapeCSV(String(obj[key] ?? ''))).join(',')
  );
  
  return [header, ...rows].join('\n');
}

/**
 * Escape a value for CSV.
 */
function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Delete all user data.
 */
async function deleteAllUserData(userId: string): Promise<{
  deletedGoals: number;
  deletedQuests: number;
  deletedSteps: number;
  deletedSparks: number;
}> {
  const store = getSwordStore();
  
  // Get all goals first
  const goals = await store.getUserGoals(userId);
  
  // Get all quests
  const questArrays = await Promise.all(
    goals.map((g) => store.getQuestsForGoal(g.id))
  );
  const quests = questArrays.flat();
  
  // Get all steps
  const stepArrays = await Promise.all(
    quests.map((q) => store.getStepsForQuest(q.id))
  );
  const steps = stepArrays.flat();
  
  // Get all sparks
  const sparks = await store.getUserSparks(userId, 10000);
  
  // Delete in reverse order (sparks -> steps -> quests -> goals)
  // to maintain referential integrity
  
  // Delete sparks
  for (const spark of sparks) {
    await store.deleteSpark(spark.id);
  }
  
  // Delete steps
  for (const step of steps) {
    await store.deleteStep(step.id);
  }
  
  // Delete quests
  for (const quest of quests) {
    await store.deleteQuest(quest.id);
  }
  
  // Delete goals
  for (const goal of goals) {
    await store.deleteGoal(goal.id);
  }
  
  // Delete reminder config if available
  try {
    const { getReminderService } = await import('../../core/sword/index.js');
    const service = getReminderService();
    if (service) {
      await service.deleteUserConfig(userId);
    }
  } catch {
    // Reminder service not available
  }
  
  return {
    deletedGoals: goals.length,
    deletedQuests: quests.length,
    deletedSteps: steps.length,
    deletedSparks: sparks.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// ROUTER FACTORY
// ─────────────────────────────────────────────────────────────────────────────────

export function createUserRouter(): Router {
  const router = Router();

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET CURRENT USER
  // GET /me
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get(
    '/',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      const user = req.user;
      
      const store = getSwordStore();
      
      // Get basic stats
      const goals = await store.getUserGoals(userId);
      const sparks = await store.getUserSparks(userId, 1000);
      
      res.json({
        userId,
        email: user?.email,
        tier: user?.tier ?? 'free',
        createdAt: user?.createdAt,
        
        stats: {
          totalGoals: goals.length,
          activeGoals: goals.filter((g) => g.status === 'active').length,
          totalSparks: sparks.length,
          completedSparks: sparks.filter((s) => s.status === 'completed').length,
        },
        
        _links: {
          self: '/api/v1/me',
          export: '/api/v1/me/export',
          delete: '/api/v1/me',
          goals: '/api/v1/goals',
          sparks: '/api/v1/sparks',
          progress: '/api/v1/progress',
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // EXPORT USER DATA (GDPR Article 20 - Right to Data Portability)
  // POST /me/export
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.post(
    '/export',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      const user = req.user;
      
      // Validate request body
      const parseResult = ExportDataSchema.safeParse(req.body || {});
      if (!parseResult.success) {
        throw new ValidationError(
          parseResult.error.issues.map((i) => i.message).join(', ')
        );
      }
      
      const { format } = parseResult.data;
      
      logger.info('Exporting user data', {
        userId,
        format,
        requestId: req.requestId,
      });
      
      // Collect all data
      const data = await collectUserData(userId);
      const dateRange = calculateDataRange(data);
      
      const exportData: UserDataExport = {
        exportedAt: new Date().toISOString(),
        userId,
        format,
        
        profile: {
          email: user?.email,
          createdAt: user?.createdAt,
          tier: user?.tier,
        },
        
        data,
        
        metadata: {
          totalGoals: (data.goals as unknown[]).length,
          totalQuests: (data.quests as unknown[]).length,
          totalSteps: (data.steps as unknown[]).length,
          totalSparks: (data.sparks as unknown[]).length,
          dataRangeStart: dateRange.start,
          dataRangeEnd: dateRange.end,
        },
      };
      
      logger.info('User data exported', {
        userId,
        format,
        totalGoals: exportData.metadata.totalGoals,
        totalSparks: exportData.metadata.totalSparks,
        requestId: req.requestId,
      });
      
      if (format === 'csv') {
        const csv = convertToCSV(data);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="novaos-export-${userId}-${Date.now()}.csv"`);
        res.send(csv);
        return;
      }
      
      // JSON format (default)
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="novaos-export-${userId}-${Date.now()}.json"`);
      res.json(exportData);
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // DELETE USER DATA (GDPR Article 17 - Right to Erasure)
  // DELETE /me
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.delete(
    '/',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      
      // Validate confirmation
      const parseResult = DeleteAccountSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          'Deletion requires confirmation. Send { "confirm": true, "confirmPhrase": "DELETE MY ACCOUNT" } in request body.',
          { 
            required: ['confirm', 'confirmPhrase'],
            errors: parseResult.error.flatten().fieldErrors,
          }
        );
      }
      
      const { reason, feedback } = parseResult.data;
      
      logger.warn('Deleting all user data', {
        userId,
        reason,
        hasFeedback: !!feedback,
        requestId: req.requestId,
      });
      
      // Perform deletion
      const result = await deleteAllUserData(userId);
      
      logger.warn('User data deleted', {
        userId,
        ...result,
        requestId: req.requestId,
      });
      
      // Store feedback for product improvement (anonymized)
      if (reason || feedback) {
        logger.info('Account deletion feedback', {
          reason,
          feedback: feedback?.substring(0, 200), // Truncate for logs
          // Note: userId intentionally omitted for privacy
        });
      }
      
      res.json({
        deleted: true,
        userId,
        deletedAt: new Date().toISOString(),
        summary: {
          goals: result.deletedGoals,
          quests: result.deletedQuests,
          steps: result.deletedSteps,
          sparks: result.deletedSparks,
        },
        message: 'All your data has been permanently deleted. This action cannot be undone.',
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // DELETION PREVIEW (What will be deleted)
  // GET /me/deletion-preview
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get(
    '/deletion-preview',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      
      const store = getSwordStore();
      
      // Count all data
      const goals = await store.getUserGoals(userId);
      const questArrays = await Promise.all(
        goals.map((g) => store.getQuestsForGoal(g.id))
      );
      const quests = questArrays.flat();
      const stepArrays = await Promise.all(
        quests.map((q) => store.getStepsForQuest(q.id))
      );
      const steps = stepArrays.flat();
      const sparks = await store.getUserSparks(userId, 10000);
      
      res.json({
        userId,
        preview: {
          goals: goals.length,
          quests: quests.length,
          steps: steps.length,
          sparks: sparks.length,
          reminderConfig: 1,
        },
        totalItems: goals.length + quests.length + steps.length + sparks.length + 1,
        warning: 'This action is permanent and cannot be undone.',
        instructions: {
          method: 'DELETE',
          endpoint: '/api/v1/me',
          requiredBody: {
            confirm: true,
            confirmPhrase: 'DELETE MY ACCOUNT',
          },
          optionalBody: {
            reason: 'One of: not_useful, too_complicated, privacy_concerns, switching_service, other',
            feedback: 'Optional feedback (max 2000 characters)',
          },
        },
        _links: {
          self: '/api/v1/me/deletion-preview',
          export: '/api/v1/me/export',
          delete: '/api/v1/me',
        },
      });
    })
  );

  return router;
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export default createUserRouter;
