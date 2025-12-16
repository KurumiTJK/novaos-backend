// ═══════════════════════════════════════════════════════════════════════════════
// SEARCH ROUTES — API Endpoints for Search & Indexing
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getSearchService } from '../../search/index.js';
import type { AuthenticatedRequest } from '../../auth/index.js';
import { getLogger } from '../../logging/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// VALIDATION SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────────

const SearchQuerySchema = z.object({
  query: z.string().min(1).max(1000),
  scope: z.enum(['all', 'conversations', 'messages', 'memories']).optional(),
  filters: z.object({
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    tags: z.array(z.string()).optional(),
    categories: z.array(z.string()).optional(),
    conversationIds: z.array(z.string()).optional(),
    memoryConfidence: z.array(z.enum(['explicit', 'inferred', 'uncertain'])).optional(),
    memorySensitivity: z.array(z.enum(['public', 'private', 'sensitive'])).optional(),
  }).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
  fuzzy: z.boolean().optional(),
  highlight: z.boolean().optional(),
  minScore: z.number().min(0).max(1).optional(),
});

const IndexConversationSchema = z.object({
  conversationId: z.string().min(1),
  title: z.string().min(1).max(200),
  messagePreview: z.string().max(2000),
  metadata: z.object({
    messageCount: z.number().int().min(0),
    tags: z.array(z.string()).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime().optional(),
  }),
});

const IndexMessageSchema = z.object({
  messageId: z.string().min(1),
  conversationId: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1).max(100000),
  timestamp: z.string().datetime(),
});

const IndexMemorySchema = z.object({
  memoryId: z.string().min(1),
  category: z.string().min(1),
  key: z.string().min(1),
  value: z.string().min(1).max(10000),
  metadata: z.object({
    confidence: z.string(),
    tags: z.array(z.string()).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime().optional(),
  }),
});

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'search-routes' });

// ─────────────────────────────────────────────────────────────────────────────────
// ROUTER FACTORY
// ─────────────────────────────────────────────────────────────────────────────────

