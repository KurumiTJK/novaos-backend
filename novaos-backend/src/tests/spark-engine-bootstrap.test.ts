// ═══════════════════════════════════════════════════════════════════════════════
// STEP GENERATOR WIRING TESTS — Phase 17 Integration Tests
// NovaOS Spark Engine — Verifying Full StepGenerator Pipeline
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { 
  bootstrapSparkEngine,
  bootstrapSparkEngineAsync,
  resetSparkEngine,
  TopicTaxonomy,
  type SparkEngineBootstrapConfig,
} from '../services/spark-engine/spark-engine-bootstrap.js';

import {
  initSecureLLMClientFromManager,
  resetSecureLLMClient,
  getSecureLLMClient,
  createLLMRequest,
  createMockProvider,
} from '../services/spark-engine/curriculum-llm-adapter.js';

import type { TopicId } from '../services/spark-engine/resource-discovery/types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// MOCKS
// ─────────────────────────────────────────────────────────────────────────────────

// Mock KeyValueStore
function createMockKvStore() {
  const data = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  
  return {
    get: vi.fn(async (key: string) => data.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      data.set(key, value);
      return true;
    }),
    delete: vi.fn(async (key: string) => {
      data.delete(key);
      return true;
    }),
    exists: vi.fn(async (key: string) => data.has(key)),
    keys: vi.fn(async (pattern: string) => {
      const regex = new RegExp(pattern.replace('*', '.*'));
      return Array.from(data.keys()).filter(k => regex.test(k));
    }),
    isConnected: vi.fn(() => true),
    // Redis set operations
    sadd: vi.fn(async (key: string, ...members: string[]) => {
      if (!sets.has(key)) {
        sets.set(key, new Set());
      }
      const set = sets.get(key)!;
      let added = 0;
      for (const member of members) {
        if (!set.has(member)) {
          set.add(member);
          added++;
        }
      }
      return added;
    }),
    srem: vi.fn(async (key: string, ...members: string[]) => {
      const set = sets.get(key);
      if (!set) return 0;
      let removed = 0;
      for (const member of members) {
        if (set.delete(member)) {
          removed++;
        }
      }
      return removed;
    }),
    smembers: vi.fn(async (key: string) => {
      const set = sets.get(key);
      return set ? Array.from(set) : [];
    }),
    __data: data,
    __sets: sets,
  };
}

// Mock ProviderManager
function createMockProviderManager() {
  return {
    generate: vi.fn(async (prompt: string, systemPrompt: string, constraints: any) => ({
      text: JSON.stringify({
        title: 'Learn Rust',
        description: 'A comprehensive Rust learning curriculum',
        targetAudience: 'beginners',
        prerequisites: [],
        difficulty: 'beginner',
        progression: 'gradual',
        days: [
          {
            day: 1,
            theme: 'Rust Fundamentals',
            objectives: [
              { description: 'Understand Rust basics' },
            ],
            resources: [
              { index: 1, minutes: 30, optional: false },
            ],
            exercises: [
              { type: 'practice', description: 'Write your first Rust program', minutes: 15, optional: false },
            ],
            totalMinutes: 45,
            difficulty: 'beginner',
          },
          {
            day: 2,
            theme: 'Ownership and Borrowing',
            objectives: [
              { description: 'Learn Rust ownership model' },
            ],
            resources: [
              { index: 2, minutes: 25, optional: false },
            ],
            exercises: [
              { type: 'practice', description: 'Practice ownership patterns', minutes: 20, optional: false },
            ],
            totalMinutes: 45,
            difficulty: 'beginner',
          },
        ],
      }),
      provider: 'openai',
      usage: {
        promptTokens: 500,
        completionTokens: 300,
        totalTokens: 800,
      },
    })),
    getAvailableProviders: vi.fn(() => ['openai']),
  };
}

