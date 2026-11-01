import { describe, expect, it } from 'vitest';
import { parseLastError } from './last-error';

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
