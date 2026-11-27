import { describe, expect, it } from 'vitest';
import { keptOnReorganize } from './kept-edits';

const extracted = { origin: 'extraction', isUserEdited: false };
const edited = { origin: 'extraction', isUserEdited: true };
const added = { origin: 'user', isUserEdited: false };

describe('keptOnReorganize', () => {
  it('says nothing when organizing again may change everything', () => {
    expect(keptOnReorganize({ activities: [extracted], tasks: [extracted] })).toBeNull();
    expect(keptOnReorganize({ activities: [], tasks: [] })).toBeNull();
  });

  it('names one edited activity', () => {
    expect(keptOnReorganize({ activities: [edited, extracted], tasks: [] })).toBe(
      'Organize again keeps what you edited or added (1 activity). Change it by hand.',
    );
  });

  it('counts edited and hand-added items of both kinds', () => {
    expect(keptOnReorganize({ activities: [edited, added], tasks: [added, extracted] })).toBe(
      'Organize again keeps what you edited or added (2 activities, 1 task). Change them by hand.',
    );
  });
});
