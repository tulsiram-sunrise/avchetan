import { type Column, getTableColumns, getTableName, isNull } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { askHistory, extractionCorrections } from '../schema/sqlite/tables';
import type { ClientDb } from './database';
import { SYNCED_TABLES } from './synced';

/**
 * Everything a person wrote or the app derived from it, for "Export my data"
 * (docs/product/advancements.md §8). Synced tables without deleted rows, plus the device's
 * own Ask history and corrections. Settings, the sync queue and LLM run stats stay out:
 * they describe the device, not the person's data, and secrets never live in SQLite anyway.
 */
const EXPORTED_TABLES: readonly SQLiteTable[] = [
  ...Object.values(SYNCED_TABLES),
  askHistory,
  extractionCorrections,
];

export const EXPORT_FORMAT = 'avchetan-export';
export const EXPORT_VERSION = 1;

export type ExportRow = Record<string, unknown>;

export type DataExport = {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  deviceId: string;
  /** Rows keyed by database column name (`snake_case`), per table. */
  tables: Record<string, ExportRow[]>;
};

export type ExportFile = { name: string; content: string };

export async function collectExport(
  db: ClientDb,
  meta: { exportedAt: string; deviceId: string },
): Promise<DataExport> {
  const tables: Record<string, ExportRow[]> = {};
  for (const table of EXPORTED_TABLES) {
    const columns = getTableColumns(table) as Record<string, Column>;
    const deletedAt = columns.deletedAt;
    const query = db.select().from(table);
    const rows = (await (deletedAt ? query.where(isNull(deletedAt)) : query)) as ExportRow[];
    tables[getTableName(table)] = rows.map((row) => {
      const out: ExportRow = {};
      for (const [key, column] of Object.entries(columns)) out[column.name] = row[key] ?? null;
      return out;
    });
  }
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, ...meta, tables };
}

/** One JSON file with every table, and one CSV per non-empty table (opens in a spreadsheet). */
export function exportFiles(data: DataExport): ExportFile[] {
  const files: ExportFile[] = [
    { name: 'avchetan-export.json', content: `${JSON.stringify(data, null, 2)}\n` },
  ];
  for (const [name, rows] of Object.entries(data.tables)) {
    if (rows.length > 0) files.push({ name: `${name}.csv`, content: toCsv(rows) });
  }
  return files;
}

/** RFC 4180 CSV. Arrays and objects are written as JSON inside the cell. */
export function toCsv(rows: readonly ExportRow[]): string {
  const first = rows[0];
  if (!first) return '';
  const headers = Object.keys(first);
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(headers.map((key) => csvCell(row[key])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
