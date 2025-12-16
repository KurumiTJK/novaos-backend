// ═══════════════════════════════════════════════════════════════════════════════
// OPENAPI SCHEMAS — Reusable Component Schemas
// ═══════════════════════════════════════════════════════════════════════════════

import type { OpenAPISchema } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// COMMON SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────────

export const ErrorSchema: OpenAPISchema = {
  type: 'object',
  properties: {
    error: { type: 'string', description: 'Error message' },
    code: { type: 'string', description: 'Error code' },
    details: { type: 'object', description: 'Additional error details' },
  },
  required: ['error'],
};

export const PaginationSchema: OpenAPISchema = {
  type: 'object',
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    offset: { type: 'integer', minimum: 0, default: 0 },
    total: { type: 'integer', description: 'Total number of items' },
    hasMore: { type: 'boolean', description: 'Whether more items exist' },
  },
};

export const TimestampSchema: OpenAPISchema = {
  type: 'string',
  format: 'date-time',
  description: 'ISO 8601 timestamp',
  example: '2024-01-15T10:30:00Z',
};

// ─────────────────────────────────────────────────────────────────────────────────
// AUTH SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────────

export const UserSchema: OpenAPISchema = {
  type: 'object',
  properties: {
    userId: { type: 'string', description: 'Unique user identifier' },
    tier: { 
      type: 'string', 
      enum: ['free', 'pro', 'enterprise'],
      description: 'User subscription tier',
    },
    createdAt: { $ref: '#/components/schemas/Timestamp' },
  },
  required: ['userId', 'tier'],
};

export const AuthStatusSchema: OpenAPISchema = {
  type: 'object',
  properties: {
    authenticated: { type: 'boolean' },
    userId: { type: 'string' },
    tier: { type: 'string', enum: ['free', 'pro', 'enterprise'] },
    blocked: { type: 'boolean' },
    blockedReason: { type: 'string', nullable: true },
    blockedUntil: { type: 'string', format: 'date-time', nullable: true },
    recentVetos: { type: 'integer' },
    storage: { type: 'string', enum: ['redis', 'memory'] },
  },
};

// ─────────────────────────────────────────────────────────────────────────────────
// CHAT SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────────

export const ChatRequestSchema: OpenAPISchema = {
  type: 'object',
  properties: {
    message: {
      type: 'string',
      minLength: 1,
      maxLength: 100000,
      description: 'User message content',
    },
    conversationId: {
      type: 'string',
      description: 'Existing conversation ID (optional, creates new if omitted)',
    },
    ackToken: {
      type: 'string',
      description: 'Acknowledgment token for soft veto override',
    },
    context: {
      type: 'object',
      properties: {
        timezone: { type: 'string', example: 'America/New_York' },
        locale: { type: 'string', example: 'en-US' },
      },
    },
  },
  required: ['message'],
};

export const ChatResponseSchema: OpenAPISchema = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: ['success', 'await_ack', 'stopped'],
      description: 'Response type',
    },
    message: { type: 'string', description: 'Assistant response' },
    conversationId: { type: 'string' },
    stance: {
      type: 'string',
      enum: ['control', 'shield', 'lens', 'sword'],
      description: 'Current Nova stance',
    },
    confidence: {
      type: 'string',
      enum: ['high', 'medium', 'low', 'inference', 'speculation'],
    },
    verified: { type: 'boolean', description: 'Whether facts were verified' },
    freshnessWarning: { type: 'string', nullable: true },
    spark: { $ref: '#/components/schemas/Spark' },
    transparency: {
      type: 'object',
      properties: {
        gates: { type: 'array', items: { type: 'string' } },
        reasoning: { type: 'string' },
      },
    },
  },
};

export const AwaitAckResponseSchema: OpenAPISchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['await_ack'] },
    message: { type: 'string' },
    ackRequired: {
      type: 'object',
      properties: {
        token: { type: 'string' },
        requiredText: { type: 'string' },
        expiresAt: { type: 'string', format: 'date-time' },
      },
      required: ['token', 'requiredText', 'expiresAt'],
    },
    reason: { type: 'string' },
  },
};

// ─────────────────────────────────────────────────────────────────────────────────
// CONVERSATION SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────────

