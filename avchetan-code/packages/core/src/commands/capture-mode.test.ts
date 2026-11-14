import { describe, expect, it } from 'vitest';
import { captureMode } from './capture-mode';

describe('captureMode', () => {
  it('is an entry for plain text, and when empty', () => {
    expect(captureMode('')).toBe('entry');
    expect(captureMode('Ran 5 km #running')).toBe('entry');
    // `//note` saves an entry starting with `/`.
    expect(captureMode('//etc/hosts changed')).toBe('entry');
  });

  it('is private with !private or a private tag, nested ones too', () => {
    expect(captureMode('Doctor visit !private')).toBe('private');
    expect(captureMode('Knee again #health/knee', ['health'])).toBe('private');
    expect(captureMode('Knee again #healthy', ['health'])).toBe('entry');
    expect(captureMode('Knee again #health/knee')).toBe('entry');
  });

  it('asks, runs commands and finds by the first character', () => {
    expect(captureMode('?how far did I run')).toBe('ask');
    expect(captureMode('  ? week')).toBe('ask');
    expect(captureMode('/')).toBe('command');
    expect(captureMode('/done buy milk')).toBe('command');
    expect(captureMode('/find dentist')).toBe('find');
    expect(captureMode('/FIND')).toBe('find');
    expect(captureMode('/finder')).toBe('command');
  });
});
