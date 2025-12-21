# NovaOS Infrastructure Services — Phase 4

Core infrastructure services for NovaOS including secure Redis client, circuit breaker, retry policies, and graceful shutdown.

## Installation

```bash
# Extract to your project root
unzip novaos-infrastructure-phase4.zip -d .

# Install dependencies
npm install ioredis
```

## Quick Start

```typescript
import {
  initializeInfrastructure,
  getCircuitBreaker,
  retry,
  Keys,
} from './infrastructure/index.js';

// Initialize all services
const { redis } = await initializeInfrastructure({
  redis: config.redis,
  shutdown: { timeoutMs: 30000 },
  installSignalHandlers: true,
});

// Use Redis with type-safe keys
await redis.set(Keys.Sword.goal(goalId), JSON.stringify(goal));

// Wrap external calls with circuit breaker
const breaker = getCircuitBreaker('openai');
const response = await breaker.execute(() => callOpenAI(prompt));

// Retry failed operations
const data = await retry(() => fetchData(url), { maxAttempts: 3 });
```

## Module Structure

```
src/infrastructure/
├── redis/
│   ├── keys.ts              # Collision-safe key generation
│   ├── scripts.ts           # Lua scripts for atomic ops
│   ├── client.ts            # Secure Redis client
│   └── index.ts
│
├── circuit-breaker/
│   ├── types.ts             # States, config, errors
│   ├── config.ts            # Per-service configurations
│   ├── breaker.ts           # Circuit breaker implementation
│   └── index.ts
│
├── retry/
│   ├── types.ts             # Retry policy types
│   ├── backoff.ts           # Exponential backoff with jitter
│   ├── policy.ts            # Retry policy implementation
│   └── index.ts
│
├── shutdown/
│   ├── hooks.ts             # Shutdown hooks registry
│   ├── handler.ts           # Signal handlers, shutdown coordinator
│   └── index.ts
│
└── index.ts                 # Main exports
```

## Features

### Redis Client

**Secure Connection:**
```typescript
import { createRedisClient, Keys } from './infrastructure/index.js';

const redis = createRedisClient({
  host: 'redis.example.com',
  port: 6379,
  password: process.env.REDIS_PASSWORD,
  tls: true,
  keyPrefix: 'nova:',
});

await redis.connect();
```

**Type-Safe Keys:**
```typescript
// Prevent key collisions and injection
Keys.Sword.goal(goalId)           // nova:sword:goal:goal_abc123
Keys.Sword.userGoals(userId)      // nova:sword:user:user_xyz:goals
Keys.RateLimit.api(ip, 'minute')  // nova:rate:api:192.168.1.1:minute
Keys.Lock.goal(goalId)            // nova:lock:goal:goal_abc123
Keys.Cache.llmResponse(hash)      // nova:cache:llm:abc123...
```

**Lua Scripts (Atomic Operations):**
```typescript
// Token bucket rate limiting
const result = await redis.rateLimit(key, 60, 1); // 60 tokens, 1/sec refill
if (!result.allowed) {
  throw new Error(`Rate limited, retry in ${result.retryAfterMs}ms`);
}

// Distributed locking with fencing tokens
const lock = await redis.acquireLock(lockKey, ownerId, 30000);
if (lock.acquired) {
  try {
    await doWork();
  } finally {
    await redis.releaseLock(lockKey, ownerId);
  }
}

// Optimistic locking
const created = await redis.createIfNotExists(key, data);
const updated = await redis.conditionalUpdate(key, version, newData);
```

### Circuit Breaker

**Basic Usage:**
```typescript
import { getCircuitBreaker, CircuitOpenError } from './infrastructure/index.js';

const breaker = getCircuitBreaker('openai');

try {
  const result = await breaker.execute(() => callOpenAI(prompt));
} catch (error) {
  if (error instanceof CircuitOpenError) {
    console.log(`Circuit open, retry after ${error.retryAfterMs}ms`);
  }
}
```

**Configuration Presets:**

| Preset | Failure Threshold | Reset Timeout | Use Case |
|--------|-------------------|---------------|----------|
| `aggressive` | 3 | 10s | Caches, simple services |
| `moderate` | 5 | 30s | Most APIs (default) |
| `tolerant` | 10 | 60s | LLMs, complex services |
| `critical` | 2 | 60s | Payment, auth |

**Pre-configured Services:**
- `openai`, `gemini`, `anthropic` — LLM providers (tolerant)
- `redis` — Cache (aggressive)
- `finnhub`, `coingecko`, `openweathermap` — Data APIs (moderate)

**Function Wrapper:**
```typescript
import { withCircuitBreaker, createProtectedClient } from './infrastructure/index.js';

// Wrap a function
const protectedCall = withCircuitBreaker('openai', callOpenAI);

// Wrap entire client
const protectedRedis = createProtectedClient('redis', redisClient);
```

