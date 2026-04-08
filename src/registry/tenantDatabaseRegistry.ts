import type { DurableObjectNamespace, DurableObjectState } from '@cloudflare/workers-types';

const TENANT_PREFIX = 'tenant:';
const DATABASE_PREFIX = 'database:';
const DEFAULT_DB_PREFIX = 'soh-kg-';

export interface TenantDatabaseRegistry {
  getDatabaseId(tenantId: string): Promise<string | null>;
  setTenantDatabase(tenantId: string, databaseId: string): Promise<void>;
  removeByDatabaseId(databaseId: string): Promise<void>;
}

export function buildTenantDatabaseName(tenantId: string): string {
  return `${DEFAULT_DB_PREFIX}${tenantId}`;
}

async function retry<T>(
  operation: () => Promise<T>,
  options?: { attempts?: number },
): Promise<T> {
  const attempts = options?.attempts ?? 6;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function tenantKey(tenantId: string): string {
  return `${TENANT_PREFIX}${tenantId}`;
}

function databaseKey(databaseId: string): string {
  return `${DATABASE_PREFIX}${databaseId}`;
}

export function createTenantDatabaseRegistry(namespace: DurableObjectNamespace): TenantDatabaseRegistry {
  const stub = namespace.get(namespace.idFromName('tenant-database-registry'));

  return {
    async getDatabaseId(tenantId: string): Promise<string | null> {
      const response = await stub.fetch(`https://registry.internal/tenant/${encodeURIComponent(tenantId)}`);
      if (response.status === 404) {
        return null;
      }
      const payload = (await response.json()) as { databaseId?: string | null };
      return typeof payload.databaseId === 'string' ? payload.databaseId : null;
    },
    async setTenantDatabase(tenantId: string, databaseId: string): Promise<void> {
      await stub.fetch(`https://registry.internal/tenant/${encodeURIComponent(tenantId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId }),
      });
    },
    async removeByDatabaseId(databaseId: string): Promise<void> {
      await stub.fetch(`https://registry.internal/database/${encodeURIComponent(databaseId)}`, {
        method: 'DELETE',
      });
    },
  };
}

function extractDatabaseId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const record = payload as {
    result?: { uuid?: string; id?: string } | Array<{ uuid?: string; id?: string }>;
  };
  if (Array.isArray(record.result)) {
    const match = record.result[0];
    return typeof match?.uuid === 'string'
      ? match.uuid
      : typeof match?.id === 'string'
        ? match.id
        : null;
  }
  return typeof record.result?.uuid === 'string'
    ? record.result.uuid
    : typeof record.result?.id === 'string'
      ? record.result.id
      : null;
}

export async function ensureTenantDatabase(params: {
  tenantId: string;
  registry: TenantDatabaseRegistry;
  client: {
    listDatabasesByName(name: string): Promise<unknown>;
    createDatabase(payload: unknown): Promise<unknown>;
  };
}): Promise<{ databaseId: string; source: 'registry' | 'backfill' | 'created' }> {
  const { tenantId, registry, client } = params;
  const existingDatabaseId = await registry.getDatabaseId(tenantId);
  if (existingDatabaseId) {
    return { databaseId: existingDatabaseId, source: 'registry' };
  }

  // Compatibility backfill for pre-registry tenant databases.
  const legacyDatabase = await retry(() =>
    client.listDatabasesByName(buildTenantDatabaseName(tenantId)),
  );
  const legacyDatabaseId = extractDatabaseId(legacyDatabase);
  if (legacyDatabaseId) {
    await registry.setTenantDatabase(tenantId, legacyDatabaseId);
    return { databaseId: legacyDatabaseId, source: 'backfill' };
  }

  const createdDatabase = await retry(() =>
    client.createDatabase({
      name: buildTenantDatabaseName(tenantId),
    }),
  );
  const createdDatabaseId = extractDatabaseId(createdDatabase);
  if (!createdDatabaseId) {
    throw new Error(`Failed to create database for tenant ${tenantId}`);
  }
  await registry.setTenantDatabase(tenantId, createdDatabaseId);
  return { databaseId: createdDatabaseId, source: 'created' };
}

export class TenantDatabaseRegistryDO {
  constructor(private readonly state: DurableObjectState) {}

  public async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const [, scope, rawId] = url.pathname.split('/');
    const identifier = decodeURIComponent(rawId ?? '');
    if (!identifier) {
      return new Response(JSON.stringify({ error: 'identifier required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (request.method === 'GET' && scope === 'tenant') {
      const databaseId = await this.state.storage.get<string>(tenantKey(identifier));
      if (!databaseId) {
        return new Response(JSON.stringify({ error: 'not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ databaseId }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (request.method === 'PUT' && scope === 'tenant') {
      const payload = (await request.json()) as { databaseId?: string };
      if (!payload.databaseId) {
        return new Response(JSON.stringify({ error: 'databaseId required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const previousDatabaseId = await this.state.storage.get<string>(tenantKey(identifier));
      if (previousDatabaseId && previousDatabaseId !== payload.databaseId) {
        await this.state.storage.delete(databaseKey(previousDatabaseId));
      }
      await this.state.storage.put(tenantKey(identifier), payload.databaseId);
      await this.state.storage.put(databaseKey(payload.databaseId), identifier);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (request.method === 'DELETE' && scope === 'database') {
      const tenantId = await this.state.storage.get<string>(databaseKey(identifier));
      await this.state.storage.delete(databaseKey(identifier));
      if (tenantId) {
        await this.state.storage.delete(tenantKey(tenantId));
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
