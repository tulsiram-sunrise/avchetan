import { openTestStore } from '@avchetan/db/testing';
import { describe, expect, it } from 'vitest';
import { buildCaptureInput } from './capture';

describe('buildCaptureInput', () => {
  it('captures verbatim text with normalized explicit tags and privacy', async () => {
    const { store } = await openTestStore();
    const text = 'Session with my therapist #Health/Sessions !private';
    const log = await store.write((tx) =>
      store.repos.rawLogs.capture(
        tx,
        buildCaptureInput(text, { source: 'desktop_text', capturedTz: 'Asia/Kolkata' }),
      ),
    );
    expect(log.content).toBe(text);
    expect(log.privacy).toBe('local_only');
    const tags = await store.repos.tags.forTarget(store.db, 'raw_log', log.id);
    expect(tags.map((t) => [t.path, t.isInferred])).toEqual([['health/session', false]]);
  });

  it('defaults to normal privacy and no tags', () => {
    expect(
      buildCaptureInput('Walked 30 minutes', { source: 'mobile_text', capturedTz: 'UTC' }),
    ).toEqual({
      content: 'Walked 30 minutes',
      source: 'mobile_text',
      capturedTz: 'UTC',
      privacy: 'normal',
      explicitTagPaths: [],
    });
  });
});
