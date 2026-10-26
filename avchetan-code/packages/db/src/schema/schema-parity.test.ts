import { is } from 'drizzle-orm';
import { getTableConfig as getPgTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { getTableConfig as getSqliteTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import * as pgSchema from './pg/tables';
import {
  type LogicalType,
  SERVER_SYNC_COLUMNS,
  TABLES,
  type TableName,
  type TableSpec,
} from './spec';
import * as sqliteSchema from './sqlite/tables';

/** Drizzle column types each logical type must map to, per dialect (docs/conventions/database.md). */
const SQLITE_TYPES: Record<LogicalType, string> = {
  uuid: 'SQLiteText',
  text: 'SQLiteText',
  instant: 'SQLiteText',
  local_date: 'SQLiteText',
  bool: 'SQLiteBoolean',
  json: 'SQLiteTextJson',
  int: 'SQLiteInteger',
  real: 'SQLiteReal',
  bigint: 'SQLiteInteger',
};

const PG_TYPES: Record<LogicalType, string> = {
  uuid: 'PgUUID',
  text: 'PgText',
  instant: 'PgTimestampString',
  local_date: 'PgDateString',
  bool: 'PgBoolean',
  json: 'PgJsonb',
  int: 'PgInteger',
  real: 'PgDoublePrecision',
  bigint: 'PgBigInt53',
};

type ColumnShape = { type: string; nullable: boolean; enum: readonly string[] | undefined };

function describeColumns(
  columns: readonly {
    name: string;
    columnType: string;
    notNull: boolean;
    enumValues?: readonly string[] | undefined;
  }[],
): Record<string, ColumnShape> {
  return Object.fromEntries(
    columns.map((c) => [
      c.name,
      {
        type: c.columnType,
        nullable: !c.notNull,
        enum: c.enumValues && c.enumValues.length > 0 ? c.enumValues : undefined,
      },
    ]),
  );
}

function expected(
  spec: Record<string, TableSpec['columns'][string]>,
  types: Record<LogicalType, string>,
): Record<string, ColumnShape> {
  return Object.fromEntries(
    Object.entries(spec).map(([name, c]) => [
      name,
      { type: types[c.type], nullable: c.nullable, enum: c.enum },
    ]),
  );
}

const sqliteTables = new Map(
  (Object.values(sqliteSchema) as unknown[])
    .filter((value): value is SQLiteTable => is(value, SQLiteTable))
    .map((table) => {
      const config = getSqliteTableConfig(table);
      return [config.name, config] as const;
    }),
);

const pgTables = new Map(
  (Object.values(pgSchema) as unknown[])
    .filter((value): value is PgTable => is(value, PgTable))
    .map((table) => {
      const config = getPgTableConfig(table);
      return [config.name, config] as const;
    }),
);

const tableNames = Object.keys(TABLES) as TableName[];
const namesWithScope = (...scopes: TableSpec['scope'][]) =>
  tableNames.filter((name) => scopes.includes(TABLES[name].scope)).sort();

describe('schema parity (ADR-0007)', () => {
  it('SQLite defines exactly the synced + client-local tables', () => {
    expect([...sqliteTables.keys()].sort()).toEqual(namesWithScope('synced', 'local'));
  });

  it('Postgres defines exactly the synced + server-only tables', () => {
    expect([...pgTables.keys()].sort()).toEqual(namesWithScope('synced', 'server'));
  });

  for (const name of namesWithScope('synced', 'local')) {
    it(`sqlite.${name} matches the spec`, () => {
      const config = sqliteTables.get(name);
      expect(config).toBeDefined();
      expect(describeColumns(config?.columns ?? [])).toEqual(
        expected(TABLES[name].columns, SQLITE_TYPES),
      );
    });
  }

  for (const name of namesWithScope('synced', 'server')) {
    it(`pg.${name} matches the spec`, () => {
      const config = pgTables.get(name);
      expect(config).toBeDefined();
      const specColumns =
        TABLES[name].scope === 'synced'
          ? { ...TABLES[name].columns, ...SERVER_SYNC_COLUMNS }
          : TABLES[name].columns;
      expect(describeColumns(config?.columns ?? [])).toEqual(expected(specColumns, PG_TYPES));
    });
  }

  it('synced tables have no unique constraints besides the primary key', () => {
    for (const name of namesWithScope('synced')) {
      const sqlite = sqliteTables.get(name);
      const pg = pgTables.get(name);
      expect(sqlite?.indexes.filter((i) => i.config.unique) ?? []).toEqual([]);
      expect(sqlite?.uniqueConstraints ?? []).toEqual([]);
      expect(pg?.indexes.filter((i) => i.config.unique) ?? []).toEqual([]);
      expect(pg?.uniqueConstraints ?? []).toEqual([]);
    }
  });

  it('every synced Postgres table indexes server_seq', () => {
    for (const name of namesWithScope('synced')) {
      const indexed = pgTables
        .get(name)
        ?.indexes.some((i) => i.config.columns.some((c) => 'name' in c && c.name === 'server_seq'));
      expect(indexed, name).toBe(true);
    }
  });
});
