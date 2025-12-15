// ═══════════════════════════════════════════════════════════════════════════════
// MODEL PROVIDERS — LLM Abstraction Layer
// OpenAI, Gemini, and fallback logic
// ═══════════════════════════════════════════════════════════════════════════════

import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Generation, GenerationConstraints, ConversationMessage } from '../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// PROVIDER INTERFACE
// ─────────────────────────────────────────────────────────────────────────────────

export interface GenerateOptions {
  conversationHistory?: ConversationMessage[];
}

export interface ModelProvider {
  name: string;
  generate(
    prompt: string,
    systemPrompt: string,
    constraints?: GenerationConstraints,
    options?: GenerateOptions
  ): Promise<Generation>;
  isAvailable(): boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────
// OPENAI PROVIDER
// ─────────────────────────────────────────────────────────────────────────────────

export class OpenAIProvider implements ModelProvider {
  name = 'openai';
  private client: OpenAI | null = null;
  private model: string;

  constructor(apiKey?: string, model: string = 'gpt-4o-mini') {
    const key = apiKey ?? process.env.OPENAI_API_KEY;
    if (key) {
      this.client = new OpenAI({ apiKey: key });
    }
    this.model = model;
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  async generate(
    prompt: string,
    systemPrompt: string,
    constraints?: GenerationConstraints,
    options?: GenerateOptions
  ): Promise<Generation> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized');
    }

    const fullSystemPrompt = this.buildSystemPrompt(systemPrompt, constraints);

