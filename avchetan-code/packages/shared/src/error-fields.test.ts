import { describe, expect, it } from 'vitest';
import { errorFields, thrownAt } from './error-fields';
import { AppError, LlmError, toAppError } from './errors';

function withStack(error: Error, ...frames: string[]): Error {
  error.stack = [`${error.name}: ${error.message}`, ...frames.map((f) => `    at ${f}`)].join('\n');
  return error;
}

describe('thrownAt', () => {
  it('names the first frame in our own code, relative to the workspace', () => {
    const error = withStack(
      new Error('x'),
      'parse (D:\\Users\\made-up-name\\avchetan\\node_modules\\zod\\lib\\index.js:10:3)',
      'socketAddress (D:\\Users\\made-up-name\\code\\avchetan-code\\apps\\server\\src\\app.ts:42:11)',
      'async handle (/home/made-up-name/avchetan-code/packages/sync/src/engine.ts:7:1)',
    );

    expect(thrownAt(error)).toBe('socketAddress (apps/server/src/app.ts:42:11)');
  });

  it('keeps no folder above the code, so no user name', () => {
    const at = thrownAt(
      withStack(new Error('x'), 'run (file:///C:/Users/made-up-name/x/packages/core/src/a.ts:3:4)'),
    );
    expect(at).toBe('run (packages/core/src/a.ts:3:4)');
  });

  it('gives a bundle its file name only, without the origin or query', () => {
    expect(
      thrownAt(
        withStack(new Error('x'), 'Fe (http://tauri.localhost/assets/index-AbC12.js:1:52817)'),
      ),
    ).toBe('Fe (index-AbC12.js:1:52817)');
    expect(thrownAt(withStack(new Error('x'), 'http://localhost:1420/src/main.ts?t=123:4:2'))).toBe(
      'main.ts:4:2',
    );
    expect(thrownAt(withStack(new Error('x'), 'g (address at index.android.bundle:1:9)'))).toBe(
      'g (index.android.bundle:1:9)',
    );
  });

  it('names the library when the failure is all inside one', () => {
    const error = withStack(
      new Error('x'),
      'fetch (C:/Users/made-up-name/a/node_modules/@tauri-apps/plugin-http/dist-js/index.js:9:1)',
    );
    expect(thrownAt(error)).toBe('fetch (@tauri-apps/plugin-http:9:1)');
  });

  it('says nothing for a value that has no stack', () => {
    expect(thrownAt('a string')).toBeUndefined();
    expect(thrownAt(Object.assign(new Error('x'), { stack: undefined }))).toBeUndefined();
  });

  it('reads a real stack from this test file', () => {
    expect(thrownAt(new Error('x'))).toMatch(
      /^.*packages\/shared\/src\/error-fields\.test\.ts:\d+:\d+\)?$/,
    );
  });
});

describe('errorFields', () => {
  const secret = 'Felt anxious about the made-up meeting';

  it('never includes the message, however the error was made', () => {
    for (const error of [
      new Error(secret),
      new SyntaxError(`Unexpected token in "${secret}"`),
      toAppError(new Error(secret)),
      new AppError('validation', secret),
      secret,
    ]) {
      expect(JSON.stringify(errorFields(error))).not.toContain('made-up meeting');
    }
  });

  it('gives an unexpected error the code internal and its own kind and place', () => {
    const cause = withStack(new TypeError('x'), 'f (/a/avchetan-code/packages/db/src/b.ts:5:6)');

    expect(errorFields(toAppError(cause))).toEqual({
      code: 'internal',
      error: 'TypeError',
      at: 'f (packages/db/src/b.ts:5:6)',
    });
  });

  it('keeps an app error’s code and details', () => {
    const error = new LlmError('llm_unavailable', 'x', { details: { status: 503 } });

    expect(errorFields(error)).toMatchObject({
      code: 'llm_unavailable',
      error: 'LlmError',
      details: { status: 503 },
    });
  });

  it('keeps the system error code Node gives', () => {
    const error = Object.assign(new Error('listen EADDRINUSE: address already in use'), {
      code: 'EADDRINUSE',
    });

    expect(errorFields(error)).toMatchObject({ code: 'internal', systemCode: 'EADDRINUSE' });
  });

  it('says what was thrown when it was not an error', () => {
    expect(errorFields('text')).toEqual({ code: 'internal', error: 'string' });
  });
});
