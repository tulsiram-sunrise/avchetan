import { describe, expect, it } from 'vitest';
import { pairingUrls } from './pairing';

const nic = (address: string, internal = false) => ({
  address,
  netmask: '255.255.255.0',
  family: 'IPv4' as const,
  mac: '00:00:00:00:00:00',
  internal,
  cidr: `${address}/24`,
});

describe('pairingUrls', () => {
  it('lists home addresses first and Tailscale last, without virtual adapters', () => {
    const urls = pairingUrls({
      port: 8787,
      bindHost: '0.0.0.0',
      interfaces: {
        Tailscale: [nic('100.101.102.103')],
        'Wi-Fi': [nic('192.168.1.5')],
        'vEthernet (WSL (Hyper-V firewall))': [nic('172.21.112.1')],
        'Loopback Pseudo-Interface 1': [nic('127.0.0.1', true)],
        'Ethernet 2': [nic('192.168.56.1')],
        Cellular: [nic('49.36.1.2')],
      },
    });

    expect(urls).toEqual([
      'http://192.168.1.5:8787',
      'http://192.168.56.1:8787',
      'http://100.101.102.103:8787',
    ]);
  });

  it('gives only the bound address when the server listens on one', () => {
    expect(pairingUrls({ port: 9000, bindHost: '192.168.1.5' })).toEqual([
      'http://192.168.1.5:9000',
    ]);
  });

  it('uses the configured addresses instead of guessing', () => {
    expect(
      pairingUrls({ port: 8787, bindHost: '0.0.0.0', configured: ['https://hub.example.org'] }),
    ).toEqual(['https://hub.example.org']);
  });
});
