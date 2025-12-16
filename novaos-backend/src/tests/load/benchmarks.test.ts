// ═══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE BENCHMARKS — Automated Performance Testing
// ═══════════════════════════════════════════════════════════════════════════════
//
// These tests require a running server. Run with:
//   BENCHMARK_BASE_URL=http://localhost:3000 npm test -- --run src/tests/load/benchmarks.test.ts
//
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  request,
  createTestUser,
  createAuthenticatedClient,
  createMetricsCollector,
  measure,
  wait,
  randomString,
  type TestUser,
} from '../e2e/utils.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────────

const BASE_URL = process.env.BENCHMARK_BASE_URL ?? 'http://localhost:3000';
const SKIP_BENCHMARKS = !process.env.BENCHMARK_BASE_URL;

// Performance thresholds (in milliseconds)
const THRESHOLDS = {
  health: { p95: 50, p99: 100 },
  auth: { p95: 100, p99: 200 },
  chat: { p95: 3000, p99: 5000 },
  goals: { p95: 200, p99: 500 },
  memories: { p95: 150, p99: 300 },
  search: { p95: 500, p99: 1000 },
};

// ─────────────────────────────────────────────────────────────────────────────────
// BENCHMARK UTILITIES
// ─────────────────────────────────────────────────────────────────────────────────

interface BenchmarkResult {
  name: string;
  iterations: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  successRate: number;
  throughput: number; // requests per second
}

async function runBenchmark(
  name: string,
  fn: () => Promise<boolean>,
  iterations: number = 100,
  concurrency: number = 1
): Promise<BenchmarkResult> {
  const latencies: number[] = [];
  let successes = 0;
  const startTime = Date.now();
  
  // Run in batches for concurrency
  const batchSize = concurrency;
  const batches = Math.ceil(iterations / batchSize);
  
  for (let b = 0; b < batches; b++) {
    const batchPromises: Promise<void>[] = [];
    const remaining = Math.min(batchSize, iterations - b * batchSize);
    
    for (let i = 0; i < remaining; i++) {
      batchPromises.push(
        (async () => {
          const start = performance.now();
          try {
            const success = await fn();
            if (success) successes++;
          } catch (error) {
            // Count as failure
          }
          latencies.push(performance.now() - start);
        })()
      );
    }
    
    await Promise.all(batchPromises);
  }
  
  const totalTime = (Date.now() - startTime) / 1000;
  const sorted = [...latencies].sort((a, b) => a - b);
  const len = sorted.length;
  
  return {
    name,
    iterations,
    avgMs: sorted.reduce((a, b) => a + b, 0) / len,
    minMs: sorted[0] ?? 0,
    maxMs: sorted[len - 1] ?? 0,
    p50Ms: sorted[Math.floor(len * 0.5)] ?? 0,
    p95Ms: sorted[Math.floor(len * 0.95)] ?? 0,
    p99Ms: sorted[Math.floor(len * 0.99)] ?? 0,
    successRate: successes / iterations,
    throughput: iterations / totalTime,
  };
}

function printBenchmarkResult(result: BenchmarkResult): void {
  console.log(`
┌─────────────────────────────────────────────────────────────┐
│ Benchmark: ${result.name.padEnd(46)} │
├─────────────────────────────────────────────────────────────┤
│ Iterations: ${String(result.iterations).padEnd(45)} │
│ Throughput: ${(result.throughput.toFixed(2) + ' req/s').padEnd(45)} │
│ Success Rate: ${((result.successRate * 100).toFixed(2) + '%').padEnd(43)} │
├─────────────────────────────────────────────────────────────┤
│ Latency (ms):                                               │
│   Min: ${result.minMs.toFixed(2).padEnd(51)} │
│   Avg: ${result.avgMs.toFixed(2).padEnd(51)} │
│   Max: ${result.maxMs.toFixed(2).padEnd(51)} │
│   P50: ${result.p50Ms.toFixed(2).padEnd(51)} │
│   P95: ${result.p95Ms.toFixed(2).padEnd(51)} │
│   P99: ${result.p99Ms.toFixed(2).padEnd(51)} │
└─────────────────────────────────────────────────────────────┘
  `);
}

