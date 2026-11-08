import { type HttpFetch, SyncError } from '@avchetan/shared';
import type { z } from 'zod';
import { readAnswer } from './ask-stream';
import {
  briefResponseSchema,
  commandResponseSchema,
  errorResponseSchema,
  HEADERS,
  type HealthResponse,
  type HubAskRequest,
  type HubAskResult,
  type HubBriefRequest,
  type HubBriefResponse,
  type HubCommandRequest,
  type HubCommandResponse,
  healthResponseSchema,
  type PairingResponse,
  PROTOCOL_VERSION,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  pairingResponseSchema,
  pullResponseSchema,
  pushResponseSchema,
  type RegisterDeviceRequest,
  registerDeviceResponseSchema,
  rotateTokenResponseSchema,
  type SearchRequest,
  type SearchResponse,
  type StatusResponse,
  searchResponseSchema,
  statusResponseSchema,
} from './protocol';

const TIMEOUT_MS = 30_000;
/** `/v1/health` decides which address to use, so a dead one has to fail fast. */
const HEALTH_TIMEOUT_MS = 4_000;
/** A local model on a processor may take minutes to answer. */
const ASK_TIMEOUT_MS = 300_000;
/** Ask waits on it, and falls back to searching by words. */
const SEARCH_TIMEOUT_MS = 10_000;

async function send<T extends z.ZodType>(
  fetch: HttpFetch,
  url: string,
  init: RequestInit,
  schema: T,
): Promise<z.output<T>> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new SyncError('server_unreachable', 'The server did not answer', { cause: error });
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const failure = errorResponseSchema.safeParse(body);
    throw new SyncError(
      failure.success ? failure.data.error.code : 'server_error',
      failure.success ? failure.data.error.message : 'The server sent an error',
      { details: { status: response.status } },
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new SyncError('bad_response', 'The server sent something unexpected', {
      details: { issues: parsed.error.issues.length },
    });
  }
  return parsed.data;
}

/** Needs no token: it picks an address and identifies the server. */
export function fetchHealth(fetch: HttpFetch, baseUrl: string): Promise<HealthResponse> {
  return send(
    fetch,
    `${baseUrl}/v1/health`,
    { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) },
    healthResponseSchema,
  );
}

export type ApiClientOptions = {
  fetch: HttpFetch;
  baseUrl: string;
  token: string;
  deviceId: string;
};

/** The only way apps reach the server (docs/conventions/api.md). */
export function createApiClient({ fetch, baseUrl, token, deviceId }: ApiClientOptions) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    [HEADERS.device]: deviceId,
    [HEADERS.protocol]: String(PROTOCOL_VERSION),
  };
  const options = () => ({ headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const post = (body: unknown) => ({
    ...options(),
    method: 'POST',
    body: JSON.stringify(body),
  });

  return {
    async register(device: Omit<RegisterDeviceRequest, 'deviceId'>): Promise<void> {
      await send(
        fetch,
        `${baseUrl}/v1/devices/register`,
        post({ ...device, deviceId }),
        registerDeviceResponseSchema,
      );
    },
    push(request: PushRequest): Promise<PushResponse> {
      return send(fetch, `${baseUrl}/v1/sync/push`, post(request), pushResponseSchema);
    },
    pull(cursor: number, limit?: number): Promise<PullResponse> {
      const query = new URLSearchParams({ cursor: String(cursor) });
      if (limit !== undefined) query.set('limit', String(limit));
      return send(fetch, `${baseUrl}/v1/sync/pull?${query}`, options(), pullResponseSchema);
    },
    search(request: SearchRequest): Promise<SearchResponse> {
      return send(
        fetch,
        `${baseUrl}/v1/search`,
        { ...post(request), signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) },
        searchResponseSchema,
      );
    },
    /** The hub answers with its own model, streamed as server-sent events. */
    async ask(request: HubAskRequest, onText: (text: string) => void): Promise<HubAskResult> {
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/v1/ask`, {
          ...post(request),
          signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
        });
      } catch (error) {
        throw new SyncError('server_unreachable', 'The hub did not answer', { cause: error });
      }
      return readAnswer(response, onText);
    },
    brief(request: HubBriefRequest): Promise<HubBriefResponse> {
      return send(
        fetch,
        `${baseUrl}/v1/brief`,
        { ...post(request), signal: AbortSignal.timeout(ASK_TIMEOUT_MS) },
        briefResponseSchema,
      );
    },
    command(request: HubCommandRequest): Promise<HubCommandResponse> {
      return send(
        fetch,
        `${baseUrl}/v1/command`,
        { ...post(request), signal: AbortSignal.timeout(ASK_TIMEOUT_MS) },
        commandResponseSchema,
      );
    },
    pairing(): Promise<PairingResponse> {
      return send(fetch, `${baseUrl}/v1/pairing`, options(), pairingResponseSchema);
    },
    async rotateToken(): Promise<string> {
      const { token } = await send(
        fetch,
        `${baseUrl}/v1/token/rotate`,
        post({}),
        rotateTokenResponseSchema,
      );
      return token;
    },
    status(): Promise<StatusResponse> {
      return send(fetch, `${baseUrl}/v1/status`, options(), statusResponseSchema);
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
