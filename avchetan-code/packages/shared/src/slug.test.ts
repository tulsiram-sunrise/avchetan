import { describe, expect, it } from 'vitest';
import { slugify, slugifyPath } from './slug';

describe('slugify', () => {
  it.each([
    ['Deep Work', 'deep-work'],
    ['  Shoulder   Pain!! ', 'shoulder-pain'],
    ['Café Run', 'cafe-run'],
    ['High_Protein/Lunch', 'high-protein-lunch'],
    ['योग', 'योग'],
    ['सुबह की सैर', 'सुबह-की-सैर'],
    ['5K run', '5k-run'],
    ['---', ''],
  ])('%s → %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});

describe('slugifyPath', () => {
  it('normalizes each segment and drops empty ones', () => {
    expect(slugifyPath('Health/Injuries/Shoulder Pain')).toBe('health/injuries/shoulder-pain');
    expect(slugifyPath('/health//knee/')).toBe('health/knee');
  });
});
