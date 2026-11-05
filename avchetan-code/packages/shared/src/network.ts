/** Hosts where plain `http://` is acceptable, because the traffic never crosses the internet unprotected. */

export function isOnThisDevice(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1';
}

/** Tailscale traffic is already encrypted, so plain HTTP is safe there. */
export function isTailscale(host: string): boolean {
  if (host.endsWith('.ts.net')) return true;
  const [first, second] = host.split('.').map(Number);
  return first === 100 && second !== undefined && second >= 64 && second <= 127;
}

/** 10/8, 172.16/12 and 192.168/16: a home or office network. */
export function isPrivateNetwork(host: string): boolean {
  const [first, second] = host.split('.').map(Number);
  if (first === 10 || (first === 192 && second === 168)) return true;
  return first === 172 && second !== undefined && second >= 16 && second <= 31;
}
