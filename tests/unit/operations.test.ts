import { describe, expect, it } from 'vitest';
import {
  getOperationDefinition,
  OperationCategory,
  operations,
  runtimeOperations,
  opsOnlyOperations,
} from '../../src/operations/catalog';

describe('operations catalog', () => {
  it('exposes the 12 D1 operations from setup guidance', () => {
    expect(Object.keys(operations)).toHaveLength(12);
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
});
