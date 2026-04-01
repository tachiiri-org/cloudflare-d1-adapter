import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env } from '../../env';
import type { EnvBindings } from '../../env';
import { D1Client, D1RequestError } from '../../services/cloudflare/v4/d1-client';

const AnyResponse = z.unknown();
const DatabaseCreatePayload = z.object({ name: z.string().min(1) }).passthrough();
const DatabasePayload = z.object({}).passthrough();
const QueryPayload = z.object({ sql: z.string().min(1) }).passthrough();
const OptionalPayload = z.object({}).passthrough();
const ErrorSchema = z.object({ error: z.string() });

const jsonResponse = (schema: z.ZodTypeAny, description: string) => ({
  description,
  content: {
    'application/json': {
      schema,
    },
  },
});

const jsonRequest = (schema: z.ZodTypeAny) => ({
  body: {
    content: {
      'application/json': {
        schema,
      },
    },
  },
});

const emptyResponse = (description: string) => ({
  description,
});

const errorResponse = (description: string) => ({
  description,
  content: {
    'application/json': {
      schema: ErrorSchema,
    },
  },
});

const clientFromEnv = (env: EnvBindings) => D1Client.fromEnv(env);

async function parseJson<T>(c: Context<Env>) {
  try {
    const length = c.req.header('content-length');
    if (!length || length === '0') {
      return null;
    }
    return (await c.req.json()) as T;
  } catch {
    return null;
  }
}

function handleD1Error(c: Context<Env>, error: unknown) {
  if (error instanceof D1RequestError) {
    return respondWithStatus(c, toContentfulStatusCode(error.status), { error: error.body });
  }
  throw error;
}

const toContentfulStatusCode = (status: number) => status as ContentfulStatusCode;

function respondWithStatus<T>(c: Context<Env>, status: ContentfulStatusCode, body: T) {
  c.status(status);
  return c.json(body);
}

const databaseListRoute = createRoute({
  method: 'get',
  path: '/v4/databases',
  summary: 'List D1 databases',
  responses: {
    200: jsonResponse(AnyResponse, 'List of D1 databases'),
    400: errorResponse('Bad request'),
    404: errorResponse('Not found'),
  },
});
export const databaseListHandler = async (c: Context<Env>) => {
  try {
    const data = await clientFromEnv(c.env).listDatabases();
    return c.json(data);
  } catch (error) {
    return handleD1Error(c, error);
  }
};

const databaseGetRoute = createRoute({
  method: 'get',
  path: '/v4/databases/{databaseId}',
  summary: 'Get D1 database metadata',
  responses: {
    200: jsonResponse(AnyResponse, 'Database metadata'),
    400: errorResponse('Bad request'),
    404: errorResponse('Not found'),
  },
});
export const databaseGetHandler = async (c: Context<Env>) => {
  const databaseId = c.req.param('databaseId');
  if (!databaseId) {
    return respondWithStatus(c, toContentfulStatusCode(400), { error: 'databaseId required' });
  }
  try {
    const data = await clientFromEnv(c.env).getDatabase(databaseId);
    return c.json(data);
  } catch (error) {
    return handleD1Error(c, error);
  }
};

const databaseCreateRoute = createRoute({
  method: 'post',
  path: '/v4/databases',
  summary: 'Create a D1 database',
  request: jsonRequest(DatabaseCreatePayload),
  responses: {
    201: jsonResponse(AnyResponse, 'Created database'),
    400: errorResponse('Bad request'),
  },
});
export const databaseCreateHandler = async (c: Context<Env>) => {
  try {
    const payload = (await parseJson<unknown>(c)) ?? {};
    const data = await clientFromEnv(c.env).createDatabase(payload);
    return respondWithStatus(c, toContentfulStatusCode(201), data);
  } catch (error) {
    return handleD1Error(c, error);
  }
};

