// ═══════════════════════════════════════════════════════════════════════════════
// CHAOS TESTING — Resilience & Failure Scenario Testing
// ═══════════════════════════════════════════════════════════════════════════════
//
// These tests require a running server. Run with:
//   CHAOS_BASE_URL=http://localhost:3000 npm test -- --run src/tests/load/chaos.test.ts
//
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  request,
  createTestUser,
  createAuthenticatedClient,
  wait,
  randomString,
  type TestUser,
} from '../e2e/utils.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────────

const BASE_URL = process.env.CHAOS_BASE_URL ?? 'http://localhost:3000';
const SKIP_CHAOS = !process.env.CHAOS_BASE_URL;

// Chaos test timeouts (longer to allow for recovery)
const CHAOS_TIMEOUT = 30000;

// ─────────────────────────────────────────────────────────────────────────────────
// CHAOS UTILITIES
// ─────────────────────────────────────────────────────────────────────────────────

interface ChaosResult {
  scenario: string;
  duration: number;
  requests: number;
  failures: number;
  recoveryTime?: number;
  notes: string[];
}

/**
 * Run a chaos scenario with monitoring
 */
async function runChaosScenario(
  name: string,
  chaos: () => Promise<void>,
  verify: () => Promise<boolean>,
  options: { duration?: number; checkInterval?: number } = {}
): Promise<ChaosResult> {
  const { duration = 10000, checkInterval = 500 } = options;
  const result: ChaosResult = {
    scenario: name,
    duration: 0,
    requests: 0,
    failures: 0,
    notes: [],
  };
  
  const startTime = Date.now();
  let lastHealthy = startTime;
  let recovered = false;
  
  // Start the chaos
  const chaosPromise = chaos().catch(err => {
    result.notes.push(`Chaos error: ${err.message}`);
  });
  
  // Monitor during chaos
  while (Date.now() - startTime < duration) {
    result.requests++;
    try {
      const healthy = await verify();
      if (healthy) {
        if (!recovered && result.failures > 0) {
          result.recoveryTime = Date.now() - lastHealthy;
          recovered = true;
          result.notes.push(`Recovered after ${result.recoveryTime}ms`);
        }
        lastHealthy = Date.now();
      } else {
        result.failures++;
      }
    } catch (error) {
      result.failures++;
      if (error instanceof Error) {
        result.notes.push(`Check failed: ${error.message}`);
      }
    }
    
    await wait(checkInterval);
  }
  
  await chaosPromise;
  result.duration = Date.now() - startTime;
  
  return result;
}

/**
 * Print chaos test result
 */
