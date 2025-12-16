// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT SERVICE — Data Export, Import, and Deletion
// ═══════════════════════════════════════════════════════════════════════════════

import { getStore, type KeyValueStore } from '../storage/index.js';
import type {
  ExportRequest,
  ExportResult,
  ExportedData,
  ExportedConversation,
  ExportedMessage,
  ExportedMemory,
  ExportedGoal,
  ExportedQuest,
  ExportedStep,
  ExportedSpark,
  ExportedSearchEntry,
  ExportedProfile,
  ExportedPreferences,
  ExportStats,
  ExportOptions,
  ExportScope,
  ExportFormat,
  ExportJob,
  ExportJobStatus,
  ImportRequest,
  ImportResult,
  ImportCounts,
  ImportError,
  DeletionRequest,
  DeletionResult,
  DeletionCounts,
  ExportConfig,
} from './types.js';
import {
  EXPORT_VERSION,
  MIME_TYPES,
  FILE_EXTENSIONS,
  DEFAULT_EXPORT_CONFIG,
} from './types.js';
import { getFormatter } from './formatters.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

const EXPORT_JOB_TTL = 48 * 60 * 60; // 48 hours

// ─────────────────────────────────────────────────────────────────────────────────
// KEY GENERATION
// ─────────────────────────────────────────────────────────────────────────────────

function exportJobKey(jobId: string): string {
  return `export:job:${jobId}`;
}

function userExportsKey(userId: string): string {
  return `export:user:${userId}:jobs`;
}

