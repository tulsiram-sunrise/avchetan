import { describe, expect, it } from 'vitest';
import { assertSafeServerUrl } from './config';
import { describeSync } from './status';

describe('assertSafeServerUrl', () => {
  it.each([
    'https://sync.example.org',
    'http://localhost:8787',
    'http://127.0.0.1:8787',
    'http://100.64.0.1:8787',
    'http://100.127.255.1:8787',
    'http://my-pc.tailnet.ts.net:8787',
  ])('allows %s', (url) => {
    expect(() => assertSafeServerUrl(url, false)).not.toThrow();
  });

  it.each(['http://192.168.1.20:8787', 'http://10.0.0.5:8787', 'http://172.16.0.5:8787'])(
    'allows %s only on a trusted home network',
    (url) => {
      expect(() => assertSafeServerUrl(url, false)).toThrowError(/Trust this home network/);
      expect(() => assertSafeServerUrl(url, true)).not.toThrow();
    },
  );

  it.each([
    'http://sync.example.org',
    'http://8.8.8.8:8787',
    'http://100.128.0.1:8787',
    'http://172.32.0.1:8787',
    'ftp://192.168.1.20',
  ])('refuses %s, even on a trusted network', (url) => {
    expect(() => assertSafeServerUrl(url, true)).toThrowError(/https/);
  });
});

describe('describeSync', () => {
  const ok = { state: 'synced', clockSkew: false, stuck: 0 } as const;

  it('says all is well', () => {
    expect(describeSync(ok)).toEqual({ text: 'Up to date.', helpCode: null });
  });

  it('puts what the user can fix first', () => {
    expect(describeSync({ ...ok, stuck: 2 }).helpCode).toBe('sync_issue');
    expect(describeSync({ ...ok, stuck: 2, clockSkew: true }).helpCode).toBe('clock_skew');
  });
});
