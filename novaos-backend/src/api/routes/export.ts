// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT ROUTES — API Endpoints for Data Export, Import, Deletion
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, type Response } from 'express';
import { z } from 'zod';
import { getExportService, MIME_TYPES, FILE_EXTENSIONS } from '../../export/index.js';
import type { AuthenticatedRequest } from '../../auth/index.js';
import { getLogger } from '../../logging/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// VALIDATION SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────────

const ExportRequestSchema = z.object({
  scopes: z.array(z.enum([
    'all', 'conversations', 'memories', 'goals', 'profile', 'search_history'
  ])).min(1),
  format: z.enum(['json', 'markdown', 'csv']),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  includeMetadata: z.boolean().optional(),
  prettyPrint: z.boolean().optional(),
  redactSensitive: z.boolean().optional(),
});

const ImportRequestSchema = z.object({
  data: z.string().min(1),
  overwrite: z.boolean().optional(),
  mergeStrategy: z.enum(['skip', 'replace', 'newest', 'merge']).optional(),
  dryRun: z.boolean().optional(),
});

const DeletionRequestSchema = z.object({
  confirmation: z.string().min(1),
  exportFirst: z.boolean().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'export-routes' });

// ─────────────────────────────────────────────────────────────────────────────────
// ROUTER FACTORY
// ─────────────────────────────────────────────────────────────────────────────────

