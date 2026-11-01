import { DEVICE_PLATFORMS, EXTRACTION_MODES } from '@avchetan/db';
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
  protocol: z.int(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

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
