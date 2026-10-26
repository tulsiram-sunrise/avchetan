import { describe, expect, it } from 'vitest';
import { normalizeTagPath, singularize } from './tags';

describe('singularize', () => {
  it.each([
    ['injuries', 'injury'],
    ['berries', 'berry'],
    ['lunches', 'lunch'],
    ['boxes', 'box'],
    ['classes', 'class'],
    ['meals', 'meal'],
    ['workouts', 'workout'],
    ['videos', 'video'],
    ['photos', 'photo'],
    ['chaos', 'chaos'],
    // not plurals / invariant
    ['fitness', 'fitness'],
    ['stress', 'stress'],
    ['focus', 'focus'],
    ['analysis', 'analysis'],
    ['news', 'news'],
    ['biceps', 'biceps'],
    ['abs', 'abs'],
    ['gas', 'gas'],
    ['run', 'run'],
  ])('%s → %s', (word, expected) => {
    expect(singularize(word)).toBe(expected);
  });

  it('leaves non-ASCII words alone', () => {
    expect(singularize('योग')).toBe('योग');
  });
});

describe('normalizeTagPath', () => {
  it.each([
    ['Shoulder Pains', 'shoulder-pain'],
    ['#Injuries'.slice(1), 'injury'],
    ['Health/Injuries/Shoulder', 'health/injury/shoulder'],
    ['high-protein-meals', 'high-protein-meal'],
    ['Work-Out', 'workout'],
    ['DeepWork', 'deep-work'],
    ['deep_work', 'deep-work'],
    ['/health//knee/', 'health/knee'],
    ['सुबह की सैर', 'सुबह-की-सैर'],
    ['!!!', ''],
  ])('%s → %s', (input, expected) => {
    expect(normalizeTagPath(input)).toBe(expected);
  });
});