// ─────────────────────────────────────────────────────────────────────────────────
// HEALTH BENCHMARKS
// ─────────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP_BENCHMARKS)('Performance Benchmarks: Health Endpoints', () => {
  it('should benchmark /health endpoint', async () => {
    const result = await runBenchmark(
      'GET /health',
      async () => {
        const res = await request(`${BASE_URL}/health`);
        return res.status === 200;
      },
      100,
      10
    );
    
    printBenchmarkResult(result);
    
    expect(result.p95Ms).toBeLessThan(THRESHOLDS.health.p95);
    expect(result.p99Ms).toBeLessThan(THRESHOLDS.health.p99);
    expect(result.successRate).toBeGreaterThan(0.99);
  });
  
  it('should benchmark /ready endpoint', async () => {
    const result = await runBenchmark(
      'GET /ready',
      async () => {
        const res = await request(`${BASE_URL}/ready`);
        return res.status === 200;
      },
      100,
      10
    );
    
    printBenchmarkResult(result);
    
    expect(result.p95Ms).toBeLessThan(THRESHOLDS.health.p95);
  });
  
  it('should benchmark /api/v1/version endpoint', async () => {
    const result = await runBenchmark(
      'GET /api/v1/version',
      async () => {
        const res = await request(`${BASE_URL}/api/v1/version`);
        return res.status === 200;
      },
      100,
      10
    );
    
    printBenchmarkResult(result);
    
    expect(result.p95Ms).toBeLessThan(THRESHOLDS.health.p95);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// AUTH BENCHMARKS
// ─────────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP_BENCHMARKS)('Performance Benchmarks: Auth Endpoints', () => {
  it('should benchmark user registration', async () => {
    let counter = 0;
    
    const result = await runBenchmark(
      'POST /api/v1/auth/register',
      async () => {
        const res = await request(`${BASE_URL}/api/v1/auth/register`, {
          method: 'POST',
          body: { 
            email: `bench_${counter++}_${randomString()}@example.com`,
            tier: 'free',
          },
        });
        return res.status === 200;
      },
      50,
      5
    );
    
    printBenchmarkResult(result);
    
    expect(result.p95Ms).toBeLessThan(THRESHOLDS.auth.p95);
  });
  
  it('should benchmark auth verification', async () => {
    const user = await createTestUser(BASE_URL, `bench_verify_${randomString()}@example.com`);
    
    const result = await runBenchmark(
      'GET /api/v1/auth/verify',
      async () => {
        const res = await request(`${BASE_URL}/api/v1/auth/verify`, {
          token: user.token,
        });
        return res.status === 200;
      },
      100,
      10
    );
    
    printBenchmarkResult(result);
    
    expect(result.p95Ms).toBeLessThan(THRESHOLDS.auth.p95);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// CHAT BENCHMARKS
// ─────────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP_BENCHMARKS)('Performance Benchmarks: Chat Endpoints', () => {
  let user: TestUser;
  
  beforeAll(async () => {
    user = await createTestUser(BASE_URL, `bench_chat_${randomString()}@example.com`, 'pro');
  });
  
  it('should benchmark chat message sending', async () => {
    const result = await runBenchmark(
      'POST /api/v1/chat',
      async () => {
        const res = await request(`${BASE_URL}/api/v1/chat`, {
          method: 'POST',
          token: user.token,
          body: { message: `Benchmark message ${randomString(20)}` },
        });
        return res.status === 200;
      },
      20, // Fewer iterations due to LLM latency
      2   // Low concurrency
    );
    
    printBenchmarkResult(result);
    
    expect(result.p95Ms).toBeLessThan(THRESHOLDS.chat.p95);
    expect(result.successRate).toBeGreaterThan(0.9);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// GOALS BENCHMARKS
// ─────────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP_BENCHMARKS)('Performance Benchmarks: Goals Endpoints', () => {
  let user: TestUser;
  let goalIds: string[] = [];
  
  beforeAll(async () => {
    user = await createTestUser(BASE_URL, `bench_goals_${randomString()}@example.com`, 'pro');
    
    // Create some goals for listing
    for (let i = 0; i < 10; i++) {
      const res = await request(`${BASE_URL}/api/v1/goals`, {
        method: 'POST',
        token: user.token,
        body: {
          title: `Benchmark Goal ${i}`,
          description: 'Created for benchmarking',
          desiredOutcome: 'Complete benchmark',
        },
      });
      if (res.status === 201) {
        goalIds.push((res.data as any).goal.id);
      }
    }
  });
  
  it('should benchmark goal listing', async () => {
    const result = await runBenchmark(
      'GET /api/v1/goals',
      async () => {
        const res = await request(`${BASE_URL}/api/v1/goals`, {
          token: user.token,
        });
        return res.status === 200;
      },
      100,
      10
    );
    
    printBenchmarkResult(result);
    
    expect(result.p95Ms).toBeLessThan(THRESHOLDS.goals.p95);
  });
  
  it('should benchmark goal creation', async () => {
    let counter = 0;
    
    const result = await runBenchmark(
      'POST /api/v1/goals',
      async () => {
        const res = await request(`${BASE_URL}/api/v1/goals`, {
          method: 'POST',
          token: user.token,
          body: {
            title: `New Goal ${counter++}`,
            description: 'Benchmark goal',
            desiredOutcome: 'Success',
          },
        });
        return res.status === 201;
      },
      50,
      5
    );
    
    printBenchmarkResult(result);
    
    expect(result.p95Ms).toBeLessThan(THRESHOLDS.goals.p95);
  });
  
  it('should benchmark single goal retrieval', async () => {
    const goalId = goalIds[0];
    if (!goalId) return;
    
    const result = await runBenchmark(
      'GET /api/v1/goals/:id',
      async () => {
        const res = await request(`${BASE_URL}/api/v1/goals/${goalId}`, {
          token: user.token,
        });
        return res.status === 200;
      },
      100,
      10
    );
    
    printBenchmarkResult(result);
    
    expect(result.p95Ms).toBeLessThan(THRESHOLDS.goals.p95);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// MEMORY BENCHMARKS
// ─────────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP_BENCHMARKS)('Performance Benchmarks: Memory Endpoints', () => {
  let user: TestUser;
  let memoryIds: string[] = [];
  
  beforeAll(async () => {
    user = await createTestUser(BASE_URL, `bench_memory_${randomString()}@example.com`, 'pro');
    
    // Create some memories
    for (let i = 0; i < 50; i++) {
      const res = await request(`${BASE_URL}/api/v1/memories`, {
        method: 'POST',
        token: user.token,
        body: {
          category: 'fact',
          key: `bench_key_${i}`,
          value: `Benchmark value ${i}`,
        },
      });
      if (res.status === 201) {
        memoryIds.push((res.data as any).memory.id);
      }
    }
  });
  
  it('should benchmark memory listing', async () => {
    const result = await runBenchmark(
      'GET /api/v1/memories',
      async () => {
        const res = await request(`${BASE_URL}/api/v1/memories`, {
          token: user.token,
        });
        return res.status === 200;
      },
      100,
      10
    );
    
    printBenchmarkResult(result);
    
    expect(result.p95Ms).toBeLessThan(THRESHOLDS.memories.p95);
  });
  
  it('should benchmark memory creation', async () => {
    let counter = 0;
    
    const result = await runBenchmark(
      'POST /api/v1/memories',
      async () => {
        const res = await request(`${BASE_URL}/api/v1/memories`, {
          method: 'POST',
          token: user.token,
          body: {
            category: 'fact',
            key: `new_bench_${counter++}_${randomString(5)}`,
            value: `Value ${randomString(20)}`,
          },
        });
        return res.status === 201;
      },
      100,
      10
    );
    
    printBenchmarkResult(result);
    
    expect(result.p95Ms).toBeLessThan(THRESHOLDS.memories.p95);
  });
  
  it('should benchmark memory stats', async () => {
    const result = await runBenchmark(
      'GET /api/v1/memories/stats',
      async () => {
        const res = await request(`${BASE_URL}/api/v1/memories/stats`, {
          token: user.token,
        });
        return res.status === 200;
      },
      100,
      10
    );
    
    printBenchmarkResult(result);
    
    expect(result.p95Ms).toBeLessThan(THRESHOLDS.memories.p95);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// SEARCH BENCHMARKS
// ─────────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP_BENCHMARKS)('Performance Benchmarks: Search Endpoints', () => {
  let user: TestUser;
  
  beforeAll(async () => {
    user = await createTestUser(BASE_URL, `bench_search_${randomString()}@example.com`, 'pro');
    
    // Create some searchable content
    await request(`${BASE_URL}/api/v1/chat`, {
      method: 'POST',
      token: user.token,
      body: { message: 'Tell me about TypeScript programming' },
    });
    
    await request(`${BASE_URL}/api/v1/memories`, {
      method: 'POST',
      token: user.token,
      body: { category: 'fact', key: 'language', value: 'TypeScript' },
    });
    
    await wait(1000); // Wait for indexing
  });
  
  it('should benchmark search', async () => {
    const result = await runBenchmark(
      'POST /api/v1/search',
      async () => {
        const res = await request(`${BASE_URL}/api/v1/search`, {
          method: 'POST',
          token: user.token,
          body: { query: 'TypeScript', scope: 'all' },
        });
        return res.status === 200;
      },
      50,
      5
    );
    
    printBenchmarkResult(result);
    
    expect(result.p95Ms).toBeLessThan(THRESHOLDS.search.p95);
  });
  
  it('should benchmark search suggestions', async () => {
    const result = await runBenchmark(
      'GET /api/v1/search/suggest',
      async () => {
        const res = await request(`${BASE_URL}/api/v1/search/suggest?q=Type`, {
          token: user.token,
        });
        return res.status === 200;
      },
      100,
      10
    );
    
    printBenchmarkResult(result);
    
    expect(result.p95Ms).toBeLessThan(THRESHOLDS.search.p95);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// CONCURRENT LOAD BENCHMARK
// ─────────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP_BENCHMARKS)('Performance Benchmarks: Concurrent Load', () => {
  it('should handle 50 concurrent users', async () => {
    const userCount = 50;
    const users: TestUser[] = [];
    
    // Create users
    for (let i = 0; i < userCount; i++) {
      const user = await createTestUser(BASE_URL, `concurrent_${i}_${randomString()}@example.com`);
      users.push(user);
    }
    
    // Simulate concurrent activity
    const startTime = Date.now();
    const results = await Promise.all(
      users.map(async (user) => {
        const metrics = createMetricsCollector();
        
        // Each user makes a few requests
        for (let i = 0; i < 5; i++) {
          const res = await request(`${BASE_URL}/api/v1/auth/status`, {
            token: user.token,
          });
          metrics.record('/auth/status', res.latencyMs, res.status === 200);
          
          await wait(100);
        }
        
        return metrics.summary();
      })
    );
    
    const totalDuration = Date.now() - startTime;
    const avgP95 = results.reduce((sum, r) => sum + r.p95LatencyMs, 0) / results.length;
    const avgSuccessRate = results.reduce((sum, r) => sum + r.successRate, 0) / results.length;
    
    console.log(`
┌─────────────────────────────────────────────────────────────┐
│ Concurrent Load Test: ${userCount} Users                            │
├─────────────────────────────────────────────────────────────┤
│ Total Duration: ${(totalDuration / 1000).toFixed(2)}s                                    │
│ Avg P95 Latency: ${avgP95.toFixed(2)}ms                                │
│ Avg Success Rate: ${(avgSuccessRate * 100).toFixed(2)}%                               │
└─────────────────────────────────────────────────────────────┘
    `);
    
    expect(avgSuccessRate).toBeGreaterThan(0.95);
    expect(avgP95).toBeLessThan(1000);
  });
});
