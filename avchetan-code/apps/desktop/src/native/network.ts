import { isTailscale } from '@avchetan/shared';
import { z } from 'zod';
import { callNative, type Invoke } from './ipc';

const hubNetworkSchema = z.object({
  /** The networks this PC is on now, Tailscale's own excluded. */
  networks: z.array(z.object({ name: z.string(), category: z.string() })),
  rule: z.boolean(),
  tailscaleRule: z.boolean(),
  /**
   * Only an address in Tailscale's range counts: a stopped or signed-out Tailscale leaves its
   * adapter with a 169.254.x.x address that phones can't reach.
   */
  tailscaleAddress: z
    .string()
    .nullable()
    .transform((address) => (address && isTailscale(address) ? address : null)),
});
export type HubNetwork = z.infer<typeof hubNetworkSchema>;

/** Firewall, network type and Tailscale for the hub (src-tauri/src/commands/network.rs). */
export function createHubNetwork(invoke: Invoke) {
  return {
    status: (port: number) => callNative(invoke, 'hub_network_status', { port }, hubNetworkSchema),
    /** Adds both firewall rules; Windows asks the user to approve. */
    allow: (port: number) => callNative(invoke, 'hub_network_allow', { port }, z.null()),
    openSettings: () => callNative(invoke, 'network_settings_open', {}, z.null()),
  };
}

export type HubNetworkControl = ReturnType<typeof createHubNetwork>;
