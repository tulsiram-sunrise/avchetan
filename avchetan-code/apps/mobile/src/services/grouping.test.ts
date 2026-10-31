import type { RawLog, Task } from '@avchetan/db/sqlite';
import { describe, expect, it } from 'vitest';
import { byRawLog, groupByDay, groupTasks } from './grouping';

const log = (id: string, capturedAt: string) => ({ id, capturedAt }) as RawLog;
const task = (title: string, dueDate: string | null) => ({ title, dueDate }) as Task;

describe('groupByDay', () => {
  it('keeps the order and starts a section at each new day', () => {
    const sections = groupByDay(
      [log('a', '2026-10-31T09:00'), log('b', '2026-10-31T08:00'), log('c', '2026-10-30T23:00')],
      (instant) => instant.slice(0, 10),
    );

    expect(sections.map((s) => [s.title, s.data.map((row) => row.id)])).toEqual([
      ['2026-10-31', ['a', 'b']],
      ['2026-10-30', ['c']],
    ]);
  });
});

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

describe('groupTasks', () => {
  it('sorts tasks into due groups around today', () => {
    const sections = groupTasks(
      [
        task('late', '2026-10-30'),
        task('now', '2026-10-31'),
        task('soon', '2026-11-01'),
        task('someday', null),
      ],
      '2026-10-31',
    );

    expect(sections.map((s) => [s.title, s.data.map((t) => t.title)])).toEqual([
      ['Overdue', ['late']],
      ['Today', ['now']],
      ['Coming up', ['soon']],
      ['No date', ['someday']],
    ]);
    expect(sections[0]?.alert).toBe(true);
  });

  it('leaves out empty groups', () => {
    expect(groupTasks([task('someday', null)], '2026-10-31').map((s) => s.title)).toEqual([
      'No date',
    ]);
  });
});
