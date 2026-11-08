import { LLM_PROVIDERS } from '@avchetan/core';
import { z } from 'zod';
import { callNative, type Invoke } from './ipc';

const modelSlotSchema = z.object({ provider: z.enum(LLM_PROVIDERS), model: z.string().min(1) });

export const hubConfigSchema = z.object({
  enabled: z.boolean(),
  port: z.number().int().min(1024).max(65_535),
  extraction: modelSlotSchema.nullable(),
  analysis: modelSlotSchema.nullable(),
  embedding: modelSlotSchema.nullable(),
});
export type HubConfig = z.infer<typeof hubConfigSchema>;

const hubStatusSchema = z.object({
  phase: z.enum(['off', 'starting', 'running', 'restarting', 'failed']),
  config: hubConfigSchema,
  dataFolder: z.string(),
  /** The data folder already holds a hub's database. */
  hasData: z.boolean(),
  restarts: z.number().int().nonnegative(),
  /** Why it stopped trying, as an error code (docs/user-guide/troubleshooting.md). */
  error: z.string().nullable(),
  logs: z.array(z.string()),
});
export type HubStatus = z.infer<typeof hubStatusSchema>;

const hubBackupsSchema = z.array(
  z.object({ name: z.string(), sizeBytes: z.number().int().nonnegative() }),
);

/** The built-in Home Hub process (src-tauri/src/commands/hub.rs, ADR-0024). */
export function createHub(invoke: Invoke) {
  return {
    status: () => callNative(invoke, 'hub_status', {}, hubStatusSchema),
    /** Saves the hub's settings and starts, restarts or stops it to match. */
    configure: (config: HubConfig) =>
      callNative(invoke, 'hub_configure', { config }, hubStatusSchema),
    /** Copies another hub's `pglite-data` folder in. Only while the hub is off and empty. */
    importData: (source: string) =>
      callNative(invoke, 'hub_import_data', { source }, hubStatusSchema),
    /** The hub's daily snapshots, newest first. */
    listBackups: () => callNative(invoke, 'hub_backup_list', {}, hubBackupsSchema),
    /** Puts a snapshot back, keeping the current data beside it, and starts the hub again. */
    restore: (name: string) => callNative(invoke, 'hub_restore', { name }, hubStatusSchema),
    /** The first port from `from` up that nothing listens on. */
    freePort: (from: number) => callNative(invoke, 'hub_free_port', { from }, z.number().int()),
    openFolder: (folder: 'data' | 'backups') =>
      callNative(invoke, 'hub_folder_open', { folder }, z.null()),
  };
}

export type Hub = ReturnType<typeof createHub>;
