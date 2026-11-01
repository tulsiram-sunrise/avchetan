import { type ColumnSpec, SYNCED_TABLE_NAMES, TABLES, type TableName } from '@avchetan/db';
import { isUtcInstant, isValidLocalDate } from '@avchetan/shared';
import { z } from 'zod';

const camelCase = (column: string) =>
  column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

function baseSchema(spec: ColumnSpec): z.ZodType {
  if (spec.enum) return z.enum(spec.enum as [string, ...string[]]);
  switch (spec.type) {
    case 'uuid':
      return z.uuid();
    case 'text':
      return z.string();
    case 'instant':
      return z.string().refine(isUtcInstant, 'Expected a UTC instant');
    case 'local_date':
      return z.string().refine(isValidLocalDate, 'Expected YYYY-MM-DD');
    case 'bool':
      return z.boolean();
    case 'json':
      return z.json();
    case 'int':
    case 'bigint':
      return z.int();
    case 'real':
      return z.number();
  }
}

function rowSchema(table: TableName) {
  const fields = Object.entries(TABLES[table].columns as Record<string, ColumnSpec>).map(
    ([name, spec]) => {
      const base = baseSchema(spec);
      return [camelCase(name), spec.nullable ? base.nullable() : base] as const;
    },
  );
  return z.object(Object.fromEntries(fields));
}

/**
 * One wire schema per synced table, built from the column spec so they can't drift from the
 * database. Unknown fields are dropped, so an older client tolerates a newer server.
 */
export const SYNCED_ROW_SCHEMAS = Object.fromEntries(
  SYNCED_TABLE_NAMES.map((table) => [table, rowSchema(table)]),
) as Record<string, ReturnType<typeof rowSchema>>;

export function isSyncedTable(table: string): boolean {
  return Object.hasOwn(SYNCED_ROW_SCHEMAS, table);
}
