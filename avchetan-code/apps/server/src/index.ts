import { randomBytes } from 'node:crypto';
import { createEmbeddingModel, embedTexts } from '@avchetan/core';
import {
  configureLogging,
  createLogger,
  createMonotonicClock,
  TimerScheduler,
  toAppError,
} from '@avchetan/shared';
import { MAX_SEARCH_RESULTS } from '@avchetan/sync/protocol';
import { serve } from '@hono/node-server';
import { ApiError } from './api-error';
import { createApp } from './app';
import { createHubAsk, type HubAsk } from './ask/hub-ask';
import { loadServerIdentity } from './auth';
import { openPglite, openPostgres } from './db/client';
import { createEmbedder, type Embedder, embeddingModelId } from './embeddings/embedder';
import { enqueueEmbedJobs, rawLogsTouchedBy } from './embeddings/jobs';
import { searchLogs } from './embeddings/search';
import { loadEnv } from './env';
import { openServerDevice, type ServerDevice } from './fallback/server-device';
import {
  analysisModelFromEnv,
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
  const search =
    embedding && resolveEmbedding
      ? {
          model: embeddingModelId(embedding),
          embed: async (text: string) => {
            const [vector] = await embedTexts(await resolveEmbedding(), [text]);
            return vector as number[];
          },
        }
      : null;
  const analysis = analysisModelFromEnv(env);
  // Set once the server's device is open, which needs the app's own fetch.
  let hubAsk: HubAsk | null = null;

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
    ...(search ? { search } : {}),
    ...(analysis
      ? {
          ask: (request, onText, abortSignal) => {
            if (!hubAsk) throw new ApiError(503, 'ask_unavailable', 'The server is still starting');
            return hubAsk(request, onText, abortSignal);
          },
        }
      : {}),
  });

  const organizing = env.FALLBACK_EXTRACTION_ENABLED ? extractionModelsFromEnv(env) : [];
  if (organizing.length === 0) {
    log.info('not organizing entries', {
      reason: env.FALLBACK_EXTRACTION_ENABLED ? 'no_extraction_provider' : 'disabled',
    });
  }
  // The server's device organizes entries, answers questions, or both.
  if (organizing.length > 0 || analysis) {
    const llm = llmFromEnv(env);
    device = await openServerDevice({
      fetch: (input, init) => Promise.resolve(app.fetch(new Request(input, init))),
      db: database.db,
      serverId: identity.serverId,
      internalToken,
      models: organizing,
      graceMinutes: env.FALLBACK_GRACE_MINUTES,
      llm,
    });
    device.start();
    if (analysis) {
      hubAsk = createHubAsk({
        device,
        model: analysis,
        llm,
        searchHistory: search
          ? async ({ query }) =>
              searchLogs(database.db, {
                vector: await search.embed(query),
                model: search.model,
                limit: MAX_SEARCH_RESULTS,
              })
          : undefined,
      });
    }
  }
  if (!analysis) log.info('not answering questions', { reason: 'no_analysis_provider' });
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
