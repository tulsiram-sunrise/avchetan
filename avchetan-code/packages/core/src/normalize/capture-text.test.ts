import { describe, expect, it } from 'vitest';
import { parseCaptureText } from './capture-text';

describe('parseCaptureText', () => {
  it.each<[string, string[]]>([
    ['Ran 5k #running', ['running']],
    ['#running at the park', ['running']],
    ['Knee hurt #health/knee, iced it #Recovery.', ['health/knee', 'recovery']],
    ['(#deep-work) on the API', ['deep-work']],
    ['#Injuries and #injury again', ['injury']],
    ['#5k-run done', ['5k-run']],
    ['सुबह की सैर #योग', ['योग']],
    // not tags
    ['Learning C# today', []],
    ['See https://example.com/#top', []],
    ['Fixed bug #123 and #2026', []],
    ['# Heading-like text', []],
    ['email me at a#b', []],
  ])('%s', (content, tags) => {
    expect(parseCaptureText(content).tagPaths).toEqual(tags);
  });

  it.each<[string, boolean]>([
    ['Therapy session notes !private', true],
    ['!PRIVATE: talked about family', true],
    ['!private', true],
    ['Feeling great!private', false],
    ['!privately', false],
    ['nothing secret here', false],
  ])('%s → private=%s', (content, isPrivate) => {
    expect(parseCaptureText(content).isPrivate).toBe(isPrivate);
  });
});