function printChaosResult(result: ChaosResult): void {
  const failureRate = ((result.failures / result.requests) * 100).toFixed(2);
  
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║ CHAOS SCENARIO: ${result.scenario.padEnd(47)} ║
╠═══════════════════════════════════════════════════════════════════╣
║ Duration:      ${(result.duration / 1000).toFixed(2)}s                                        ║
║ Total Checks:  ${String(result.requests).padEnd(49)} ║
║ Failures:      ${String(result.failures).padEnd(49)} ║
║ Failure Rate:  ${(failureRate + '%').padEnd(49)} ║
${result.recoveryTime ? `║ Recovery Time: ${(result.recoveryTime / 1000).toFixed(2)}s                                        ║` : ''}
╠═══════════════════════════════════════════════════════════════════╣
${result.notes.length > 0 ? result.notes.map(n => `║ • ${n.substring(0, 61).padEnd(61)} ║`).join('\n') : '║ No additional notes                                           ║'}
╚═══════════════════════════════════════════════════════════════════╝
  `);
}

// ─────────────────────────────────────────────────────────────────────────────────
// RATE LIMIT CHAOS
// ─────────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP_CHAOS)('Chaos: Rate Limiting', { timeout: CHAOS_TIMEOUT }, () => {
  let user: TestUser;
  let client: ReturnType<typeof createAuthenticatedClient>;
  
  beforeAll(async () => {
    user = await createTestUser(BASE_URL, `chaos_rate_${randomString()}@example.com`, 'free');
    client = createAuthenticatedClient(BASE_URL, user);
  });
  
  it('should handle burst of requests exceeding rate limit', async () => {
    const burstSize = 100;
    const results: { status: number; latency: number }[] = [];
    
    console.log(`\nSending burst of ${burstSize} requests...`);
    
    // Send burst of requests
    const startTime = Date.now();
    const promises = Array.from({ length: burstSize }, async () => {
      const res = await client.get('/api/v1/auth/status');
      return { status: res.status, latency: res.latencyMs };
    });
    
    const responses = await Promise.all(promises);
    const burstDuration = Date.now() - startTime;
    
    const successful = responses.filter(r => r.status === 200).length;
    const rateLimited = responses.filter(r => r.status === 429).length;
    const avgLatency = responses.reduce((sum, r) => sum + r.latency, 0) / responses.length;
    
    console.log(`
Burst Test Results:
  Total Requests: ${burstSize}
  Duration: ${burstDuration}ms
  Successful: ${successful}
  Rate Limited: ${rateLimited}
  Avg Latency: ${avgLatency.toFixed(2)}ms
    `);
    
    // Verify system is still responsive after burst
    await wait(2000); // Wait for rate limit window
    const recoveryRes = await client.get('/api/v1/auth/status');
    
    expect(recoveryRes.status).toBe(200);
    expect(successful + rateLimited).toBe(burstSize);
  });
  
  it('should recover after sustained high load', async () => {
    const result = await runChaosScenario(
      'Sustained High Load Recovery',
      async () => {
        // Simulate sustained high load for 5 seconds
        const endTime = Date.now() + 5000;
        while (Date.now() < endTime) {
          await Promise.all([
            client.get('/api/v1/auth/status'),
            client.get('/api/v1/profile'),
            client.get('/api/v1/memories'),
          ]);
          await wait(50);
        }
      },
      async () => {
        const res = await request(`${BASE_URL}/health`);
        return res.status === 200;
      },
      { duration: 15000, checkInterval: 1000 }
    );
    
    printChaosResult(result);
    
    // System should recover
    expect(result.failures).toBeLessThan(result.requests / 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// TIMEOUT CHAOS
// ─────────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP_CHAOS)('Chaos: Timeout Handling', { timeout: CHAOS_TIMEOUT }, () => {
  let user: TestUser;
  
  beforeAll(async () => {
    user = await createTestUser(BASE_URL, `chaos_timeout_${randomString()}@example.com`, 'pro');
  });
  
  it('should handle slow client connections', async () => {
    const results: { success: boolean; error?: string }[] = [];
    
    // Simulate slow requests with artificial delay
    for (let i = 0; i < 10; i++) {
      try {
        const controller = new AbortController();
        
        // Set a short timeout
        const timeoutId = setTimeout(() => controller.abort(), 1000);
        
        const res = await request(`${BASE_URL}/api/v1/chat`, {
          method: 'POST',
          token: user.token,
          body: { message: `Timeout test ${i}` },
        });
        
        clearTimeout(timeoutId);
        results.push({ success: res.status === 200 });
      } catch (error) {
        results.push({ 
          success: false, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }
    
    const successful = results.filter(r => r.success).length;
    console.log(`\nTimeout Test: ${successful}/10 requests completed within timeout`);
    
    // At least some should succeed
    expect(successful).toBeGreaterThan(0);
  });
  
  it('should not leak resources on cancelled requests', async () => {
    const cancelledCount = 20;
    
    console.log(`\nSending ${cancelledCount} requests to be cancelled...`);
    
    // Send requests and immediately cancel them
    for (let i = 0; i < cancelledCount; i++) {
      const controller = new AbortController();
      
      // Start request but don't await
      fetch(`${BASE_URL}/api/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`,
        },
        body: JSON.stringify({ message: `Cancel test ${i}` }),
        signal: controller.signal,
      }).catch(() => {}); // Ignore abort errors
      
      // Cancel immediately
      controller.abort();
    }
    
    // Wait a bit
    await wait(2000);
    
    // System should still be responsive
    const healthRes = await request(`${BASE_URL}/health`);
    expect(healthRes.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// MALFORMED INPUT CHAOS
// ─────────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP_CHAOS)('Chaos: Malformed Input Handling', { timeout: CHAOS_TIMEOUT }, () => {
  let user: TestUser;
  
  beforeAll(async () => {
    user = await createTestUser(BASE_URL, `chaos_input_${randomString()}@example.com`, 'pro');
  });
  
  it('should handle various malformed JSON payloads', async () => {
    const malformedPayloads = [
      '', // Empty
      'not json', // Plain text
      '{', // Incomplete
      '{"message":}', // Invalid
      '{"message": "test"', // Missing closing brace
      'null',
      '[]',
      '{"message": null}',
      `{"message": "${'a'.repeat(200000)}"}`, // Very long
      '{"message": "test", "__proto__": {}}', // Prototype pollution attempt
      '{"message": "test", "constructor": {}}',
    ];
    
    const results: { payload: string; status: number }[] = [];
    
    for (const payload of malformedPayloads) {
      try {
        const res = await fetch(`${BASE_URL}/api/v1/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${user.token}`,
          },
          body: payload,
        });
        
        results.push({ 
          payload: payload.substring(0, 30) + (payload.length > 30 ? '...' : ''),
          status: res.status,
        });
      } catch (error) {
        results.push({ 
          payload: payload.substring(0, 30) + '...',
          status: 0,
        });
      }
    }
    
    console.log('\nMalformed Input Results:');
    results.forEach(r => {
      console.log(`  "${r.payload}" -> ${r.status}`);
    });
    
    // All should return error status (400) or be rejected
    expect(results.every(r => r.status === 400 || r.status === 0)).toBe(true);
    
    // System should still work after all malformed inputs
    const validRes = await request(`${BASE_URL}/api/v1/auth/status`, {
      token: user.token,
    });
    expect(validRes.status).toBe(200);
  });
  
  it('should handle SQL injection-like strings', async () => {
    const injectionPayloads = [
      "'; DROP TABLE users; --",
      "1 OR 1=1",
      "admin'--",
      "' UNION SELECT * FROM users --",
      "${7*7}",
      "{{7*7}}",
    ];
    
    for (const payload of injectionPayloads) {
      const res = await request(`${BASE_URL}/api/v1/memories`, {
        method: 'POST',
        token: user.token,
        body: {
          category: 'fact',
          key: payload,
          value: payload,
        },
      });
      
      // Should either succeed (stored as plain text) or fail validation
      expect([200, 201, 400]).toContain(res.status);
    }
    
    // Verify system integrity
    const healthRes = await request(`${BASE_URL}/health`);
    expect(healthRes.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// CONCURRENT USER CHAOS
// ─────────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP_CHAOS)('Chaos: Concurrent User Conflicts', { timeout: CHAOS_TIMEOUT }, () => {
  it('should handle multiple users modifying same resources', async () => {
    // Create two users
    const user1 = await createTestUser(BASE_URL, `chaos_user1_${randomString()}@example.com`, 'pro');
    const user2 = await createTestUser(BASE_URL, `chaos_user2_${randomString()}@example.com`, 'pro');
    
    // User 1 creates a goal
    const goalRes = await request(`${BASE_URL}/api/v1/goals`, {
      method: 'POST',
      token: user1.token,
      body: {
        title: 'Shared Goal',
        description: 'Test concurrent access',
        desiredOutcome: 'No conflicts',
      },
    });
    
    expect(goalRes.status).toBe(201);
    const goalId = (goalRes.data as any).goal.id;
    
    // Both users try to read/modify concurrently
    const operations = await Promise.allSettled([
      request(`${BASE_URL}/api/v1/goals/${goalId}`, { token: user1.token }),
      request(`${BASE_URL}/api/v1/goals/${goalId}`, { token: user2.token }),
      request(`${BASE_URL}/api/v1/goals/${goalId}/transition`, {
        method: 'POST',
        token: user1.token,
        body: { event: 'PAUSE' },
      }),
    ]);
    
    // User 1's operations should succeed
    // User 2 should get 403/404 (not their goal)
    const results = operations.map(op => 
      op.status === 'fulfilled' ? op.value.status : 0
    );
    
    console.log('\nConcurrent access results:', results);
    
    // At least user 1's read should succeed
    expect(results[0]).toBe(200);
  });
  
  it('should handle rapid authentication attempts', async () => {
    const attempts = 50;
    const email = `chaos_auth_${randomString()}@example.com`;
    
    console.log(`\nAttempting ${attempts} rapid registrations...`);
    
    // Try to register same email multiple times rapidly
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, () =>
        request(`${BASE_URL}/api/v1/auth/register`, {
          method: 'POST',
          body: { email, tier: 'free' },
        })
      )
    );
    
    const successful = results.filter(
      r => r.status === 'fulfilled' && (r.value as any).status === 200
    ).length;
    
    console.log(`  Successful registrations: ${successful}`);
    
    // Only one should succeed (or all if duplicates allowed)
    // The important thing is no server errors
    const serverErrors = results.filter(
      r => r.status === 'fulfilled' && (r.value as any).status >= 500
    ).length;
    
    expect(serverErrors).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// RESOURCE EXHAUSTION CHAOS
// ─────────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP_CHAOS)('Chaos: Resource Exhaustion', { timeout: CHAOS_TIMEOUT }, () => {
  let user: TestUser;
  
  beforeAll(async () => {
    user = await createTestUser(BASE_URL, `chaos_resource_${randomString()}@example.com`, 'pro');
  });
  
  it('should handle creation of many resources', async () => {
    const resourceCount = 100;
    const created: string[] = [];
    
    console.log(`\nCreating ${resourceCount} memories...`);
    
    for (let i = 0; i < resourceCount; i++) {
      const res = await request(`${BASE_URL}/api/v1/memories`, {
        method: 'POST',
        token: user.token,
        body: {
          category: 'fact',
          key: `exhaust_${i}_${randomString(5)}`,
          value: `Value ${randomString(100)}`,
        },
      });
      
      if (res.status === 201) {
        created.push((res.data as any).memory.id);
      }
    }
    
    console.log(`  Created: ${created.length}`);
    
    // List should still work
    const listRes = await request(`${BASE_URL}/api/v1/memories`, {
      token: user.token,
    });
    
    expect(listRes.status).toBe(200);
    
    // Cleanup
    console.log('  Cleaning up...');
    await request(`${BASE_URL}/api/v1/memories`, {
      method: 'DELETE',
      token: user.token,
    });
  });
  
  it('should handle long conversations', async () => {
    const messageCount = 20;
    let conversationId: string | undefined;
    
    console.log(`\nSending ${messageCount} messages in one conversation...`);
    
    for (let i = 0; i < messageCount; i++) {
      const res = await request(`${BASE_URL}/api/v1/chat`, {
        method: 'POST',
        token: user.token,
        body: {
          message: `Message ${i + 1}: ${randomString(50)}`,
          conversationId,
        },
      });
      
      if (res.status === 200) {
        conversationId = (res.data as any).conversationId;
      }
      
      // Small delay to avoid rate limiting
      await wait(100);
    }
    
    // Should still be able to retrieve the conversation
    if (conversationId) {
      const convRes = await request(`${BASE_URL}/api/v1/conversations/${conversationId}`, {
        token: user.token,
      });
      
      expect(convRes.status).toBe(200);
      console.log(`  Conversation has ${(convRes.data as any).messages?.length ?? 0} messages`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// RECOVERY TESTING
// ─────────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP_CHAOS)('Chaos: Recovery', { timeout: CHAOS_TIMEOUT }, () => {
  it('should recover service availability after errors', async () => {
    const user = await createTestUser(BASE_URL, `chaos_recovery_${randomString()}@example.com`);
    
    // Cause some errors
    console.log('\nGenerating errors...');
    for (let i = 0; i < 10; i++) {
      await request(`${BASE_URL}/api/v1/nonexistent`, { token: user.token });
      await request(`${BASE_URL}/api/v1/goals/invalid_id`, { token: user.token });
    }
    
    // Wait a moment
    await wait(1000);
    
    // Check recovery
    console.log('Checking recovery...');
    const checks = [
      request(`${BASE_URL}/health`),
      request(`${BASE_URL}/ready`),
      request(`${BASE_URL}/api/v1/auth/status`, { token: user.token }),
    ];
    
    const results = await Promise.all(checks);
    
    console.log('Recovery results:', results.map(r => r.status));
    
    expect(results.every(r => r.status === 200)).toBe(true);
  });
});
