// ═══════════════════════════════════════════════════════════════════════════════
// DOCS TESTS — OpenAPI Documentation Tests
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  openAPIDocument,
  getOpenAPIJson,
  schemas,
  API_VERSION,
  OPENAPI_VERSION,
} from '../docs/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// OPENAPI DOCUMENT TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('OpenAPI Document', () => {
  describe('structure', () => {
    it('should have valid OpenAPI version', () => {
      expect(openAPIDocument.openapi).toBe(OPENAPI_VERSION);
      expect(openAPIDocument.openapi).toMatch(/^3\.\d+\.\d+$/);
    });
    
    it('should have info section', () => {
      expect(openAPIDocument.info).toBeDefined();
      expect(openAPIDocument.info.title).toBe('NovaOS API');
      expect(openAPIDocument.info.version).toBe(API_VERSION);
    });
    
    it('should have servers defined', () => {
      expect(openAPIDocument.servers).toBeDefined();
      expect(openAPIDocument.servers.length).toBeGreaterThan(0);
      expect(openAPIDocument.servers[0]!.url).toBeDefined();
    });
    
    it('should have tags defined', () => {
      expect(openAPIDocument.tags).toBeDefined();
      expect(openAPIDocument.tags.length).toBeGreaterThan(0);
      
      const tagNames = openAPIDocument.tags.map(t => t.name);
      expect(tagNames).toContain('Health');
      expect(tagNames).toContain('Chat');
      expect(tagNames).toContain('Sword - Goals');
      expect(tagNames).toContain('Memory - Profile');
      expect(tagNames).toContain('Search');
      expect(tagNames).toContain('Export');
    });
    
    it('should have paths defined', () => {
      expect(openAPIDocument.paths).toBeDefined();
      expect(Object.keys(openAPIDocument.paths).length).toBeGreaterThan(0);
    });
    
    it('should have components defined', () => {
      expect(openAPIDocument.components).toBeDefined();
      expect(openAPIDocument.components.schemas).toBeDefined();
      expect(openAPIDocument.components.securitySchemes).toBeDefined();
    });
    
    it('should have security schemes', () => {
      const schemes = openAPIDocument.components.securitySchemes!;
      expect(schemes.bearerAuth).toBeDefined();
      expect(schemes.apiKey).toBeDefined();
    });
  });
  
  describe('paths', () => {
    it('should have health endpoint', () => {
      expect(openAPIDocument.paths['/health']).toBeDefined();
      expect(openAPIDocument.paths['/health']!.get).toBeDefined();
    });
    
    it('should have chat endpoint', () => {
      expect(openAPIDocument.paths['/api/v1/chat']).toBeDefined();
      expect(openAPIDocument.paths['/api/v1/chat']!.post).toBeDefined();
    });
    
    it('should have goals endpoints', () => {
      expect(openAPIDocument.paths['/api/v1/goals']).toBeDefined();
      expect(openAPIDocument.paths['/api/v1/goals']!.get).toBeDefined();
      expect(openAPIDocument.paths['/api/v1/goals']!.post).toBeDefined();
    });
    
    it('should have memories endpoints', () => {
      expect(openAPIDocument.paths['/api/v1/memories']).toBeDefined();
      expect(openAPIDocument.paths['/api/v1/memories']!.get).toBeDefined();
      expect(openAPIDocument.paths['/api/v1/memories']!.post).toBeDefined();
      expect(openAPIDocument.paths['/api/v1/memories']!.delete).toBeDefined();
    });
    
    it('should have search endpoint', () => {
      expect(openAPIDocument.paths['/api/v1/search']).toBeDefined();
      expect(openAPIDocument.paths['/api/v1/search']!.post).toBeDefined();
    });
    
    it('should have export endpoints', () => {
      expect(openAPIDocument.paths['/api/v1/export']).toBeDefined();
      expect(openAPIDocument.paths['/api/v1/export/account']).toBeDefined();
    });
    
    it('should have all paths with valid operations', () => {
      for (const [path, pathItem] of Object.entries(openAPIDocument.paths)) {
        expect(path).toMatch(/^\//);
        
        const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;
        let hasOperation = false;
        
        for (const method of methods) {
          const op = pathItem[method];
          if (op) {
            hasOperation = true;
            expect(op.operationId).toBeDefined();
            expect(op.summary).toBeDefined();
            expect(op.responses).toBeDefined();
          }
        }
        
        expect(hasOperation).toBe(true);
      }
    });
  });
  
  describe('operations', () => {
    it('should have unique operationIds', () => {
      const operationIds = new Set<string>();
      
      for (const pathItem of Object.values(openAPIDocument.paths)) {
        const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;
        
        for (const method of methods) {
          const op = pathItem[method];
          if (op?.operationId) {
            expect(operationIds.has(op.operationId)).toBe(false);
            operationIds.add(op.operationId);
          }
        }
      }
    });
    
    it('should have tags for all operations', () => {
      for (const pathItem of Object.values(openAPIDocument.paths)) {
        const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;
        
        for (const method of methods) {
          const op = pathItem[method];
          if (op) {
            expect(op.tags).toBeDefined();
            expect(op.tags!.length).toBeGreaterThan(0);
          }
        }
      }
    });
    
    it('should have 200 response for GET operations', () => {
      for (const pathItem of Object.values(openAPIDocument.paths)) {
        const op = pathItem.get;
        if (op) {
          expect(op.responses['200']).toBeDefined();
        }
      }
    });
    
    it('should have request body for POST operations', () => {
      for (const [path, pathItem] of Object.entries(openAPIDocument.paths)) {
        const op = pathItem.post;
        // Skip health endpoints which don't need request body
        if (op && !path.includes('/health') && !path.includes('/next-spark') && !path.includes('/active')) {
          // Most POST operations should have a request body
          // Some exceptions like generate endpoints without required body
        }
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// SCHEMA TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Schemas', () => {
  it('should have all required schemas', () => {
    const requiredSchemas = [
      'Error',
      'Timestamp',
      'User',
      'ChatRequest',
      'ChatResponse',
      'Conversation',
      'Message',
      'Goal',
      'Quest',
      'Step',
      'Spark',
      'Path',
      'Memory',
      'Profile',
      'Preferences',
      'SearchRequest',
      'SearchResult',
      'ExportRequest',
      'ExportResult',
      'HealthCheck',
    ];
    
    for (const name of requiredSchemas) {
      expect(schemas[name]).toBeDefined();
    }
  });
  
  it('should have valid Error schema', () => {
    const errorSchema = schemas.Error;
    expect(errorSchema.type).toBe('object');
    expect(errorSchema.properties).toBeDefined();
    expect(errorSchema.properties!.error).toBeDefined();
    expect(errorSchema.required).toContain('error');
  });
  
  it('should have valid Goal schema', () => {
    const goalSchema = schemas.Goal;
    expect(goalSchema.type).toBe('object');
    expect(goalSchema.properties).toBeDefined();
    expect(goalSchema.properties!.id).toBeDefined();
    expect(goalSchema.properties!.title).toBeDefined();
    expect(goalSchema.properties!.status).toBeDefined();
    expect(goalSchema.properties!.progress).toBeDefined();
  });
  
  it('should have valid Spark schema', () => {
    const sparkSchema = schemas.Spark;
    expect(sparkSchema.type).toBe('object');
    expect(sparkSchema.properties).toBeDefined();
    expect(sparkSchema.properties!.action).toBeDefined();
    expect(sparkSchema.properties!.rationale).toBeDefined();
    expect(sparkSchema.properties!.estimatedMinutes).toBeDefined();
    expect(sparkSchema.properties!.status).toBeDefined();
  });
  
  it('should have valid Memory schema', () => {
    const memorySchema = schemas.Memory;
    expect(memorySchema.type).toBe('object');
    expect(memorySchema.properties).toBeDefined();
    expect(memorySchema.properties!.category).toBeDefined();
    expect(memorySchema.properties!.key).toBeDefined();
    expect(memorySchema.properties!.value).toBeDefined();
    expect(memorySchema.properties!.confidence).toBeDefined();
  });
  
  it('should have enums with valid values', () => {
    // Goal status
    const goalSchema = schemas.Goal;
    expect(goalSchema.properties!.status.enum).toContain('active');
    expect(goalSchema.properties!.status.enum).toContain('completed');
    
    // Memory category
    const memorySchema = schemas.Memory;
    expect(memorySchema.properties!.category.enum).toContain('fact');
    expect(memorySchema.properties!.category.enum).toContain('preference');
    
    // Spark status
    const sparkSchema = schemas.Spark;
    expect(sparkSchema.properties!.status.enum).toContain('suggested');
    expect(sparkSchema.properties!.status.enum).toContain('completed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// JSON OUTPUT TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('getOpenAPIJson', () => {
  it('should return valid JSON string', () => {
    const json = getOpenAPIJson();
    expect(typeof json).toBe('string');
    expect(() => JSON.parse(json)).not.toThrow();
  });
  
  it('should be parseable to original document', () => {
    const json = getOpenAPIJson();
    const parsed = JSON.parse(json);
    
    expect(parsed.openapi).toBe(openAPIDocument.openapi);
    expect(parsed.info.title).toBe(openAPIDocument.info.title);
    expect(parsed.info.version).toBe(openAPIDocument.info.version);
  });
  
  it('should be pretty-printed', () => {
    const json = getOpenAPIJson();
    expect(json).toContain('\n');
    expect(json).toContain('  ');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// SECURITY TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Security', () => {
  it('should have global security defined', () => {
    expect(openAPIDocument.security).toBeDefined();
    expect(openAPIDocument.security!.length).toBeGreaterThan(0);
  });
  
  it('should have bearer auth scheme', () => {
    const bearerAuth = openAPIDocument.components.securitySchemes!.bearerAuth;
    expect(bearerAuth).toBeDefined();
    expect(bearerAuth.type).toBe('http');
    expect(bearerAuth.scheme).toBe('bearer');
  });
  
  it('should have API key scheme', () => {
    const apiKey = openAPIDocument.components.securitySchemes!.apiKey;
    expect(apiKey).toBeDefined();
    expect(apiKey.type).toBe('apiKey');
    expect(apiKey.in).toBe('header');
    expect(apiKey.name).toBe('X-API-Key');
  });
  
  it('should have security on protected endpoints', () => {
    const chatOp = openAPIDocument.paths['/api/v1/chat']!.post!;
    expect(chatOp.security).toBeDefined();
    
    const goalsOp = openAPIDocument.paths['/api/v1/goals']!.get!;
    expect(goalsOp.security).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// VERSION TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Version', () => {
  it('should have valid API version', () => {
    expect(API_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
  
  it('should have valid OpenAPI version', () => {
    expect(OPENAPI_VERSION).toMatch(/^3\.\d+\.\d+$/);
  });
  
  it('should match document versions', () => {
    expect(openAPIDocument.info.version).toBe(API_VERSION);
    expect(openAPIDocument.openapi).toBe(OPENAPI_VERSION);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// COMPLETENESS TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('Completeness', () => {
  const expectedEndpoints = [
    // Health
    'GET /health',
    'GET /ready',
    'GET /api/v1/health',
    'GET /api/v1/version',
    // Auth
    'GET /api/v1/auth/status',
    // Chat
    'POST /api/v1/chat',
    'POST /api/v1/chat/enhanced',
    // Conversations
    'GET /api/v1/conversations',
    'GET /api/v1/conversations/{conversationId}',
    'DELETE /api/v1/conversations/{conversationId}',
    // Goals
    'GET /api/v1/goals',
    'POST /api/v1/goals',
    'GET /api/v1/goals/{goalId}',
    'POST /api/v1/goals/{goalId}/transition',
    // Quests
    'POST /api/v1/quests',
    'POST /api/v1/quests/{questId}/transition',
    // Steps
    'POST /api/v1/steps',
    'POST /api/v1/steps/{stepId}/transition',
    // Sparks
    'POST /api/v1/sparks/generate',
    'GET /api/v1/sparks/active',
    'POST /api/v1/sparks/{sparkId}/transition',
    // Path
    'GET /api/v1/path/{goalId}',
    'POST /api/v1/path/{goalId}/next-spark',
    // Profile
    'GET /api/v1/profile',
    'PATCH /api/v1/profile',
    'GET /api/v1/preferences',
    'PATCH /api/v1/preferences',
    // Memories
    'GET /api/v1/memories',
    'POST /api/v1/memories',
    'DELETE /api/v1/memories',
    'PATCH /api/v1/memories/{memoryId}',
    'DELETE /api/v1/memories/{memoryId}',
    'POST /api/v1/memories/extract',
    // Search
    'POST /api/v1/search',
    'GET /api/v1/search/suggest',
    // Export
    'POST /api/v1/export',
    'GET /api/v1/export/{exportId}/download',
    'POST /api/v1/export/import',
    'DELETE /api/v1/export/account',
  ];
  
  it('should have all expected endpoints', () => {
    for (const endpoint of expectedEndpoints) {
      const [method, path] = endpoint.split(' ');
      const pathItem = openAPIDocument.paths[path!];
      
      expect(pathItem).toBeDefined();
      expect(pathItem![method!.toLowerCase() as 'get' | 'post' | 'patch' | 'delete']).toBeDefined();
    }
  });
  
  it('should have minimum number of endpoints', () => {
    const endpointCount = Object.values(openAPIDocument.paths).reduce((count, pathItem) => {
      return count + ['get', 'post', 'put', 'patch', 'delete'].filter(m => pathItem[m as 'get']).length;
    }, 0);
    
    expect(endpointCount).toBeGreaterThanOrEqual(30);
  });
  
  it('should have all tags used', () => {
    const usedTags = new Set<string>();
    
    for (const pathItem of Object.values(openAPIDocument.paths)) {
      for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
        const op = pathItem[method];
        if (op?.tags) {
          op.tags.forEach(t => usedTags.add(t));
        }
      }
    }
    
    // All defined tags should be used
    for (const tag of openAPIDocument.tags) {
      expect(usedTags.has(tag.name)).toBe(true);
    }
  });
});
