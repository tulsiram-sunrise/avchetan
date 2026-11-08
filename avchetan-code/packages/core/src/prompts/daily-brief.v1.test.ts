import { describe, expect, it } from 'vitest';
import { type BriefFacts, buildPrompt, SYSTEM } from './daily-brief.v1';

const facts: BriefFacts = {
  day: '2026-11-07',
  weekday: 'saturday',
  entries: [
    { time: '08:10', writtenOn: null, text: 'Walked 30 minutes' },
    { time: '23:49', writtenOn: '2026-11-08', text: 'Yesterday I swam 20 laps at the pool' },
  ],
  categories: [],
  totalMinutes: null,
  tasksDone: [],
  rolledOver: 0,
  tags: [],
  frictionTags: [],
};

describe('daily brief prompt', () => {
  it('says an entry time is when it was written, not when it happened (audit bug 3)', () => {
    const prompt = buildPrompt(facts);

    expect(prompt).toContain('- (written at 08:10) Walked 30 minutes');
    expect(prompt).toContain(
      '- (written on 2026-11-08 at 23:49, about this day) Yesterday I swam 20 laps at the pool',
    );
    expect(SYSTEM).toContain('not when it happened');
  });
});