export const ConversationSchema: OpenAPISchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    title: { type: 'string' },
    createdAt: { $ref: '#/components/schemas/Timestamp' },
    updatedAt: { $ref: '#/components/schemas/Timestamp' },
    messageCount: { type: 'integer' },
    totalTokens: { type: 'integer' },
    metadata: { type: 'object' },
  },
};

export const MessageSchema: OpenAPISchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    role: { type: 'string', enum: ['user', 'assistant', 'system'] },
    content: { type: 'string' },
    timestamp: { type: 'integer', description: 'Unix timestamp in milliseconds' },
    tokens: { type: 'integer' },
    metadata: { type: 'object' },
  },
};

// ─────────────────────────────────────────────────────────────────────────────────
// SWORD SCHEMAS (Goals, Quests, Steps, Sparks)
// ─────────────────────────────────────────────────────────────────────────────────

export const GoalSchema: OpenAPISchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
    desiredOutcome: { type: 'string' },
    interestLevel: {
      type: 'string',
      enum: ['physical_safety', 'financial_stability', 'career_capital', 'reputation', 'emotional_stability', 'comfort'],
    },
    tags: { type: 'array', items: { type: 'string' } },
    status: { type: 'string', enum: ['active', 'paused', 'completed', 'abandoned'] },
    progress: { type: 'integer', minimum: 0, maximum: 100 },
    targetDate: { type: 'string', format: 'date' },
    createdAt: { $ref: '#/components/schemas/Timestamp' },
    updatedAt: { $ref: '#/components/schemas/Timestamp' },
    completedAt: { $ref: '#/components/schemas/Timestamp' },
    questIds: { type: 'array', items: { type: 'string' } },
    motivations: { type: 'array', items: { type: 'string' } },
    constraints: { type: 'array', items: { type: 'string' } },
    successCriteria: { type: 'array', items: { type: 'string' } },
  },
};

export const CreateGoalRequestSchema: OpenAPISchema = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', maxLength: 2000 },
    desiredOutcome: { type: 'string', maxLength: 1000 },
    interestLevel: {
      type: 'string',
      enum: ['physical_safety', 'financial_stability', 'career_capital', 'reputation', 'emotional_stability', 'comfort'],
      default: 'comfort',
    },
    targetDate: { type: 'string', format: 'date' },
    motivations: { type: 'array', items: { type: 'string' } },
    constraints: { type: 'array', items: { type: 'string' } },
    successCriteria: { type: 'array', items: { type: 'string' } },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'description', 'desiredOutcome'],
};

export const QuestSchema: OpenAPISchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    goalId: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
    outcome: { type: 'string' },
    status: { type: 'string', enum: ['not_started', 'active', 'blocked', 'completed', 'skipped'] },
    priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
    progress: { type: 'integer', minimum: 0, maximum: 100 },
    order: { type: 'integer' },
    estimatedMinutes: { type: 'integer' },
    targetDate: { type: 'string', format: 'date' },
    createdAt: { $ref: '#/components/schemas/Timestamp' },
    updatedAt: { $ref: '#/components/schemas/Timestamp' },
    stepIds: { type: 'array', items: { type: 'string' } },
    riskLevel: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
    riskNotes: { type: 'string' },
  },
};

export const StepSchema: OpenAPISchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    questId: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
    type: { type: 'string', enum: ['action', 'decision', 'verification', 'milestone'] },
    status: { type: 'string', enum: ['pending', 'active', 'completed', 'skipped'] },
    order: { type: 'integer' },
    estimatedMinutes: { type: 'integer' },
    createdAt: { $ref: '#/components/schemas/Timestamp' },
    completedAt: { $ref: '#/components/schemas/Timestamp' },
    completionNotes: { type: 'string' },
    verificationRequired: { type: 'boolean' },
  },
};

