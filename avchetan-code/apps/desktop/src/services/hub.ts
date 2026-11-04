import type { ModelPreset } from '@avchetan/core';
import type { ClientStore } from '@avchetan/db/sqlite';
import type { SecretName, SecretStore } from '@avchetan/shared';
import { SYNC_TOKEN_SECRET, saveConnection } from '@avchetan/sync';
import type { Hub, HubConfig, HubStatus } from '../native/hub';

/** Read by Rust and handed to the hub process (src-tauri/src/commands/hub.rs). */
export const HUB_TOKEN_SECRET: SecretName = 'hub:server:token';
export const DEFAULT_HUB_PORT = 8787;

export const hubUrl = (port: number) => `http://127.0.0.1:${port}`;

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

export function hubModels(preset: ModelPreset): Omit<HubConfig, 'enabled' | 'port'> {
  const slot = (model: string | undefined) => (model ? { provider: preset.provider, model } : null);
  return {
    extraction: slot(preset.extractionModel),
    analysis: slot(preset.analysisModel),
    embedding: slot(preset.embeddingModel),
  };
}

type HubDeps = { hub: Hub; secrets: SecretStore; store: ClientStore };

/**
 * Turns on the hub inside this app and points this PC's own sync at it. Data moved over from
 * another hub already knows the token this PC syncs with, so it keeps that token, and the
 * phones paired with that hub keep syncing.
 */
export async function turnOnHub(
  { hub, secrets, store }: HubDeps,
  options: { preset: ModelPreset; importFrom?: string; port?: number },
): Promise<HubStatus> {
  if (options.importFrom) await hub.importData(options.importFrom);
  let token = await secrets.get(HUB_TOKEN_SECRET);
  if (!token) {
    token = (options.importFrom ? await secrets.get(SYNC_TOKEN_SECRET) : null) ?? newToken();
    await secrets.set(HUB_TOKEN_SECRET, token);
  }
  const port = options.port ?? DEFAULT_HUB_PORT;
  const status = await hub.configure({ enabled: true, port, ...hubModels(options.preset) });
  await saveConnection(store, secrets, { urls: [hubUrl(port)], token, trustLocalNetwork: false });
  return status;
}

/** This PC syncs with the hub it runs itself, and with nothing else. */
export function syncsWithOwnHub(status: HubStatus, urls: readonly string[]): boolean {
  return status.phase !== 'off' && urls.length === 1 && urls[0] === hubUrl(status.config.port);
}

/**
 * A new token for the hub this app runs. The hub gets its token at start, so it can't change
 * it itself (`token_from_env`): the app saves a new one and restarts it.
 */
export async function changeOwnHubToken({
  hub,
  secrets,
}: Omit<HubDeps, 'store'>): Promise<HubStatus> {
  const token = newToken();
  await secrets.set(HUB_TOKEN_SECRET, token);
  await secrets.set(SYNC_TOKEN_SECRET, token);
  const { config } = await hub.status();
  return hub.configure(config);
}

/** Stops the hub and keeps it off. This PC's sync still points at it, so sync waits. */
export async function turnOffHub(hub: Hub): Promise<HubStatus> {
  const { config } = await hub.status();
  return hub.configure({ ...config, enabled: false });
}
