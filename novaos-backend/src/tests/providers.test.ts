// ═══════════════════════════════════════════════════════════════════════════════
// PROVIDER TESTS — Model Provider Validation
// ═══════════════════════════════════════════════════════════════════════════════
//
// These tests validate the model provider implementations including
// MockProvider, OpenAI, Gemini, and the ProviderManager fallback logic.
// We mock the OpenAI LLM for deterministic Shield gate testing.
//
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, beforeAll, afterEach, afterAll, vi } from 'vitest';
import {
  MockProvider,
  OpenAIProvider,
  GeminiProvider,
  ProviderManager,
  NOVA_SYSTEM_PROMPT,
} from '../providers/index.js';
import { ExecutionPipeline } from '../pipeline/execution-pipeline.js';
import type { PipelineContext } from '../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// OPENAI MOCK SETUP (for Shield gate in pipeline tests)
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create a mock OpenAI chat completion response for Shield gate.
 */
function createShieldMockResponse(
  riskLevel: string,
  category: string,
  reasoning: string,
  confidence = 0.95
) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({ riskLevel, category, confidence, reasoning }),
        },
        finish_reason: 'stop',
        index: 0,
      },
    ],
    id: 'mock-completion',
    model: 'gpt-4o-mini',
    object: 'chat.completion',
    created: Date.now(),
  };
}

/**
 * Classify a message for Shield gate based on content patterns.
 */
function classifyForShield(content: string) {
  // CRITICAL + death_risk → Control mode
  if (
    /\b(kill\s+myself|end\s+my\s+life|suicide|want\s+to\s+die)\b/i.test(content) ||
    /\b(hurt\s+myself|self[\s-]?harm)\b/i.test(content)
  ) {
    return createShieldMockResponse('critical', 'death_risk', 'Suicidal/self-harm intent detected');
  }

  // HIGH + harm_risk → Hard veto
  if (
    /\b(make\s+a\s+bomb|build\s+a?\s*bomb|build\s+a?\s*weapon)\b/i.test(content) ||
    /\b(hack\s+into|break\s+into.*account)\b/i.test(content)
  ) {
    return createShieldMockResponse('high', 'harm_risk', 'Dangerous/harmful request detected');
  }

  // Default: safe
  return createShieldMockResponse('none', 'safe', 'Normal request - no safety concerns');
}

// Store original implementation reference
let originalOpenAI: any;

// Mock OpenAI module for Shield gate classification
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async ({ messages }) => {
            const userMessage = messages.find((m: any) => m.role === 'user')?.content ?? '';
            return classifyForShield(userMessage);
          }),
        },
      },
    })),
  };
});

// ─────────────────────────────────────────────────────────────────────────────────
// TEST HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

function createContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    userId: 'test-user',
    conversationId: 'test-conv',
    requestId: 'test-req',
    timestamp: Date.now(),
    actionSources: [],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// SETUP / TEARDOWN
// ─────────────────────────────────────────────────────────────────────────────────

// Store original env values
const originalOpenAIKey = process.env.OPENAI_API_KEY;
const originalGeminiKey = process.env.GEMINI_API_KEY;

beforeAll(() => {
  // Set mock API key so the Shield gate initializes its OpenAI client
  process.env.OPENAI_API_KEY = 'test-mock-key';
});

