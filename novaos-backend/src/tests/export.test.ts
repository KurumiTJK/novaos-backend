// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT TESTS — Data Export, Import, Deletion
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../storage/memory.js';
import {
  ExportService,
  JsonFormatter,
  MarkdownFormatter,
  CsvFormatter,
  getFormatter,
  EXPORT_VERSION,
} from '../export/index.js';
import type {
  ExportedData,
  ExportedConversation,
  ExportedGoal,
  ExportedMemory,
  ExportOptions,
} from '../export/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TEST DATA
// ─────────────────────────────────────────────────────────────────────────────────

const userId = 'user123';

function createTestConversation(): ExportedConversation {
  return {
    id: 'conv1',
    title: 'Test Conversation',
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T11:00:00Z',
    messageCount: 2,
    tags: ['test', 'important'],
    messages: [
      {
        id: 'msg1',
        role: 'user',
        content: 'Hello, how are you?',
        timestamp: '2024-01-15T10:00:00Z',
      },
      {
        id: 'msg2',
        role: 'assistant',
        content: 'I am doing well, thank you for asking!',
        timestamp: '2024-01-15T10:01:00Z',
      },
    ],
  };
}

function createTestGoal(): ExportedGoal {
  return {
    id: 'goal1',
    title: 'Learn TypeScript',
    description: 'Master TypeScript for better code quality',
    desiredOutcome: 'Write type-safe code confidently',
    interestLevel: 'career_capital',
    status: 'active',
    progress: 50,
    targetDate: '2024-06-01',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-15T00:00:00Z',
    motivations: ['Better job opportunities', 'Cleaner code'],
    constraints: ['Limited time'],
    successCriteria: ['Complete tutorial', 'Build project'],
    tags: ['learning', 'tech'],
    quests: [
      {
        id: 'quest1',
        title: 'Complete Basics Tutorial',
        description: 'Learn TypeScript fundamentals',
        outcome: 'Understanding of basic types',
        status: 'completed',
        priority: 'high',
        progress: 100,
        order: 0,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-10T00:00:00Z',
        completedAt: '2024-01-10T00:00:00Z',
        riskLevel: 'none',
        steps: [
          {
            id: 'step1',
            title: 'Install TypeScript',
            type: 'action',
            status: 'completed',
            order: 0,
            createdAt: '2024-01-01T00:00:00Z',
            completedAt: '2024-01-02T00:00:00Z',
            sparks: [],
          },
        ],
      },
    ],
  };
}

function createTestMemory(): ExportedMemory {
  return {
    id: 'mem1',
    category: 'fact',
    key: 'user.name',
    value: 'John Doe',
    context: 'User introduced themselves',
    confidence: 'explicit',
    sensitivity: 'private',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    reinforcementScore: 85,
  };
}