const databaseUpdateRoute = createRoute({
  method: 'put',
  path: '/v4/databases/{databaseId}',
  summary: 'Replace D1 database metadata',
  request: {
    params: z.object({ databaseId: z.string().min(1) }),
    ...jsonRequest(DatabasePayload),
  },
  responses: {
    200: jsonResponse(AnyResponse, 'Updated database'),
    400: errorResponse('Bad request'),
  },
});
export const databaseUpdateHandler = async (c: Context<Env>) => {
  const databaseId = c.req.param('databaseId');
  if (!databaseId) {
    return respondWithStatus(c, toContentfulStatusCode(400), { error: 'databaseId required' });
  }
  try {
    const payload = (await parseJson<unknown>(c)) ?? {};
    const data = await clientFromEnv(c.env).updateDatabase(databaseId, payload);
    return c.json(data);
  } catch (error) {
    return handleD1Error(c, error);
  }
};

const databasePatchRoute = createRoute({
  method: 'patch',
  path: '/v4/databases/{databaseId}',
  summary: 'Patch D1 database metadata',
  request: {
    params: z.object({ databaseId: z.string().min(1) }),
    ...jsonRequest(DatabasePayload),
  },
  responses: {
    200: jsonResponse(AnyResponse, 'Patched database'),
    400: errorResponse('Bad request'),
  },
});
export const databasePatchHandler = async (c: Context<Env>) => {
  const databaseId = c.req.param('databaseId');
  if (!databaseId) {
    return respondWithStatus(c, toContentfulStatusCode(400), { error: 'databaseId required' });
  }
  try {
    const payload = (await parseJson<unknown>(c)) ?? {};
    const data = await clientFromEnv(c.env).patchDatabase(databaseId, payload);
    return c.json(data);
  } catch (error) {
    return handleD1Error(c, error);
  }
};

const databaseDeleteRoute = createRoute({
  method: 'delete',
  path: '/v4/databases/{databaseId}',
  summary: 'Delete a D1 database',
  responses: {
    204: emptyResponse('Deleted'),
    400: errorResponse('Bad request'),
  },
});
export const databaseDeleteHandler = async (c: Context<Env>) => {
  const databaseId = c.req.param('databaseId');
  if (!databaseId) {
    return respondWithStatus(c, toContentfulStatusCode(400), { error: 'databaseId required' });
  }
  try {
    await clientFromEnv(c.env).deleteDatabase(databaseId);
    return respondWithStatus(c, toContentfulStatusCode(204), {});
  } catch (error) {
    return handleD1Error(c, error);
  }
};

const databaseQueryRoute = createRoute({
  method: 'post',
  path: '/v4/databases/{databaseId}/query',
  summary: 'Execute SQL query against D1',
  request: {
    params: z.object({ databaseId: z.string().min(1) }),
    ...jsonRequest(QueryPayload),
  },
  responses: {
    200: jsonResponse(AnyResponse, 'Query result'),
    400: errorResponse('Bad request'),
  },
});
export const databaseQueryHandler = async (c: Context<Env>) => {
  const databaseId = c.req.param('databaseId');
  if (!databaseId) {
    return respondWithStatus(c, toContentfulStatusCode(400), { error: 'databaseId required' });
  }
  try {
    const payload = (await parseJson<unknown>(c)) ?? {};
    const data = await clientFromEnv(c.env).queryDatabase(databaseId, payload);
    return c.json(data);
  } catch (error) {
    return handleD1Error(c, error);
  }
};

const databaseRawRoute = createRoute({
  method: 'post',
  path: '/v4/databases/{databaseId}/raw',
  summary: 'Execute raw SQL statements',
  request: {
    params: z.object({ databaseId: z.string().min(1) }),
    ...jsonRequest(QueryPayload),
  },
  responses: {
    200: jsonResponse(AnyResponse, 'Raw query result'),
    400: errorResponse('Bad request'),
  },
});
export const databaseRawHandler = async (c: Context<Env>) => {
  const databaseId = c.req.param('databaseId');
  if (!databaseId) {
    return respondWithStatus(c, toContentfulStatusCode(400), { error: 'databaseId required' });
  }
  try {
    const payload = (await parseJson<unknown>(c)) ?? {};
    const data = await clientFromEnv(c.env).rawDatabase(databaseId, payload);
    return c.json(data);
  } catch (error) {
    return handleD1Error(c, error);
  }
};

