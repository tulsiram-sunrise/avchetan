import { describe, expect, it } from 'vitest';
import { ipv4Parts, isOnThisDevice, isPrivateNetwork, isTailscale } from './network';

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

  it('takes only real four-number IPv4 addresses as private or Tailscale', () => {
    for (const host of [
      '100.100.example.com',
      '100.100',
      '100.100.1',
      '100.100.1.1.example.com',
      '100.100.1.256',
      '100.100.1.1 ',
      'ts.net.example.com',
    ]) {
      expect(isTailscale(host), host).toBe(false);
    }
    for (const host of ['10.0.0.5.example.com', '192.168.evil.com', '10.0.0', '10.0.0.999']) {
      expect(isPrivateNetwork(host), host).toBe(false);
    }
  });

  it('reads the four numbers of an IPv4 address', () => {
    expect(ipv4Parts('192.168.1.20')).toEqual([192, 168, 1, 20]);
    expect(ipv4Parts('1.2.3')).toBeNull();
    expect(ipv4Parts('a.b.c.d')).toBeNull();
  });
});
