import { describe, expect, it } from 'vitest';
import { openTestStore } from '../../testing';
import { collectExport, EXPORT_FORMAT, exportFiles, exportFolderName, toCsv } from './export';

const meta = { exportedAt: '2026-10-26T12:00:00.000Z', deviceId: 'device-a' };

describe('collectExport', () => {
  it('exports live rows by column name and leaves deleted rows out', async () => {
    const { store } = await openTestStore();
    const capture = (content: string) =>
      store.write((tx) =>
        store.repos.rawLogs.capture(tx, { content, source: 'desktop_text', capturedTz: 'UTC' }),
      );
    const kept = await capture('Walked to the park');
    const gone = await capture('Typo entry');
    await store.write((tx) => store.repos.rawLogs.softDelete(tx, gone.id));

    const data = await collectExport(store.db, meta);

    expect(data.format).toBe(EXPORT_FORMAT);
    expect(data.deviceId).toBe('device-a');
    expect(data.tables.raw_logs?.map((row) => row.id)).toEqual([kept.id]);
    const row = data.tables.raw_logs?.[0];
    expect(row?.content).toBe('Walked to the park');
    expect(row?.captured_tz).toBe('UTC');
    expect(row).not.toHaveProperty('capturedTz');
    expect(data.tables.categories?.length).toBeGreaterThan(0);
    expect(Object.keys(data.tables)).toContain('ask_history');
    expect(Object.keys(data.tables)).not.toContain('settings');
    expect(Object.keys(data.tables)).not.toContain('sync_outbox');
  });

  it('writes one JSON file and a CSV per non-empty table', async () => {
    const { store } = await openTestStore();
    const files = exportFiles(await collectExport(store.db, meta));
    const names = files.map((file) => file.name);
    expect(names[0]).toBe('avchetan-export.json');
    expect(names).toContain('categories.csv');
    expect(names).not.toContain('raw_logs.csv');
    expect(JSON.parse(files[0]?.content ?? '').format).toBe(EXPORT_FORMAT);
  });
});

describe('toCsv', () => {
  it('quotes cells with commas, quotes or line breaks, and writes objects as JSON', () => {
    const csv = toCsv([
      { id: '1', text: 'plain', tags: ['a', 'b'], empty: null },
      { id: '2', text: 'said "hi", then\nleft', tags: [], empty: null },
    ]);
    expect(csv).toBe(
      'id,text,tags,empty\r\n1,plain,"[""a"",""b""]",\r\n2,"said ""hi"", then\nleft",[],\r\n',
    );
  });

  it('is empty for no rows', () => {
    expect(toCsv([])).toBe('');
  });
});

describe('exportFolderName', () => {
  it('names the folder in local time, not UTC (audit bug 9)', () => {
    // 00:01:32 on 9 Nov in India is still 8 Nov in UTC.
    expect(exportFolderName('2026-11-08T18:31:32.807Z', 'Asia/Kolkata')).toBe(
      'avchetan-export-2026-11-09-000132',
    );
    expect(exportFolderName('2026-11-08T18:31:32.807Z', 'UTC')).toBe(
      'avchetan-export-2026-11-08-183132',
    );
  });
});