function generateId(): string {
  return `exp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORT SERVICE
// ─────────────────────────────────────────────────────────────────────────────────

export class ExportService {
  private store: KeyValueStore;
  private config: ExportConfig;
  
  constructor(store?: KeyValueStore, config?: Partial<ExportConfig>) {
    this.store = store ?? getStore();
    this.config = { ...DEFAULT_EXPORT_CONFIG, ...config };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // EXPORT
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Create a data export.
   */
  async export(request: ExportRequest): Promise<ExportResult> {
    const exportId = generateId();
    const startTime = Date.now();
    
    const options: ExportOptions = {
      includeMetadata: request.includeMetadata ?? true,
      prettyPrint: request.prettyPrint ?? true,
      redactSensitive: request.redactSensitive ?? false,
      startDate: request.startDate ? new Date(request.startDate) : undefined,
      endDate: request.endDate ? new Date(request.endDate) : undefined,
    };
    
    // Collect data for each scope
    const data = await this.collectData(request.userId, request.scopes, options);
    
    // Format data
    const formatter = getFormatter(request.format);
    const content = formatter.format(data, options);
    
    // Calculate stats
    const stats = this.calculateStats(data);
    
    // Create result
    const now = new Date();
    const result: ExportResult = {
      exportId,
      userId: request.userId,
      format: request.format,
      scopes: request.scopes,
      data,
      filename: `nova-export-${request.userId}-${now.toISOString().slice(0, 10)}${FILE_EXTENSIONS[request.format]}`,
      mimeType: MIME_TYPES[request.format],
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.config.exportTTLHours * 60 * 60 * 1000).toISOString(),
      stats,
    };
    
    // Store export job record
    await this.storeExportJob(exportId, request, result);
    
    return result;
  }
  
  /**
   * Export to string content.
   */
  async exportToString(request: ExportRequest): Promise<{ content: string; result: ExportResult }> {
    const result = await this.export(request);
    
    const options: ExportOptions = {
      includeMetadata: request.includeMetadata ?? true,
      prettyPrint: request.prettyPrint ?? true,
      redactSensitive: request.redactSensitive ?? false,
    };
    
    const formatter = getFormatter(request.format);
    const content = formatter.format(result.data, options);
    
    return { content, result };
  }
  
  /**
   * Export a single conversation.
   */
  async exportConversation(
    userId: string,
    conversationId: string,
    format: ExportFormat = 'markdown'
  ): Promise<{ content: string; conversation: ExportedConversation | null }> {
    const conversation = await this.collectConversation(userId, conversationId);
    
    if (!conversation) {
      return { content: '', conversation: null };
    }
    
    const formatter = getFormatter(format);
    const content = formatter.formatConversation(conversation);
    
    return { content, conversation };
  }
  
  /**
   * Export a single goal with all quests/steps.
   */
  async exportGoal(
    userId: string,
    goalId: string,
    format: ExportFormat = 'markdown'
  ): Promise<{ content: string; goal: ExportedGoal | null }> {
    const goal = await this.collectGoal(userId, goalId);
    
    if (!goal) {
      return { content: '', goal: null };
    }
    
    const formatter = getFormatter(format);
    const content = formatter.formatGoal(goal);
    
    return { content, goal };
  }
  
  /**
   * Get export job status.
   */
  async getExportJob(jobId: string): Promise<ExportJob | null> {
    const data = await this.store.get(exportJobKey(jobId));
    return data ? JSON.parse(data) : null;
  }
  
  /**
   * List user's export jobs.
   */
  async listExportJobs(userId: string): Promise<ExportJob[]> {
    const jobIds = await this.getUserExportIds(userId);
    const jobs: ExportJob[] = [];
    
    for (const jobId of jobIds) {
      const job = await this.getExportJob(jobId);
      if (job) {
        jobs.push(job);
      }
    }
    
    return jobs.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // IMPORT
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Import data from backup.
   */
  async import(request: ImportRequest): Promise<ImportResult> {
    const startTime = Date.now();
    const errors: ImportError[] = [];
    
    const imported: ImportCounts = this.emptyImportCounts();
    const skipped: ImportCounts = this.emptyImportCounts();
    
    // Parse data
    let data: ExportedData;
    try {
      data = JSON.parse(request.data);
    } catch (e) {
      return {
        success: false,
        dryRun: request.dryRun ?? false,
        imported,
        skipped,
        errors: [{ type: 'parse', message: 'Invalid JSON data' }],
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      };
    }
    
    // Validate version
    if (!data.exportVersion) {
      errors.push({ type: 'validation', message: 'Missing export version' });
    }
    
    const mergeStrategy = request.mergeStrategy ?? 'skip';
    const dryRun = request.dryRun ?? false;
    
    // Import profile
    if (data.profile && !dryRun) {
      try {
        await this.importProfile(request.userId, data.profile, mergeStrategy);
        imported.profile = 1;
      } catch (e: any) {
        errors.push({ type: 'profile', message: e.message });
      }
    }
    
    // Import preferences
    if (data.preferences && !dryRun) {
      try {
        await this.importPreferences(request.userId, data.preferences, mergeStrategy);
        imported.preferences = 1;
      } catch (e: any) {
        errors.push({ type: 'preferences', message: e.message });
      }
    }
    
    // Import memories
    if (data.memories) {
      for (const memory of data.memories) {
        try {
          if (!dryRun) {
            const result = await this.importMemory(request.userId, memory, mergeStrategy);
            if (result === 'imported') {
              imported.memories++;
            } else {
              skipped.memories++;
            }
          } else {
            imported.memories++; // Count for dry run
          }
        } catch (e: any) {
          errors.push({ type: 'memory', id: memory.id, message: e.message });
        }
      }
    }
    
    // Import conversations
    if (data.conversations) {
      for (const conv of data.conversations) {
        try {
          if (!dryRun) {
            const result = await this.importConversation(request.userId, conv, mergeStrategy);
            if (result === 'imported') {
              imported.conversations++;
              imported.messages += conv.messages.length;
            } else {
              skipped.conversations++;
              skipped.messages += conv.messages.length;
            }
          } else {
            imported.conversations++;
            imported.messages += conv.messages.length;
          }
        } catch (e: any) {
          errors.push({ type: 'conversation', id: conv.id, message: e.message });
        }
      }
    }
    
    // Import goals (with nested quests, steps, sparks)
    if (data.goals) {
      for (const goal of data.goals) {
        try {
          if (!dryRun) {
            const result = await this.importGoal(request.userId, goal, mergeStrategy);
            if (result === 'imported') {
              imported.goals++;
              imported.quests += goal.quests.length;
              for (const quest of goal.quests) {
                imported.steps += quest.steps.length;
                for (const step of quest.steps) {
                  imported.sparks += step.sparks.length;
                }
              }
            } else {
              skipped.goals++;
            }
          } else {
            imported.goals++;
            imported.quests += goal.quests.length;
          }
        } catch (e: any) {
          errors.push({ type: 'goal', id: goal.id, message: e.message });
        }
      }
    }
    
    return {
      success: errors.length === 0,
      dryRun,
      imported,
      skipped,
      errors,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // DELETION
  // ═══════════════════════════════════════════════════════════════════════════════
  
  /**
   * Delete all user data (GDPR right to erasure).
   */
  async deleteUserData(request: DeletionRequest): Promise<DeletionResult> {
    // Verify confirmation
    if (this.config.requireConfirmation && request.confirmation !== request.userId) {
      throw new Error('Confirmation does not match user ID');
    }
    
    const deleted: DeletionCounts = {
      conversations: 0,
      messages: 0,
      memories: 0,
      goals: 0,
      quests: 0,
      steps: 0,
      sparks: 0,
      searchHistory: 0,
      indexDocuments: 0,
      profile: false,
      preferences: false,
    };
    
    let exportId: string | undefined;
    
    // Export first if requested
    if (request.exportFirst) {
      const result = await this.export({
        userId: request.userId,
        scopes: ['all'],
        format: 'json',
        includeMetadata: true,
        prettyPrint: true,
      });
      exportId = result.exportId;
    }
    
    // Delete conversations
    const convResult = await this.deleteConversations(request.userId);
    deleted.conversations = convResult.conversations;
    deleted.messages = convResult.messages;
    
    // Delete memories
    deleted.memories = await this.deleteMemories(request.userId);
    
    // Delete goals (cascades to quests, steps, sparks)
    const goalResult = await this.deleteGoals(request.userId);
    deleted.goals = goalResult.goals;
    deleted.quests = goalResult.quests;
    deleted.steps = goalResult.steps;
    deleted.sparks = goalResult.sparks;
    
    // Delete search history
    deleted.searchHistory = await this.deleteSearchHistory(request.userId);
    
    // Delete search index
    deleted.indexDocuments = await this.deleteSearchIndex(request.userId);
    
    // Delete profile
    deleted.profile = await this.deleteProfile(request.userId);
    
    // Delete preferences
    deleted.preferences = await this.deletePreferences(request.userId);
    
    return {
      success: true,
      userId: request.userId,
      deleted,
      exportId,
      deletedAt: new Date().toISOString(),
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // DATA COLLECTION
  // ═══════════════════════════════════════════════════════════════════════════════
  
  private async collectData(
    userId: string,
    scopes: ExportScope[],
    options: ExportOptions
  ): Promise<ExportedData> {
    const data: ExportedData = {
      exportVersion: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      userId,
      scopes,
    };
    
    const includeAll = scopes.includes('all');
    
    // Profile
    if (includeAll || scopes.includes('profile')) {
      data.profile = await this.collectProfile(userId);
      data.preferences = await this.collectPreferences(userId);
    }
    
    // Conversations
    if (includeAll || scopes.includes('conversations')) {
      data.conversations = await this.collectConversations(userId, options);
    }
    
    // Memories
    if (includeAll || scopes.includes('memories')) {
      data.memories = await this.collectMemories(userId, options);
    }
    
    // Goals
    if (includeAll || scopes.includes('goals')) {
      data.goals = await this.collectGoals(userId);
    }
    
    // Search history
    if (includeAll || scopes.includes('search_history')) {
      data.searchHistory = await this.collectSearchHistory(userId);
    }
    
    return data;
  }
  
  private async collectProfile(userId: string): Promise<ExportedProfile | undefined> {
    const data = await this.store.get(`memory:user:${userId}:profile`);
    if (!data) return undefined;
    
    const profile = JSON.parse(data);
    return {
      name: profile.name,
      role: profile.role,
      organization: profile.organization,
      location: profile.location,
      timezone: profile.timezone,
      preferredTone: profile.preferredTone,
      preferredDepth: profile.preferredDepth,
      preferredFormat: profile.preferredFormat,
      expertiseAreas: profile.expertiseAreas ?? [],
      expertiseLevel: profile.expertiseLevel,
      interests: profile.interests ?? [],
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }
  
  private async collectPreferences(userId: string): Promise<ExportedPreferences | undefined> {
    const data = await this.store.get(`memory:user:${userId}:preferences`);
    if (!data) return undefined;
    
    const prefs = JSON.parse(data);
    return {
      tone: prefs.tone,
      verbosity: prefs.verbosity,
      formatting: prefs.formatting,
      proactiveReminders: prefs.proactiveReminders,
      suggestNextSteps: prefs.suggestNextSteps,
      askClarifyingQuestions: prefs.askClarifyingQuestions,
      riskTolerance: prefs.riskTolerance,
      memoryEnabled: prefs.memoryEnabled,
      autoExtractFacts: prefs.autoExtractFacts,
      defaultMode: prefs.defaultMode,
      showConfidenceLevel: prefs.showConfidenceLevel,
      showSources: prefs.showSources,
      updatedAt: prefs.updatedAt,
    };
  }
  
  private async collectConversations(
    userId: string,
    options: ExportOptions
  ): Promise<ExportedConversation[]> {
    const conversations: ExportedConversation[] = [];
    
    // Get conversation IDs
    const convIds = await this.getListData(`user:${userId}:conversations`);
    
    for (const convId of convIds) {
      const conv = await this.collectConversation(userId, convId, options);
      if (conv) {
        conversations.push(conv);
      }
    }
    
    return conversations;
  }
  
  private async collectConversation(
    userId: string,
    conversationId: string,
    options?: ExportOptions
  ): Promise<ExportedConversation | null> {
    const convData = await this.store.get(`conv:${conversationId}`);
    if (!convData) return null;
    
    const conv = JSON.parse(convData);
    if (conv.userId !== userId) return null;
    
    // Apply date filters
    if (options?.startDate && new Date(conv.createdAt) < options.startDate) {
      return null;
    }
    if (options?.endDate && new Date(conv.createdAt) > options.endDate) {
      return null;
    }
    
    // Get messages
    const messagesData = await this.getListData(`conv:${conversationId}:messages`);
    const messages: ExportedMessage[] = [];
    
    for (const msgJson of messagesData) {
      try {
        const msg = JSON.parse(msgJson);
        messages.push({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          timestamp: new Date(msg.timestamp).toISOString(),
          metadata: msg.metadata,
        });
      } catch (e) {
        // Skip invalid messages
      }
    }
    
    // Reverse to chronological order
    messages.reverse();
    
    return {
      id: conv.id,
      title: conv.title,
      createdAt: new Date(conv.createdAt).toISOString(),
      updatedAt: new Date(conv.updatedAt).toISOString(),
      messageCount: conv.messageCount,
      tags: conv.metadata?.tags,
      messages,
    };
  }
  
  private async collectMemories(
    userId: string,
    options: ExportOptions
  ): Promise<ExportedMemory[]> {
    const memories: ExportedMemory[] = [];
    
    const memIds = await this.getJsonData(`memory:user:${userId}:items`) as string[] ?? [];
    
    for (const memId of memIds) {
      const memData = await this.store.get(`memory:item:${memId}`);
      if (!memData) continue;
      
      const mem = JSON.parse(memData);
      if (mem.userId !== userId) continue;
      
      memories.push({
        id: mem.id,
        category: mem.category,
        key: mem.key,
        value: mem.value,
        context: mem.context,
        confidence: mem.confidence,
        sensitivity: mem.sensitivity,
        createdAt: mem.createdAt,
        updatedAt: mem.updatedAt,
        reinforcementScore: mem.reinforcementScore,
      });
    }
    
    return memories;
  }
  
  private async collectGoals(userId: string): Promise<ExportedGoal[]> {
    const goals: ExportedGoal[] = [];
    
    const goalIds = await this.getJsonData(`sword:user:${userId}:goals`) as string[] ?? [];
    
    for (const goalId of goalIds) {
      const goal = await this.collectGoal(userId, goalId);
      if (goal) {
        goals.push(goal);
      }
    }
    
    return goals;
  }
  
  private async collectGoal(userId: string, goalId: string): Promise<ExportedGoal | null> {
    const goalData = await this.store.get(`sword:goal:${goalId}`);
    if (!goalData) return null;
    
    const goal = JSON.parse(goalData);
    if (goal.userId !== userId) return null;
    
    // Collect quests
    const quests: ExportedQuest[] = [];
    const questIds = await this.getJsonData(`sword:goal:${goalId}:quests`) as string[] ?? [];
    
    for (const questId of questIds) {
      const quest = await this.collectQuest(questId);
      if (quest) {
        quests.push(quest);
      }
    }
    
    return {
      id: goal.id,
      title: goal.title,
      description: goal.description,
      desiredOutcome: goal.desiredOutcome,
      interestLevel: goal.interestLevel,
      status: goal.status,
      progress: goal.progress,
      targetDate: goal.targetDate,
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
      completedAt: goal.completedAt,
      motivations: goal.motivations ?? [],
      constraints: goal.constraints ?? [],
      successCriteria: goal.successCriteria ?? [],
      tags: goal.tags ?? [],
      quests,
    };
  }
  
  private async collectQuest(questId: string): Promise<ExportedQuest | null> {
    const questData = await this.store.get(`sword:quest:${questId}`);
    if (!questData) return null;
    
    const quest = JSON.parse(questData);
    
    // Collect steps
    const steps: ExportedStep[] = [];
    const stepIds = await this.getJsonData(`sword:quest:${questId}:steps`) as string[] ?? [];
    
    for (const stepId of stepIds) {
      const step = await this.collectStep(stepId);
      if (step) {
        steps.push(step);
      }
    }
    
    return {
      id: quest.id,
      title: quest.title,
      description: quest.description,
      outcome: quest.outcome,
      status: quest.status,
      priority: quest.priority,
      progress: quest.progress,
      order: quest.order,
      estimatedMinutes: quest.estimatedMinutes,
      targetDate: quest.targetDate,
      createdAt: quest.createdAt,
      updatedAt: quest.updatedAt,
      completedAt: quest.completedAt,
      riskLevel: quest.riskLevel,
      steps,
    };
  }
  
  private async collectStep(stepId: string): Promise<ExportedStep | null> {
    const stepData = await this.store.get(`sword:step:${stepId}`);
    if (!stepData) return null;
    
    const step = JSON.parse(stepData);
    
    // Collect sparks (simplified - just get last spark if exists)
    const sparks: ExportedSpark[] = [];
    if (step.lastSparkId) {
      const sparkData = await this.store.get(`sword:spark:${step.lastSparkId}`);
      if (sparkData) {
        const spark = JSON.parse(sparkData);
        sparks.push({
          id: spark.id,
          action: spark.action,
          rationale: spark.rationale,
          estimatedMinutes: spark.estimatedMinutes,
          status: spark.status,
          createdAt: spark.createdAt,
          completedAt: spark.completedAt,
        });
      }
    }
    
    return {
      id: step.id,
      title: step.title,
      description: step.description,
      type: step.type,
      status: step.status,
      order: step.order,
      estimatedMinutes: step.estimatedMinutes,
      createdAt: step.createdAt,
      completedAt: step.completedAt,
      completionNotes: step.completionNotes,
      sparks,
    };
  }
  
  private async collectSearchHistory(userId: string): Promise<ExportedSearchEntry[]> {
    const history: ExportedSearchEntry[] = [];
    
    const entryIds = await this.getJsonData(`search:user:${userId}:history`) as string[] ?? [];
    
    for (const entryId of entryIds) {
      const entryData = await this.store.get(`search:history:${entryId}`);
      if (!entryData) continue;
      
      const entry = JSON.parse(entryData);
      history.push({
        query: entry.query,
        scope: entry.scope,
        resultCount: entry.resultCount,
        timestamp: entry.timestamp,
      });
    }
    
    return history;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // IMPORT HELPERS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  private async importProfile(
    userId: string,
    profile: ExportedProfile,
    strategy: string
  ): Promise<'imported' | 'skipped'> {
    const existing = await this.store.get(`memory:user:${userId}:profile`);
    
    if (existing && strategy === 'skip') {
      return 'skipped';
    }
    
    const data = {
      userId,
      ...profile,
      updatedAt: new Date().toISOString(),
    };
    
    await this.store.set(
      `memory:user:${userId}:profile`,
      JSON.stringify(data),
      365 * 24 * 60 * 60
    );
    
    return 'imported';
  }
  
  private async importPreferences(
    userId: string,
    prefs: ExportedPreferences,
    strategy: string
  ): Promise<'imported' | 'skipped'> {
    const existing = await this.store.get(`memory:user:${userId}:preferences`);
    
    if (existing && strategy === 'skip') {
      return 'skipped';
    }
    
    const data = {
      userId,
      ...prefs,
      updatedAt: new Date().toISOString(),
    };
    
    await this.store.set(
      `memory:user:${userId}:preferences`,
      JSON.stringify(data),
      365 * 24 * 60 * 60
    );
    
    return 'imported';
  }
  
  private async importMemory(
    userId: string,
    memory: ExportedMemory,
    strategy: string
  ): Promise<'imported' | 'skipped'> {
    const existing = await this.store.get(`memory:item:${memory.id}`);
    
    if (existing && strategy === 'skip') {
      return 'skipped';
    }
    
    const data = {
      ...memory,
      userId,
      source: { type: 'imported', timestamp: new Date().toISOString() },
    };
    
    await this.store.set(
      `memory:item:${memory.id}`,
      JSON.stringify(data),
      730 * 24 * 60 * 60
    );
    
    // Add to user's memory list
    const memIds = await this.getJsonData(`memory:user:${userId}:items`) as string[] ?? [];
    if (!memIds.includes(memory.id)) {
      memIds.push(memory.id);
      await this.store.set(
        `memory:user:${userId}:items`,
        JSON.stringify(memIds),
        730 * 24 * 60 * 60
      );
    }
    
    return 'imported';
  }
  
  private async importConversation(
    userId: string,
    conv: ExportedConversation,
    strategy: string
  ): Promise<'imported' | 'skipped'> {
    const existing = await this.store.get(`conv:${conv.id}`);
    
    if (existing && strategy === 'skip') {
      return 'skipped';
    }
    
    // Import conversation
    const convData = {
      id: conv.id,
      userId,
      title: conv.title,
      createdAt: new Date(conv.createdAt).getTime(),
      updatedAt: new Date(conv.updatedAt).getTime(),
      messageCount: conv.messageCount,
      totalTokens: 0,
      metadata: { tags: conv.tags },
    };
    
    await this.store.set(`conv:${conv.id}`, JSON.stringify(convData), 30 * 24 * 60 * 60);
    
    // Import messages (stored as list, newest first)
    for (const msg of [...conv.messages].reverse()) {
      const msgData = {
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: new Date(msg.timestamp).getTime(),
        metadata: msg.metadata,
      };
      
      await this.store.lpush(`conv:${conv.id}:messages`, JSON.stringify(msgData));
    }
    
    // Add to user's conversation list
    await this.store.lpush(`user:${userId}:conversations`, conv.id);
    
    return 'imported';
  }
  
  private async importGoal(
    userId: string,
    goal: ExportedGoal,
    strategy: string
  ): Promise<'imported' | 'skipped'> {
    const existing = await this.store.get(`sword:goal:${goal.id}`);
    
    if (existing && strategy === 'skip') {
      return 'skipped';
    }
    
    // Import goal
    const questIds: string[] = [];
    
    for (const quest of goal.quests) {
      await this.importQuest(goal.id, quest);
      questIds.push(quest.id);
    }
    
    const goalData = {
      id: goal.id,
      userId,
      title: goal.title,
      description: goal.description,
      desiredOutcome: goal.desiredOutcome,
      interestLevel: goal.interestLevel,
      tags: goal.tags,
      status: goal.status,
      progress: goal.progress,
      targetDate: goal.targetDate,
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
      completedAt: goal.completedAt,
      questIds,
      motivations: goal.motivations,
      constraints: goal.constraints,
      successCriteria: goal.successCriteria,
    };
    
    await this.store.set(`sword:goal:${goal.id}`, JSON.stringify(goalData), 365 * 24 * 60 * 60);
    
    // Add to user's goal list
    const goalIds = await this.getJsonData(`sword:user:${userId}:goals`) as string[] ?? [];
    if (!goalIds.includes(goal.id)) {
      goalIds.push(goal.id);
      await this.store.set(`sword:user:${userId}:goals`, JSON.stringify(goalIds), 365 * 24 * 60 * 60);
    }
    
    // Store quest IDs
    await this.store.set(`sword:goal:${goal.id}:quests`, JSON.stringify(questIds), 180 * 24 * 60 * 60);
    
    return 'imported';
  }
  
  private async importQuest(goalId: string, quest: ExportedQuest): Promise<void> {
    const stepIds: string[] = [];
    
    for (const step of quest.steps) {
      await this.importStep(quest.id, step);
      stepIds.push(step.id);
    }
    
    const questData = {
      id: quest.id,
      goalId,
      title: quest.title,
      description: quest.description,
      outcome: quest.outcome,
      status: quest.status,
      priority: quest.priority,
      progress: quest.progress,
      order: quest.order,
      estimatedMinutes: quest.estimatedMinutes,
      targetDate: quest.targetDate,
      createdAt: quest.createdAt,
      updatedAt: quest.updatedAt,
      completedAt: quest.completedAt,
      stepIds,
      riskLevel: quest.riskLevel,
    };
    
    await this.store.set(`sword:quest:${quest.id}`, JSON.stringify(questData), 180 * 24 * 60 * 60);
    await this.store.set(`sword:quest:${quest.id}:steps`, JSON.stringify(stepIds), 180 * 24 * 60 * 60);
  }
  
  private async importStep(questId: string, step: ExportedStep): Promise<void> {
    const stepData = {
      id: step.id,
      questId,
      title: step.title,
      description: step.description,
      type: step.type,
      status: step.status,
      order: step.order,
      estimatedMinutes: step.estimatedMinutes,
      createdAt: step.createdAt,
      completedAt: step.completedAt,
      completionNotes: step.completionNotes,
      verificationRequired: false,
    };
    
    await this.store.set(`sword:step:${step.id}`, JSON.stringify(stepData), 180 * 24 * 60 * 60);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // DELETION HELPERS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  private async deleteConversations(userId: string): Promise<{ conversations: number; messages: number }> {
    let conversations = 0;
    let messages = 0;
    
    const convIds = await this.getListData(`user:${userId}:conversations`);
    
    for (const convId of convIds) {
      // Count messages
      const msgData = await this.getListData(`conv:${convId}:messages`);
      messages += msgData.length;
      
      // Delete messages
      await this.store.delete(`conv:${convId}:messages`);
      
      // Delete conversation
      await this.store.delete(`conv:${convId}`);
      conversations++;
    }
    
    // Delete user's conversation list
    await this.store.delete(`user:${userId}:conversations`);
    
    return { conversations, messages };
  }
  
  private async deleteMemories(userId: string): Promise<number> {
    let count = 0;
    
    const memIds = await this.getJsonData(`memory:user:${userId}:items`) as string[] ?? [];
    
    for (const memId of memIds) {
      await this.store.delete(`memory:item:${memId}`);
      count++;
    }
    
    await this.store.delete(`memory:user:${userId}:items`);
    
    // Delete category indexes
    const categories = ['preference', 'fact', 'project', 'skill', 'interest', 'relationship', 'goal', 'context'];
    for (const cat of categories) {
      await this.store.delete(`memory:user:${userId}:category:${cat}`);
    }
    
    return count;
  }
  
  private async deleteGoals(userId: string): Promise<{ goals: number; quests: number; steps: number; sparks: number }> {
    let goals = 0;
    let quests = 0;
    let steps = 0;
    let sparks = 0;
    
    const goalIds = await this.getJsonData(`sword:user:${userId}:goals`) as string[] ?? [];
    
    for (const goalId of goalIds) {
      // Get quests
      const questIds = await this.getJsonData(`sword:goal:${goalId}:quests`) as string[] ?? [];
      
      for (const questId of questIds) {
        // Get steps
        const stepIds = await this.getJsonData(`sword:quest:${questId}:steps`) as string[] ?? [];
        
        for (const stepId of stepIds) {
          await this.store.delete(`sword:step:${stepId}`);
          steps++;
        }
        
        await this.store.delete(`sword:quest:${questId}:steps`);
        await this.store.delete(`sword:quest:${questId}`);
        quests++;
      }
      
      await this.store.delete(`sword:goal:${goalId}:quests`);
      await this.store.delete(`sword:goal:${goalId}`);
      goals++;
    }
    
    await this.store.delete(`sword:user:${userId}:goals`);
    
    // Delete sparks
    const sparkIds = await this.getJsonData(`sword:user:${userId}:sparks`) as string[] ?? [];
    for (const sparkId of sparkIds) {
      await this.store.delete(`sword:spark:${sparkId}`);
      sparks++;
    }
    await this.store.delete(`sword:user:${userId}:sparks`);
    
    return { goals, quests, steps, sparks };
  }
  
  private async deleteSearchHistory(userId: string): Promise<number> {
    let count = 0;
    
    const entryIds = await this.getJsonData(`search:user:${userId}:history`) as string[] ?? [];
    
    for (const entryId of entryIds) {
      await this.store.delete(`search:history:${entryId}`);
      count++;
    }
    
    await this.store.delete(`search:user:${userId}:history`);
    await this.store.delete(`search:user:${userId}:popular`);
    
    return count;
  }
  
  private async deleteSearchIndex(userId: string): Promise<number> {
    let count = 0;
    
    const docIds = await this.getJsonData(`search:user:${userId}:index`) as string[] ?? [];
    
    for (const docId of docIds) {
      await this.store.delete(`search:user:${userId}:doc:${docId}`);
      count++;
    }
    
    await this.store.delete(`search:user:${userId}:index`);
    await this.store.delete(`search:user:${userId}:stats`);
    
    // Delete type indexes
    for (const type of ['conversation', 'message', 'memory']) {
      await this.store.delete(`search:user:${userId}:type:${type}`);
    }
    
    return count;
  }
  
  private async deleteProfile(userId: string): Promise<boolean> {
    const exists = await this.store.get(`memory:user:${userId}:profile`);
    if (exists) {
      await this.store.delete(`memory:user:${userId}:profile`);
      return true;
    }
    return false;
  }
  
  private async deletePreferences(userId: string): Promise<boolean> {
    const exists = await this.store.get(`memory:user:${userId}:preferences`);
    if (exists) {
      await this.store.delete(`memory:user:${userId}:preferences`);
      return true;
    }
    return false;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // UTILITY HELPERS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  private calculateStats(data: ExportedData): ExportStats {
    let messages = 0;
    let quests = 0;
    let steps = 0;
    let sparks = 0;
    
    if (data.conversations) {
      for (const conv of data.conversations) {
        messages += conv.messages.length;
      }
    }
    
    if (data.goals) {
      for (const goal of data.goals) {
        quests += goal.quests.length;
        for (const quest of goal.quests) {
          steps += quest.steps.length;
          for (const step of quest.steps) {
            sparks += step.sparks.length;
          }
        }
      }
    }
    
    return {
      conversations: data.conversations?.length ?? 0,
      messages,
      memories: data.memories?.length ?? 0,
      goals: data.goals?.length ?? 0,
      quests,
      steps,
      sparks,
      searchHistory: data.searchHistory?.length ?? 0,
    };
  }
  
  private emptyImportCounts(): ImportCounts {
    return {
      conversations: 0,
      messages: 0,
      memories: 0,
      goals: 0,
      quests: 0,
      steps: 0,
      sparks: 0,
      profile: 0,
      preferences: 0,
    };
  }
  
  private async storeExportJob(
    exportId: string,
    request: ExportRequest,
    result: ExportResult
  ): Promise<void> {
    const job: ExportJob = {
      id: exportId,
      userId: request.userId,
      status: 'completed',
      request,
      progress: 100,
      result,
      createdAt: result.createdAt,
      completedAt: result.createdAt,
      expiresAt: result.expiresAt,
    };
    
    await this.store.set(exportJobKey(exportId), JSON.stringify(job), EXPORT_JOB_TTL);
    
    // Add to user's export list
    const userExports = await this.getUserExportIds(request.userId);
    userExports.push(exportId);
    await this.store.set(userExportsKey(request.userId), JSON.stringify(userExports), EXPORT_JOB_TTL);
  }
  
  private async getUserExportIds(userId: string): Promise<string[]> {
    const data = await this.store.get(userExportsKey(userId));
    return data ? JSON.parse(data) : [];
  }
  
  private async getJsonData(key: string): Promise<unknown> {
    const data = await this.store.get(key);
    return data ? JSON.parse(data) : null;
  }
  
  private async getListData(key: string): Promise<string[]> {
    // Try to get as list first
    try {
      const data = await this.store.lrange(key, 0, -1);
      return data ?? [];
    } catch (e) {
      // Fall back to JSON array
      const data = await this.store.get(key);
      return data ? JSON.parse(data) : [];
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let exportService: ExportService | null = null;

export function getExportService(): ExportService {
  if (!exportService) {
    exportService = new ExportService();
  }
  return exportService;
}
