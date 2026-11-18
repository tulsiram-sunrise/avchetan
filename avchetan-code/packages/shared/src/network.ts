/** Hosts where plain `http://` is acceptable, because the traffic never crosses the internet unprotected. */

export function isOnThisDevice(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1';
}

/**
 * The four numbers of a plain IPv4 address, or null for anything else. A name that starts with
 * numbers, such as `100.100.example.com` or `10.0.0.5.example.com`, is not an address.
 */
export function ipv4Parts(host: string): [number, number, number, number] | null {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return null;
  const parts = host.split('.').map(Number);
  if (parts.some((part) => part > 255)) return null;
  return parts as [number, number, number, number];
}

/** Tailscale traffic is already encrypted, so plain HTTP is safe there. */
export function isTailscale(host: string): boolean {
  if (host.endsWith('.ts.net')) return true;
  const parts = ipv4Parts(host);
  return parts !== null && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

/** 10/8, 172.16/12 and 192.168/16: a home or office network. */
export function isPrivateNetwork(host: string): boolean {
  const parts = ipv4Parts(host);
  if (!parts) return false;
  const [first, second] = parts;
  if (first === 10 || (first === 192 && second === 168)) return true;
  return first === 172 && second >= 16 && second <= 31;
}