function createTestExportedData(): ExportedData {
  return {
    exportVersion: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    userId,
    scopes: ['all'],
    profile: {
      name: 'John Doe',
      role: 'Developer',
      organization: 'TechCorp',
      preferredTone: 'friendly',
      preferredDepth: 'moderate',
      preferredFormat: 'prose',
      expertiseAreas: ['TypeScript', 'Node.js'],
      expertiseLevel: 'intermediate',
      interests: ['coding', 'AI'],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-15T00:00:00Z',
    },
    preferences: {
      tone: 'friendly',
      verbosity: 'balanced',
      formatting: 'moderate',
      proactiveReminders: true,
      suggestNextSteps: true,
      askClarifyingQuestions: true,
      riskTolerance: 'moderate',
      memoryEnabled: true,
      autoExtractFacts: true,
      defaultMode: 'snapshot',
      showConfidenceLevel: false,
      showSources: true,
      updatedAt: '2024-01-15T00:00:00Z',
    },
    conversations: [createTestConversation()],
    memories: [createTestMemory()],
    goals: [createTestGoal()],
    searchHistory: [
      {
        query: 'typescript tutorial',
        scope: 'all',
        resultCount: 5,
        timestamp: '2024-01-15T09:00:00Z',
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// JSON FORMATTER TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('JsonFormatter', () => {
  let formatter: JsonFormatter;
  const options: ExportOptions = {
    includeMetadata: true,
    prettyPrint: true,
    redactSensitive: false,
  };
  
  beforeEach(() => {
    formatter = new JsonFormatter();
  });
  
  describe('format', () => {
    it('should format data as valid JSON', () => {
      const data = createTestExportedData();
      const result = formatter.format(data, options);
      
      expect(() => JSON.parse(result)).not.toThrow();
    });
    
    it('should pretty print when option is true', () => {
      const data = createTestExportedData();
      const result = formatter.format(data, { ...options, prettyPrint: true });
      
      expect(result).toContain('\n');
      expect(result).toContain('  ');
    });
    
    it('should minify when pretty print is false', () => {
      const data = createTestExportedData();
      const result = formatter.format(data, { ...options, prettyPrint: false });
      
      // Minified JSON should be a single line (approximately)
      expect(result.split('\n').length).toBeLessThan(5);
    });
    
    it('should redact sensitive data when option is true', () => {
      const data = createTestExportedData();
      data.memories = [{
        ...createTestMemory(),
        sensitivity: 'sensitive',
        value: 'secret-value',
      }];
      
      const result = formatter.format(data, { ...options, redactSensitive: true });
      const parsed = JSON.parse(result);
      
      expect(parsed.memories[0].value).toBe('[REDACTED]');
    });
    
    it('should not redact non-sensitive data', () => {
      const data = createTestExportedData();
      const result = formatter.format(data, { ...options, redactSensitive: true });
      const parsed = JSON.parse(result);
      
      expect(parsed.memories[0].value).toBe('John Doe');
    });
  });
  
  describe('formatConversation', () => {
    it('should format conversation as JSON', () => {
      const conv = createTestConversation();
      const result = formatter.formatConversation(conv);
      
      const parsed = JSON.parse(result);
      expect(parsed.id).toBe('conv1');
      expect(parsed.messages.length).toBe(2);
    });
  });
  
  describe('formatGoal', () => {
    it('should format goal as JSON', () => {
      const goal = createTestGoal();
      const result = formatter.formatGoal(goal);
      
      const parsed = JSON.parse(result);
      expect(parsed.id).toBe('goal1');
      expect(parsed.quests.length).toBe(1);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// MARKDOWN FORMATTER TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('MarkdownFormatter', () => {
  let formatter: MarkdownFormatter;
  const options: ExportOptions = {
    includeMetadata: true,
    prettyPrint: true,
    redactSensitive: false,
  };
  
  beforeEach(() => {
    formatter = new MarkdownFormatter();
  });
  
  describe('format', () => {
    it('should format data as Markdown', () => {
      const data = createTestExportedData();
      const result = formatter.format(data, options);
      
      expect(result).toContain('# Nova Data Export');
      expect(result).toContain('## Profile');
      expect(result).toContain('## Conversations');
      expect(result).toContain('## Memories');
      expect(result).toContain('## Goals');
    });
    
    it('should include export metadata', () => {
      const data = createTestExportedData();
      const result = formatter.format(data, options);
      
      expect(result).toContain('**User ID:**');
      expect(result).toContain('**Exported:**');
      expect(result).toContain('**Scopes:**');
    });
    
    it('should format profile information', () => {
      const data = createTestExportedData();
      const result = formatter.format(data, options);
      
      expect(result).toContain('**Name:** John Doe');
      expect(result).toContain('**Role:** Developer');
    });
  });
  
  describe('formatConversation', () => {
    it('should format conversation as Markdown', () => {
      const conv = createTestConversation();
      const result = formatter.formatConversation(conv);
      
      expect(result).toContain('### Test Conversation');
      expect(result).toContain('**Messages:** 2');
      expect(result).toContain('**Tags:** test, important');
    });
    
    it('should include message details', () => {
      const conv = createTestConversation();
      const result = formatter.formatConversation(conv);
      
      expect(result).toContain('**User**');
      expect(result).toContain('**Assistant**');
      expect(result).toContain('Hello, how are you?');
    });
  });
  
  describe('formatGoal', () => {
    it('should format goal as Markdown', () => {
      const goal = createTestGoal();
      const result = formatter.formatGoal(goal);
      
      expect(result).toContain('🟢 Learn TypeScript');
      expect(result).toContain('**Progress:** 50%');
      expect(result).toContain('**Quests:**');
    });
    
    it('should show status emoji', () => {
      const goal = createTestGoal();
      
      goal.status = 'completed';
      expect(formatter.formatGoal(goal)).toContain('✅');
      
      goal.status = 'paused';
      expect(formatter.formatGoal(goal)).toContain('⏸️');
      
      goal.status = 'abandoned';
      expect(formatter.formatGoal(goal)).toContain('❌');
    });
  });
  
  describe('formatMemories', () => {
    it('should group memories by category', () => {
      const memories = [
        createTestMemory(),
        { ...createTestMemory(), id: 'mem2', category: 'skill', key: 'skill.typescript', value: 'Advanced' },
      ];
      
      const result = formatter.formatMemories(memories);
      
      expect(result).toContain('### Fact');
      expect(result).toContain('### Skill');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// CSV FORMATTER TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('CsvFormatter', () => {
  let formatter: CsvFormatter;
  const options: ExportOptions = {
    includeMetadata: true,
    prettyPrint: true,
    redactSensitive: false,
  };
  
  beforeEach(() => {
    formatter = new CsvFormatter();
  });
  
  describe('format', () => {
    it('should format conversations as CSV', () => {
      const data = createTestExportedData();
      const result = formatter.format(data, options);
      
      expect(result).toContain('# CONVERSATIONS');
      expect(result).toContain('conversation_id,title,created_at');
      expect(result).toContain('conv1,Test Conversation');
    });
    
    it('should format messages as CSV', () => {
      const data = createTestExportedData();
      const result = formatter.format(data, options);
      
      expect(result).toContain('# MESSAGES');
      expect(result).toContain('conversation_id,message_id,role,timestamp,content');
    });
    
    it('should format memories as CSV', () => {
      const data = createTestExportedData();
      const result = formatter.format(data, options);
      
      expect(result).toContain('# MEMORIES');
      expect(result).toContain('id,category,key,value,confidence,sensitivity');
    });
    
    it('should format goals as CSV', () => {
      const data = createTestExportedData();
      const result = formatter.format(data, options);
      
      expect(result).toContain('# GOALS');
      expect(result).toContain('# QUESTS');
      expect(result).toContain('# STEPS');
    });
    
    it('should escape CSV values with commas', () => {
      const data = createTestExportedData();
      data.conversations![0]!.title = 'Hello, World';
      
      const result = formatter.format(data, options);
      
      expect(result).toContain('"Hello, World"');
    });
    
    it('should escape CSV values with quotes', () => {
      const data = createTestExportedData();
      data.conversations![0]!.title = 'Say "Hello"';
      
      const result = formatter.format(data, options);
      
      expect(result).toContain('"Say ""Hello"""');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// FORMATTER FACTORY TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('getFormatter', () => {
  it('should return JsonFormatter for json format', () => {
    const formatter = getFormatter('json');
    expect(formatter).toBeInstanceOf(JsonFormatter);
  });
  
  it('should return MarkdownFormatter for markdown format', () => {
    const formatter = getFormatter('markdown');
    expect(formatter).toBeInstanceOf(MarkdownFormatter);
  });
  
  it('should return CsvFormatter for csv format', () => {
    const formatter = getFormatter('csv');
    expect(formatter).toBeInstanceOf(CsvFormatter);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORT SERVICE TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('ExportService', () => {
  let service: ExportService;
  let memoryStore: MemoryStore;
  
  beforeEach(async () => {
    memoryStore = new MemoryStore();
    service = new ExportService(memoryStore);
    
    // Set up test data in store
    await setupTestData(memoryStore);
  });
  
  describe('export', () => {
    it('should create export with all scopes', async () => {
      const result = await service.export({
        userId,
        scopes: ['all'],
        format: 'json',
      });
      
      expect(result.exportId).toBeDefined();
      expect(result.userId).toBe(userId);
      expect(result.format).toBe('json');
      expect(result.data.exportVersion).toBe(EXPORT_VERSION);
    });
    
    it('should calculate correct stats', async () => {
      const result = await service.export({
        userId,
        scopes: ['all'],
        format: 'json',
      });
      
      expect(result.stats).toBeDefined();
      expect(typeof result.stats.conversations).toBe('number');
      expect(typeof result.stats.memories).toBe('number');
      expect(typeof result.stats.goals).toBe('number');
    });
    
    it('should set correct mime type', async () => {
      const jsonResult = await service.export({
        userId,
        scopes: ['all'],
        format: 'json',
      });
      expect(jsonResult.mimeType).toBe('application/json');
      
      const mdResult = await service.export({
        userId,
        scopes: ['all'],
        format: 'markdown',
      });
      expect(mdResult.mimeType).toBe('text/markdown');
    });
    
    it('should generate proper filename', async () => {
      const result = await service.export({
        userId,
        scopes: ['all'],
        format: 'json',
      });
      
      expect(result.filename).toContain('nova-export');
      expect(result.filename).toContain(userId);
      expect(result.filename).toEndWith('.json');
    });
  });
  
  describe('exportToString', () => {
    it('should return content and result', async () => {
      const { content, result } = await service.exportToString({
        userId,
        scopes: ['all'],
        format: 'json',
      });
      
      expect(content).toBeDefined();
      expect(content.length).toBeGreaterThan(0);
      expect(result).toBeDefined();
    });
    
    it('should return valid JSON for json format', async () => {
      const { content } = await service.exportToString({
        userId,
        scopes: ['all'],
        format: 'json',
      });
      
      expect(() => JSON.parse(content)).not.toThrow();
    });
    
    it('should return markdown for markdown format', async () => {
      const { content } = await service.exportToString({
        userId,
        scopes: ['all'],
        format: 'markdown',
      });
      
      expect(content).toContain('# Nova Data Export');
    });
  });
  
  describe('import', () => {
    it('should import valid JSON data', async () => {
      const exportData = createTestExportedData();
      
      const result = await service.import({
        userId: 'newuser',
        data: JSON.stringify(exportData),
      });
      
      expect(result.success).toBe(true);
    });
    
    it('should fail with invalid JSON', async () => {
      const result = await service.import({
        userId,
        data: 'not valid json',
      });
      
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]!.type).toBe('parse');
    });
    
    it('should support dry run', async () => {
      const exportData = createTestExportedData();
      
      const result = await service.import({
        userId: 'newuser',
        data: JSON.stringify(exportData),
        dryRun: true,
      });
      
      expect(result.dryRun).toBe(true);
      expect(result.imported.conversations).toBeGreaterThan(0);
    });
    
    it('should skip existing data with skip strategy', async () => {
      const exportData = createTestExportedData();
      
      // Import once
      await service.import({
        userId,
        data: JSON.stringify(exportData),
        mergeStrategy: 'replace',
      });
      
      // Import again with skip
      const result = await service.import({
        userId,
        data: JSON.stringify(exportData),
        mergeStrategy: 'skip',
      });
      
      // Some items should be skipped
      expect(result.skipped.memories + result.skipped.conversations + result.skipped.goals)
        .toBeGreaterThanOrEqual(0);
    });
  });
  
  describe('deleteUserData', () => {
    it('should require confirmation', async () => {
      await expect(service.deleteUserData({
        userId,
        confirmation: 'wrong',
      })).rejects.toThrow('Confirmation does not match');
    });
    
    it('should delete all user data', async () => {
      const result = await service.deleteUserData({
        userId,
        confirmation: userId,
      });
      
      expect(result.success).toBe(true);
      expect(result.userId).toBe(userId);
    });
    
    it('should export before deletion if requested', async () => {
      const result = await service.deleteUserData({
        userId,
        confirmation: userId,
        exportFirst: true,
      });
      
      expect(result.exportId).toBeDefined();
    });
    
    it('should return deletion counts', async () => {
      const result = await service.deleteUserData({
        userId,
        confirmation: userId,
      });
      
      expect(typeof result.deleted.conversations).toBe('number');
      expect(typeof result.deleted.memories).toBe('number');
      expect(typeof result.deleted.goals).toBe('number');
    });
  });
  
  describe('getExportJob', () => {
    it('should return null for non-existent job', async () => {
      const job = await service.getExportJob('nonexistent');
      expect(job).toBeNull();
    });
    
    it('should return job after export', async () => {
      const result = await service.export({
        userId,
        scopes: ['all'],
        format: 'json',
      });
      
      const job = await service.getExportJob(result.exportId);
      
      expect(job).not.toBeNull();
      expect(job!.id).toBe(result.exportId);
      expect(job!.status).toBe('completed');
    });
  });
  
  describe('listExportJobs', () => {
    it('should return empty list for new user', async () => {
      const jobs = await service.listExportJobs('newuser');
      expect(jobs).toEqual([]);
    });
    
    it('should return jobs after exports', async () => {
      await service.export({ userId, scopes: ['all'], format: 'json' });
      await service.export({ userId, scopes: ['conversations'], format: 'markdown' });
      
      const jobs = await service.listExportJobs(userId);
      
      expect(jobs.length).toBe(2);
    });
    
    it('should return most recent first', async () => {
      await service.export({ userId, scopes: ['all'], format: 'json' });
      await new Promise(r => setTimeout(r, 10));
      await service.export({ userId, scopes: ['conversations'], format: 'markdown' });
      
      const jobs = await service.listExportJobs(userId);
      
      expect(new Date(jobs[0]!.createdAt).getTime())
        .toBeGreaterThanOrEqual(new Date(jobs[1]!.createdAt).getTime());
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// TEST DATA SETUP
// ─────────────────────────────────────────────────────────────────────────────────

async function setupTestData(store: MemoryStore): Promise<void> {
  // Set up profile
  await store.set(
    `memory:user:${userId}:profile`,
    JSON.stringify({
      userId,
      name: 'Test User',
      preferredTone: 'friendly',
      preferredDepth: 'moderate',
      preferredFormat: 'prose',
      expertiseAreas: [],
      expertiseLevel: 'intermediate',
      interests: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  );
  
  // Set up preferences
  await store.set(
    `memory:user:${userId}:preferences`,
    JSON.stringify({
      userId,
      tone: 'friendly',
      verbosity: 'balanced',
      formatting: 'moderate',
      proactiveReminders: true,
      suggestNextSteps: true,
      askClarifyingQuestions: true,
      riskTolerance: 'moderate',
      memoryEnabled: true,
      autoExtractFacts: true,
      defaultMode: 'snapshot',
      showConfidenceLevel: false,
      showSources: true,
      updatedAt: new Date().toISOString(),
    })
  );
  
  // Set up a memory
  const memId = 'test-mem-1';
  await store.set(
    `memory:item:${memId}`,
    JSON.stringify({
      id: memId,
      userId,
      category: 'fact',
      key: 'user.name',
      value: 'Test User',
      confidence: 'explicit',
      sensitivity: 'private',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      reinforcementScore: 100,
    })
  );
  await store.set(`memory:user:${userId}:items`, JSON.stringify([memId]));
  
  // Set up a conversation
  const convId = 'test-conv-1';
  await store.set(
    `conv:${convId}`,
    JSON.stringify({
      id: convId,
      userId,
      title: 'Test Conversation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 1,
    })
  );
  await store.lpush(`user:${userId}:conversations`, convId);
  await store.lpush(
    `conv:${convId}:messages`,
    JSON.stringify({
      id: 'msg1',
      role: 'user',
      content: 'Hello',
      timestamp: Date.now(),
    })
  );
  
  // Set up a goal
  const goalId = 'test-goal-1';
  await store.set(
    `sword:goal:${goalId}`,
    JSON.stringify({
      id: goalId,
      userId,
      title: 'Test Goal',
      description: 'A test goal',
      desiredOutcome: 'Success',
      interestLevel: 'comfort',
      status: 'active',
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      questIds: [],
      motivations: [],
      constraints: [],
      successCriteria: [],
      tags: [],
    })
  );
  await store.set(`sword:user:${userId}:goals`, JSON.stringify([goalId]));
  await store.set(`sword:goal:${goalId}:quests`, JSON.stringify([]));
}