const databaseExportRoute = createRoute({
  method: 'post',
  path: '/v4/databases/{databaseId}/export',
  summary: 'Start database export',
  request: {
    params: z.object({ databaseId: z.string().min(1) }),
    ...jsonRequest(OptionalPayload),
  },
  responses: {
    200: jsonResponse(AnyResponse, 'Export started'),
    400: errorResponse('Bad request'),
  },
});
export const databaseExportHandler = async (c: Context<Env>) => {
  const databaseId = c.req.param('databaseId');
  if (!databaseId) {
    return respondWithStatus(c, toContentfulStatusCode(400), { error: 'databaseId required' });
  }
  try {
    const payload = (await parseJson<unknown>(c)) ?? {};
    const data = await clientFromEnv(c.env).startExport(databaseId, payload);
    return c.json(data);
  } catch (error) {
    return handleD1Error(c, error);
  }
};

const databaseImportRoute = createRoute({
  method: 'post',
  path: '/v4/databases/{databaseId}/import',
  summary: 'Import SQL into database',
  request: {
    params: z.object({ databaseId: z.string().min(1) }),
    ...jsonRequest(OptionalPayload),
  },
  responses: {
    200: jsonResponse(AnyResponse, 'Import started'),
    400: errorResponse('Bad request'),
  },
});
export const databaseImportHandler = async (c: Context<Env>) => {
  const databaseId = c.req.param('databaseId');
  if (!databaseId) {
    return respondWithStatus(c, toContentfulStatusCode(400), { error: 'databaseId required' });
  }
  try {
    const payload = (await parseJson<unknown>(c)) ?? {};
    const data = await clientFromEnv(c.env).startImport(databaseId, payload);
    return c.json(data);
  } catch (error) {
    return handleD1Error(c, error);
  }
};

const timeTravelBookmarkRoute = createRoute({
  method: 'get',
  path: '/v4/databases/{databaseId}/time-travel/bookmark',
  summary: 'Get a time travel bookmark',
  request: {
    params: z.object({ databaseId: z.string().min(1) }),
  },
  responses: {
    200: jsonResponse(AnyResponse, 'Time travel bookmark'),
    400: errorResponse('Bad request'),
  },
});
export const timeTravelBookmarkHandler = async (c: Context<Env>) => {
  const databaseId = c.req.param('databaseId');
  if (!databaseId) {
    return respondWithStatus(c, toContentfulStatusCode(400), { error: 'databaseId required' });
  }
  try {
    const data = await clientFromEnv(c.env).getBookmark(databaseId);
    return c.json(data);
  } catch (error) {
    return handleD1Error(c, error);
  }
};

const timeTravelRestoreRoute = createRoute({
  method: 'post',
  path: '/v4/databases/{databaseId}/time-travel/restore',
  summary: 'Restore database to a bookmark',
  request: {
    params: z.object({ databaseId: z.string().min(1) }),
    ...jsonRequest(OptionalPayload),
  },
  responses: {
    200: jsonResponse(AnyResponse, 'Restore result'),
    400: errorResponse('Bad request'),
  },
});
export const timeTravelRestoreHandler = async (c: Context<Env>) => {
  const databaseId = c.req.param('databaseId');
  if (!databaseId) {
    return respondWithStatus(c, toContentfulStatusCode(400), { error: 'databaseId required' });
  }
  try {
    const payload = (await parseJson<unknown>(c)) ?? {};
    const data = await clientFromEnv(c.env).restoreBookmark(databaseId, payload);
    return c.json(data);
  } catch (error) {
    return handleD1Error(c, error);
  }
};

export const databasesRoutes = [
  { route: databaseListRoute, handler: databaseListHandler },
  { route: databaseGetRoute, handler: databaseGetHandler },
  { route: databaseCreateRoute, handler: databaseCreateHandler },
  { route: databaseUpdateRoute, handler: databaseUpdateHandler },
  { route: databasePatchRoute, handler: databasePatchHandler },
  { route: databaseDeleteRoute, handler: databaseDeleteHandler },
  { route: databaseQueryRoute, handler: databaseQueryHandler },
  { route: databaseRawRoute, handler: databaseRawHandler },
  { route: databaseExportRoute, handler: databaseExportHandler },
  { route: databaseImportRoute, handler: databaseImportHandler },
  { route: timeTravelBookmarkRoute, handler: timeTravelBookmarkHandler },
  { route: timeTravelRestoreRoute, handler: timeTravelRestoreHandler },
];