export function createSearchRouter(): Router {
  const router = Router();
  const searchService = getSearchService();
  
  // ─────────────────────────────────────────────────────────────────────────────
  // SEARCH ENDPOINTS
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * POST /search
   * Execute a search query
   */
  router.post('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const parsed = SearchQuerySchema.parse(req.body);
      
      const results = await searchService.search(userId, parsed);
      
      logger.info('Search executed', {
        userId,
        query: parsed.query,
        scope: parsed.scope ?? 'all',
        resultCount: results.totalResults,
        searchTimeMs: results.searchTimeMs,
      });
      
      res.json(results);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Invalid search query',
          details: error.errors,
        });
        return;
      }
      
      logger.error('Search failed', { error });
      res.status(500).json({ error: 'Search failed' });
    }
  });
  
  /**
   * GET /search/conversations
   * Search conversations only
   */
  router.get('/conversations', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const query = req.query.q as string;
      
      if (!query) {
        res.status(400).json({ error: 'Query parameter q is required' });
        return;
      }
      
      const results = await searchService.searchConversations(userId, query, {
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
        tags: req.query.tags ? (req.query.tags as string).split(',') : undefined,
      });
      
      res.json(results);
    } catch (error) {
      logger.error('Conversation search failed', { error });
      res.status(500).json({ error: 'Search failed' });
    }
  });
  
  /**
   * GET /search/messages
   * Search messages only
   */
  router.get('/messages', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const query = req.query.q as string;
      
      if (!query) {
        res.status(400).json({ error: 'Query parameter q is required' });
        return;
      }
      
      const results = await searchService.searchMessages(userId, query, {
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
        conversationIds: req.query.conversationId 
          ? [(req.query.conversationId as string)] 
          : undefined,
      });
      
      res.json(results);
    } catch (error) {
      logger.error('Message search failed', { error });
      res.status(500).json({ error: 'Search failed' });
    }
  });
  
  /**
   * GET /search/memories
   * Search memories only
   */
  router.get('/memories', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const query = req.query.q as string;
      
      if (!query) {
        res.status(400).json({ error: 'Query parameter q is required' });
        return;
      }
      
      const results = await searchService.searchMemories(userId, query, {
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
        categories: req.query.category 
          ? [(req.query.category as string)] 
          : undefined,
      });
      
      res.json(results);
    } catch (error) {
      logger.error('Memory search failed', { error });
      res.status(500).json({ error: 'Search failed' });
    }
  });
  
  /**
   * GET /search/tags
   * Search by tag
   */
  router.get('/tags/:tag', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { tag } = req.params;
      
      const results = await searchService.searchByTag(userId, tag, {
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
      });
      
      res.json(results);
    } catch (error) {
      logger.error('Tag search failed', { error });
      res.status(500).json({ error: 'Search failed' });
    }
  });
  
  // ─────────────────────────────────────────────────────────────────────────────
  // SUGGESTIONS & HISTORY
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * GET /search/suggestions
   * Get search suggestions
   */
  router.get('/suggestions', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const prefix = req.query.prefix as string | undefined;
      const limit = req.query.limit 
        ? parseInt(req.query.limit as string, 10) 
        : 10;
      
      const suggestions = await searchService.getSuggestions(userId, prefix, limit);
      
      res.json({ suggestions });
    } catch (error) {
      logger.error('Suggestions failed', { error });
      res.status(500).json({ error: 'Failed to get suggestions' });
    }
  });
  
  /**
   * GET /search/history
   * Get search history
   */
  router.get('/history', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      
      const history = await searchService.getSearchHistory(userId, {
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 20,
        offset: req.query.offset ? parseInt(req.query.offset as string, 10) : 0,
      });
      
      res.json({ history });
    } catch (error) {
      logger.error('Get history failed', { error });
      res.status(500).json({ error: 'Failed to get history' });
    }
  });
  
  /**
   * DELETE /search/history
   * Clear search history
   */
  router.delete('/history', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      
      const count = await searchService.clearSearchHistory(userId);
      
      logger.info('Search history cleared', { userId, count });
      
      res.json({ cleared: count });
    } catch (error) {
      logger.error('Clear history failed', { error });
      res.status(500).json({ error: 'Failed to clear history' });
    }
  });
  
  /**
   * GET /search/recent
   * Get recent unique queries
   */
  router.get('/recent', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const limit = req.query.limit 
        ? parseInt(req.query.limit as string, 10) 
        : 10;
      
      const recent = await searchService.getRecentSearches(userId, limit);
      
      res.json({ recent });
    } catch (error) {
      logger.error('Get recent searches failed', { error });
      res.status(500).json({ error: 'Failed to get recent searches' });
    }
  });
  
  // ─────────────────────────────────────────────────────────────────────────────
  // INDEX MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * POST /search/index/conversation
   * Index a conversation
   */
  router.post('/index/conversation', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const parsed = IndexConversationSchema.parse(req.body);
      
      await searchService.indexConversation(
        userId,
        parsed.conversationId,
        parsed.title,
        parsed.messagePreview,
        parsed.metadata
      );
      
      logger.debug('Conversation indexed', { 
        userId, 
        conversationId: parsed.conversationId 
      });
      
      res.json({ indexed: true, id: parsed.conversationId });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Invalid conversation data',
          details: error.errors,
        });
        return;
      }
      
      logger.error('Index conversation failed', { error });
      res.status(500).json({ error: 'Failed to index conversation' });
    }
  });
  
  /**
   * POST /search/index/message
   * Index a message
   */
  router.post('/index/message', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const parsed = IndexMessageSchema.parse(req.body);
      
      await searchService.indexMessage(
        userId,
        parsed.messageId,
        parsed.conversationId,
        parsed.role,
        parsed.content,
        parsed.timestamp
      );
      
      logger.debug('Message indexed', { 
        userId, 
        messageId: parsed.messageId 
      });
      
      res.json({ indexed: true, id: parsed.messageId });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Invalid message data',
          details: error.errors,
        });
        return;
      }
      
      logger.error('Index message failed', { error });
      res.status(500).json({ error: 'Failed to index message' });
    }
  });
  
  /**
   * POST /search/index/memory
   * Index a memory
   */
  router.post('/index/memory', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const parsed = IndexMemorySchema.parse(req.body);
      
      await searchService.indexMemory(
        userId,
        parsed.memoryId,
        parsed.category,
        parsed.key,
        parsed.value,
        parsed.metadata
      );
      
      logger.debug('Memory indexed', { 
        userId, 
        memoryId: parsed.memoryId 
      });
      
      res.json({ indexed: true, id: parsed.memoryId });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Invalid memory data',
          details: error.errors,
        });
        return;
      }
      
      logger.error('Index memory failed', { error });
      res.status(500).json({ error: 'Failed to index memory' });
    }
  });
  
  /**
   * DELETE /search/index/:docId
   * Remove a document from the index
   */
  router.delete('/index/:docId', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { docId } = req.params;
      
      const removed = await searchService.removeFromIndex(userId, docId);
      
      if (!removed) {
        res.status(404).json({ error: 'Document not found in index' });
        return;
      }
      
      logger.debug('Document removed from index', { userId, docId });
      
      res.json({ removed: true });
    } catch (error) {
      logger.error('Remove from index failed', { error });
      res.status(500).json({ error: 'Failed to remove from index' });
    }
  });
  
  /**
   * GET /search/index/stats
   * Get index statistics
   */
  router.get('/index/stats', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      
      const stats = await searchService.getIndexStats(userId);
      
      res.json(stats);
    } catch (error) {
      logger.error('Get index stats failed', { error });
      res.status(500).json({ error: 'Failed to get index stats' });
    }
  });
  
  /**
   * DELETE /search/index
   * Clear the entire index
   */
  router.delete('/index', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      
      const count = await searchService.clearIndex(userId);
      
      logger.info('Search index cleared', { userId, count });
      
      res.json({ cleared: count });
    } catch (error) {
      logger.error('Clear index failed', { error });
      res.status(500).json({ error: 'Failed to clear index' });
    }
  });
  
  // ─────────────────────────────────────────────────────────────────────────────
  // TAGS
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * GET /search/tags
   * Get all tags
   */
  router.get('/tags', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      
      const tags = await searchService.getAllTags(userId);
      
      res.json({ tags });
    } catch (error) {
      logger.error('Get tags failed', { error });
      res.status(500).json({ error: 'Failed to get tags' });
    }
  });
  
  // ─────────────────────────────────────────────────────────────────────────────
  // STATS
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * GET /search/stats
   * Get search usage statistics
   */
  router.get('/stats', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      
      const stats = await searchService.getSearchStats(userId);
      
      res.json(stats);
    } catch (error) {
      logger.error('Get search stats failed', { error });
      res.status(500).json({ error: 'Failed to get search stats' });
    }
  });
  
  return router;
}
