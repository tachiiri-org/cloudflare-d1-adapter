import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import type { Env } from '../src/env';
import { databasesRoutes } from '../src/routes/v4/databases';
import { internalOperationsRouteDefinition } from '../src/routes/internal/operations';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(__dirname, '../openapi.json');

const app = new OpenAPIHono<Env>();

const normalizeRoute = (route: ReturnType<typeof createRoute>) => {
  const { schema, ...rest } = route as any;
  const normalized = { ...rest } as Record<string, unknown>;
  if (!schema) {
    return normalized;
  }
  if (schema.summary) {
    normalized.summary = normalized.summary ?? schema.summary;
  }
  if (schema.description) {
    normalized.description = normalized.description ?? schema.description;
  }
  if (schema.tags) {
    normalized.tags = normalized.tags ?? schema.tags;
  }
  if (schema.operationId) {
    normalized.operationId = normalized.operationId ?? schema.operationId;
  }
  if (schema.request) {
    normalized.request = schema.request;
  }
  const responseSection = schema.responses ?? schema.response;
  if (responseSection) {
    normalized.responses = responseSection;
  }
  return normalized;
};

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  schema: {
    summary: 'Health check',
    responses: { 200: z.object({ status: z.literal('ok') }) },
  },
});
app.openapi(normalizeRoute(healthRoute), () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));

databasesRoutes.forEach(({ route, handler }) => {
  const normalized = normalizeRoute(route);
  const requestBody = normalized.request?.body;
  if (requestBody && !requestBody.content) {
    console.log(`route request missing content: ${route.method} ${route.path}`);
  }
  if (!normalized.responses) {
    console.log('missing responses for', route.method, route.path);
  }
  app.openapi({ ...normalized, method: route.method.toLowerCase() as any }, handler);
});

{
  const normalizedInternal = normalizeRoute(internalOperationsRouteDefinition.route);
  if (!normalizedInternal.responses) {
    console.log('missing internal responses');
  }
  app.openapi({
    ...normalizedInternal,
    method: internalOperationsRouteDefinition.route.method.toLowerCase() as any,
  }, internalOperationsRouteDefinition.handler);
}

const document = app.getOpenAPI31Document({
  openapi: '3.1.0',
  info: {
    title: 'Cloudflare D1 Adapter API',
    version: '1.0.0',
    description: 'Cloudflare D1 adapter boundaries',
  },
});

writeFileSync(outputPath, JSON.stringify(document, null, 2) + '\n');
console.log(`openapi.json generated -> ${outputPath}`);
