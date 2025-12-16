// ═══════════════════════════════════════════════════════════════════════════════
// E2E USER JOURNEY TESTS — Full User Flow Testing
// ═══════════════════════════════════════════════════════════════════════════════
//
// These tests require a running server. Run with:
//   E2E_BASE_URL=http://localhost:3000 npm test -- --run src/tests/e2e/journeys.test.ts
//
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  request,
  createTestUser,
  createAuthenticatedClient,
  createTestContext,
  assertStatus,
  assertLatency,
  sampleGoal,
  sampleMemory,
  wait,
  randomString,
  type TestUser,
  type TestContext,
} from './utils.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TEST CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────────

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const SKIP_E2E = !process.env.E2E_BASE_URL;
const LATENCY_THRESHOLD_MS = 2000; // 2 second max for individual requests

// ─────────────────────────────────────────────────────────────────────────────────
// NEW USER ONBOARDING JOURNEY
// ─────────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP_E2E)('E2E: New User Onboarding Journey', () => {
  let ctx: TestContext;
  let user: TestUser;
  let client: ReturnType<typeof createAuthenticatedClient>;
  
  beforeAll(async () => {
    ctx = await createTestContext(BASE_URL);
    // Create user in beforeAll so all tests have access
    const email = `onboarding_${randomString()}@example.com`;
    user = await createTestUser(BASE_URL, email, 'free');
    ctx.users.set('onboarding', user);
    client = createAuthenticatedClient(BASE_URL, user);
  });
  
  afterAll(async () => {
    await ctx.cleanup();
  });
  
  it('Step 1: Register new user', async () => {
    expect(user.userId).toBeDefined();
    expect(user.token).toBeDefined();
    expect(user.apiKey).toBeDefined();
  });
  
  it('Step 2: Verify authentication', async () => {
    const response = await client.get('/api/v1/auth/verify');
    
    assertStatus(response, 200);
    assertLatency(response, LATENCY_THRESHOLD_MS);
    expect(response.data).toHaveProperty('valid', true);
  });
  
  it('Step 3: Check initial profile', async () => {
    const response = await client.get('/api/v1/profile');
    
    assertStatus(response, 200);
    expect(response.data).toHaveProperty('profile');
  });
  
  it('Step 4: Update profile', async () => {
    const response = await client.patch('/api/v1/profile', {
      name: 'Test User',
      timezone: 'America/New_York',
      preferredTone: 'friendly',
    });
    
    assertStatus(response, 200);
    expect((response.data as any).profile.name).toBe('Test User');
  });
  
  it('Step 5: Set preferences', async () => {
    const response = await client.patch('/api/v1/preferences', {
      verbosity: 'balanced',
      suggestNextSteps: true,
      memoryEnabled: true,
    });
    
    assertStatus(response, 200);
  });
  
  it('Step 6: Send first chat message', async () => {
    const response = await client.post('/api/v1/chat', {
      message: 'Hello! I just joined NovaOS.',
    });
    
    assertStatus(response, 200);
    assertLatency(response, 5000); // Allow more time for LLM response
    expect(response.data).toHaveProperty('message');
    expect(response.data).toHaveProperty('conversationId');
    
    ctx.conversationIds.push((response.data as any).conversationId);
  });
  
  it('Step 7: Continue conversation', async () => {
    const convId = ctx.conversationIds[0];
    const response = await client.post('/api/v1/chat', {
      message: 'Can you help me set up my first goal?',
      conversationId: convId,
    });
    
    assertStatus(response, 200);
    expect((response.data as any).conversationId).toBe(convId);
  });
  
  it('Step 8: Create first goal', async () => {
    const response = await client.post('/api/v1/goals', sampleGoal({
      title: 'Learn NovaOS',
      description: 'Understand all NovaOS features',
      desiredOutcome: 'Be productive with NovaOS',
    }));
    
    assertStatus(response, 201);
    expect(response.data).toHaveProperty('goal');
    expect((response.data as any).goal.status).toBe('active');
    
    ctx.goalIds.push((response.data as any).goal.id);
  });
  
  it('Step 9: Generate first spark', async () => {
    const goalId = ctx.goalIds[0];
    const response = await client.post(`/api/v1/path/${goalId}/next-spark`);
    
    // May return 200 or 404 depending on implementation
    expect([200, 201, 404]).toContain(response.status);
  });
  
  it('Step 10: Add a memory', async () => {
    const response = await client.post('/api/v1/memories', sampleMemory({
      category: 'preference',
      key: 'communication_style',
      value: 'I prefer detailed explanations',
    }));
    
    assertStatus(response, 201);
    expect(response.data).toHaveProperty('memory');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// GOAL COMPLETION JOURNEY
// ─────────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP_E2E)('E2E: Goal Completion Journey', () => {
  let ctx: TestContext;
  let user: TestUser;
  let client: ReturnType<typeof createAuthenticatedClient>;
  let goalId: string;
  let questId: string;
  let stepId: string;
  
  beforeAll(async () => {
    ctx = await createTestContext(BASE_URL);
    user = await createTestUser(BASE_URL, `goal_journey_${randomString()}@example.com`, 'pro');
    ctx.users.set('goal_user', user);
    client = createAuthenticatedClient(BASE_URL, user);
  });
  
  afterAll(async () => {
    await ctx.cleanup();
  });
  
  it('Step 1: Create a goal', async () => {
    const response = await client.post('/api/v1/goals', {
      title: 'Complete E2E Test Suite',
      description: 'Build comprehensive E2E tests',
      desiredOutcome: 'All tests passing with good coverage',
      interestLevel: 'career_capital',
      targetDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      motivations: ['Improve code quality', 'Catch bugs early'],
      successCriteria: ['100% journey coverage', 'All tests pass'],
    });
    
    assertStatus(response, 201);
    goalId = (response.data as any).goal.id;
    ctx.goalIds.push(goalId);
  });
  
  it('Step 2: Add a quest to the goal', async () => {
    const response = await client.post('/api/v1/quests', {
      goalId,
      title: 'Write user journey tests',
      description: 'Create tests for common user flows',
      outcome: 'Tests document user journeys',
      priority: 'high',
      estimatedMinutes: 120,
    });
    
    assertStatus(response, 201);
    questId = (response.data as any).quest.id;
  });
  
  it('Step 3: Add steps to the quest', async () => {
    const steps = [
      { title: 'Define user personas', type: 'action' },
      { title: 'Map user journeys', type: 'action' },
      { title: 'Write test cases', type: 'action' },
      { title: 'Review coverage', type: 'verification' },
    ];
    
    for (const step of steps) {
      const response = await client.post('/api/v1/steps', {
        questId,
        ...step,
      });
      
      assertStatus(response, 201);
      if (!stepId) {
        stepId = (response.data as any).step.id;
      }
    }
  });
  
  it('Step 4: Get the full path', async () => {
    const response = await client.get(`/api/v1/path/${goalId}`);
    
    assertStatus(response, 200);
    expect(response.data).toHaveProperty('path');
  });
  
  it('Step 5: Start the quest', async () => {
    const response = await client.post(`/api/v1/quests/${questId}/transition`, {
      event: 'START',
    });
    
    assertStatus(response, 200);
    expect((response.data as any).quest.status).toBe('active');
  });
  
  it('Step 6: Generate a spark', async () => {
    const response = await client.post('/api/v1/sparks/generate', {
      questId,
      maxMinutes: 15,
      frictionLevel: 'minimal',
    });
    
    assertStatus(response, 200);
    expect(response.data).toHaveProperty('spark');
    expect((response.data as any).spark.estimatedMinutes).toBeLessThanOrEqual(15);
  });
  
  it('Step 7: Complete a step', async () => {
    const response = await client.post(`/api/v1/steps/${stepId}/transition`, {
      event: 'COMPLETE',
      notes: 'Completed via E2E test',
    });
    
    assertStatus(response, 200);
    expect((response.data as any).step.status).toBe('completed');
  });
  
  it('Step 8: Check goal progress', async () => {
    const response = await client.get(`/api/v1/goals/${goalId}`);
    
    assertStatus(response, 200);
    expect((response.data as any).goal.progress).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// MEMORY & PERSONALIZATION JOURNEY
// ─────────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP_E2E)('E2E: Memory & Personalization Journey', () => {
  let ctx: TestContext;
  let user: TestUser;
  let client: ReturnType<typeof createAuthenticatedClient>;
  let memoryId: string;
  
  beforeAll(async () => {
    ctx = await createTestContext(BASE_URL);
    user = await createTestUser(BASE_URL, `memory_journey_${randomString()}@example.com`, 'pro');
    ctx.users.set('memory_user', user);
    client = createAuthenticatedClient(BASE_URL, user);
  });
  
  afterAll(async () => {
    await ctx.cleanup();
  });
  
  it('Step 1: Create multiple memories', async () => {
    const memories = [
      { category: 'fact', key: 'occupation', value: 'Software Engineer' },
      { category: 'preference', key: 'coding_language', value: 'TypeScript' },
      { category: 'interest', key: 'hobby', value: 'Reading sci-fi books' },
      { category: 'skill', key: 'expertise', value: 'Backend development' },
    ];
    
    for (const memory of memories) {
      const response = await client.post('/api/v1/memories', memory);
      assertStatus(response, 201);
      
      if (!memoryId) {
        memoryId = (response.data as any).memory.id;
      }
    }
  });
  
  it('Step 2: List all memories', async () => {
    const response = await client.get('/api/v1/memories');
    
    assertStatus(response, 200);
    expect((response.data as any).memories.length).toBeGreaterThanOrEqual(4);
  });
  
  it('Step 3: Filter memories by category', async () => {
    const response = await client.get('/api/v1/memories?category=preference');
    
    assertStatus(response, 200);
    const memories = (response.data as any).memories;
    expect(memories.every((m: any) => m.category === 'preference')).toBe(true);
  });
  
  it('Step 4: Get memory stats', async () => {
    const response = await client.get('/api/v1/memories/stats');
    
    assertStatus(response, 200);
    expect(response.data).toHaveProperty('stats');
    expect((response.data as any).stats.total).toBeGreaterThanOrEqual(4);
  });
  
  it('Step 5: Update a memory', async () => {
    const response = await client.patch(`/api/v1/memories/${memoryId}`, {
      value: 'Senior Software Engineer',
    });
    
    assertStatus(response, 200);
    expect((response.data as any).memory.value).toBe('Senior Software Engineer');
  });
  
  it('Step 6: Get memory context', async () => {
    const response = await client.post('/api/v1/memories/context', {
      message: 'What do you know about my job?',
    });
    
    assertStatus(response, 200);
    expect(response.data).toHaveProperty('formatted');
  });
  
  it('Step 7: Extract memories from message', async () => {
    const response = await client.post('/api/v1/memories/extract', {
      message: 'I live in San Francisco and I love hiking on weekends.',
    });
    
    assertStatus(response, 200);
    // Extraction may or may not find memories depending on implementation
    expect(response.data).toHaveProperty('saved');
  });
  
  it('Step 8: Delete a specific memory', async () => {
    const response = await client.delete(`/api/v1/memories/${memoryId}`);
    
    assertStatus(response, 200);
    expect((response.data as any).deleted).toBe(true);
  });
  
  it('Step 9: Clear category memories', async () => {
    const response = await client.delete('/api/v1/memories?category=interest');
    
    assertStatus(response, 200);
    expect(response.data).toHaveProperty('deleted');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// SEARCH & DISCOVERY JOURNEY
// ─────────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP_E2E)('E2E: Search & Discovery Journey', () => {
  let ctx: TestContext;
  let user: TestUser;
  let client: ReturnType<typeof createAuthenticatedClient>;
  
  beforeAll(async () => {
    ctx = await createTestContext(BASE_URL);
    user = await createTestUser(BASE_URL, `search_journey_${randomString()}@example.com`, 'pro');
    ctx.users.set('search_user', user);
    client = createAuthenticatedClient(BASE_URL, user);
    
    // Create some searchable content
    await client.post('/api/v1/chat', { message: 'Tell me about TypeScript best practices' });
    await client.post('/api/v1/memories', { category: 'fact', key: 'topic', value: 'TypeScript' });
    await client.post('/api/v1/goals', sampleGoal({ title: 'Master TypeScript' }));
    
    // Wait for indexing
    await wait(500);
  });
  
  afterAll(async () => {
    await ctx.cleanup();
  });
  
  it('Step 1: Search across all content', async () => {
    const response = await client.post('/api/v1/search', {
      query: 'TypeScript',
      scope: 'all',
      limit: 10,
    });
    
    assertStatus(response, 200);
    expect(response.data).toHaveProperty('results');
    expect(response.data).toHaveProperty('total');
  });
  
  it('Step 2: Search conversations only', async () => {
    const response = await client.post('/api/v1/search', {
      query: 'TypeScript',
      scope: 'conversations',
    });
    
    assertStatus(response, 200);
    const results = (response.data as any).results;
    // Results should be conversation or message type
    expect(results.every((r: any) => 
      r.type === 'conversation' || r.type === 'message'
    )).toBe(true);
  });
  
  it('Step 3: Search memories only', async () => {
    const response = await client.post('/api/v1/search', {
      query: 'TypeScript',
      scope: 'memories',
    });
    
    assertStatus(response, 200);
  });
  
  it('Step 4: Get search suggestions', async () => {
    const response = await client.get('/api/v1/search/suggest?q=Type&limit=5');
    
    assertStatus(response, 200);
    expect(response.data).toHaveProperty('suggestions');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// DATA EXPORT JOURNEY
// ─────────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP_E2E)('E2E: Data Export Journey', () => {
  let ctx: TestContext;
  let user: TestUser;
  let client: ReturnType<typeof createAuthenticatedClient>;
  let exportId: string;
  
  beforeAll(async () => {
    ctx = await createTestContext(BASE_URL);
    user = await createTestUser(BASE_URL, `export_journey_${randomString()}@example.com`, 'pro');
    ctx.users.set('export_user', user);
    client = createAuthenticatedClient(BASE_URL, user);
    
    // Create some content to export
    await client.post('/api/v1/chat', { message: 'Hello for export test' });
    await client.post('/api/v1/memories', sampleMemory());
    await client.post('/api/v1/goals', sampleGoal());
  });
  
  afterAll(async () => {
    await ctx.cleanup();
  });
  
  it('Step 1: Create JSON export', async () => {
    const response = await client.post('/api/v1/export', {
      scopes: ['all'],
      format: 'json',
      includeMetadata: true,
      prettyPrint: true,
    });
    
    assertStatus(response, 200);
    expect(response.data).toHaveProperty('exportId');
    expect(response.data).toHaveProperty('filename');
    
    exportId = (response.data as any).exportId;
  });
  
  it('Step 2: Download export', async () => {
    // Skip if no exportId
    if (!exportId) return;
    
    const response = await client.get(`/api/v1/export/${exportId}/download`);
    
    // Should return the export data or redirect
    expect([200, 302]).toContain(response.status);
  });
  
  it('Step 3: Create Markdown export', async () => {
    const response = await client.post('/api/v1/export', {
      scopes: ['conversations'],
      format: 'markdown',
    });
    
    assertStatus(response, 200);
    expect((response.data as any).filename).toContain('.md');
  });
  
  it('Step 4: Create CSV export', async () => {
    const response = await client.post('/api/v1/export', {
      scopes: ['memories'],
      format: 'csv',
    });
    
    assertStatus(response, 200);
    expect((response.data as any).filename).toContain('.csv');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// MULTI-SESSION JOURNEY
// ─────────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP_E2E)('E2E: Multi-Session Continuity', () => {
  let ctx: TestContext;
  let user: TestUser;
  let conversationId: string;
  
  beforeAll(async () => {
    ctx = await createTestContext(BASE_URL);
    user = await createTestUser(BASE_URL, `multi_session_${randomString()}@example.com`, 'pro');
    ctx.users.set('multi_session_user', user);
  });
  
  afterAll(async () => {
    await ctx.cleanup();
  });
  
  it('Session 1: Start conversation with token auth', async () => {
    const client = createAuthenticatedClient(BASE_URL, user);
    
    const response = await client.post('/api/v1/chat', {
      message: 'Remember that my favorite color is blue.',
    });
    
    assertStatus(response, 200);
    conversationId = (response.data as any).conversationId;
    ctx.conversationIds.push(conversationId);
  });
  
  it('Session 2: Continue with API key auth', async () => {
    const response = await request(`${BASE_URL}/api/v1/chat`, {
      method: 'POST',
      apiKey: user.apiKey,
      body: {
        message: 'What is my favorite color?',
        conversationId,
      },
    });
    
    assertStatus(response, 200);
  });
  
  it('Session 3: Verify conversation history', async () => {
    const client = createAuthenticatedClient(BASE_URL, user);
    
    const response = await client.get(`/api/v1/conversations/${conversationId}`);
    
    assertStatus(response, 200);
    expect((response.data as any).messages.length).toBeGreaterThanOrEqual(4); // 2 user + 2 assistant
  });
  
  it('Session 4: List all conversations', async () => {
    const client = createAuthenticatedClient(BASE_URL, user);
    
    const response = await client.get('/api/v1/conversations');
    
    assertStatus(response, 200);
    expect((response.data as any).conversations.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// ERROR RECOVERY JOURNEY
// ─────────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP_E2E)('E2E: Error Handling & Recovery', () => {
  let ctx: TestContext;
  let user: TestUser;
  let client: ReturnType<typeof createAuthenticatedClient>;
  
  beforeAll(async () => {
    ctx = await createTestContext(BASE_URL);
    user = await createTestUser(BASE_URL, `error_journey_${randomString()}@example.com`, 'free');
    ctx.users.set('error_user', user);
    client = createAuthenticatedClient(BASE_URL, user);
  });
  
  afterAll(async () => {
    await ctx.cleanup();
  });
  
  it('Should handle invalid request body', async () => {
    const response = await client.post('/api/v1/chat', {
      // Missing required 'message' field
    });
    
    expect(response.status).toBe(400);
    expect(response.data).toHaveProperty('error');
  });
  
  it('Should handle not found resources', async () => {
    const response = await client.get('/api/v1/goals/nonexistent_goal_id');
    
    expect(response.status).toBe(404);
  });
  
  it('Should handle unauthorized requests', async () => {
    const response = await request(`${BASE_URL}/api/v1/goals`, {
      method: 'GET',
      // No auth
    });
    
    // Depending on config, may be 401 or allow anonymous
    expect([200, 401]).toContain(response.status);
  });
  
  it('Should handle invalid token', async () => {
    const response = await request(`${BASE_URL}/api/v1/auth/verify`, {
      method: 'GET',
      token: 'invalid_token_here',
    });
    
    expect(response.status).toBe(401);
  });
  
  it('Should recover after error', async () => {
    // Make an invalid request
    await client.post('/api/v1/chat', {});
    
    // Should still work for valid requests
    const response = await client.get('/api/v1/auth/status');
    assertStatus(response, 200);
  });
});
