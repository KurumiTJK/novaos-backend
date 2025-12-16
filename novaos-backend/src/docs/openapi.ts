// ═══════════════════════════════════════════════════════════════════════════════
// OPENAPI SPECIFICATION — NovaOS Backend API Documentation
// ═══════════════════════════════════════════════════════════════════════════════

import type { OpenAPIDocument, OpenAPIPathItem, OpenAPIOperation } from './types.js';
import { schemas } from './schemas.js';

// ─────────────────────────────────────────────────────────────────────────────────
// API VERSION
// ─────────────────────────────────────────────────────────────────────────────────

export const API_VERSION = '10.0.0';
export const OPENAPI_VERSION = '3.0.3';

// ─────────────────────────────────────────────────────────────────────────────────
// COMMON RESPONSES
// ─────────────────────────────────────────────────────────────────────────────────

const errorResponses = {
  '400': {
    description: 'Bad Request - Invalid input',
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/Error' },
        example: { error: 'Invalid request body', code: 'VALIDATION_ERROR' },
      },
    },
  },
  '401': {
    description: 'Unauthorized - Missing or invalid authentication',
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/Error' },
        example: { error: 'Invalid API key', code: 'UNAUTHORIZED' },
      },
    },
  },
  '403': {
    description: 'Forbidden - User blocked or insufficient permissions',
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/Error' },
        example: { error: 'User blocked due to abuse', code: 'BLOCKED' },
      },
    },
  },
  '404': {
    description: 'Not Found',
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/Error' },
        example: { error: 'Resource not found', code: 'NOT_FOUND' },
      },
    },
  },
  '429': {
    description: 'Too Many Requests - Rate limit exceeded',
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/Error' },
        example: { error: 'Rate limit exceeded', code: 'RATE_LIMITED' },
      },
    },
  },
  '500': {
    description: 'Internal Server Error',
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/Error' },
        example: { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      },
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────────
// PATH DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────────

const paths: Record<string, OpenAPIPathItem> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // HEALTH & STATUS
  // ═══════════════════════════════════════════════════════════════════════════
  
  '/health': {
    get: {
      tags: ['Health'],
      summary: 'Liveness check',
      description: 'Returns basic health status. Used by Kubernetes for liveness probes.',
      operationId: 'getHealth',
      responses: {
        '200': {
          description: 'Service is healthy',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/HealthCheck' },
            },
          },
        },
      },
    },
  },
  
  '/ready': {
    get: {
      tags: ['Health'],
      summary: 'Readiness check',
      description: 'Checks if service is ready to handle requests. Used by Kubernetes for readiness probes.',
      operationId: 'getReady',
      responses: {
        '200': {
          description: 'Service is ready',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  ready: { type: 'boolean' },
                  timestamp: { type: 'string', format: 'date-time' },
                  checks: {
                    type: 'object',
                    properties: {
                      storage: { type: 'boolean' },
                      config: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        },
        '503': {
          description: 'Service not ready',
        },
      },
    },
  },
  
  '/api/v1/health': {
    get: {
      tags: ['Health'],
      summary: 'API health check',
      description: 'Returns detailed health status including version and features.',
      operationId: 'getApiHealth',
      responses: {
        '200': {
          description: 'API is healthy',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/HealthCheck' },
            },
          },
        },
      },
    },
  },
  
  '/api/v1/version': {
    get: {
      tags: ['Health'],
      summary: 'Get API version',
      description: 'Returns API version, constitution version, and enabled features.',
      operationId: 'getVersion',
      responses: {
        '200': {
          description: 'Version information',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  api: { type: 'string', example: '10.0.0' },
                  constitution: { type: 'string', example: '1.2' },
                  gates: { type: 'array', items: { type: 'string' } },
                  features: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // AUTHENTICATION
  // ═══════════════════════════════════════════════════════════════════════════
  
  '/api/v1/auth/status': {
    get: {
      tags: ['Auth'],
      summary: 'Get authentication status',
      description: 'Returns current authentication status, user tier, and block status.',
      operationId: 'getAuthStatus',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      responses: {
        '200': {
          description: 'Authentication status',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AuthStatus' },
            },
          },
        },
      },
    },
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // CHAT
  // ═══════════════════════════════════════════════════════════════════════════
  
  '/api/v1/chat': {
    post: {
      tags: ['Chat'],
      summary: 'Send chat message',
      description: `
Main chat endpoint. Processes user messages through the Nova pipeline (intent, shield, lens, stance, capability, model, personality, spark gates).

**Response Types:**
- \`success\`: Normal response
- \`await_ack\`: Soft veto - requires acknowledgment to proceed
- \`stopped\`: Hard veto - action blocked

**Soft Veto Override:**
If response type is \`await_ack\`, resend the request with the provided \`ackToken\` to override.
      `,
      operationId: 'sendChatMessage',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ChatRequest' },
            examples: {
              simple: {
                summary: 'Simple message',
                value: { message: 'What is the current price of Bitcoin?' },
              },
              withConversation: {
                summary: 'Continue conversation',
                value: {
                  message: 'Can you explain more?',
                  conversationId: 'conv_abc123',
                },
              },
              withAck: {
                summary: 'Override soft veto',
                value: {
                  message: 'Yes, I understand the risks',
                  conversationId: 'conv_abc123',
                  ackToken: 'ack_xyz789',
                },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Chat response',
          content: {
            'application/json': {
              schema: {
                oneOf: [
                  { $ref: '#/components/schemas/ChatResponse' },
                  { $ref: '#/components/schemas/AwaitAckResponse' },
                ],
              },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
  
  '/api/v1/chat/enhanced': {
    post: {
      tags: ['Chat'],
      summary: 'Enhanced chat with Memory + Sword',
      description: 'Chat endpoint with full Memory and Sword (Path/Spark) integration.',
      operationId: 'sendEnhancedChatMessage',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ChatRequest' },
          },
        },
      },
      responses: {
        '200': {
          description: 'Enhanced chat response',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ChatResponse' },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // CONVERSATIONS
  // ═══════════════════════════════════════════════════════════════════════════
  
  '/api/v1/conversations': {
    get: {
      tags: ['Conversations'],
      summary: 'List conversations',
      description: 'Get user\'s conversation history with pagination.',
      operationId: 'listConversations',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      parameters: [
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
        { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
      ],
      responses: {
        '200': {
          description: 'List of conversations',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  conversations: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/Conversation' },
                  },
                  total: { type: 'integer' },
                  hasMore: { type: 'boolean' },
                },
              },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
  
  '/api/v1/conversations/{conversationId}': {
    get: {
      tags: ['Conversations'],
      summary: 'Get conversation',
      description: 'Get a specific conversation with all messages.',
      operationId: 'getConversation',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      parameters: [
        { name: 'conversationId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': {
          description: 'Conversation with messages',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  conversation: { $ref: '#/components/schemas/Conversation' },
                  messages: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/Message' },
                  },
                },
              },
            },
          },
        },
        ...errorResponses,
      },
    },
    delete: {
      tags: ['Conversations'],
      summary: 'Delete conversation',
      description: 'Delete a conversation and all its messages.',
      operationId: 'deleteConversation',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      parameters: [
        { name: 'conversationId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': {
          description: 'Conversation deleted',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  deletedMessages: { type: 'integer' },
                },
              },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // GOALS (Sword)
  // ═══════════════════════════════════════════════════════════════════════════
  
  '/api/v1/goals': {
    get: {
      tags: ['Sword - Goals'],
      summary: 'List goals',
      description: 'Get all user goals with optional status filter.',
      operationId: 'listGoals',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      parameters: [
        {
          name: 'status',
          in: 'query',
          schema: { type: 'string', enum: ['active', 'paused', 'completed', 'abandoned'] },
        },
      ],
      responses: {
        '200': {
          description: 'List of goals',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  goals: { type: 'array', items: { $ref: '#/components/schemas/Goal' } },
                },
              },
            },
          },
        },
        ...errorResponses,
      },
    },
    post: {
      tags: ['Sword - Goals'],
      summary: 'Create goal',
      description: 'Create a new long-term goal.',
      operationId: 'createGoal',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateGoalRequest' },
            example: {
              title: 'Launch my startup',
              description: 'Build and launch a SaaS product',
              desiredOutcome: 'Product live with paying customers',
              interestLevel: 'career_capital',
              targetDate: '2024-12-31',
              motivations: ['Financial independence', 'Build something meaningful'],
              successCriteria: ['MVP launched', '10 paying customers', 'Positive unit economics'],
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'Goal created',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Goal' },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
  
  '/api/v1/goals/{goalId}': {
    get: {
      tags: ['Sword - Goals'],
      summary: 'Get goal with path',
      description: 'Get a specific goal including its current path status.',
      operationId: 'getGoal',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      parameters: [
        { name: 'goalId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': {
          description: 'Goal with path',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  goal: { $ref: '#/components/schemas/Goal' },
                  path: { $ref: '#/components/schemas/Path' },
                },
              },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
  
  '/api/v1/goals/{goalId}/transition': {
    post: {
      tags: ['Sword - Goals'],
      summary: 'Transition goal status',
      description: 'Change goal status (start, pause, resume, complete, abandon).',
      operationId: 'transitionGoal',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      parameters: [
        { name: 'goalId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                event: {
                  type: 'string',
                  enum: ['START', 'PAUSE', 'RESUME', 'COMPLETE', 'ABANDON'],
                },
                reason: { type: 'string' },
              },
              required: ['event'],
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Goal transitioned',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Goal' },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // QUESTS (Sword)
  // ═══════════════════════════════════════════════════════════════════════════
  
  '/api/v1/quests': {
    post: {
      tags: ['Sword - Quests'],
      summary: 'Create quest',
      description: 'Create a new quest (milestone) for a goal.',
      operationId: 'createQuest',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                goalId: { type: 'string' },
                title: { type: 'string' },
                description: { type: 'string' },
                outcome: { type: 'string' },
                priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
                estimatedMinutes: { type: 'integer' },
                targetDate: { type: 'string', format: 'date' },
              },
              required: ['goalId', 'title', 'description', 'outcome'],
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'Quest created',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Quest' },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
  
  '/api/v1/quests/{questId}/transition': {
    post: {
      tags: ['Sword - Quests'],
      summary: 'Transition quest status',
      description: 'Change quest status (start, block, unblock, complete, skip).',
      operationId: 'transitionQuest',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      parameters: [
        { name: 'questId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                event: {
                  type: 'string',
                  enum: ['START', 'BLOCK', 'UNBLOCK', 'COMPLETE', 'SKIP'],
                },
                reason: { type: 'string' },
              },
              required: ['event'],
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Quest transitioned',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Quest' },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEPS (Sword)
  // ═══════════════════════════════════════════════════════════════════════════
  
  '/api/v1/steps': {
    post: {
      tags: ['Sword - Steps'],
      summary: 'Create step',
      description: 'Create a new step within a quest.',
      operationId: 'createStep',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                questId: { type: 'string' },
                title: { type: 'string' },
                description: { type: 'string' },
                type: { type: 'string', enum: ['action', 'decision', 'verification', 'milestone'] },
                estimatedMinutes: { type: 'integer' },
                verificationRequired: { type: 'boolean' },
              },
              required: ['questId', 'title'],
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'Step created',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Step' },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
  
  '/api/v1/steps/{stepId}/transition': {
    post: {
      tags: ['Sword - Steps'],
      summary: 'Transition step status',
      description: 'Complete or skip a step.',
      operationId: 'transitionStep',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      parameters: [
        { name: 'stepId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                event: { type: 'string', enum: ['START', 'COMPLETE', 'SKIP'] },
                notes: { type: 'string' },
              },
              required: ['event'],
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Step transitioned',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Step' },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SPARKS (Sword)
  // ═══════════════════════════════════════════════════════════════════════════
  
  '/api/v1/sparks/generate': {
    post: {
      tags: ['Sword - Sparks'],
      summary: 'Generate spark',
      description: 'Generate a minimal, low-friction action (Spark) for immediate progress.',
      operationId: 'generateSpark',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                stepId: { type: 'string' },
                questId: { type: 'string' },
                goalId: { type: 'string' },
                context: { type: 'string', description: 'Additional context for generation' },
                maxMinutes: { type: 'integer', default: 15 },
                frictionLevel: { type: 'string', enum: ['minimal', 'low', 'medium'] },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Spark generated',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Spark' },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
  
  '/api/v1/sparks/active': {
    get: {
      tags: ['Sword - Sparks'],
      summary: 'Get active spark',
      description: 'Get the user\'s currently active spark.',
      operationId: 'getActiveSpark',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      responses: {
        '200': {
          description: 'Active spark',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Spark' },
            },
          },
        },
        '404': {
          description: 'No active spark',
        },
        ...errorResponses,
      },
    },
  },
  
  '/api/v1/sparks/{sparkId}/transition': {
    post: {
      tags: ['Sword - Sparks'],
      summary: 'Transition spark status',
      description: 'Accept, complete, or skip a spark.',
      operationId: 'transitionSpark',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      parameters: [
        { name: 'sparkId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                event: { type: 'string', enum: ['ACCEPT', 'COMPLETE', 'SKIP'] },
                reason: { type: 'string' },
              },
              required: ['event'],
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Spark transitioned',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Spark' },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PATH (Sword)
  // ═══════════════════════════════════════════════════════════════════════════
  
  '/api/v1/path/{goalId}': {
    get: {
      tags: ['Sword - Path'],
      summary: 'Get path to goal',
      description: 'Get the full path from current state to goal completion.',
      operationId: 'getPath',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      parameters: [
        { name: 'goalId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': {
          description: 'Path to goal',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Path' },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
  
  '/api/v1/path/{goalId}/next-spark': {
    post: {
      tags: ['Sword - Path'],
      summary: 'Generate next spark for path',
      description: 'Auto-generate the next spark based on current path position.',
      operationId: 'generateNextSpark',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      parameters: [
        { name: 'goalId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': {
          description: 'Next spark generated',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Spark' },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // MEMORY - PROFILE
  // ═══════════════════════════════════════════════════════════════════════════
  
  '/api/v1/profile': {
    get: {
      tags: ['Memory - Profile'],
      summary: 'Get user profile',
      description: 'Get the user\'s profile information.',
      operationId: 'getProfile',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      responses: {
        '200': {
          description: 'User profile',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Profile' },
            },
          },
        },
        ...errorResponses,
      },
    },
    patch: {
      tags: ['Memory - Profile'],
      summary: 'Update profile',
      description: 'Update user profile fields.',
      operationId: 'updateProfile',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                role: { type: 'string' },
                organization: { type: 'string' },
                location: { type: 'string' },
                timezone: { type: 'string' },
                expertiseAreas: { type: 'array', items: { type: 'string' } },
                interests: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Profile updated',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Profile' },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
  
  '/api/v1/preferences': {
    get: {
      tags: ['Memory - Profile'],
      summary: 'Get preferences',
      description: 'Get user preferences for Nova behavior.',
      operationId: 'getPreferences',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      responses: {
        '200': {
          description: 'User preferences',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Preferences' },
            },
          },
        },
        ...errorResponses,
      },
    },
    patch: {
      tags: ['Memory - Profile'],
      summary: 'Update preferences',
      description: 'Update user preferences.',
      operationId: 'updatePreferences',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Preferences' },
          },
        },
      },
      responses: {
        '200': {
          description: 'Preferences updated',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Preferences' },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // MEMORY - ITEMS
  // ═══════════════════════════════════════════════════════════════════════════
  
  '/api/v1/memories': {
    get: {
      tags: ['Memory - Items'],
      summary: 'List memories',
      description: 'Get all user memories with optional category filter.',
      operationId: 'listMemories',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      parameters: [
        {
          name: 'category',
          in: 'query',
          schema: {
            type: 'string',
            enum: ['preference', 'fact', 'project', 'skill', 'interest', 'relationship', 'goal', 'context'],
          },
        },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
      ],
      responses: {
        '200': {
          description: 'List of memories',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  memories: { type: 'array', items: { $ref: '#/components/schemas/Memory' } },
                  total: { type: 'integer' },
                },
              },
            },
          },
        },
        ...errorResponses,
      },
    },
    post: {
      tags: ['Memory - Items'],
      summary: 'Create memory',
      description: 'Manually create a new memory.',
      operationId: 'createMemory',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                category: {
                  type: 'string',
                  enum: ['preference', 'fact', 'project', 'skill', 'interest', 'relationship', 'goal', 'context'],
                },
                key: { type: 'string' },
                value: { type: 'string' },
                context: { type: 'string' },
                sensitivity: { type: 'string', enum: ['public', 'private', 'sensitive'] },
              },
              required: ['category', 'key', 'value'],
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'Memory created',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Memory' },
            },
          },
        },
        ...errorResponses,
      },
    },
    delete: {
      tags: ['Memory - Items'],
      summary: 'Clear memories',
      description: 'Clear all memories or memories in a specific category.',
      operationId: 'clearMemories',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      parameters: [
        {
          name: 'category',
          in: 'query',
          schema: { type: 'string' },
          description: 'Category to clear (omit to clear all)',
        },
      ],
      responses: {
        '200': {
          description: 'Memories cleared',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  deleted: { type: 'integer' },
                },
              },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
  
  '/api/v1/memories/{memoryId}': {
    patch: {
      tags: ['Memory - Items'],
      summary: 'Update memory',
      description: 'Update an existing memory.',
      operationId: 'updateMemory',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      parameters: [
        { name: 'memoryId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                value: { type: 'string' },
                context: { type: 'string' },
                sensitivity: { type: 'string', enum: ['public', 'private', 'sensitive'] },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Memory updated',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Memory' },
            },
          },
        },
        ...errorResponses,
      },
    },
    delete: {
      tags: ['Memory - Items'],
      summary: 'Delete memory',
      description: 'Delete a specific memory.',
      operationId: 'deleteMemory',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      parameters: [
        { name: 'memoryId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': {
          description: 'Memory deleted',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { success: { type: 'boolean' } },
              },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
  
  '/api/v1/memories/extract': {
    post: {
      tags: ['Memory - Items'],
      summary: 'Extract memories from text',
      description: 'Automatically extract memories from a message using AI.',
      operationId: 'extractMemories',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                message: { type: 'string' },
                context: { type: 'string' },
              },
              required: ['message'],
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Extracted memories',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  extracted: { type: 'array', items: { $ref: '#/components/schemas/Memory' } },
                  count: { type: 'integer' },
                },
              },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SEARCH
  // ═══════════════════════════════════════════════════════════════════════════
  
  '/api/v1/search': {
    post: {
      tags: ['Search'],
      summary: 'Search user data',
      description: 'Full-text search across conversations, memories, and goals.',
      operationId: 'search',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/SearchRequest' },
          },
        },
      },
      responses: {
        '200': {
          description: 'Search results',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  results: { type: 'array', items: { $ref: '#/components/schemas/SearchResult' } },
                  total: { type: 'integer' },
                  query: { type: 'string' },
                  took: { type: 'integer', description: 'Time in milliseconds' },
                },
              },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
  
  '/api/v1/search/suggest': {
    get: {
      tags: ['Search'],
      summary: 'Get search suggestions',
      description: 'Get autocomplete suggestions for search queries.',
      operationId: 'searchSuggest',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      parameters: [
        { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } },
      ],
      responses: {
        '200': {
          description: 'Search suggestions',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  suggestions: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // EXPORT
  // ═══════════════════════════════════════════════════════════════════════════
  
  '/api/v1/export': {
    post: {
      tags: ['Export'],
      summary: 'Create data export',
      description: 'Create an export of user data in JSON, Markdown, or CSV format.',
      operationId: 'createExport',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ExportRequest' },
          },
        },
      },
      responses: {
        '200': {
          description: 'Export created',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ExportResult' },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
  
  '/api/v1/export/{exportId}/download': {
    get: {
      tags: ['Export'],
      summary: 'Download export',
      description: 'Download the exported data file.',
      operationId: 'downloadExport',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      parameters: [
        { name: 'exportId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': {
          description: 'Export file',
          content: {
            'application/json': {},
            'text/markdown': {},
            'text/csv': {},
          },
        },
        '404': { description: 'Export not found' },
        '410': { description: 'Export expired' },
        ...errorResponses,
      },
    },
  },
  
  '/api/v1/export/import': {
    post: {
      tags: ['Export'],
      summary: 'Import data',
      description: 'Import data from a previous export.',
      operationId: 'importData',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                data: { type: 'string', description: 'JSON export data' },
                mergeStrategy: { type: 'string', enum: ['skip', 'replace', 'newest', 'merge'] },
                dryRun: { type: 'boolean', default: false },
              },
              required: ['data'],
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Import result',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  imported: { type: 'object' },
                  skipped: { type: 'object' },
                  errors: { type: 'array', items: { type: 'object' } },
                },
              },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
  
  '/api/v1/export/account': {
    delete: {
      tags: ['Export'],
      summary: 'Delete all user data',
      description: 'Permanently delete all user data (GDPR right to erasure). Requires confirmation.',
      operationId: 'deleteAccount',
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                confirmation: { type: 'string', description: 'Must match user ID' },
                exportFirst: { type: 'boolean', default: false },
              },
              required: ['confirmation'],
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Account deleted',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  deleted: { type: 'object' },
                  exportId: { type: 'string' },
                },
              },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────────
// FULL OPENAPI DOCUMENT
// ─────────────────────────────────────────────────────────────────────────────────

export const openAPIDocument: OpenAPIDocument = {
  openapi: OPENAPI_VERSION,
  info: {
    title: 'NovaOS API',
    description: `
# NovaOS Backend API

NovaOS is a cognitive assistant system built on the **Nova Constitution**, providing:

- **Shield** — Protection from misinformation and risky decisions
- **Lens** — Clarity through confidence-calibrated information
- **Sword** — Forward motion through Goals, Quests, Steps, and Sparks

## Authentication

All protected endpoints require authentication via:
- **Bearer Token**: \`Authorization: Bearer <token>\`
- **API Key**: \`X-API-Key: <key>\`

## Rate Limiting

- Free tier: 60 requests/minute
- Pro tier: 300 requests/minute
- Enterprise: Custom limits

## Response Types

### Success Response
Standard successful response with requested data.

### Soft Veto (await_ack)
Nova's Shield has identified potential risk. The response includes:
- \`ackRequired.token\` — Use this token to acknowledge and proceed
- \`ackRequired.requiredText\` — Exact text user must confirm
- \`reason\` — Why this action was flagged

### Hard Veto (stopped)
Action blocked due to safety, legality, or constitutional violation.
Cannot be overridden.

## Interest Stack (Priority Order)

When tradeoffs occur, Nova prioritizes:
1. Physical safety, mental health, legal safety
2. Long-term financial stability
3. Career capital and skill development
4. Reputation and relationships
5. Emotional stability and peace of mind
6. Short-term comfort and convenience
    `,
    version: API_VERSION,
    contact: {
      name: 'Nova Support',
      email: 'support@novaos.dev',
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT',
    },
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Development server',
    },
    {
      url: 'https://api.novaos.dev',
      description: 'Production server',
    },
  ],
  tags: [
    { name: 'Health', description: 'Health and status endpoints' },
    { name: 'Auth', description: 'Authentication and authorization' },
    { name: 'Chat', description: 'Main chat interface' },
    { name: 'Conversations', description: 'Conversation history management' },
    { name: 'Sword - Goals', description: 'Long-term goals (Constitution §2.3)' },
    { name: 'Sword - Quests', description: 'Milestones toward goals' },
    { name: 'Sword - Steps', description: 'Ordered actions within quests' },
    { name: 'Sword - Sparks', description: 'Minimal, immediate actions' },
    { name: 'Sword - Path', description: 'Route from current state to goal' },
    { name: 'Memory - Profile', description: 'User profile and preferences' },
    { name: 'Memory - Items', description: 'Individual memory items' },
    { name: 'Search', description: 'Full-text search' },
    { name: 'Export', description: 'Data export, import, and deletion' },
  ],
  paths,
  components: {
    schemas,
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT authentication token',
      },
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'API key for programmatic access',
      },
    },
  },
  security: [
    { bearerAuth: [] },
    { apiKey: [] },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

export function getOpenAPIJson(): string {
  return JSON.stringify(openAPIDocument, null, 2);
}

export function getOpenAPIYaml(): string {
  // Simple YAML conversion (for full YAML support, use js-yaml library)
  return jsonToYaml(openAPIDocument);
}

function jsonToYaml(obj: unknown, indent = 0): string {
  const spaces = '  '.repeat(indent);
  
  if (obj === null || obj === undefined) {
    return 'null';
  }
  
  if (typeof obj === 'string') {
    if (obj.includes('\n') || obj.includes(':') || obj.includes('#')) {
      return `|\n${obj.split('\n').map(line => spaces + '  ' + line).join('\n')}`;
    }
    return obj;
  }
  
  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return String(obj);
  }
  
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return obj.map(item => {
      const value = jsonToYaml(item, indent + 1);
      if (typeof item === 'object' && item !== null) {
        return `\n${spaces}- ${value.trim()}`;
      }
      return `\n${spaces}- ${value}`;
    }).join('');
  }
  
  if (typeof obj === 'object') {
    const entries = Object.entries(obj);
    if (entries.length === 0) return '{}';
    
    return entries.map(([key, value]) => {
      const yamlValue = jsonToYaml(value, indent + 1);
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return `\n${spaces}${key}:${yamlValue}`;
      }
      if (Array.isArray(value)) {
        return `\n${spaces}${key}:${yamlValue}`;
      }
      return `\n${spaces}${key}: ${yamlValue}`;
    }).join('');
  }
  
  return String(obj);
}
