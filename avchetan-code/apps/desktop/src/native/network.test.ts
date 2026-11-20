import { describe, expect, it } from 'vitest';
import { createHubNetwork } from './network';

const answer = (tailscaleAddress: string | null) => async () => ({
  networks: [{ name: 'Home', category: 'Private' }],
  rule: true,
  tailscaleRule: true,
  tailscaleAddress,
});

describe('hub network status', () => {
  it('keeps a Tailscale address', async () => {
    const status = await createHubNetwork(answer('100.95.1.2')).status(8787);
    expect(status.tailscaleAddress).toBe('100.95.1.2');
  });

  it('reads a stopped Tailscale (169.254.x.x on its adapter) as not running', async () => {
    const status = await createHubNetwork(answer('169.254.83.107')).status(8787);
    expect(status.tailscaleAddress).toBeNull();
  });
});
