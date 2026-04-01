import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env } from '../../env';
import { getOperationDefinition, OperationCategory } from '../../operations/catalog';
import { D1Client, D1RequestError } from '../../services/cloudflare/v4/d1-client';

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

const jsonResponse = (schema: z.ZodTypeAny, description: string) => ({
  description,
  content: {
    'application/json': {
      schema,
    },
  },
});

const errorResponse = (description: string) => ({
  description,
  content: {
    'application/json': {
      schema: ErrorSchema,
    },
  },
});

const getClientFromContext = (c: Context<Env>) => D1Client.fromEnv(c.env as Env);
const toContentfulStatusCode = (status: number) => status as ContentfulStatusCode;

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
    400: errorResponse('Bad request'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Not found'),
    422: errorResponse('Idempotency key required'),
  },
});

export const internalOperationsHandler = async (c: Context<Env>) => {
  try {
    const body = await c.req.json();
    const parsed = internalOperationSchema.safeParse(body);
    if (!parsed.success) {
      return c.status(toContentfulStatusCode(400))
        .json({ error: parsed.error.message });
    }

    if (parsed.data.contract_version !== '1') {
      return c.status(toContentfulStatusCode(400))
        .json({ error: 'unsupported contract version' });
    }

    let definition;
    try {
      definition = getOperationDefinition(parsed.data.operation);
  } catch (err) {
      return c.status(toContentfulStatusCode(404))
        .json({ error: 'unsupported operation' });
    }

    const claims = parsed.data.claims ?? { role: 'runtime' };
    enforceClaims(definition, claims);
    ensureIdempotency(definition, parsed.data.idempotency_key);
    const client = D1Client.fromEnv(c.env);
    const result = await executeOperation(client, definition.name, parsed.data.input ?? undefined);
    return c.json({
      operation: definition.name,
      contract_version: definition.contractVersion,
      result,
    });
  } catch (error) {
    if (error instanceof OperationInputError) {
      return c.status(toContentfulStatusCode(error.status))
        .json({ error: error.message });
    }
    if (error instanceof D1RequestError) {
      return c.status(toContentfulStatusCode(error.status))
        .json({ error: error.body });
    }
    throw error;
  }
};

export const internalOperationsRouteDefinition = {
  route: internalOperationsRoute,
  handler: internalOperationsHandler,
};
