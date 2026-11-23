import type { Conflict } from '@avchetan/db/sqlite';
import { describe, expect, it } from 'vitest';
import { describeConflict } from './describe';

const conflict = (changes: Conflict['changes'], current: Record<string, unknown>) =>
  ({ table: 'tasks', id: 't1', current, changes, detectedAt: '' }) as unknown as Conflict;

describe('describeConflict', () => {
  it('names the task and each field that differs, in words', () => {
    const notice = describeConflict(
      conflict(
        [
          { field: 'title', mine: 'Call the plumber', theirs: 'Call the plumber today' },
          { field: 'completedAt', mine: '2026-11-23T10:00:00.000Z', theirs: null },
          { field: 'progressPct', mine: null, theirs: 40 },
          { field: 'dueDate', mine: '2026-11-24', theirs: null },
        ],
        { title: 'Call the plumber today' },
      ),
    );

    expect(notice).toEqual({
      title: 'Call the plumber today',
      kind: 'Task',
      lines: [
        { label: 'Title', mine: 'Call the plumber', theirs: 'Call the plumber today' },
        { label: 'Done', mine: 'yes', theirs: 'no' },
        { label: 'Partly done', mine: 'none', theirs: '40%' },
        { label: 'Due', mine: '2026-11-24', theirs: 'none' },
      ],
    });
  });

  it('names categories, and says when it can’t read a repeat rule', () => {
    const notice = describeConflict(
      conflict(
        [
          { field: 'categoryId', mine: 'c1', theirs: 'c2' },
          { field: 'repeatRule', mine: { every: 'fortnight?' }, theirs: null },
        ],
        { title: 'Walk' },
      ),
      (id) => (id === 'c1' ? 'Exercise' : 'Health'),
    );

    expect(notice.lines).toEqual([
      { label: 'Category', mine: 'Exercise', theirs: 'Health' },
      { label: 'Repeats', mine: 'a rule this app can’t read', theirs: 'none' },
    ]);
  });
});
