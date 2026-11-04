import type { ClientStore } from '@avchetan/db/sqlite';
import {
  type CheckRow,
  formatAgo,
  formatMinutes,
  type HttpFetch,
  type ModelCheck,
  type SecretStore,
  toAppError,
} from '@avchetan/shared';
import { createApiClient, fetchHealth } from './api-client';
import { loadServerUrls, SYNC_TOKEN_SECRET } from './config';
import type { StatusResponse } from './protocol';
import { loadSyncStatus } from './status';

/** Well inside the server's limit (MAX_CLOCK_SKEW_MS), leaving room for the request's own time. */
export const CLOCK_WARNING_MS = 2 * 60_000;

export type ConnectionCheckDeps = {
  store: ClientStore;
  fetch: HttpFetch;
  secrets: Pick<SecretStore, 'get'>;
  /** The wall clock, not the store's monotonic one, which hides a clock set back. */
  nowMs?: () => number;
};

export type ConnectionCheck =
  | { configured: false }
  | {
      configured: true;
      addresses: { url: string; reachable: boolean }[];
      /** `null` when no address answered, so the token couldn't be tried. */
      token: 'accepted' | 'refused' | 'missing' | null;
      /** Server time minus this device's time, measured at the middle of the request. */
      clockOffsetMs: number | null;
      server: StatusResponse | null;
      /** The server sent something this check didn't expect. */
      error: string | null;
      lastSyncedAt: string | null;
      /** Changes the server keeps refusing (status.ts). */
      stuck: number;
    };

/** Tries every saved address, the token, and the clock, as the Setup check shows them. */
export async function checkConnection(deps: ConnectionCheckDeps): Promise<ConnectionCheck> {
  const { store, fetch } = deps;
  const nowMs = deps.nowMs ?? Date.now;
  const urls = await loadServerUrls(store);
  if (urls.length === 0) return { configured: false };

  const token = await deps.secrets.get(SYNC_TOKEN_SECRET);
  const addresses = await Promise.all(
    urls.map(async (url) => {
      try {
        await fetchHealth(fetch, url);
        return { url, reachable: true };
      } catch {
        return { url, reachable: false };
      }
    }),
  );
  const [status, lastSyncedAt] = await Promise.all([
    loadSyncStatus(store),
    store.sync.getState('last_pull_at'),
  ]);
  const result = {
    configured: true as const,
    addresses,
    token: null as 'accepted' | 'refused' | 'missing' | null,
    clockOffsetMs: null as number | null,
    server: null as StatusResponse | null,
    error: null as string | null,
    lastSyncedAt: lastSyncedAt || null,
    stuck: status.stuck,
  };
  const baseUrl = addresses.find((a) => a.reachable)?.url;
  if (!baseUrl) return result;
  if (!token) return { ...result, token: 'missing' };

  const api = createApiClient({ fetch, baseUrl, token, deviceId: store.deviceId });
  const sentAt = nowMs();
  try {
    const server = await api.status();
    const receivedAt = nowMs();
    const offset = Date.parse(server.serverTime) - (sentAt + receivedAt) / 2;
    return { ...result, token: 'accepted', server, clockOffsetMs: Math.round(offset) };
  } catch (error) {
    const code = toAppError(error).code;
    if (code === 'unauthorized') return { ...result, token: 'refused' };
    return { ...result, error: code };
  }
}

const JOB_NAME: Record<ModelCheck['job'], string> = {
  organizing: 'organizes entries',
  answers: 'answers questions',
  search: 'searches by meaning',
};

function hubModelRow(check: ModelCheck): CheckRow {
  const id = `hub-ai-${check.job}`;
  const what = `The hub ${JOB_NAME[check.job]} with ${check.model}`;
  switch (check.readiness) {
    case 'ready':
    case 'configured':
      return { id, state: 'ok', title: what };
    case 'ollama_not_running':
      return {
        id,
        state: 'problem',
        title: "Ollama isn't running on the hub's PC",
        detail: `${what}, so that waits until Ollama runs again. Open Ollama on that PC.`,
        helpCode: 'ollama_not_running',
      };
    case 'model_missing':
      return {
        id,
        state: 'problem',
        title: `The hub's PC hasn't downloaded ${check.model}`,
        detail: 'Open Avchetan on that PC, then Settings → Home Hub on this PC → Download them.',
        helpCode: 'model_missing',
      };
    case 'no_api_key':
      return {
        id,
        state: 'problem',
        title: `The hub has no API key for ${check.provider}`,
        detail: `${what}. Add the key where the server is set up.`,
        helpCode: 'llm_auth',
      };
  }
}

