import { networkInterfaces } from 'node:os';

/** Adapters for virtual machines and containers, which a phone can never reach. */
const VIRTUAL = /vethernet|wsl|docker|hyper-v|virtualbox|vmware|vboxnet|br-|veth|loopback/i;

const isTailscale = (address: string) => {
  const [first, second] = address.split('.').map(Number) as [number, number];
  return first === 100 && second >= 64 && second <= 127;
};

const isPrivate = (address: string) => {
  const [first, second] = address.split('.').map(Number) as [number, number];
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
};

type Interfaces = ReturnType<typeof networkInterfaces>;

/**
 * Addresses a phone could use to reach this server: home network first, Tailscale last. The
 * phone tests each one when it pairs and keeps those that answer, so a stray adapter only costs
 * it a moment. `configured` (PAIRING_URLS) replaces the guess, e.g. for a hub in a container.
 */
export function pairingUrls(options: {
  port: number;
  bindHost: string;
  configured?: readonly string[] | undefined;
  interfaces?: Interfaces;
}): string[] {
  if (options.configured && options.configured.length > 0) return [...options.configured];
  // Listening on one address only: that is the only one that works.
  if (options.bindHost !== '0.0.0.0' && options.bindHost !== '::') {
    return [`http://${options.bindHost}:${options.port}`];
  }
  const home: string[] = [];
  const away: string[] = [];
  for (const [name, addresses] of Object.entries(options.interfaces ?? networkInterfaces())) {
    if (VIRTUAL.test(name)) continue;
    for (const { family, address, internal } of addresses ?? []) {
      if (family !== 'IPv4' || internal) continue;
      const url = `http://${address}:${options.port}`;
      if (isTailscale(address)) away.push(url);
      else if (isPrivate(address)) home.push(url);
    }
  }
  return [...home, ...away];
}
