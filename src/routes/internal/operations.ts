import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env } from '../../env';
import { getOperationDefinition, OperationCategory } from '../../operations/catalog';
import { D1Client, D1RequestError } from '../../services/cloudflare/v4/d1-client';
import { createTenantDatabaseRegistry, ensureTenantDatabase } from '../../registry/tenantDatabaseRegistry';

const claimsSchema = z.object({
  role: z.enum(['runtime', 'ops']),
  actor: z.string().optional(),
});

const inputSchema = z
  .object({
    databaseId: z.string().min(1).optional(),
    payload: z.unknown().optional(),
  })
  .passthrough();

const internalOperationSchema = z.object({
  operation: z.string(),
  contract_version: z.literal('1'),
  claims: claimsSchema.optional(),
  input: inputSchema.optional(),
  idempotency_key: z.string().min(1).optional(),
});

const internalResponseSchema = z.object({
  operation: z.string(),
  contract_version: z.literal('1'),
  result: z.unknown(),
});

const ErrorSchema = z.object({ error: z.string() });

class OperationInputError extends Error {
  constructor(public message: string, public status = 400) {
    super(message);
  }
}

function assertDatabaseId(operation: string, databaseId?: string) {
  if (!databaseId) {
    throw new OperationInputError(`databaseId is required for ${operation}`);
  }
  return databaseId;
}

function enforceClaims(definition: ReturnType<typeof getOperationDefinition>, claims: z.infer<typeof claimsSchema>) {
  if (definition.category === OperationCategory.Ops && claims.role !== 'ops') {
    throw new OperationInputError('ops role required', 403);
  }
}

function ensureIdempotency(definition: ReturnType<typeof getOperationDefinition>, key?: string) {
  if (definition.requiresIdempotency && !key) {
    throw new OperationInputError('idempotency_key required', 422);
  }
}

async function executeOperation(client: D1Client, operation: string, input: Record<string, unknown> | undefined) {
  const databaseId = input?.databaseId as string | undefined;
  const payload = input?.payload;
  switch (operation) {
    case 'd1.database.list':
      return client.listDatabases();
    case 'd1.database.resolve_by_name': {
      const name = input?.name as string | undefined;
      if (!name) {
        throw new OperationInputError('name is required for d1.database.resolve_by_name');
      }
      const result = await client.listDatabasesByName(name) as { result?: { uuid?: string; id?: string }[] };
      const match = Array.isArray(result?.result) ? result.result[0] : undefined;
      const resolvedDatabaseId = match?.uuid ?? match?.id;
      if (!resolvedDatabaseId) {
        throw new OperationInputError(`database not found: ${name}`, 404);
      }
      return { databaseId: String(resolvedDatabaseId) };
    }
    case 'd1.database.get':
      return client.getDatabase(assertDatabaseId(operation, databaseId));
    case 'd1.database.create':
      return client.createDatabase(payload ?? {});
    case 'd1.database.update':
      return client.updateDatabase(assertDatabaseId(operation, databaseId), payload ?? {});
    case 'd1.database.patch':
      return client.patchDatabase(assertDatabaseId(operation, databaseId), payload ?? {});
    case 'd1.database.delete':
      return client.deleteDatabase(assertDatabaseId(operation, databaseId));
    case 'd1.database.query':
      return client.queryDatabase(assertDatabaseId(operation, databaseId), payload ?? {});
    case 'd1.database.raw':
      return client.rawDatabase(assertDatabaseId(operation, databaseId), payload ?? {});
    case 'd1.database.export':
      return client.startExport(assertDatabaseId(operation, databaseId), payload ?? {});
    case 'd1.database.import':
      return client.startImport(assertDatabaseId(operation, databaseId), payload ?? {});
    case 'd1.database.time_travel.bookmark':
      return client.getBookmark(assertDatabaseId(operation, databaseId));
    case 'd1.database.time_travel.restore':
      return client.restoreBookmark(assertDatabaseId(operation, databaseId), payload ?? {});
    default:
      throw new OperationInputError(`unsupported operation ${operation}`, 404);
  }
}

const jsonResponse = (schema: z.ZodTypeAny, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});

const internalOperationsRoute = createRoute({
  method: 'post',
  path: '/internal/operations',
  summary: 'Execute a D1 internal operation',
  request: {
    body: {
      content: {
        'application/json': {
          schema: internalOperationSchema,
        },
      },
    },
  },
  responses: {
    200: jsonResponse(internalResponseSchema, 'Operation result'),
    400: jsonResponse(ErrorSchema, 'Bad request'),
    403: jsonResponse(ErrorSchema, 'Forbidden'),
    404: jsonResponse(ErrorSchema, 'Not found'),
    422: jsonResponse(ErrorSchema, 'Unprocessable entity'),
  },
});

export const internalOperationsHandler = async (c: Context<Env>) => {
  try {
    const body = await c.req.json();
    const parsed = internalOperationSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }

    if (parsed.data.contract_version !== '1') {
      return c.json({ error: 'unsupported contract version' }, 400);
    }

    let definition;
    try {
      definition = getOperationDefinition(parsed.data.operation);
    } catch {
      return c.json({ error: 'unsupported operation' }, 404 as ContentfulStatusCode);
    }

    const claims = parsed.data.claims ?? { role: 'runtime' };
    enforceClaims(definition, claims);
    ensureIdempotency(definition, parsed.data.idempotency_key);
    const client = D1Client.fromEnv(c.env);
    const result =
      definition.name === 'd1.database.ensure_for_tenant'
        ? await (async () => {
            const tenantId = parsed.data.input?.tenantId as string | undefined;
            if (!tenantId) {
              throw new OperationInputError('tenantId is required for d1.database.ensure_for_tenant');
            }
            return ensureTenantDatabase({
              tenantId,
              registry: createTenantDatabaseRegistry(c.env.TENANT_DATABASE_REGISTRY),
              client,
            });
          })()
        : await executeOperation(client, definition.name, parsed.data.input ?? undefined);
    return c.json({
      operation: definition.name,
      contract_version: definition.contractVersion,
      result,
    });
  } catch (error) {
    if (error instanceof OperationInputError) {
      return c.json({ error: error.message }, error.status as ContentfulStatusCode);
    }
    if (error instanceof D1RequestError) {
      return c.json({ error: error.body }, error.status as ContentfulStatusCode);
    }
    throw error;
  }
};

export const internalOperationsRouteDefinition = {
  route: internalOperationsRoute,
  handler: internalOperationsHandler,
};
