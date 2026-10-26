import { TABLES, type TableName, type TableScope } from '../src/schema/spec';

/** Table names with any of the given scopes, sorted. */
export function namesWithScope(...scopes: TableScope[]): TableName[] {
  return (Object.keys(TABLES) as TableName[])
    .filter((name) => scopes.includes(TABLES[name].scope))
    .sort();
}
