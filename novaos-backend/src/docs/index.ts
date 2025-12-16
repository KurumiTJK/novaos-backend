// ═══════════════════════════════════════════════════════════════════════════════
// DOCS MODULE — OpenAPI Documentation
// ═══════════════════════════════════════════════════════════════════════════════

// Types
export type {
  OpenAPIDocument,
  OpenAPIInfo,
  OpenAPIServer,
  OpenAPITag,
  OpenAPIPathItem,
  OpenAPIOperation,
  OpenAPIParameter,
  OpenAPIRequestBody,
  OpenAPIResponse,
  OpenAPIMediaType,
  OpenAPISchema,
  OpenAPIComponents,
  OpenAPISecurityScheme,
  OpenAPISecurityRequirement,
  RouteDefinition,
  SchemaDefinition,
} from './types.js';

// Schemas
export { schemas } from './schemas.js';

// OpenAPI spec
export {
  openAPIDocument,
  getOpenAPIJson,
  getOpenAPIYaml,
  API_VERSION,
  OPENAPI_VERSION,
} from './openapi.js';

// Router
export { createDocsRouter } from './routes.js';
