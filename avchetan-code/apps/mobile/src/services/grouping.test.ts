import type { RawLog, Task } from '@avchetan/db/sqlite';
import { describe, expect, it } from 'vitest';
import { byRawLog } from './grouping';

const _log = (id: string, capturedAt: string) => ({ id, capturedAt }) as RawLog;
const task = (title: string, dueDate: string | null) => ({ title, dueDate }) as Task;

describe('byRawLog', () => {
  it('collects rows by their log and skips rows with none', () => {
    const groups = byRawLog([
      { id: '1', rawLogId: 'a' },
      { id: '2', rawLogId: 'a' },
      { id: '3', rawLogId: null },
    ]);

    expect(groups.get('a')?.map((row) => row.id)).toEqual(['1', '2']);
    expect(groups.size).toBe(1);
  });
});