export const SparkSchema: OpenAPISchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    stepId: { type: 'string' },
    questId: { type: 'string' },
    action: { type: 'string', description: 'The specific action (imperative, < 100 chars)' },
    rationale: { type: 'string', description: 'Why this action (1-2 sentences)' },
    estimatedMinutes: { type: 'integer', description: 'Typically 2-15 minutes' },
    frictionLevel: { type: 'string', enum: ['minimal', 'low', 'medium'] },
    reversible: { type: 'boolean' },
    status: { type: 'string', enum: ['suggested', 'accepted', 'completed', 'skipped', 'expired'] },
    createdAt: { $ref: '#/components/schemas/Timestamp' },
    expiresAt: { $ref: '#/components/schemas/Timestamp' },
    completedAt: { $ref: '#/components/schemas/Timestamp' },
    nextSparkHint: { type: 'string' },
  },
};

export const PathSchema: OpenAPISchema = {
  type: 'object',
  properties: {
    goalId: { type: 'string' },
    currentQuestId: { type: 'string' },
    currentStepId: { type: 'string' },
    completedQuests: { type: 'integer' },
    totalQuests: { type: 'integer' },
    overallProgress: { type: 'integer', minimum: 0, maximum: 100 },
    nextStep: { $ref: '#/components/schemas/Step' },
    activeSpark: { $ref: '#/components/schemas/Spark' },
    blockers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['quest_dependency', 'external', 'resource', 'decision'] },
          description: { type: 'string' },
          questId: { type: 'string' },
          suggestedAction: { type: 'string' },
        },
      },
    },
    estimatedCompletionDate: { type: 'string', format: 'date' },
    daysRemaining: { type: 'integer' },
    onTrack: { type: 'boolean' },
  },
};

// ─────────────────────────────────────────────────────────────────────────────────
// MEMORY SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────────

export const MemorySchema: OpenAPISchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    category: {
      type: 'string',
      enum: ['preference', 'fact', 'project', 'skill', 'interest', 'relationship', 'goal', 'context'],
    },
    key: { type: 'string' },
    value: { type: 'string' },
    context: { type: 'string' },
    confidence: { type: 'string', enum: ['explicit', 'inferred', 'speculative'] },
    sensitivity: { type: 'string', enum: ['public', 'private', 'sensitive'] },
    createdAt: { $ref: '#/components/schemas/Timestamp' },
    updatedAt: { $ref: '#/components/schemas/Timestamp' },
    expiresAt: { $ref: '#/components/schemas/Timestamp' },
    reinforcementScore: { type: 'integer', minimum: 0, maximum: 100 },
  },
};

export const ProfileSchema: OpenAPISchema = {
  type: 'object',
  properties: {
    userId: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string' },
    organization: { type: 'string' },
    location: { type: 'string' },
    timezone: { type: 'string' },
    preferredTone: { type: 'string', enum: ['formal', 'friendly', 'direct', 'supportive'] },
    preferredDepth: { type: 'string', enum: ['brief', 'moderate', 'detailed'] },
    preferredFormat: { type: 'string', enum: ['prose', 'bullets', 'structured'] },
    expertiseAreas: { type: 'array', items: { type: 'string' } },
    expertiseLevel: { type: 'string', enum: ['beginner', 'intermediate', 'advanced', 'expert'] },
    interests: { type: 'array', items: { type: 'string' } },
    createdAt: { $ref: '#/components/schemas/Timestamp' },
    updatedAt: { $ref: '#/components/schemas/Timestamp' },
  },
};

export const PreferencesSchema: OpenAPISchema = {
  type: 'object',
  properties: {
    userId: { type: 'string' },
    tone: { type: 'string', enum: ['formal', 'friendly', 'direct', 'supportive'] },
    verbosity: { type: 'string', enum: ['concise', 'balanced', 'detailed'] },
    formatting: { type: 'string', enum: ['minimal', 'moderate', 'rich'] },
    proactiveReminders: { type: 'boolean' },
    suggestNextSteps: { type: 'boolean' },
    askClarifyingQuestions: { type: 'boolean' },
    riskTolerance: { type: 'string', enum: ['conservative', 'moderate', 'aggressive'] },
    memoryEnabled: { type: 'boolean' },
    autoExtractFacts: { type: 'boolean' },
    defaultMode: { type: 'string', enum: ['snapshot', 'expansion'] },
    showConfidenceLevel: { type: 'boolean' },
    showSources: { type: 'boolean' },
    updatedAt: { $ref: '#/components/schemas/Timestamp' },
  },
};