/** The hub's own models, as a phone can't ask Ollama on the PC itself. */
export function hubModelRows(checks: readonly ModelCheck[]): CheckRow[] {
  return checks.map(hubModelRow);
}

/** The rows for a connection check. `device` names this device in the text ("this phone"). */
export function connectionRows(
  check: ConnectionCheck,
  options: { device: string; nowMs?: number },
): CheckRow[] {
  const nowMs = options.nowMs ?? Date.now();
  if (!check.configured) {
    return [
      {
        id: 'connection',
        state: 'info',
        title: 'Not connected to a hub or server',
        detail: `Everything stays on ${options.device}. Connect one to sync your devices.`,
        action: 'sync_settings',
      },
    ];
  }

  const rows: CheckRow[] = [];
  const reached = check.addresses.filter((a) => a.reachable);
  if (reached.length === 0) {
    rows.push({
      id: 'reachable',
      state: 'problem',
      title: "Can't reach your hub or server",
      detail: `Tried ${check.addresses.map((a) => a.url).join(', ')}. For a hub: is the PC on with Avchetan open, and is ${options.device} on the same Wi-Fi or on Tailscale?`,
      helpCode: 'server_unreachable',
    });
  } else {
    rows.push({ id: 'reachable', state: 'ok', title: `Reaches ${reached[0]?.url}` });
    const others = check.addresses.filter((a) => !a.reachable);
    if (others.length > 0) {
      rows.push({
        id: 'reachable-others',
        state: 'info',
        title: `Not reachable right now: ${others.map((a) => a.url).join(', ')}`,
        detail: 'Normal for an address used only at home or only away from home.',
      });
    }
  }

  switch (check.token) {
    case 'accepted':
      rows.push({ id: 'token', state: 'ok', title: 'The server accepts this device' });
      break;
    case 'refused':
      rows.push({
        id: 'token',
        state: 'problem',
        title: 'The server refused this sync token',
        detail:
          'The token was changed on the hub. Pair this device again, or paste the new token in Sync.',
        helpCode: 'unauthorized',
        action: 'pair',
      });
      break;
    case 'missing':
      rows.push({
        id: 'token',
        state: 'problem',
        title: 'No sync token is saved on this device',
        detail: 'Pair this device again, or paste the token in Sync.',
        helpCode: 'unauthorized',
        action: 'pair',
      });
      break;
    case null:
      break;
  }

  if (check.error) {
    rows.push({
      id: 'server-error',
      state: 'problem',
      title: 'The server answered with an error',
      detail: `Code: ${check.error}. Check that both devices run the same version of Avchetan.`,
      helpCode: 'server_unreachable',
    });
  }

  if (check.clockOffsetMs !== null) {
    rows.push(
      Math.abs(check.clockOffsetMs) > CLOCK_WARNING_MS
        ? {
            id: 'clock',
            state: 'problem',
            title: `This device's clock is ${formatMinutes(check.clockOffsetMs)} ${check.clockOffsetMs > 0 ? 'behind' : 'ahead of'} the server's`,
            detail: 'Turn on automatic date and time in the device settings.',
            helpCode: 'clock_skew',
            action: 'date_settings',
          }
        : { id: 'clock', state: 'ok', title: "This device's clock matches the server's" },
    );
  }

  if (check.stuck > 0) {
    rows.push({
      id: 'stuck',
      state: 'problem',
      title: `${check.stuck} changes keep failing to sync`,
      detail: 'Nothing is lost; they wait on this device.',
      helpCode: 'sync_issue',
    });
  }

  if (check.server) {
    if (check.server.logs.failed > 0) {
      rows.push({
        id: 'hub-failed',
        state: 'info',
        title: `${check.server.logs.failed} entries couldn't be organized`,
        detail: 'Open Review to see why for each one.',
      });
    }
    rows.push(...hubModelRows(check.server.ai ?? []));
  }

  if (check.lastSyncedAt) {
    rows.push({
      id: 'last-synced',
      state: 'info',
      title: `Last synced ${formatAgo(check.lastSyncedAt, nowMs)}`,
    });
  }
  return rows;
}

/** Error codes the Setup check can explain, so the apps link it beside them. */
const CONNECTION_ERROR_CODES: ReadonlySet<string> = new Set([
  'server_unreachable',
  'unauthorized',
  'clock_skew',
  'not_configured',
  'wrong_server',
  'server_error',
  'bad_response',
]);

export function isConnectionError(code: string): boolean {
  return CONNECTION_ERROR_CODES.has(code);
}