    // Build messages array with conversation history
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: fullSystemPrompt },
    ];

    // Add conversation history if provided
    if (options?.conversationHistory?.length) {
      for (const msg of options.conversationHistory) {
        messages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content,
        });
      }
    }

    // Add current user message
    messages.push({ role: 'user', content: prompt });

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      max_tokens: 2048,
      temperature: 0.7,
    });

    const text = response.choices[0]?.message?.content ?? '';
    const tokensUsed = response.usage?.total_tokens ?? 0;

    return {
      text: this.applyPostConstraints(text, constraints),
      model: this.model,
      tokensUsed,
      constraints,
    };
  }

  private buildSystemPrompt(base: string, constraints?: GenerationConstraints): string {
    let prompt = base;

    if (constraints?.bannedPhrases?.length) {
      prompt += `\n\nNEVER use these phrases: ${constraints.bannedPhrases.join(', ')}`;
    }

    if (constraints?.maxWe !== undefined) {
      prompt += `\n\nLimit use of "we" to maximum ${constraints.maxWe} times.`;
    }

    if (constraints?.tone) {
      prompt += `\n\nTone: ${constraints.tone}`;
    }

    if (constraints?.numericPrecisionAllowed === false) {
      prompt += `\n\nDo NOT provide specific numeric values for time-sensitive data.`;
    }

    if (constraints?.actionRecommendationsAllowed === false) {
      prompt += `\n\nDo NOT provide specific action recommendations.`;
    }

    return prompt;
  }

  private applyPostConstraints(text: string, constraints?: GenerationConstraints): string {
    let result = text;

    if (constraints?.mustPrepend) {
      result = constraints.mustPrepend + '\n\n' + result;
    }

    if (constraints?.mustInclude?.length) {
      for (const required of constraints.mustInclude) {
        if (!result.includes(required)) {
          result += '\n\n' + required;
        }
      }
    }

    return result;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// GEMINI PROVIDER
// ─────────────────────────────────────────────────────────────────────────────────

export class GeminiProvider implements ModelProvider {
  name = 'gemini';
  private client: GoogleGenerativeAI | null = null;
  private model: string;

  constructor(apiKey?: string, model: string = 'gemini-1.5-flash') {
    const key = apiKey ?? process.env.GEMINI_API_KEY;
    if (key) {
      this.client = new GoogleGenerativeAI(key);
    }
    this.model = model;
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  async generate(
    prompt: string,
    systemPrompt: string,
    constraints?: GenerationConstraints,
    options?: GenerateOptions
  ): Promise<Generation> {
    if (!this.client) {
      throw new Error('Gemini client not initialized');
    }

    const fullSystemPrompt = this.buildSystemPrompt(systemPrompt, constraints);
    const model = this.client.getGenerativeModel({ 
      model: this.model,
      systemInstruction: fullSystemPrompt,
    });

    // Build chat history if provided
    if (options?.conversationHistory?.length) {
      const chat = model.startChat({
        history: options.conversationHistory.map(msg => ({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        })),
      });
      const result = await chat.sendMessage(prompt);
      const text = result.response.text();
      const tokensUsed = Math.ceil(text.length / 4);
      
      return {
        text: this.applyPostConstraints(text, constraints),
        model: this.model,
        tokensUsed,
        constraints,
      };
    }

    // No history, simple generate
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();
    const tokensUsed = Math.ceil(text.length / 4);

    return {
      text: this.applyPostConstraints(text, constraints),
      model: this.model,
      tokensUsed,
      constraints,
    };
  }

  private buildSystemPrompt(base: string, constraints?: GenerationConstraints): string {
    let prompt = base;

    if (constraints?.bannedPhrases?.length) {
      prompt += `\n\nNEVER use these phrases: ${constraints.bannedPhrases.join(', ')}`;
    }

    if (constraints?.maxWe !== undefined) {
      prompt += `\n\nLimit use of "we" to maximum ${constraints.maxWe} times.`;
    }

    if (constraints?.tone) {
      prompt += `\n\nTone: ${constraints.tone}`;
    }

    if (constraints?.numericPrecisionAllowed === false) {
      prompt += `\n\nDo NOT provide specific numeric values for time-sensitive data.`;
    }

    return prompt;
  }

  private applyPostConstraints(text: string, constraints?: GenerationConstraints): string {
    let result = text;

    if (constraints?.mustPrepend) {
      result = constraints.mustPrepend + '\n\n' + result;
    }

    if (constraints?.mustInclude?.length) {
      for (const required of constraints.mustInclude) {
        if (!result.includes(required)) {
          result += '\n\n' + required;
        }
      }
    }

    return result;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// MOCK PROVIDER (for testing/offline)
// ─────────────────────────────────────────────────────────────────────────────────

export class MockProvider implements ModelProvider {
  name = 'mock';

  isAvailable(): boolean {
    return true;
  }

  async generate(
    prompt: string,
    _systemPrompt: string,
    constraints?: GenerationConstraints,
    _options?: GenerateOptions
  ): Promise<Generation> {
    // Generate contextual mock response
    let text = this.generateMockResponse(prompt);

    if (constraints?.mustPrepend) {
      text = constraints.mustPrepend + '\n\n' + text;
    }

    if (constraints?.mustInclude?.length) {
      text += '\n\n' + constraints.mustInclude.join(' ');
    }

    return {
      text,
      model: 'mock-v1',
      tokensUsed: text.split(/\s+/).length,
      constraints,
    };
  }

  private generateMockResponse(prompt: string): string {
    const lower = prompt.toLowerCase();

    if (/\b(help|plan|create|make|build)\b/.test(lower)) {
      return 'I can help you with that. Here are the steps to accomplish your goal.';
    }

    if (/\b(what|who|where|when|why|how)\b/.test(lower)) {
      return 'Based on my understanding, here is the information you requested.';
    }

    if (/\b(summarize|summary)\b/.test(lower)) {
      return 'Here is a concise summary of the key points.';
    }

    return 'I understand your request. Here is my response.';
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// PROVIDER MANAGER WITH FALLBACK
// ─────────────────────────────────────────────────────────────────────────────────

export interface ProviderManagerConfig {
  openaiApiKey?: string;
  geminiApiKey?: string;
  preferredProvider?: 'openai' | 'gemini' | 'mock';
  enableFallback?: boolean;
}

export class ProviderManager {
  private providers: ModelProvider[] = [];
  private enableFallback: boolean;

  constructor(config: ProviderManagerConfig = {}) {
    this.enableFallback = config.enableFallback ?? true;

    // Initialize providers based on config and available keys
    const openai = new OpenAIProvider(config.openaiApiKey);
    const gemini = new GeminiProvider(config.geminiApiKey);
    const mock = new MockProvider();

    // Order by preference
    const preferred = config.preferredProvider ?? 'openai';

    if (preferred === 'openai') {
      if (openai.isAvailable()) this.providers.push(openai);
      if (gemini.isAvailable()) this.providers.push(gemini);
    } else if (preferred === 'gemini') {
      if (gemini.isAvailable()) this.providers.push(gemini);
      if (openai.isAvailable()) this.providers.push(openai);
    }

    // Always add mock as final fallback
    this.providers.push(mock);

    console.log(`[PROVIDERS] Initialized: ${this.providers.map(p => p.name).join(' → ')}`);
  }

  async generate(
    prompt: string,
    systemPrompt: string,
    constraints?: GenerationConstraints,
    options?: GenerateOptions
  ): Promise<Generation> {
    let lastError: Error | null = null;

    for (const provider of this.providers) {
      if (!provider.isAvailable()) continue;

      try {
        console.log(`[PROVIDERS] Attempting ${provider.name}...`);
        const result = await provider.generate(prompt, systemPrompt, constraints, options);
        console.log(`[PROVIDERS] Success with ${provider.name}`);
        return result;
      } catch (error) {
        console.error(`[PROVIDERS] ${provider.name} failed:`, error);
        lastError = error instanceof Error ? error : new Error(String(error));

        if (!this.enableFallback) {
          throw lastError;
        }
      }
    }

    throw lastError ?? new Error('No providers available');
  }

  getAvailableProviders(): string[] {
    return this.providers.filter(p => p.isAvailable()).map(p => p.name);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// NOVA SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────────────────────

export const NOVA_SYSTEM_PROMPT = `You are Nova, an AI assistant designed to be a Shield, Lens, and Sword for the user.

CORE PRINCIPLES:
- Shield: Protect from misinformation, impulsive decisions, and harmful actions
- Lens: Provide clear, calibrated information with explicit uncertainty
- Sword: Enable forward progress through directed action

BEHAVIORAL RULES:
1. Never foster emotional dependency
2. Always distinguish facts from inference from speculation
3. Never fabricate information
4. Redirect to real-world engagement when appropriate
5. Match confidence to evidence strength

ANTI-PATTERNS (Never do these):
- "I'm always here for you" or similar dependency-fostering language
- "I'm so proud of you" or excessive praise
- Claiming certainty on uncertain matters
- Providing specific numbers for time-sensitive data without verification

RESPONSE STYLE:
- Be direct and actionable
- Use concrete language
- Acknowledge tradeoffs explicitly
- Keep responses focused and practical`;
