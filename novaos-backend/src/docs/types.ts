// ═══════════════════════════════════════════════════════════════════════════════
// OPENAPI TYPES — Type Definitions for API Documentation
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// OPENAPI DOCUMENT TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface OpenAPIDocument {
  openapi: string;
  info: OpenAPIInfo;
  servers: OpenAPIServer[];
  tags: OpenAPITag[];
  paths: Record<string, OpenAPIPathItem>;
  components: OpenAPIComponents;
  security?: OpenAPISecurityRequirement[];
}

export interface OpenAPIInfo {
  title: string;
  description: string;
  version: string;
  termsOfService?: string;
  contact?: {
    name?: string;
    url?: string;
    email?: string;
  };
  license?: {
    name: string;
    url?: string;
  };
}

export interface OpenAPIServer {
  url: string;
  description?: string;
  variables?: Record<string, {
    default: string;
    enum?: string[];
    description?: string;
  }>;
}

export interface OpenAPITag {
  name: string;
  description?: string;
  externalDocs?: {
    description?: string;
    url: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// PATH & OPERATION TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface OpenAPIPathItem {
  summary?: string;
  description?: string;
  get?: OpenAPIOperation;
  post?: OpenAPIOperation;
  put?: OpenAPIOperation;
  patch?: OpenAPIOperation;
  delete?: OpenAPIOperation;
  options?: OpenAPIOperation;
  head?: OpenAPIOperation;
  parameters?: OpenAPIParameter[];
}

export interface OpenAPIOperation {
  tags?: string[];
  summary: string;
  description?: string;
  operationId: string;
  parameters?: OpenAPIParameter[];
  requestBody?: OpenAPIRequestBody;
  responses: Record<string, OpenAPIResponse>;
  security?: OpenAPISecurityRequirement[];
  deprecated?: boolean;
}

export interface OpenAPIParameter {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie';
  description?: string;
  required?: boolean;
  deprecated?: boolean;
  schema: OpenAPISchema;
  example?: unknown;
}

export interface OpenAPIRequestBody {
  description?: string;
  required?: boolean;
  content: Record<string, OpenAPIMediaType>;
}

export interface OpenAPIResponse {
  description: string;
  headers?: Record<string, OpenAPIHeader>;
  content?: Record<string, OpenAPIMediaType>;
}

export interface OpenAPIMediaType {
  schema: OpenAPISchema;
  example?: unknown;
  examples?: Record<string, OpenAPIExample>;
}

export interface OpenAPIHeader {
  description?: string;
  schema: OpenAPISchema;
}

export interface OpenAPIExample {
  summary?: string;
  description?: string;
  value: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────────
// SCHEMA TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface OpenAPISchema {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  format?: string;
  title?: string;
  description?: string;
  default?: unknown;
  example?: unknown;
  enum?: unknown[];
  const?: unknown;
  
  // String validation
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  
  // Number validation
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  
  // Array validation
  items?: OpenAPISchema;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  
  // Object validation
  properties?: Record<string, OpenAPISchema>;
  required?: string[];
  additionalProperties?: boolean | OpenAPISchema;
  
  // Composition
  allOf?: OpenAPISchema[];
  oneOf?: OpenAPISchema[];
  anyOf?: OpenAPISchema[];
  not?: OpenAPISchema;
  
  // Reference
  $ref?: string;
  
  // Nullable
  nullable?: boolean;
  
  // Read/write
  readOnly?: boolean;
  writeOnly?: boolean;
  
  // Deprecated
  deprecated?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────
// COMPONENTS TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface OpenAPIComponents {
  schemas?: Record<string, OpenAPISchema>;
  responses?: Record<string, OpenAPIResponse>;
  parameters?: Record<string, OpenAPIParameter>;
  examples?: Record<string, OpenAPIExample>;
  requestBodies?: Record<string, OpenAPIRequestBody>;
  headers?: Record<string, OpenAPIHeader>;
  securitySchemes?: Record<string, OpenAPISecurityScheme>;
}

export interface OpenAPISecurityScheme {
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect';
  description?: string;
  name?: string;
  in?: 'query' | 'header' | 'cookie';
  scheme?: string;
  bearerFormat?: string;
  flows?: OpenAPIOAuthFlows;
  openIdConnectUrl?: string;
}

export interface OpenAPIOAuthFlows {
  implicit?: OpenAPIOAuthFlow;
  password?: OpenAPIOAuthFlow;
  clientCredentials?: OpenAPIOAuthFlow;
  authorizationCode?: OpenAPIOAuthFlow;
}

export interface OpenAPIOAuthFlow {
  authorizationUrl?: string;
  tokenUrl?: string;
  refreshUrl?: string;
  scopes: Record<string, string>;
}

export type OpenAPISecurityRequirement = Record<string, string[]>;

// ─────────────────────────────────────────────────────────────────────────────────
// BUILDER TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface RouteDefinition {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  operation: OpenAPIOperation;
}

export interface SchemaDefinition {
  name: string;
  schema: OpenAPISchema;
}
