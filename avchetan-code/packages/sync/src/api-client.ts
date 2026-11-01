import { type HttpFetch, SyncError } from '@avchetan/shared';
import type { z } from 'zod';
import {
  errorResponseSchema,
  HEADERS,
  type HealthResponse,
  healthResponseSchema,
  PROTOCOL_VERSION,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  pullResponseSchema,
  pushResponseSchema,
  type RegisterDeviceRequest,
  registerDeviceResponseSchema,
} from './protocol';

const TIMEOUT_MS = 30_000;
/** `/v1/health` decides which address to use, so a dead one has to fail fast. */
const HEALTH_TIMEOUT_MS = 4_000;

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
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