// Mock Redis
function createMockRedis() {
  const data = new Map<string, string>();
  
  return {
    get: vi.fn(async (key: string) => data.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, mode?: string, duration?: number) => {
      data.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      data.delete(key);
      return 1;
    }),
    eval: vi.fn(async () => 1),
    quit: vi.fn(async () => 'OK'),
  } as any;
}

// ─────────────────────────────────────────────────────────────────────────────────
// TESTS: TOPIC TAXONOMY (Inference-based)
// ─────────────────────────────────────────────────────────────────────────────────

describe('TopicTaxonomy', () => {
  describe('with empty registry', () => {
    let taxonomy: TopicTaxonomy;

    beforeEach(() => {
      taxonomy = new TopicTaxonomy();
    });

    it('should infer topic name from ID structure', () => {
      // "language:rust:ownership" → "Rust Ownership"
      expect(taxonomy.getTopicName('language:rust:ownership' as TopicId)).toBe('Rust Ownership');
      
      // "framework:react:hooks" → "React Hooks"
      expect(taxonomy.getTopicName('framework:react:hooks' as TopicId)).toBe('React Hooks');
      
      // "language:rust:error-handling" → "Rust Error Handling"
      expect(taxonomy.getTopicName('language:rust:error-handling' as TopicId)).toBe('Rust Error Handling');
    });

    it('should return default metadata for unknown topics', () => {
      const topic = taxonomy.getTopic('anything:unknown' as TopicId);
      
      expect(topic).toBeDefined();
      expect(topic!.priority).toBe(5); // Default priority
      expect(topic!.estimatedMinutes).toBe(30); // Default time
      expect(topic!.prerequisites).toHaveLength(0);
    });

    it('should infer parent as prerequisite for subtopics', () => {
      const prereqs = taxonomy.getPrerequisites('category:parent:child' as TopicId);
      
      expect(prereqs).toContain('category:parent');
    });

    it('should return undefined for official docs when not configured', () => {
      const url = taxonomy.getOfficialDocsUrl('language:rust' as TopicId);
      
      expect(url).toBeUndefined();
    });
  });

  describe('with custom topics', () => {
    let taxonomy: TopicTaxonomy;

    beforeEach(() => {
      taxonomy = new TopicTaxonomy({
        'company:internal-api': {
          name: 'Internal API',
          priority: 1,
          estimatedMinutes: 60,
          prerequisites: [],
          officialDocsUrl: 'https://docs.internal.example.com',
        },
        'company:internal-api:auth': {
          name: 'API Authentication',
          priority: 2,
          estimatedMinutes: 30,
          prerequisites: ['company:internal-api'],
        },
      });
    });

    it('should return metadata for configured topics', () => {
      const topic = taxonomy.getTopic('company:internal-api' as TopicId);
      
      expect(topic).toBeDefined();
      expect(topic!.name).toBe('Internal API');
      expect(topic!.priority).toBe(1);
      expect(topic!.officialDocsUrl).toBe('https://docs.internal.example.com');
    });

    it('should return configured prerequisites', () => {
      const prereqs = taxonomy.getPrerequisites('company:internal-api:auth' as TopicId);
      
      expect(prereqs).toContain('company:internal-api');
    });

    it('should inherit docs URL from parent for unknown subtopics', () => {
      // "company:internal-api:unknown" inherits from "company:internal-api"
      const url = taxonomy.getOfficialDocsUrl('company:internal-api:unknown' as TopicId);
      
      expect(url).toBe('https://docs.internal.example.com');
    });

    it('should still use inference for unconfigured topics', () => {
      const topic = taxonomy.getTopic('other:unknown:topic' as TopicId);
      
      expect(topic!.name).toBe('Unknown Topic');
      expect(topic!.priority).toBe(5);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// TESTS: CURRICULUM LLM ADAPTER
// ─────────────────────────────────────────────────────────────────────────────────

describe('CurriculumLLMAdapter', () => {
  beforeEach(() => {
    resetSecureLLMClient();
  });

  afterEach(() => {
    resetSecureLLMClient();
  });

  describe('initialization', () => {
    it('should throw if getSecureLLMClient called before init', () => {
      expect(() => getSecureLLMClient()).toThrow('SecureLLMClient not initialized');
    });

    it('should return client after initialization', () => {
      const mockProvider = createMockProviderManager();
      initSecureLLMClientFromManager(mockProvider as any);

      const client = getSecureLLMClient();
      expect(client).toBeDefined();
    });
  });

  describe('execute', () => {
    it('should execute LLM request through provider manager', async () => {
      const mockProvider = createMockProviderManager();
      initSecureLLMClientFromManager(mockProvider as any);

      const client = getSecureLLMClient();
      const request = createLLMRequest()
        .setPurpose('curriculum_structuring')
        .setSystemPrompt('You are a curriculum designer')
        .setUserPrompt('Create a curriculum for learning Rust')
        .setResources([
          {
            title: 'Rust Book',
            description: 'Official Rust book',
            provider: 'official_docs',
            estimatedMinutes: 120,
            difficulty: 'beginner',
            topics: ['language:rust'],
          },
        ])
        .setTemperature(0.7)
        .setUserId('test-user')
        .build();

      const response = await client.execute(request);

      expect(response.ok).toBe(true);
      expect(response.rawContent).toBeDefined();
      expect(response.metrics.totalTokens).toBeGreaterThan(0);
      expect(response.audit.success).toBe(true);
      
      // Note: constraints are passed as empty object since ProviderManager
      // doesn't support temperature in GenerationConstraints
      expect(mockProvider.generate).toHaveBeenCalledWith(
        request.userPrompt,
        request.systemPrompt,
        {}
      );
    });

    it('should handle errors gracefully', async () => {
      const mockProvider = {
        generate: vi.fn(async () => {
          throw new Error('Rate limit exceeded');
        }),
      };
      initSecureLLMClientFromManager(mockProvider as any);

      const client = getSecureLLMClient();
      const request = createLLMRequest()
        .setPurpose('curriculum_structuring')
        .setSystemPrompt('test')
        .setUserPrompt('test')
        .build();

      const response = await client.execute(request);

      expect(response.ok).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe('RATE_LIMITED');
      expect(response.audit.success).toBe(false);
    });
  });

  describe('createMockProvider', () => {
    it('should return valid mock responses', async () => {
      const mockProvider = createMockProvider();
      
      const request = createLLMRequest()
        .setPurpose('curriculum_structuring')
        .setSystemPrompt('test')
        .setUserPrompt('test')
        .build();

      const response = await mockProvider.execute(request);

      expect(response.ok).toBe(true);
      expect(response.rawContent).toContain('Mock Curriculum');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// TESTS: SPARK ENGINE BOOTSTRAP (SYNC/STUB MODE)
// ─────────────────────────────────────────────────────────────────────────────────

describe('bootstrapSparkEngine (stub mode)', () => {
  let mockKvStore: ReturnType<typeof createMockKvStore>;

  beforeEach(() => {
    resetSparkEngine();
    mockKvStore = createMockKvStore();
  });

  afterEach(() => {
    resetSparkEngine();
  });

  it('should bootstrap with stub StepGenerator', () => {
    const result = bootstrapSparkEngine(mockKvStore as any);

    expect(result.sparkEngine).toBeDefined();
    expect(result.status.stepGenerator).toBe('stub');
    expect(result.status.sparkGenerator).toBe('full');
    expect(result.status.resourceDiscovery).toBe('not_initialized');
    expect(result.status.curriculumLLM).toBe('not_initialized');
  });

  it('should warn when useStubStepGenerator is false', () => {
    const consoleSpy = vi.spyOn(console, 'warn');

    const result = bootstrapSparkEngine(mockKvStore as any, {
      useStubStepGenerator: false,
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Full StepGenerator requires async bootstrap')
    );
    expect(result.status.stepGenerator).toBe('stub'); // Falls back to stub

    consoleSpy.mockRestore();
  });

  it('should include enhanced topic taxonomy', () => {
    const result = bootstrapSparkEngine(mockKvStore as any);

    expect(result.taxonomy).toBeDefined();
    expect(result.taxonomy.getTopicName('language:rust' as TopicId)).toBe('Rust');
  });

  it('should accept additional topics', () => {
    const result = bootstrapSparkEngine(mockKvStore as any, {
      additionalTopics: {
        'company:internal-tool': {
          name: 'Internal Tool',
          priority: 1,
          estimatedMinutes: 30,
          prerequisites: [],
        },
      },
    });

    expect(result.taxonomy.getTopicName('company:internal-tool' as TopicId)).toBe('Internal Tool');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// TESTS: SPARK ENGINE BOOTSTRAP (ASYNC/FULL MODE)
// ─────────────────────────────────────────────────────────────────────────────────

describe('bootstrapSparkEngineAsync (full mode)', () => {
  let mockKvStore: ReturnType<typeof createMockKvStore>;
  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockProviderManager: ReturnType<typeof createMockProviderManager>;

  beforeEach(() => {
    resetSparkEngine();
    resetSecureLLMClient();
    mockKvStore = createMockKvStore();
    mockRedis = createMockRedis();
    mockProviderManager = createMockProviderManager();
  });

  afterEach(() => {
    resetSparkEngine();
    resetSecureLLMClient();
  });

  it('should bootstrap with full StepGenerator', async () => {
    const result = await bootstrapSparkEngineAsync(
      mockKvStore as any,
      mockRedis,
      mockProviderManager as any
    );

    expect(result.sparkEngine).toBeDefined();
    expect(result.status.stepGenerator).toBe('full');
    expect(result.status.sparkGenerator).toBe('full');
    expect(result.status.resourceDiscovery).toBe('initialized');
    expect(result.status.curriculumLLM).toBe('initialized');
  });

  it('should initialize resource discovery orchestrator', async () => {
    const result = await bootstrapSparkEngineAsync(
      mockKvStore as any,
      mockRedis,
      mockProviderManager as any
    );

    expect(result.resourceDiscovery).toBeDefined();
  });

  it('should work without Redis (no locking)', async () => {
    const result = await bootstrapSparkEngineAsync(
      mockKvStore as any,
      null, // No Redis
      mockProviderManager as any
    );

    expect(result.sparkEngine).toBeDefined();
    expect(result.status.stepGenerator).toBe('full');
  });

  it('should configure StepGenerator with custom config', async () => {
    const result = await bootstrapSparkEngineAsync(
      mockKvStore as any,
      null,
      mockProviderManager as any,
      {
        stepGeneratorConfig: {
          maxResources: 50,
          maxCurriculumRetries: 5,
        },
      }
    );

    expect(result.sparkEngine).toBeDefined();
    // The config would be passed to StepGenerator internally
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// TESTS: INTEGRATION (SparkEngine Operations)
// ─────────────────────────────────────────────────────────────────────────────────

describe('SparkEngine Integration', () => {
  let mockKvStore: ReturnType<typeof createMockKvStore>;

  beforeEach(() => {
    resetSparkEngine();
    mockKvStore = createMockKvStore();
  });

  afterEach(() => {
    resetSparkEngine();
  });

  it('should create goals through SparkEngine', async () => {
    // Disable encryption for this test to avoid encryption service issues
    const result = bootstrapSparkEngine(mockKvStore as any, {
      encryptionEnabled: false,
    });
    const sparkEngine = result.sparkEngine;

    // This tests the store adapter wiring
    const goalResult = await sparkEngine.createGoal({
      userId: 'user-123' as any,
      title: 'Learn Rust',
      description: 'Master Rust programming',
    });

    // The goal creation should succeed
    expect(goalResult.ok).toBe(true);
    
    if (goalResult.ok) {
      expect(goalResult.value).toBeDefined();
      expect(goalResult.value.title).toBe('Learn Rust');
      
      // Store adapter should have saved the goal via the store manager
      expect(mockKvStore.set).toHaveBeenCalled();
    }
  });
});