### Retry Policies

**Simple Retry:**
```typescript
import { retry, RetryPresets } from './infrastructure/index.js';

// With defaults
const result = await retry(() => fetchData(url));

// With options
const result = await retry(() => callAPI(), {
  maxAttempts: 5,
  initialDelayMs: 500,
  totalTimeoutMs: 30000,
});

// Using presets
const result = await retry(() => callLLM(prompt), RetryPresets.patient);
```

**Backoff Strategies:**

| Strategy | Description |
|----------|-------------|
| `fixed` | Same delay each time |
| `linear` | Delay increases linearly |
| `exponential` | Delay doubles each time |
| `exponential-jitter` | Exponential with randomization (default) |

**Presets:**

| Preset | Max Attempts | Initial Delay | Total Timeout |
|--------|--------------|---------------|---------------|
| `quick` | 2 | 100ms | 5s |
| `standard` | 3 | 1s | 30s |
| `patient` | 5 | 2s | 120s |
| `aggressive` | 10 | 500ms | 60s |

**Custom Policy:**
```typescript
import { createRetryPolicy } from './infrastructure/index.js';

const policy = createRetryPolicy({
  maxAttempts: 5,
  backoffStrategy: 'exponential-jitter',
  isRetryable: (error) => error.code !== 'INVALID_REQUEST',
  onRetry: (event) => console.log(`Retry ${event.attempt}/${event.maxAttempts}`),
});

const result = await policy.execute(() => riskyOperation());
```

### Graceful Shutdown

**Register Hooks:**
```typescript
import { 
  registerShutdownHook, 
  installSignalHandlers,
  createServerCloseHook,
} from './infrastructure/index.js';

// Register cleanup tasks
registerShutdownHook('redis', () => redis.disconnect(), { priority: 'high' });
registerShutdownHook('http', createServerCloseHook(server), { priority: 'critical' });
registerShutdownHook('metrics', () => flushMetrics(), { priority: 'low' });

// Install signal handlers (SIGTERM, SIGINT)
installSignalHandlers();
```

**Priority Levels:**

| Priority | Value | Use Case |
|----------|-------|----------|
| `critical` | 100 | Stop accepting requests |
| `high` | 75 | Close connections |
| `normal` | 50 | Standard cleanup |
| `low` | 25 | Nice-to-have cleanup |
| `background` | 0 | Best-effort |

**Configuration:**
```typescript
import { configureShutdown } from './infrastructure/index.js';

configureShutdown({
  timeoutMs: 30000,           // Total shutdown timeout
  signals: ['SIGTERM', 'SIGINT'],
  drainDelayMs: 5000,         // Wait for in-flight requests
  exitCodeSuccess: 0,
  exitCodeFailure: 1,
  exitCodeTimeout: 124,
});
```

**Health Check Integration:**
```typescript
import { shouldAcceptRequests } from './infrastructure/index.js';

app.get('/health/ready', (req, res) => {
  if (!shouldAcceptRequests()) {
    return res.status(503).json({ ready: false, reason: 'shutting_down' });
  }
  res.json({ ready: true });
});
```

## Dependencies

Required:
```json
{
  "dependencies": {
    "ioredis": "^5.x"
  }
}
```

## Metrics Emitted

### Redis
- `redis_operation_duration_seconds` — Operation latency histogram
- `redis_errors_total` — Error counter by type
- `redis_connected` — Connection status gauge

### Circuit Breaker
- `circuit_breaker_state` — Current state gauge (0=CLOSED, 1=HALF_OPEN, 2=OPEN)
- `circuit_breaker_state_changes_total` — State transition counter
- `circuit_breaker_requests_total` — Request counter by result
- `circuit_breaker_rejections_total` — Rejection counter by reason

### Retry
- `retry_attempts_total` — Attempt counter by result
- `retry_attempts_count` — Histogram of attempts needed

## File Listing

```
infrastructure/
├── redis/
│   ├── keys.ts           (450 lines)
│   ├── scripts.ts        (400 lines)
│   ├── client.ts         (980 lines)
│   └── index.ts          (80 lines)
├── circuit-breaker/
│   ├── types.ts          (220 lines)
│   ├── config.ts         (280 lines)
│   ├── breaker.ts        (480 lines)
│   └── index.ts          (60 lines)
├── retry/
│   ├── types.ts          (200 lines)
│   ├── backoff.ts        (200 lines)
│   ├── policy.ts         (350 lines)
│   └── index.ts          (60 lines)
├── shutdown/
│   ├── hooks.ts          (280 lines)
│   ├── handler.ts        (350 lines)
│   └── index.ts          (60 lines)
└── index.ts              (280 lines)
```

Total: ~16 TypeScript files, ~4,700 lines of code
