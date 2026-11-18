import { describe, expect, it } from 'vitest';
import { replacedColumns } from './apply-push';

describe('replacedColumns', () => {
  it('names only real columns, so an unknown field cannot fail the batch', () => {
    const row = { id: 'x', updatedAt: 't', title: 'Run', notAColumn: 1, toString: 2 };
    expect(replacedColumns('activities', row)).toEqual([
      ['updatedAt', 'updated_at'],
      ['title', 'title'],
    ]);
  });

  it('never replaces a raw log text', () => {
    const keys = replacedColumns('raw_logs', { id: 'x', content: 'new', status: 'processed' });
    expect(keys).toEqual([['status', 'status']]);
  });
});
