import { describe, expect, it } from 'vitest';
import {
  getOperationDefinition,
  OperationCategory,
  operations,
  runtimeOperations,
  opsOnlyOperations,
} from '../../src/operations/catalog';
import { buildTenantDatabaseName, ensureTenantDatabase } from '../../src/registry/tenantDatabaseRegistry';

describe('operations catalog', () => {
  it('exposes the expected D1 operations from setup guidance', () => {
    expect(Object.keys(operations)).toHaveLength(14);
    expect(operations['d1.database.list'].category).toBe(OperationCategory.Runtime);
    expect(operations['d1.database.create'].category).toBe(OperationCategory.Ops);
  });

  it('returns filled contract definitions', () => {
    const definition = getOperationDefinition('d1.database.query');
    expect(definition.contractVersion).toBe('1');
    expect(definition.mutates).toBeTruthy();
  });

  it('keeps runtime/ops partitions stable', () => {
    expect(runtimeOperations).toContain('d1.database.query');
    expect(opsOnlyOperations).toContain('d1.database.import');
  });

  it('exposes tenant-based database provisioning instead of name resolution', () => {
    expect(operations['d1.database.ensure_for_tenant'].category).toBe(OperationCategory.Ops);
    expect(operations['d1.database.resolve_by_name'].category).toBe(OperationCategory.Runtime);
  });
});

describe('tenant database registry helpers', () => {
  it('builds database names from tenant ids', () => {
    expect(buildTenantDatabaseName('tenant-acme')).toBe('soh-kg-tenant-acme');
  });

  it('returns registry hits without calling Cloudflare', async () => {
    const registry = {
      getDatabaseId: async () => 'db-1',
      setTenantDatabase: async () => undefined,
      removeByDatabaseId: async () => undefined,
    };
    const client = {
      listDatabasesByName: async () => {
        throw new Error('should not be called');
      },
      createDatabase: async () => {
        throw new Error('should not be called');
      },
    };

    await expect(
      ensureTenantDatabase({
        tenantId: 'tenant-acme',
        registry,
        client,
      }),
    ).resolves.toEqual({ databaseId: 'db-1', source: 'registry' });
  });

  it('backfills a registry miss from the legacy database name once', async () => {
    const writes: Array<{ tenantId: string; databaseId: string }> = [];
    const registry = {
      getDatabaseId: async () => null,
      setTenantDatabase: async (tenantId: string, databaseId: string) => {
        writes.push({ tenantId, databaseId });
      },
      removeByDatabaseId: async () => undefined,
    };
    const client = {
      listDatabasesByName: async () => ({ result: [{ uuid: 'db-legacy' }] }),
      createDatabase: async () => {
        throw new Error('should not be called');
      },
    };

    await expect(
      ensureTenantDatabase({
        tenantId: 'tenant-acme',
        registry,
        client,
      }),
    ).resolves.toEqual({ databaseId: 'db-legacy', source: 'backfill' });
    expect(writes).toEqual([{ tenantId: 'tenant-acme', databaseId: 'db-legacy' }]);
  });

  it('retries the legacy name backfill before succeeding', async () => {
    let attempts = 0;
    const writes: Array<{ tenantId: string; databaseId: string }> = [];
    const registry = {
      getDatabaseId: async () => null,
      setTenantDatabase: async (tenantId: string, databaseId: string) => {
        writes.push({ tenantId, databaseId });
      },
      removeByDatabaseId: async () => undefined,
    };
    const client = {
      listDatabasesByName: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error('transient control-plane error');
        }
        return { result: [{ uuid: 'db-legacy' }] };
      },
      createDatabase: async () => {
        throw new Error('should not be called');
      },
    };

    await expect(
      ensureTenantDatabase({
        tenantId: 'tenant-acme',
        registry,
        client,
      }),
    ).resolves.toEqual({ databaseId: 'db-legacy', source: 'backfill' });
    expect(attempts).toBe(3);
    expect(writes).toEqual([{ tenantId: 'tenant-acme', databaseId: 'db-legacy' }]);
  });

  it('creates and stores a database when neither registry nor backfill resolve it', async () => {
    const writes: Array<{ tenantId: string; databaseId: string }> = [];
    const registry = {
      getDatabaseId: async () => null,
      setTenantDatabase: async (tenantId: string, databaseId: string) => {
        writes.push({ tenantId, databaseId });
      },
      removeByDatabaseId: async () => undefined,
    };
    const client = {
      listDatabasesByName: async () => ({ result: [] }),
      createDatabase: async () => ({ result: { uuid: 'db-created' } }),
    };

    await expect(
      ensureTenantDatabase({
        tenantId: 'tenant-acme',
        registry,
        client,
      }),
    ).resolves.toEqual({ databaseId: 'db-created', source: 'created' });
    expect(writes).toEqual([{ tenantId: 'tenant-acme', databaseId: 'db-created' }]);
  });
});
