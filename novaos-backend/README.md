# NovaOS Live Data Router

> Constitutional AI backend with real-time data integration

## Overview

NovaOS is a constitutional AI backend system that processes user requests through an **8-gate pipeline**. The Live Data Router enhances the **Lens gate** to fetch real-time data (stock prices, weather, time, crypto, FX rates) from provider APIs instead of relying on stale training data.

```
User Request
     │
     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        8-GATE PIPELINE                              │
├─────────┬─────────┬─────────┬─────────┬─────────┬─────────┬─────────┤
│ Intent  │ Shield  │  Lens   │ Stance  │Capability│ Model  │Personality│ Spark │
│   (1)   │   (2)   │  (3)    │   (4)   │   (5)   │  (6)   │   (7)   │  (8)  │
└─────────┴─────────┴────┬────┴─────────┴─────────┴─────────┴─────────┴───────┘
                         │
                         ▼
              ┌─────────────────────┐
              │  LIVE DATA ROUTER   │
              ├─────────────────────┤
              │ • Classification    │
              │ • Risk Assessment   │
              │ • Provider Fetch    │
              │ • Evidence Building │
              │ • Leak Guard        │
              └─────────────────────┘
```

## Architecture

### Phase Breakdown

The Live Data Router was implemented in 8 phases:

| Phase | Name | Files | Purpose |
|-------|------|-------|---------|
| 1 | Core Types | 8 | Type definitions for categories, providers, constraints |
| 2 | Infrastructure | 10 | HTTP client, cache, retry, circuit breaker, rate limiter |
| 3 | Providers | 10 | Time, FX, Crypto, Stock, Weather providers |
| 4 | Entity System | 6 | Entity resolution and authoritative policies |
| 5 | Leak Guard | 5 | Two-mode numeric leak prevention |
| 6 | Evidence & Injection | 6 | Evidence formatting and failure semantics |
| 7 | Lens Gate | 10 | Gate orchestration and telemetry |
| 8 | Integration | 5 | Pipeline integration, tests, documentation |

**Total: 60 files**

### Directory Structure

```
src/
├── types/
│   ├── categories.ts         # LiveCategory, AuthoritativeCategory
│   ├── provider-results.ts   # ProviderResult discriminated union
│   ├── constraints.ts        # NumericToken, ResponseConstraints
│   ├── entities.ts           # Entity resolution types
│   ├── data-need.ts          # TruthMode, FallbackMode, Classification
│   ├── lens.ts               # LensGateResult, EvidencePack
│   ├── telemetry.ts          # LensTrace, OperationalEvent
│   └── search.ts             # LiveCategorySearchResult (snippet-free)
│
├── utils/
│   ├── canonicalize.ts       # Numeric normalization
│   ├── regex.ts              # Safe regex utilities
│   └── redaction.ts          # Sensitive data redaction
│
├── services/
│   ├── data-providers/
│   │   ├── infrastructure/
│   │   │   ├── fetch-client.ts
│   │   │   ├── cache.ts          # Bounded LRU cache
│   │   │   ├── retry.ts          # Jittered backoff
│   │   │   ├── circuit-breaker.ts
│   │   │   └── rate-limiter.ts   # Atomic rate limiting
│   │   ├── providers/
│   │   │   ├── base-provider.ts
│   │   │   ├── time-provider.ts
│   │   │   ├── fx-provider.ts
│   │   │   ├── crypto-provider.ts
│   │   │   ├── finnhub-provider.ts
│   │   │   └── weather-provider.ts
│   │   ├── entity-resolver.ts
│   │   ├── entity-validator.ts
│   │   ├── freshness.ts
│   │   ├── registry.ts
│   │   └── health.ts
│   │
│   ├── search/
│   │   ├── domain-filter.ts
│   │   └── authoritative-policy.ts
│   │
│   └── live-data/
│       ├── leak-patterns.ts
│       ├── leak-guard.ts
│       ├── leak-exemptions.ts
│       ├── leak-response.ts
│       ├── numeric-tokens.ts
│       ├── evidence-injection.ts
│       ├── constraints-builder.ts
│       ├── failure-semantics.ts
│       └── formatting.ts
│
├── gates/
│   └── lens/
│       ├── index.ts              # Main entry point
│       ├── compatibility.ts      # Legacy interface mapping
│       ├── telemetry.ts
│       ├── classification/
│       │   ├── classifier.ts
│       │   ├── patterns.ts
│       │   └── llm-assist.ts
│       ├── risk/
│       │   └── assessor.ts
│       └── orchestration/
│           ├── orchestrator.ts
│           └── time-handler.ts
│
├── observability/
│   └── operational-events.ts     # Event emission with paging
│
└── tests/
    └── lens-gate.test.ts         # Comprehensive test suite
```

## Configuration

### Environment Variables

```bash
# Provider API Keys
FINNHUB_API_KEY=your_finnhub_key          # Stock data (required for market)
OPENWEATHERMAP_API_KEY=your_owm_key       # Weather data (required for weather)
OPENAI_API_KEY=your_openai_key            # LLM classification (optional)

# Optional Configuration
NODE_ENV=production                        # Affects logging
LENS_ENABLE_TRACING=true                   # Enable detailed traces
LENS_LOG_TRACE=false                       # Log traces to console
```

### Provider Setup

| Provider | Category | API Key Required | Free Tier |
|----------|----------|------------------|-----------|
| System Clock | `time` | No | Always available |
| Frankfurter | `fx` | No | Unlimited |
| CoinGecko | `crypto` | No | Rate limited |
| Finnhub | `market` | Yes | 60 calls/min |
| OpenWeatherMap | `weather` | Yes | 1000 calls/day |

## Usage

### Basic Usage

