import { describe, expect, it } from 'vitest';
import { draftWithShared, MAX_SHARED_CHARS } from './share';

describe('draftWithShared', () => {
  it('puts a page title above its link', () => {
    expect(
      draftWithShared('', { text: 'https://example.org/bread', subject: 'Easy bread recipe' }),
    ).toBe('Easy bread recipe\nhttps://example.org/bread');
  });

  it('takes plain text as it is', () => {
    expect(draftWithShared('', { text: '  Call the plumber on Friday \n', subject: null })).toBe(
      'Call the plumber on Friday',
    );
  });

  it('does not repeat a subject the text already holds', () => {
    expect(
      draftWithShared('', {
        text: 'Easy bread recipe https://example.org/bread',
        subject: 'Easy bread recipe',
      }),
    ).toBe('Easy bread recipe https://example.org/bread');
  });

  it('keeps what was already typed, above the share', () => {
    expect(draftWithShared('read later:\n', { text: 'https://example.org', subject: '' })).toBe(
      'read later:\n\nhttps://example.org',
    );
  });

  it('cuts a very long share', () => {
    const draft = draftWithShared('', { text: 'a'.repeat(MAX_SHARED_CHARS + 50), subject: null });
    expect(draft).toHaveLength(MAX_SHARED_CHARS + 1);
    expect(draft.endsWith('…')).toBe(true);
  });
});
