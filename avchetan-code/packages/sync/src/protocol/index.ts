import { DEVICE_PLATFORMS, EXTRACTION_MODES } from '@avchetan/db';
import { modelCheckSchema } from '@avchetan/shared';
import { z } from 'zod';

export { isSyncedTable, SYNCED_ROW_SCHEMAS } from './rows';

/** Major version, sent as `X-Avchetan-Protocol`. The server answers others with 426. */
export const PROTOCOL_VERSION = 1;
export const MAX_PUSH_CHANGES = 500;
export const MAX_PUSH_BYTES = 2 * 1024 * 1024;
export const MAX_PULL_LIMIT = 500;
/** A pushed row may be this far ahead of the server's clock. */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;

export const HEADERS = {
  device: 'X-Avchetan-Device',
  protocol: 'X-Avchetan-Protocol',
  requestId: 'X-Request-Id',
} as const;

const instant = z.string();

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  serverId: z.uuid(),
  /** Changes when the server's data is restored or moved in. Older servers don't send it. */
  dataEpoch: z.uuid().optional(),
  protocol: z.int(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const SERVER_PROFILES = ['cloud', 'hub'] as const;
export type ServerProfile = (typeof SERVER_PROFILES)[number];

/**
 * What a settings screen shows about the server. Fields for the fallback extractor, embeddings
 * and job runs join with those workers; older apps ignore fields they don't know.
 */
export const statusResponseSchema = z.object({
  serverId: z.uuid(),
  version: z.string(),
  profile: z.enum(SERVER_PROFILES),
  serverTime: instant,
  devices: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      platform: z.enum(DEVICE_PLATFORMS),
      extractionMode: z.enum(EXTRACTION_MODES),
      lastSeenAt: instant.nullable(),
    }),
  ),
  /** Raw logs not deleted, by the status that needs attention. */
  logs: z.object({ waiting: z.int(), failed: z.int() }),
  /** The server's own models and whether each can be used. Older servers don't send it. */
  ai: z.array(modelCheckSchema).optional(),
});
export type StatusResponse = z.infer<typeof statusResponseSchema>;

export const registerDeviceRequestSchema = z.object({
  deviceId: z.uuid(),
  name: z.string().trim().min(1).max(100),
  platform: z.enum(DEVICE_PLATFORMS),
  extractionMode: z.enum(EXTRACTION_MODES).default('self'),
});
export type RegisterDeviceRequest = z.input<typeof registerDeviceRequestSchema>;

export const registerDeviceResponseSchema = z.object({
  deviceId: z.uuid(),
  serverTime: instant,
});

/** Tables and rows are checked one at a time, so one bad row can't sink the whole batch. */
export const pushRequestSchema = z.object({
  deviceId: z.uuid(),
  batchId: z.uuid(),
  changes: z.array(z.object({ table: z.string(), row: z.unknown() })).max(MAX_PUSH_CHANGES),
});
export type PushRequest = z.infer<typeof pushRequestSchema>;

export const PUSH_REJECTIONS = ['validation', 'clock_skew', 'unknown_table'] as const;
export type PushRejection = (typeof PUSH_REJECTIONS)[number];

export const pushResponseSchema = z.object({
  acked: z.array(z.object({ table: z.string(), id: z.string() })),
  rejected: z.array(
    z.object({
      table: z.string(),
      id: z.string(),
      code: z.enum(PUSH_REJECTIONS),
      message: z.string(),
    }),
  ),
  serverTime: instant,
});
export type PushResponse = z.infer<typeof pushResponseSchema>;

export const pullQuerySchema = z.object({
  cursor: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(MAX_PULL_LIMIT).default(MAX_PULL_LIMIT),
});

export const pullResponseSchema = z.object({
  changes: z.array(
    z.object({ table: z.string(), row: z.record(z.string(), z.unknown()), seq: z.int() }),
  ),
  nextCursor: z.int(),
  hasMore: z.boolean(),
});
export type PullResponse = z.infer<typeof pullResponseSchema>;

export const MAX_SEARCH_RESULTS = 15;

/** docs/architecture/retrieval.md#search-api. `from` and `to` bound `capturedAt`. */
export const searchRequestSchema = z.object({
  query: z.string().trim().min(1).max(500),
  from: instant.optional(),
  to: instant.optional(),
  limit: z.int().min(1).max(MAX_SEARCH_RESULTS).default(8),
});
export type SearchRequest = z.input<typeof searchRequestSchema>;

export const searchResponseSchema = z.object({
  results: z.array(
    z.object({
      rawLogId: z.uuid(),
      /** Cosine similarity: 1 is the same meaning. */
      score: z.number(),
      capturedAt: instant,
      snippet: z.string(),
    }),
  ),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

/** `POST /v1/ask`: the hub answers with its own model, from its own copy of the entries. */
export const askRequestSchema = z.object({
  question: z.string().trim().min(1).max(2_000),
  /** The asking device's IANA time zone, so "today" and "this week" mean its days. */
  timeZone: z.string().min(1).max(64),
});
export type HubAskRequest = z.input<typeof askRequestSchema>;

/** Sent as server-sent events, one JSON object per `data:` line. */
export const askEventSchema = z.discriminatedUnion('type', [
  /** The whole answer so far, citations already numbered. */
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('done'),
    answer: z.string(),
    /** The device reads these entries from its own database to show them. */
    sources: z.array(z.object({ number: z.int(), rawLogId: z.uuid() })),
  }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type AskEvent = z.infer<typeof askEventSchema>;
export type HubAskResult = Omit<Extract<AskEvent, { type: 'done' }>, 'type'>;

/** `GET /v1/pairing`: what the pairing QR code carries, besides the token. */
export const pairingResponseSchema = z.object({
  serverId: z.uuid(),
  /** Addresses a phone may reach this server at: home network first, Tailscale last. */
  urls: z.array(z.string()),
});
export type PairingResponse = z.infer<typeof pairingResponseSchema>;

/** `POST /v1/token/rotate`: the new token, shown once. Every other device pairs again. */
export const rotateTokenResponseSchema = z.object({ token: z.string().min(32) });
