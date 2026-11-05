import { describe, expect, it } from 'vitest';
import { isOnThisDevice, isPrivateNetwork, isTailscale } from './network';

describe('network hosts', () => {
  it('knows this device', () => {
    expect(isOnThisDevice('localhost')).toBe(true);
    expect(isOnThisDevice('127.0.0.1')).toBe(true);
    expect(isOnThisDevice('example.com')).toBe(false);
  });

  it('knows Tailscale addresses', () => {
    expect(isTailscale('100.64.0.1')).toBe(true);
    expect(isTailscale('100.127.255.1')).toBe(true);
    expect(isTailscale('100.128.0.1')).toBe(false);
    expect(isTailscale('my-pc.tail1234.ts.net')).toBe(true);
  });

  it('knows private networks', () => {
    expect(isPrivateNetwork('192.168.1.20')).toBe(true);
    expect(isPrivateNetwork('10.0.0.5')).toBe(true);
    expect(isPrivateNetwork('172.16.0.1')).toBe(true);
    expect(isPrivateNetwork('172.32.0.1')).toBe(false);
    expect(isPrivateNetwork('8.8.8.8')).toBe(false);
  });
});
