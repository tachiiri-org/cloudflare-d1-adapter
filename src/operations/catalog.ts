export enum OperationCategory {
  Runtime = 'runtime',
  Ops = 'ops'
}

export interface OperationDefinition {
  name: string;
  contractVersion: string;
  description: string;
  category: OperationCategory;
  mutates: boolean;
  requiresIdempotency: boolean;
}

function build(name: string, category: OperationCategory, mutates: boolean, requiresIdempotency: boolean, description: string): OperationDefinition {
  return {
    name,
    category,
    contractVersion: '1',
    mutates,
    requiresIdempotency,
    description,
  };
}

export const operations: Record<string, OperationDefinition> = {
  'd1.database.list': build('d1.database.list', OperationCategory.Runtime, false, false, 'List D1 databases'),
  'd1.database.resolve_by_name': build('d1.database.resolve_by_name', OperationCategory.Runtime, false, false, 'Resolve database ID by name (cached)'),
  'd1.database.get': build('d1.database.get', OperationCategory.Runtime, false, false, 'Get single D1 database'),
  'd1.database.create': build('d1.database.create', OperationCategory.Ops, true, true, 'Create a D1 database'),
  'd1.database.update': build('d1.database.update', OperationCategory.Ops, true, true, 'Replace metadata for a D1 database'),
  'd1.database.patch': build('d1.database.patch', OperationCategory.Ops, true, true, 'Patch metadata for a D1 database'),
  'd1.database.delete': build('d1.database.delete', OperationCategory.Ops, true, true, 'Delete a D1 database'),
  'd1.database.query': build('d1.database.query', OperationCategory.Runtime, true, false, 'Query a D1 database (structured response)'),
  'd1.database.raw': build('d1.database.raw', OperationCategory.Runtime, true, false, 'Query a D1 database returning arrays'),
  'd1.database.export': build('d1.database.export', OperationCategory.Ops, true, false, 'Export a D1 database as SQL dump'),
  'd1.database.import': build('d1.database.import', OperationCategory.Ops, true, true, 'Import SQL into a D1 database'),
  'd1.database.time_travel.bookmark': build('d1.database.time_travel.bookmark', OperationCategory.Runtime, false, false, 'Get a D1 time travel bookmark'),
  'd1.database.time_travel.restore': build('d1.database.time_travel.restore', OperationCategory.Ops, true, true, 'Restore a D1 database to a bookmark'),
};

export const runtimeOperations = Object.keys(operations).filter(name => operations[name].category === OperationCategory.Runtime);
export const opsOnlyOperations = Object.keys(operations).filter(name => operations[name].category === OperationCategory.Ops);

export function getOperationDefinition(name: string): OperationDefinition {
  const definition = operations[name];
  if (!definition) {
    throw new Error(`unsupported operation '${name}'`);
  }
  return definition;
}