export function createExportRouter(): Router {
  const router = Router();
  const exportService = getExportService();
  
  // ─────────────────────────────────────────────────────────────────────────────
  // EXPORT ENDPOINTS
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * POST /export
   * Create a data export
   */
  router.post('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const parsed = ExportRequestSchema.parse(req.body);
      
      const { content, result } = await exportService.exportToString({
        userId,
        ...parsed,
      });
      
      logger.info('Data export created', {
        userId,
        exportId: result.exportId,
        scopes: parsed.scopes,
        format: parsed.format,
        sizeBytes: result.sizeBytes,
      });
      
      // Return metadata and download URL
      res.json({
        exportId: result.exportId,
        filename: result.filename,
        mimeType: result.mimeType,
        sizeBytes: result.sizeBytes,
        stats: result.stats,
        createdAt: result.createdAt,
        expiresAt: result.expiresAt,
        downloadUrl: `/api/v1/export/${result.exportId}/download`,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Invalid export request',
          details: error.errors,
        });
        return;
      }
      
      logger.error('Export failed', { error });
      res.status(500).json({ error: 'Export failed' });
    }
  });
  
  /**
   * POST /export/download
   * Create and immediately download export
   */
  router.post('/download', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const parsed = ExportRequestSchema.parse(req.body);
      
      const { content, result } = await exportService.exportToString({
        userId,
        ...parsed,
      });
      
      logger.info('Direct download export', {
        userId,
        exportId: result.exportId,
        format: parsed.format,
      });
      
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.send(content);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Invalid export request',
          details: error.errors,
        });
        return;
      }
      
      logger.error('Download export failed', { error });
      res.status(500).json({ error: 'Export failed' });
    }
  });
  
  /**
   * GET /export/:exportId
   * Get export job status
   */
  router.get('/:exportId', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { exportId } = req.params;
      
      const job = await exportService.getExportJob(exportId);
      
      if (!job) {
        res.status(404).json({ error: 'Export not found' });
        return;
      }
      
      if (job.userId !== userId) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      
      res.json({
        id: job.id,
        status: job.status,
        progress: job.progress,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        expiresAt: job.expiresAt,
        result: job.result ? {
          filename: job.result.filename,
          mimeType: job.result.mimeType,
          sizeBytes: job.result.sizeBytes,
          stats: job.result.stats,
        } : undefined,
        error: job.error,
      });
    } catch (error) {
      logger.error('Get export failed', { error });
      res.status(500).json({ error: 'Failed to get export' });
    }
  });
  
  /**
   * GET /export/:exportId/download
   * Download export data
   */
  router.get('/:exportId/download', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { exportId } = req.params;
      
      const job = await exportService.getExportJob(exportId);
      
      if (!job) {
        res.status(404).json({ error: 'Export not found' });
        return;
      }
      
      if (job.userId !== userId) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      
      if (job.status !== 'completed' || !job.result) {
        res.status(400).json({ error: 'Export not ready' });
        return;
      }
      
      // Check expiration
      if (new Date(job.expiresAt) < new Date()) {
        res.status(410).json({ error: 'Export has expired' });
        return;
      }
      
      // Re-generate content (since we don't store the actual file)
      const { content } = await exportService.exportToString(job.request);
      
      res.setHeader('Content-Type', job.result.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${job.result.filename}"`);
      res.send(content);
    } catch (error) {
      logger.error('Download failed', { error });
      res.status(500).json({ error: 'Download failed' });
    }
  });
  
  /**
   * GET /export/jobs
   * List user's export jobs
   */
  router.get('/jobs/list', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      
      const jobs = await exportService.listExportJobs(userId);
      
      res.json({
        jobs: jobs.map(job => ({
          id: job.id,
          status: job.status,
          scopes: job.request.scopes,
          format: job.request.format,
          createdAt: job.createdAt,
          completedAt: job.completedAt,
          expiresAt: job.expiresAt,
          stats: job.result?.stats,
        })),
      });
    } catch (error) {
      logger.error('List exports failed', { error });
      res.status(500).json({ error: 'Failed to list exports' });
    }
  });
  
  // ─────────────────────────────────────────────────────────────────────────────
  // SINGLE RESOURCE EXPORTS
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * GET /export/conversation/:conversationId
   * Export a single conversation
   */
  router.get('/conversation/:conversationId', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { conversationId } = req.params;
      const format = (req.query.format as 'json' | 'markdown' | 'csv') ?? 'markdown';
      
      const { content, conversation } = await exportService.exportConversation(
        userId,
        conversationId,
        format
      );
      
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      
      const filename = `conversation-${conversationId}${FILE_EXTENSIONS[format]}`;
      
      res.setHeader('Content-Type', MIME_TYPES[format]);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(content);
    } catch (error) {
      logger.error('Export conversation failed', { error });
      res.status(500).json({ error: 'Export failed' });
    }
  });
  
  /**
   * GET /export/goal/:goalId
   * Export a single goal with quests/steps
   */
  router.get('/goal/:goalId', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { goalId } = req.params;
      const format = (req.query.format as 'json' | 'markdown' | 'csv') ?? 'markdown';
      
      const { content, goal } = await exportService.exportGoal(userId, goalId, format);
      
      if (!goal) {
        res.status(404).json({ error: 'Goal not found' });
        return;
      }
      
      const filename = `goal-${goalId}${FILE_EXTENSIONS[format]}`;
      
      res.setHeader('Content-Type', MIME_TYPES[format]);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(content);
    } catch (error) {
      logger.error('Export goal failed', { error });
      res.status(500).json({ error: 'Export failed' });
    }
  });
  
  // ─────────────────────────────────────────────────────────────────────────────
  // IMPORT ENDPOINTS
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * POST /export/import
   * Import data from backup
   */
  router.post('/import', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const parsed = ImportRequestSchema.parse(req.body);
      
      const result = await exportService.import({
        userId,
        ...parsed,
      });
      
      logger.info('Data import completed', {
        userId,
        success: result.success,
        dryRun: result.dryRun,
        imported: result.imported,
        errors: result.errors.length,
      });
      
      res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Invalid import request',
          details: error.errors,
        });
        return;
      }
      
      logger.error('Import failed', { error });
      res.status(500).json({ error: 'Import failed' });
    }
  });
  
  /**
   * POST /export/import/validate
   * Validate import data without importing
   */
  router.post('/import/validate', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const parsed = ImportRequestSchema.parse(req.body);
      
      const result = await exportService.import({
        userId,
        ...parsed,
        dryRun: true,
      });
      
      res.json({
        valid: result.errors.length === 0,
        wouldImport: result.imported,
        errors: result.errors,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Invalid import data',
          details: error.errors,
        });
        return;
      }
      
      logger.error('Validate import failed', { error });
      res.status(500).json({ error: 'Validation failed' });
    }
  });
  
  // ─────────────────────────────────────────────────────────────────────────────
  // DELETION ENDPOINTS
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * DELETE /export/account
   * Delete all user data (GDPR right to erasure)
   */
  router.delete('/account', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const parsed = DeletionRequestSchema.parse(req.body);
      
      // Verify confirmation matches user ID
      if (parsed.confirmation !== userId) {
        res.status(400).json({
          error: 'Confirmation must match your user ID',
          required: userId,
        });
        return;
      }
      
      const result = await exportService.deleteUserData({
        userId,
        ...parsed,
      });
      
      logger.warn('User data deleted', {
        userId,
        deleted: result.deleted,
        exportId: result.exportId,
      });
      
      res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Invalid deletion request',
          details: error.errors,
        });
        return;
      }
      
      logger.error('Deletion failed', { error });
      res.status(500).json({ error: 'Deletion failed' });
    }
  });
  
  /**
   * GET /export/account/preview
   * Preview what would be deleted
   */
  router.get('/account/preview', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      
      // Get export with all scopes to count data
      const result = await exportService.export({
        userId,
        scopes: ['all'],
        format: 'json',
      });
      
      res.json({
        userId,
        wouldDelete: {
          conversations: result.stats.conversations,
          messages: result.stats.messages,
          memories: result.stats.memories,
          goals: result.stats.goals,
          quests: result.stats.quests,
          steps: result.stats.steps,
          sparks: result.stats.sparks,
          searchHistory: result.stats.searchHistory,
          profile: result.data.profile ? 1 : 0,
          preferences: result.data.preferences ? 1 : 0,
        },
        warning: 'This action is irreversible. Export your data first if needed.',
        confirmationRequired: userId,
      });
    } catch (error) {
      logger.error('Deletion preview failed', { error });
      res.status(500).json({ error: 'Preview failed' });
    }
  });
  
  return router;
}
