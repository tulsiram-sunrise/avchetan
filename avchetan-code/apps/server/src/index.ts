import { randomBytes } from 'node:crypto';
import { createEmbeddingModel, embedTexts } from '@avchetan/core';
import {
  configureLogging,
  createLogger,
  createMonotonicClock,
  TimerScheduler,
  toAppError,
} from '@avchetan/shared';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadServerIdentity } from './auth';
import { openPglite, openPostgres } from './db/client';
import { createEmbedder, type Embedder, embeddingModelId } from './embeddings/embedder';
import { enqueueEmbedJobs, rawLogsTouchedBy } from './embeddings/jobs';
import { loadEnv } from './env';
import { openServerDevice, type ServerDevice } from './fallback/server-device';
import {
  embeddingModelFromEnv,
  extractionModelsFromEnv,
  llmFromEnv,
  secretsFromEnv,
} from './from-env';

const VERSION = '0.0.0';

const log = createLogger('server');

async function main(): Promise<void> {
  const env = loadEnv(process.env);
  configureLogging({ level: env.LOG_LEVEL });

  const database =
    env.DB_DRIVER === 'pglite'
      ? await openPglite(env.PGLITE_DATA_DIR)
      : await openPostgres(env.DATABASE_URL as string);
  const clock = createMonotonicClock();
  await database.migrate(() => clock.now());

  const identity = await loadServerIdentity(database.db, env.SYNC_TOKEN);
  if (identity.generatedToken) {
    // Not through the logger: this is the one time the token is shown, and log sinks keep lines.
    process.stdout.write(
      `\nYour sync token (shown once, keep it safe):\n${identity.generatedToken}\n\n`,
    );
  }

  // Only the server's own device holds this, in memory; it changes on every start.
  const internalToken = randomBytes(32).toString('base64url');
  let device: ServerDevice | null = null;
  let embedder: Embedder | null = null;

  const embedding = embeddingModelFromEnv(env);
  const resolveEmbedding = embedding
    ? () =>
        createEmbeddingModel(embedding, { fetch: globalThis.fetch, secrets: secretsFromEnv(env) })
    : null;

  const app = createApp({
    db: database.db,
    identity,
    clock,
    version: VERSION,
    profile: env.SERVER_PROFILE,
    internalToken,
    onPush: (deviceId, acked) => {
      if (device && deviceId !== device.store.deviceId) device.wake();
      if (!embedder) return;
      const wakeAfter = embedder.wake;
      rawLogsTouchedBy(database.db, acked)
        .then((ids) => enqueueEmbedJobs(database.db, ids))
        .then(wakeAfter)
        .catch((error) => log.warn('could not queue embeddings', { code: toAppError(error).code }));
    },
    ...(embedding && resolveEmbedding
      ? {
          search: {
            model: embeddingModelId(embedding),
            embed: async (text: string) => {
              const [vector] = await embedTexts(await resolveEmbedding(), [text]);
              return vector as number[];
            },
          },
        }
      : {}),
  });

  const models = extractionModelsFromEnv(env);
  if (env.FALLBACK_EXTRACTION_ENABLED && models.length > 0) {
    device = await openServerDevice({
      fetch: (input, init) => Promise.resolve(app.fetch(new Request(input, init))),
      db: database.db,
      serverId: identity.serverId,
      internalToken,
      models,
      graceMinutes: env.FALLBACK_GRACE_MINUTES,
      llm: llmFromEnv(env),
    });
    device.start();
  } else {
    log.info('not organizing entries', {
      reason: env.FALLBACK_EXTRACTION_ENABLED ? 'no_extraction_provider' : 'disabled',
    });
  }
  if (embedding && resolveEmbedding) {
    embedder = createEmbedder({
      db: database.db,
      model: embedding,
      resolveModel: resolveEmbedding,
      scheduler: new TimerScheduler(),
    });
    await embedder.start();
  } else {
    log.info('search by meaning is off', { reason: 'no_embedding_provider' });
  }

  const server = serve({ fetch: app.fetch, hostname: env.BIND_HOST, port: env.PORT }, (address) =>
    log.info('listening', {
      port: address.port,
      driver: env.DB_DRIVER,
      profile: env.SERVER_PROFILE,
    }),
  );

  const shutDown = () => {
    device?.stop();
    embedder?.stop();
    server.close(() => {
      void database.close().finally(() => process.exit(0));
    });
  };
  process.once('SIGINT', shutDown);
  process.once('SIGTERM', shutDown);
}

main().catch((error: unknown) => {
  log.error('startup failed', { error: error instanceof Error ? error.message : 'unknown' });
  process.exit(1);
});
