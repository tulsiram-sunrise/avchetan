import { describe, expect, it } from 'vitest';
import { describeError, helpSection, parseLastError } from './error-help';

describe('describeError', () => {
  it('replaces a developer message with the plain one, and names the guide section', () => {
    expect(
      describeError({ code: 'db_not_open', message: 'Database not opened for this window' }),
    ).toEqual({ message: 'Avchetan couldn’t open its database', section: 'database_unavailable' });
  });

  it('keeps a message already written for the user', () => {
    const message = 'The model could not be reached (HTTP 503)';
    expect(describeError({ code: 'llm_unavailable', message })).toEqual({
      message,
      section: 'llm_unavailable',
    });
  });

  it('sends unknown codes to Other errors', () => {
    expect(describeError({ code: 'something_new', message: 'Odd' })).toEqual({
      message: 'Odd',
      section: 'other_errors',
    });
  });

  it('needs no help page for input the user can correct', () => {
    expect(helpSection('invalid_title')).toBeNull();
  });

  it('does not treat object properties as codes', () => {
    expect(helpSection('constructor')).toBe('other_errors');
  });
});

describe('parseLastError', () => {
  it('splits the code from the message', () => {
    expect(parseLastError('llm_auth: The provider rejected the API key')).toEqual({
      code: 'llm_auth',
      message: 'The provider rejected the API key',
    });
  });

  it('keeps a colon inside the message', () => {
    expect(parseLastError('internal: failed: twice').message).toBe('failed: twice');
  });
});
