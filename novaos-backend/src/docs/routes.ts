// ═══════════════════════════════════════════════════════════════════════════════
// DOCS ROUTES — Swagger UI and OpenAPI Spec Endpoints
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, type Request, type Response } from 'express';
import { openAPIDocument, getOpenAPIJson, API_VERSION } from './openapi.js';

// ─────────────────────────────────────────────────────────────────────────────────
// SWAGGER UI HTML
// ─────────────────────────────────────────────────────────────────────────────────

const swaggerUIHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NovaOS API Documentation</title>
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css">
  <link rel="icon" type="image/png" href="https://unpkg.com/swagger-ui-dist@5.11.0/favicon-32x32.png" sizes="32x32">
  <style>
    html { box-sizing: border-box; overflow-y: scroll; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin: 0; background: #fafafa; }
    .topbar { display: none !important; }
    .swagger-ui .info { margin: 30px 0; }
    .swagger-ui .info .title { font-size: 36px; }
    .swagger-ui .info .description p { font-size: 16px; line-height: 1.6; }
    .swagger-ui .opblock-tag { font-size: 18px; }
    .swagger-ui .opblock .opblock-summary-operation-id { font-size: 14px; }
    /* Nova theme colors */
    .swagger-ui .opblock.opblock-get { border-color: #61affe; background: rgba(97, 175, 254, 0.1); }
    .swagger-ui .opblock.opblock-post { border-color: #49cc90; background: rgba(73, 204, 144, 0.1); }
    .swagger-ui .opblock.opblock-put { border-color: #fca130; background: rgba(252, 161, 48, 0.1); }
    .swagger-ui .opblock.opblock-delete { border-color: #f93e3e; background: rgba(249, 62, 62, 0.1); }
    .swagger-ui .opblock.opblock-patch { border-color: #50e3c2; background: rgba(80, 227, 194, 0.1); }
    /* Custom header */
    .nova-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px 40px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .nova-header h1 { margin: 0; font-size: 24px; font-weight: 600; }
    .nova-header .version { 
      background: rgba(255,255,255,0.2); 
      padding: 4px 12px; 
      border-radius: 12px; 
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="nova-header">
    <h1>⚔️ NovaOS API</h1>
    <span class="version">v${API_VERSION}</span>
  </div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      window.ui = SwaggerUIBundle({
        url: "/docs/openapi.json",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout",
        defaultModelsExpandDepth: 1,
        defaultModelExpandDepth: 3,
        docExpansion: "list",
        filter: true,
        showExtensions: true,
        showCommonExtensions: true,
        syntaxHighlight: {
          activate: true,
          theme: "monokai"
        },
        tryItOutEnabled: true,
        persistAuthorization: true,
      });
    };
  </script>
</body>
</html>
`;

// ─────────────────────────────────────────────────────────────────────────────────
// REDOC HTML (Alternative UI)
// ─────────────────────────────────────────────────────────────────────────────────

const redocHtml = `
<!DOCTYPE html>
<html>
<head>
  <title>NovaOS API Documentation</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
  <style>
    body { margin: 0; padding: 0; }
  </style>
</head>
<body>
  <redoc spec-url='/docs/openapi.json' 
    expand-responses="200,201"
    hide-download-button="false"
    theme='{
      "colors": {
        "primary": { "main": "#667eea" }
      },
      "typography": {
        "fontSize": "15px",
        "fontFamily": "Roboto, sans-serif",
        "headings": { "fontFamily": "Montserrat, sans-serif" }
      },
      "sidebar": {
        "width": "260px"
      }
    }'>
  </redoc>
  <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
</body>
</html>
`;

// ─────────────────────────────────────────────────────────────────────────────────
// ROUTER FACTORY
// ─────────────────────────────────────────────────────────────────────────────────

export function createDocsRouter(): Router {
  const router = Router();
  
  // Swagger UI
  router.get('/', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(swaggerUIHtml);
  });
  
  router.get('/swagger', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(swaggerUIHtml);
  });
  
  // ReDoc UI (alternative)
  router.get('/redoc', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(redocHtml);
  });
  
  // OpenAPI JSON
  router.get('/openapi.json', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(getOpenAPIJson());
  });
  
  // OpenAPI YAML
  router.get('/openapi.yaml', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/yaml');
    res.send(getOpenAPIJson()); // Would use getOpenAPIYaml() with proper YAML library
  });
  
  // Raw spec object (for programmatic access)
  router.get('/spec', (_req: Request, res: Response) => {
    res.json(openAPIDocument);
  });
  
  // API reference (simple HTML)
  router.get('/reference', (_req: Request, res: Response) => {
    const html = generateSimpleReference();
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });
  
  return router;
}

// ─────────────────────────────────────────────────────────────────────────────────
// SIMPLE REFERENCE GENERATOR
// ─────────────────────────────────────────────────────────────────────────────────

function generateSimpleReference(): string {
  const paths = openAPIDocument.paths;
  const tags = openAPIDocument.tags ?? [];
  
  let html = `
<!DOCTYPE html>
<html>
<head>
  <title>NovaOS API Quick Reference</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; }
    h1 { color: #667eea; }
    h2 { color: #333; border-bottom: 2px solid #eee; padding-bottom: 10px; margin-top: 40px; }
    .endpoint { background: #f5f5f5; padding: 15px; margin: 10px 0; border-radius: 8px; }
    .method { display: inline-block; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; margin-right: 10px; }
    .method-get { background: #61affe; color: white; }
    .method-post { background: #49cc90; color: white; }
    .method-put { background: #fca130; color: white; }
    .method-patch { background: #50e3c2; color: white; }
    .method-delete { background: #f93e3e; color: white; }
    .path { font-family: monospace; font-size: 14px; }
    .summary { color: #666; margin-top: 5px; }
    a { color: #667eea; }
  </style>
</head>
<body>
  <h1>⚔️ NovaOS API Quick Reference</h1>
  <p>Version: ${API_VERSION} | <a href="/docs">Interactive Docs</a> | <a href="/docs/openapi.json">OpenAPI Spec</a></p>
`;
  
  // Group by tag
  const byTag = new Map<string, Array<{ method: string; path: string; summary: string }>>();
  
  for (const [path, pathItem] of Object.entries(paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const op = pathItem[method];
      if (op) {
        const tag = op.tags?.[0] ?? 'Other';
        if (!byTag.has(tag)) {
          byTag.set(tag, []);
        }
        byTag.get(tag)!.push({
          method: method.toUpperCase(),
          path,
          summary: op.summary,
        });
      }
    }
  }
  
  for (const tag of tags) {
    const endpoints = byTag.get(tag.name);
    if (!endpoints || endpoints.length === 0) continue;
    
    html += `<h2>${tag.name}</h2>`;
    if (tag.description) {
      html += `<p>${tag.description}</p>`;
    }
    
    for (const ep of endpoints) {
      html += `
      <div class="endpoint">
        <span class="method method-${ep.method.toLowerCase()}">${ep.method}</span>
        <span class="path">${ep.path}</span>
        <div class="summary">${ep.summary}</div>
      </div>`;
    }
  }
  
  html += `
</body>
</html>`;
  
  return html;
}