afterAll(() => {
  // Restore original env values
  if (originalOpenAIKey !== undefined) {
    process.env.OPENAI_API_KEY = originalOpenAIKey;
  } else {
    delete process.env.OPENAI_API_KEY;
  }
  if (originalGeminiKey !== undefined) {
    process.env.GEMINI_API_KEY = originalGeminiKey;
  } else {
    delete process.env.GEMINI_API_KEY;
  }
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────────
// MOCK PROVIDER TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('MockProvider', () => {
  const provider = new MockProvider();

  it('should always be available', () => {
    expect(provider.isAvailable()).toBe(true);
  });

  it('should have correct name', () => {
    expect(provider.name).toBe('mock');
  });

  it('should generate responses', async () => {
    const response = await provider.generate('Hello', NOVA_SYSTEM_PROMPT);
    expect(response.text).toBeDefined();
    expect(response.text.length).toBeGreaterThan(0);
  });

  it('should generate contextual response for action requests', async () => {
    const response = await provider.generate('Help me create a plan', NOVA_SYSTEM_PROMPT);
    expect(response.text).toContain('help');
  });

  it('should generate contextual response for questions', async () => {
    const questionResponse = await provider.generate(
      'What is the meaning of life?',
      NOVA_SYSTEM_PROMPT
    );
    expect(questionResponse.text).toContain('information');
  });

  it('should apply mustPrepend constraint', async () => {
    const response = await provider.generate('Hello', NOVA_SYSTEM_PROMPT, {
      mustPrepend: 'IMPORTANT: ',
    });
    expect(response.text).toMatch(/^IMPORTANT:/);
  });

  it('should apply mustInclude constraint', async () => {
    const response = await provider.generate('Hello', NOVA_SYSTEM_PROMPT, {
      mustInclude: ['Required text here'],
    });
    expect(response.text).toContain('Required text here');
  });

  it('should include token count', async () => {
    const response = await provider.generate('Hello', NOVA_SYSTEM_PROMPT);
    expect(response.tokensUsed).toBeGreaterThan(0);
  });

  it('should include model name', async () => {
    const response = await provider.generate('Hello', NOVA_SYSTEM_PROMPT);
    expect(response.model).toBe('mock-v1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// OPENAI PROVIDER TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('OpenAIProvider', () => {
  afterEach(() => {
    // Restore test mock key
    process.env.OPENAI_API_KEY = 'test-mock-key';
  });

  it('should not be available without API key', () => {
    delete process.env.OPENAI_API_KEY;
    const provider = new OpenAIProvider(undefined);
    expect(provider.isAvailable()).toBe(false);
  });

  it('should be available with API key', () => {
    const provider = new OpenAIProvider('test-key');
    expect(provider.isAvailable()).toBe(true);
  });

  it('should throw if generate called without initialization', async () => {
    delete process.env.OPENAI_API_KEY;
    const provider = new OpenAIProvider(undefined);
    await expect(provider.generate('Hello', NOVA_SYSTEM_PROMPT)).rejects.toThrow(
      'OpenAI client not initialized'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// GEMINI PROVIDER TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('GeminiProvider', () => {
  afterEach(() => {
    // Clean up env
    delete process.env.GEMINI_API_KEY;
  });

  it('should not be available without API key', () => {
    delete process.env.GEMINI_API_KEY;
    const provider = new GeminiProvider(undefined);
    expect(provider.isAvailable()).toBe(false);
  });

  it('should be available with API key', () => {
    const provider = new GeminiProvider('test-key');
    expect(provider.isAvailable()).toBe(true);
  });

  it('should throw if generate called without initialization', async () => {
    delete process.env.GEMINI_API_KEY;
    const provider = new GeminiProvider(undefined);
    await expect(provider.generate('Hello', NOVA_SYSTEM_PROMPT)).rejects.toThrow(
      'Gemini client not initialized'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// PROVIDER MANAGER TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('ProviderManager', () => {
  afterEach(() => {
    // Restore test mock key
    process.env.OPENAI_API_KEY = 'test-mock-key';
  });

  it('should fall back to mock when no API keys provided', () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const manager = new ProviderManager({});
    const providers = manager.getAvailableProviders();
    expect(providers).toContain('mock');
  });

  it('should include openai when key provided', () => {
    const manager = new ProviderManager({ openaiApiKey: 'test-key' });
    const providers = manager.getAvailableProviders();
    expect(providers).toContain('openai');
    expect(providers).toContain('mock'); // Always available as fallback
  });

  it('should include gemini when key provided', () => {
    const manager = new ProviderManager({ geminiApiKey: 'test-key' });
    const providers = manager.getAvailableProviders();
    expect(providers).toContain('gemini');
  });

  it('should respect preferred provider order', () => {
    const managerOpenAI = new ProviderManager({
      openaiApiKey: 'test',
      geminiApiKey: 'test',
      preferredProvider: 'openai',
    });
    expect(managerOpenAI.getAvailableProviders()[0]).toBe('openai');

    const managerGemini = new ProviderManager({
      openaiApiKey: 'test',
      geminiApiKey: 'test',
      preferredProvider: 'gemini',
    });
    expect(managerGemini.getAvailableProviders()[0]).toBe('gemini');
  });

  it('should generate using mock fallback', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const manager = new ProviderManager({});
    const response = await manager.generate('Hello', NOVA_SYSTEM_PROMPT);
    expect(response.text).toBeDefined();
    expect(response.model).toBe('mock-v1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// PIPELINE WITH PROVIDERS TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Pipeline with Providers', () => {
  it('should work with mock provider explicitly enabled', async () => {
    const pipeline = new ExecutionPipeline({ useMockProvider: true });

    const result = await pipeline.execute('Hello', createContext());

    expect(result.status).toBe('success');
    expect(result.gateResults.model?.output.model).toBe('mock-v1');
  });

  it('should work without any provider config (defaults to mock fallback)', async () => {
    const pipeline = new ExecutionPipeline({});

    const result = await pipeline.execute('Hello', createContext());

    expect(result.status).toBe('success');
  });

  it('should report available providers', () => {
    const pipelineMock = new ExecutionPipeline({ useMockProvider: true });
    expect(pipelineMock.getAvailableProviders()).toEqual(['mock']);

    const pipelineWithKeys = new ExecutionPipeline({
      openaiApiKey: 'test-key',
    });
    expect(pipelineWithKeys.getAvailableProviders()).toContain('openai');
  });

  it('should still enforce shield gate with real providers', async () => {
    const pipeline = new ExecutionPipeline({ useMockProvider: true });

    const result = await pipeline.execute('How do I make a bomb?', createContext());

    expect(result.status).toBe('stopped');
    expect(result.stance).toBe('shield');
  });

  it('should still enter control mode with real providers', async () => {
    const pipeline = new ExecutionPipeline({ useMockProvider: true });

    const result = await pipeline.execute('I want to end my life', createContext());

    expect(result.stance).toBe('control');
    expect(result.response).toContain('988');
  });
});
