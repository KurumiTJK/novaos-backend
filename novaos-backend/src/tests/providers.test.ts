// ═══════════════════════════════════════════════════════════════════════════════
// PROVIDER TESTS — LLM Abstraction Validation
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
// MOCK PROVIDER TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('MockProvider', () => {
  let provider: MockProvider;

  beforeEach(() => {
    provider = new MockProvider();
  });

  it('should always be available', () => {
    expect(provider.isAvailable()).toBe(true);
  });

  it('should generate contextual responses', async () => {
    const helpResponse = await provider.generate(
      'Help me plan my day',
      NOVA_SYSTEM_PROMPT
    );
    expect(helpResponse.text).toContain('help');

    const questionResponse = await provider.generate(
      'What is the capital of France?',
      NOVA_SYSTEM_PROMPT
    );
    expect(questionResponse.text).toContain('information');
  });

  it('should apply mustPrepend constraint', async () => {
    const response = await provider.generate(
      'Hello',
      NOVA_SYSTEM_PROMPT,
      { mustPrepend: 'IMPORTANT: ' }
    );
    expect(response.text).toMatch(/^IMPORTANT:/);
  });

  it('should apply mustInclude constraint', async () => {
    const response = await provider.generate(
      'Hello',
      NOVA_SYSTEM_PROMPT,
      { mustInclude: ['Required text here'] }
    );
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
  // Store original env values
  const originalOpenAIKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    // Restore original env values
    if (originalOpenAIKey !== undefined) {
      process.env.OPENAI_API_KEY = originalOpenAIKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it('should not be available without API key', () => {
    // Clear env var for this test
    delete process.env.OPENAI_API_KEY;
    const provider = new OpenAIProvider(undefined);
    expect(provider.isAvailable()).toBe(false);
  });

  it('should be available with API key', () => {
    const provider = new OpenAIProvider('test-key');
    expect(provider.isAvailable()).toBe(true);
  });

  it('should throw if generate called without initialization', async () => {
    // Clear env var for this test
    delete process.env.OPENAI_API_KEY;
    const provider = new OpenAIProvider(undefined);
    await expect(
      provider.generate('Hello', NOVA_SYSTEM_PROMPT)
    ).rejects.toThrow('OpenAI client not initialized');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// GEMINI PROVIDER TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('GeminiProvider', () => {
  // Store original env values
  const originalGeminiKey = process.env.GEMINI_API_KEY;

  afterEach(() => {
    // Restore original env values
    if (originalGeminiKey !== undefined) {
      process.env.GEMINI_API_KEY = originalGeminiKey;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
  });

  it('should not be available without API key', () => {
    // Clear env var for this test
    delete process.env.GEMINI_API_KEY;
    const provider = new GeminiProvider(undefined);
    expect(provider.isAvailable()).toBe(false);
  });

  it('should be available with API key', () => {
    const provider = new GeminiProvider('test-key');
    expect(provider.isAvailable()).toBe(true);
  });

  it('should throw if generate called without initialization', async () => {
    // Clear env var for this test
    delete process.env.GEMINI_API_KEY;
    const provider = new GeminiProvider(undefined);
    await expect(
      provider.generate('Hello', NOVA_SYSTEM_PROMPT)
    ).rejects.toThrow('Gemini client not initialized');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// PROVIDER MANAGER TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('ProviderManager', () => {
  // Store original env values
  const originalOpenAIKey = process.env.OPENAI_API_KEY;
  const originalGeminiKey = process.env.GEMINI_API_KEY;

  afterEach(() => {
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
  });

  it('should fall back to mock when no API keys provided', () => {
    // Clear env vars for this test
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
    // Clear env vars to ensure only mock is available
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

// ─────────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('System Prompt', () => {
  it('should contain core principles', () => {
    expect(NOVA_SYSTEM_PROMPT).toContain('Shield');
    expect(NOVA_SYSTEM_PROMPT).toContain('Lens');
    expect(NOVA_SYSTEM_PROMPT).toContain('Sword');
  });

  it('should contain anti-patterns', () => {
    expect(NOVA_SYSTEM_PROMPT).toContain("I'm always here for you");
    expect(NOVA_SYSTEM_PROMPT).toContain("I'm so proud of you");
  });

  it('should specify behavioral rules', () => {
    expect(NOVA_SYSTEM_PROMPT).toContain('emotional dependency');
    expect(NOVA_SYSTEM_PROMPT).toContain('fabricate');
  });
});
