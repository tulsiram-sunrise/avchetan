import { type ColumnSpec, SYNCED_TABLE_NAMES, TABLES, type TableName } from '@avchetan/db';
import { isUtcInstant, isValidLocalDate, isValidLocalTime } from '@avchetan/shared';
import { z } from 'zod';

const camelCase = (column: string) =>
  column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

/**
 * An enum value from any version of the app: a newer one may send a value this one doesn't
 * know yet, which passes on and is narrowed where it is read (ADR-0032). Enum values are always
 * lowercase snake_case (docs/conventions/naming.md), so anything else is a bad row.
 */
export const wireEnumSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'Expected an enum value');

function baseSchema(spec: ColumnSpec): z.ZodType {
  if (spec.enum) return wireEnumSchema;
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
    // Server-only tables never sync; listed so a vector column on a synced table would be checked.
    case 'vector':
      return z.array(z.number());
  }
}

/** Columns with a tighter check than their logical type, keyed `table.column`. */
const COLUMN_SCHEMAS: Record<string, z.ZodType> = {
  // Any object: a newer app's rule passes on, and a rule this app can't read makes no days
  // (routineRule, ADR-0032). Rules typed in are still checked strictly (ADR-0030).
  'routines.repeat_rule': z.record(z.string(), z.json()),
  'routines.window_start': z.string().refine(isValidLocalTime, 'Expected HH:MM'),
  'routines.window_end': z.string().refine(isValidLocalTime, 'Expected HH:MM'),
};

function rowSchema(table: TableName) {
  const fields = Object.entries(TABLES[table].columns as Record<string, ColumnSpec>).map(
    ([name, spec]) => {
      const base = COLUMN_SCHEMAS[`${table}.${name}`] ?? baseSchema(spec);
      // A missing nullable field reads as null, so an older client that doesn't know a newly
      // added column can still push.
      // Likewise a missing column with a default takes it.
      const field = spec.nullable
        ? base.nullable().default(null)
        : spec.default !== undefined
          ? base.default(spec.default)
          : base;
      return [camelCase(name), field] as const;
    },
  );
  return z.object(Object.fromEntries(fields));
}

/**
 * One wire schema per synced table, built from the column spec so they can't drift from the
 * database. Unknown fields are dropped, so an older client tolerates a newer server, and missing
 * nullable fields become null, so a newer server accepts an older client.
 */
export const SYNCED_ROW_SCHEMAS = Object.fromEntries(
  SYNCED_TABLE_NAMES.map((table) => [table, rowSchema(table)]),
) as Record<string, ReturnType<typeof rowSchema>>;

export function isSyncedTable(table: string): boolean {
  return Object.hasOwn(SYNCED_ROW_SCHEMAS, table);
}