// ─────────────────────────────────────────────────────────────────────────────────
// SEARCH SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────────

export const SearchRequestSchema: OpenAPISchema = {
  type: 'object',
  properties: {
    query: { type: 'string', minLength: 1, maxLength: 500 },
    scope: { type: 'string', enum: ['all', 'conversations', 'memories', 'goals'] },
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    offset: { type: 'integer', minimum: 0, default: 0 },
    filters: {
      type: 'object',
      properties: {
        dateFrom: { type: 'string', format: 'date-time' },
        dateTo: { type: 'string', format: 'date-time' },
        types: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  required: ['query'],
};

export const SearchResultSchema: OpenAPISchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['conversation', 'message', 'memory', 'goal'] },
    title: { type: 'string' },
    snippet: { type: 'string' },
    score: { type: 'number' },
    highlights: { type: 'array', items: { type: 'string' } },
    metadata: { type: 'object' },
    createdAt: { $ref: '#/components/schemas/Timestamp' },
  },
};

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORT SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────────

export const ExportRequestSchema: OpenAPISchema = {
  type: 'object',
  properties: {
    scopes: {
      type: 'array',
      items: {
        type: 'string',
        enum: ['all', 'conversations', 'memories', 'goals', 'profile', 'search_history'],
      },
      minItems: 1,
    },
    format: { type: 'string', enum: ['json', 'markdown', 'csv'] },
    startDate: { type: 'string', format: 'date-time' },
    endDate: { type: 'string', format: 'date-time' },
    includeMetadata: { type: 'boolean', default: true },
    prettyPrint: { type: 'boolean', default: true },
    redactSensitive: { type: 'boolean', default: false },
  },
  required: ['scopes', 'format'],
};

export const ExportResultSchema: OpenAPISchema = {
  type: 'object',
  properties: {
    exportId: { type: 'string' },
    filename: { type: 'string' },
    mimeType: { type: 'string' },
    sizeBytes: { type: 'integer' },
    stats: {
      type: 'object',
      properties: {
        conversations: { type: 'integer' },
        messages: { type: 'integer' },
        memories: { type: 'integer' },
        goals: { type: 'integer' },
        quests: { type: 'integer' },
        steps: { type: 'integer' },
        sparks: { type: 'integer' },
      },
    },
    createdAt: { $ref: '#/components/schemas/Timestamp' },
    expiresAt: { $ref: '#/components/schemas/Timestamp' },
    downloadUrl: { type: 'string', format: 'uri' },
  },
};

// ─────────────────────────────────────────────────────────────────────────────────
// HEALTH SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────────

export const HealthCheckSchema: OpenAPISchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy'] },
    version: { type: 'string' },
    timestamp: { $ref: '#/components/schemas/Timestamp' },
    uptime: { type: 'number', description: 'Uptime in seconds' },
    storage: { type: 'string', enum: ['redis', 'memory'] },
    verification: { type: 'string', enum: ['enabled', 'disabled'] },
  },
};

// ─────────────────────────────────────────────────────────────────────────────────
// ALL SCHEMAS MAP
// ─────────────────────────────────────────────────────────────────────────────────

export const schemas: Record<string, OpenAPISchema> = {
  Error: ErrorSchema,
  Pagination: PaginationSchema,
  Timestamp: TimestampSchema,
  User: UserSchema,
  AuthStatus: AuthStatusSchema,
  ChatRequest: ChatRequestSchema,
  ChatResponse: ChatResponseSchema,
  AwaitAckResponse: AwaitAckResponseSchema,
  Conversation: ConversationSchema,
  Message: MessageSchema,
  Goal: GoalSchema,
  CreateGoalRequest: CreateGoalRequestSchema,
  Quest: QuestSchema,
  Step: StepSchema,
  Spark: SparkSchema,
  Path: PathSchema,
  Memory: MemorySchema,
  Profile: ProfileSchema,
  Preferences: PreferencesSchema,
  SearchRequest: SearchRequestSchema,
  SearchResult: SearchResultSchema,
  ExportRequest: ExportRequestSchema,
  ExportResult: ExportResultSchema,
  HealthCheck: HealthCheckSchema,
};
