import { LLM_PROVIDERS } from '@avchetan/core';
import type { LogLevel } from '@avchetan/shared';
import { SERVER_PROFILES } from '@avchetan/sync/protocol';
import { z } from 'zod';

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const satisfies readonly LogLevel[];

const flag = z
  .enum(['true', 'false'])
  .default('true')
  .transform((value) => value === 'true');

const envSchema = z
  .object({
    DB_DRIVER: z.enum(['postgres', 'pglite']).default('postgres'),
    DATABASE_URL: z.string().min(1).optional(),
    PGLITE_DATA_DIR: z.string().min(1).default('./pglite-data'),
    /** Daily snapshots of the PGlite folder, the newest 7 kept. Outside the data folder. */
    BACKUPS_ENABLED: flag,
    BACKUP_DIR: z.string().min(1).default('./pglite-backups'),
    SERVER_PROFILE: z.enum(SERVER_PROFILES).default('cloud'),
    SYNC_TOKEN: z.string().min(32).optional(),
    PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
    BIND_HOST: z.string().min(1).default('0.0.0.0'),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    /** Comma-separated addresses for the pairing QR code, when the server can't see its own. */
    PAIRING_URLS: z
      .string()
      .transform((value) =>
        value
          .split(',')
          .map((url) => url.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.url()))
      .optional(),
    /** Stop cleanly when stdin closes: how the desktop app stops the hub it runs (ADR-0024). */
    SHUTDOWN_ON_STDIN_CLOSE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    /** Set after data was moved in from elsewhere, so devices sync everything again. */
    RESET_DATA_EPOCH: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    // The server organizes entries other devices left waiting (extraction-pipeline §5).
    FALLBACK_EXTRACTION_ENABLED: flag,
    FALLBACK_GRACE_MINUTES: z.coerce.number().int().min(0).default(15),
    /** With no provider, the server organizes nothing and devices do it themselves. */
    EXTRACTION_PROVIDER: z.enum(LLM_PROVIDERS).optional(),
    EXTRACTION_MODEL: z.string().min(1).optional(),
    /** The hub answers Ask questions for devices set to use it (ADR-0022). */
    ANALYSIS_PROVIDER: z.enum(LLM_PROVIDERS).optional(),
    ANALYSIS_MODEL: z.string().min(1).optional(),
    /** Search by meaning (docs/architecture/retrieval.md). With no provider, search is off. */
    EMBEDDING_PROVIDER: z.enum(LLM_PROVIDERS).optional(),
    EMBEDDING_MODEL: z.string().min(1).optional(),
    OLLAMA_BASE_URL: z.url().optional(),
    GROQ_API_KEY: z.string().min(1).optional(),
    GOOGLE_API_KEY: z.string().min(1).optional(),
  })
  .refine((env) => env.DB_DRIVER === 'pglite' || env.DATABASE_URL, {
    path: ['DATABASE_URL'],
    message: 'DATABASE_URL is required when DB_DRIVER is postgres',
  })
  .refine((env) => !env.EXTRACTION_PROVIDER || env.EXTRACTION_MODEL, {
    path: ['EXTRACTION_MODEL'],
    message: 'EXTRACTION_MODEL is required when EXTRACTION_PROVIDER is set',
  })
  .refine((env) => !env.ANALYSIS_PROVIDER || env.ANALYSIS_MODEL, {
    path: ['ANALYSIS_MODEL'],
    message: 'ANALYSIS_MODEL is required when ANALYSIS_PROVIDER is set',
  })
  .refine((env) => !env.EMBEDDING_PROVIDER || env.EMBEDDING_MODEL, {
    path: ['EMBEDDING_MODEL'],
    message: 'EMBEDDING_MODEL is required when EMBEDDING_PROVIDER is set',
  });

export type ServerEnv = z.infer<typeof envSchema>;

/** Empty values count as unset, so `.env.example` can be copied as it is. */
export function loadEnv(source: Record<string, string | undefined>): ServerEnv {
  const set = Object.entries(source).filter(([, value]) => value !== '');
  return envSchema.parse(Object.fromEntries(set));
}