```typescript
import { executeLensGateAsync } from './gates/lens/index.js';

const state = {
  userMessage: "What's Apple's stock price?",
  normalizedInput: "What's Apple's stock price?",
  gateResults: {},
  flags: {},
  timestamps: { pipelineStart: Date.now() },
};

const context = {
  userId: 'user-123',
  conversationId: 'conv-456',
  timestamp: Date.now(),
  actionSources: [],
  timezone: 'America/New_York',
};

const result = await executeLensGateAsync(state, context);

if (result.output.evidencePack) {
  // Use evidence for response generation
  console.log(result.output.evidencePack.items);
}
```

### Configuration Options

```typescript
const result = await executeLensGateAsync(state, context, {
  enableSearch: true,           // Enable live data fetching
  userTimezone: 'Asia/Tokyo',   // For time queries
  userLocation: 'Seattle, WA',  // For weather queries
});
```

## Hard Invariants

The system enforces 21 hard invariants that MUST NOT be violated:

### Pipeline Invariants
1. **8-gate pipeline order**: Intent → Shield → Lens → Stance → Capability → Model → Personality → Spark
2. **live_feed/mixed → forceHigh IMMUTABLE**: Cannot be overridden once set

### Data Integrity Invariants
3. **Numbers NEVER from web search for live categories**: Only from verified providers
4. **Time has NO qualitative fallback**: If provider fails, refuse (don't degrade)
5. **Failure semantics enforced via central function**: All paths through `getFailureSemantics()`

### Leak Guard Invariants
6. **Two-mode leak guard**: FORBID catches all, ALLOWLIST validates context
7. **Context-bound token validation**: Numbers only valid in semantic context
8. **Exemptions explicitly defined**: No implicit passes
9. **Leak guard is TERMINAL**: No retry, safe response is final
10. **Allowed tokens from EXACT injected strings**: Token generation uses same formatters

### Infrastructure Invariants
11. **Canonicalization for all comparisons**: All numeric comparisons use canonical form
12. **Circuit breaker per provider**: Prevents cascading failures
13. **Jittered backoff prevents thundering herd**: Randomized retry delays
14. **Atomic rate limiting**: No race between check and increment
15. **Bounded cache with O(1) LRU eviction**: Memory-safe with size limits
16. **Logging redaction for secrets**: No API keys in logs

### Verification Invariants
17. **Authoritative policies with conflict detection**: Multiple sources validated

### Observability Invariants
18. **Correlation IDs across all gates**: Complete request tracing
19. **invalid_state triggers page**: Critical alerts for impossible states
20. **Phase manifests machine-checkable**: Automated validation

### Cache Invariants
21. **Cache distinguishes cacheHit vs deduplicated**: Accurate metrics

## Failure Semantics Matrix

| TruthMode | Category | Provider | Fallback | Model? | Constraints |
|-----------|----------|----------|----------|--------|-------------|
| `live_feed` | market | ✓ verified | - | yes | `quoteEvidenceOnly` |
| `live_feed` | market | ✗ fail | `context_only` | yes | `forbidNumericClaims` |
| `live_feed` | time | ✗ fail | - | **NO** | `insufficient` |
| `mixed` | any | ✗ fail | - | yes | `forbidNumericClaims` |
| `local` | - | - | - | yes | `unrestricted` |

**CRITICAL**: Time category has NO qualitative fallback. This is enforced at the type level.

## Testing

### Run Tests

```bash
# Run all tests
npm test

# Run lens gate tests only
npm test -- src/tests/lens-gate.test.ts

# Run with coverage
npm test -- --coverage
```

### Test Categories

1. **Classification tests**: Each category correctly identified
2. **Provider tests**: Mock provider responses
3. **Leak guard tests**: All modes and exemptions
4. **Failure semantics tests**: All matrix combinations
5. **Integration tests**: Full pipeline flow
6. **Invalid state tests**: Trigger and verify paging

## Operational Events

The system emits operational events for monitoring:

| Event | Alert Level | Description |
|-------|-------------|-------------|
| `lens.request` | none | Gate execution started |
| `lens.success` | none | Completed successfully |
| `lens.failure` | warn | Recoverable failure |
| `lens.degraded` | none/warn | Operating in degraded mode |
| `lens.blocked` | none/warn | User action required |
| `lens.invalid_state` | **page** | CRITICAL: Invalid system state |

### Paging Configuration

```typescript
import { configure } from './observability/operational-events.js';

configure({
  onPage: async (event, condition) => {
    // Send to PagerDuty, Slack, etc.
    await pagerduty.trigger({
      severity: 'critical',
      summary: `INVALID STATE: ${condition?.code}`,
      details: event,
    });
  },
});
```

## Troubleshooting

### Common Issues

**Provider returns empty data**
- Check API key is set correctly
- Verify rate limits haven't been exceeded
- Check circuit breaker state

**Time queries fail**
- Time uses system clock, should never fail
- If seeing failures, check for invalid timezone format

**Numeric leak detected**
- Check if number is in evidence tokens
- Verify context words are present
- Check exemptions configuration

**Invalid state alert triggered**
- This is a critical bug - investigate immediately
- Check condition code for specific issue
- Review recent changes to failure semantics

### Debug Logging

```typescript
// Enable detailed traces
const result = await executeLensGate(state, context, {
  enableTracing: true,
  logTrace: true,  // Logs full trace to console
});
```

## Contributing

When modifying the Live Data Router:

1. **Never violate hard invariants** - They exist for safety
2. **Add tests for new code paths** - Especially failure scenarios
3. **Update failure semantics matrix** - If adding new categories
4. **Emit operational events** - For observability
5. **Use correlation IDs** - For tracing

## License

Proprietary - NovaOS

---

*Built with constitutional AI principles. Safety through constraints, not restrictions.*
