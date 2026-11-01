import type { LogLevel } from '@avchetan/shared';
import { z } from 'zod';

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const satisfies readonly LogLevel[];

const envSchema = z
  .object({
    DB_DRIVER: z.enum(['postgres', 'pglite']).default('postgres'),
    DATABASE_URL: z.string().min(1).optional(),
    PGLITE_DATA_DIR: z.string().min(1).default('./pglite-data'),
    SERVER_PROFILE: z.enum(['cloud', 'hub']).default('cloud'),
    SYNC_TOKEN: z.string().min(32).optional(),
    PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
    BIND_HOST: z.string().min(1).default('0.0.0.0'),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  })
  .refine((env) => env.DB_DRIVER === 'pglite' || env.DATABASE_URL, {
    path: ['DATABASE_URL'],
    message: 'DATABASE_URL is required when DB_DRIVER is postgres',
  });

export type ServerEnv = z.infer<typeof envSchema>;

/** Empty values count as unset, so `.env.example` can be copied as it is. */
export function loadEnv(source: Record<string, string | undefined>): ServerEnv {
  const set = Object.entries(source).filter(([, value]) => value !== '');
  return envSchema.parse(Object.fromEntries(set));
}
