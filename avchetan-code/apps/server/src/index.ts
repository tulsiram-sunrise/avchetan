import { randomBytes } from 'node:crypto';
import { type BriefRunner, checkModels, createEmbeddingModel, embedTexts } from '@avchetan/core';
import {
  configureLogging,
  createLogger,
  createMonotonicClock,
  TimerScheduler,
  toAppError,
} from '@avchetan/shared';
import { MAX_SEARCH_RESULTS } from '@avchetan/sync/protocol';
import { serve } from '@hono/node-server';
import serverPackage from '../package.json' with { type: 'json' };
import { ApiError } from './api-error';
import { createApp } from './app';
import { createHubAsk, type HubAsk } from './ask/hub-ask';
import { loadServerIdentity } from './auth';
import { restoreSnapshot } from './backups/restore';
import { startHubSnapshots } from './backups/snapshots';
import { createHubBrief, type HubBrief } from './brief/hub-brief';
import { createHubCommand } from './commands/hub-command';
import { openPglite, openPostgres, type ServerDatabase } from './db/client';
import { databaseStartupHint } from './db/startup-hint';
import { createEmbedder, type Embedder, embeddingModelId } from './embeddings/embedder';
import { enqueueEmbedJobs, rawLogsTouchedBy } from './embeddings/jobs';
import { searchLogs } from './embeddings/search';
import { loadEnv, type ServerEnv } from './env';
import { openServerDevice, type ServerDevice } from './fallback/server-device';
import {
  analysisModelFromEnv,
  embeddingModelFromEnv,
  extractionModelsFromEnv,
  llmFromEnv,
  secretsFromEnv,
} from './from-env';
import { pairingUrls } from './pairing';

/** The release version (`pnpm version:set`), bundled in at build time. */
const VERSION = serverPackage.version;
const SHUTDOWN_GRACE_MS = 5_000;

const log = createLogger('server');

/** Opens and migrates the database, explaining the setup mistakes we know how to fix. */
async function openDatabase(env: ServerEnv, now: () => string): Promise<ServerDatabase> {
  if (env.DB_DRIVER === 'pglite') {
    const database = await openPglite(env.PGLITE_DATA_DIR);
    await database.migrate(now);
    return database;
  }
  try {
    const database = await openPostgres(env.DATABASE_URL as string);
    await database.migrate(now);
    return database;
  } catch (error) {
    const hint = databaseStartupHint(error);
    if (hint) log.error('database setup problem', hint);
    throw error;
  }
}

async function main(): Promise<void> {
  const env = loadEnv(process.env);
  configureLogging({ level: env.LOG_LEVEL });

  if (env.RESTORE_SNAPSHOT) {
    // The desktop app's hub restores this way: its program is this one file (ADR-0024).
    await restoreSnapshot(env.RESTORE_SNAPSHOT, env.PGLITE_DATA_DIR);
    log.info('snapshot restored');
    return;
  }

  const clock = createMonotonicClock();
  const database = await openDatabase(env, () => clock.now());

  const identity = await loadServerIdentity(database.db, env.SYNC_TOKEN, {
    resetDataEpoch: env.RESET_DATA_EPOCH,
  });
  if (env.RESET_DATA_EPOCH) log.info('data epoch replaced', { reason: 'requested' });
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
  const organizing = env.FALLBACK_EXTRACTION_ENABLED ? extractionModelsFromEnv(env) : [];
  const serverModels = [
    ...organizing.slice(0, 1).map((config) => ({ job: 'organizing' as const, config })),
    ...(analysis ? [{ job: 'answers' as const, config: analysis }] : []),
    ...(embedding ? [{ job: 'search' as const, config: embedding }] : []),
  ];
  // Set once the server's device is open, which needs the app's own fetch.
  let hubAsk: HubAsk | null = null;
  let hubBrief: HubBrief | null = null;
  let briefRunner: BriefRunner | null = null;

  const app = createApp({
    db: database.db,
    identity,
    clock,
    version: VERSION,
    profile: env.SERVER_PROFILE,
    internalToken,
    pairing: {
      urls: () =>
        pairingUrls({ port: env.PORT, bindHost: env.BIND_HOST, configured: env.PAIRING_URLS }),
      tokenFromEnv: env.SYNC_TOKEN !== undefined,
    },
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
    ...(serverModels.length > 0
      ? {
          checkAi: () =>
            checkModels(serverModels, { fetch: globalThis.fetch, secrets: secretsFromEnv(env) }),
        }
      : {}),
    ...(analysis
      ? {
          ask: (request, onText, abortSignal) => {
            if (!hubAsk) throw new ApiError(503, 'ask_unavailable', 'The server is still starting');
            return hubAsk(request, onText, abortSignal);
          },
          command: createHubCommand({ model: analysis, llm: llmFromEnv(env) }),
          brief: (request) => {
            if (!hubBrief)
              throw new ApiError(503, 'ask_unavailable', 'The server is still starting');
            return hubBrief(request);
          },
        }
      : {}),
  });

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
      learnFromCorrections: env.EXTRACTION_LEARN_FROM_CORRECTIONS,
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
  if (analysis && device) {
    const brief = createHubBrief({
      db: database.db,
      device,
      model: analysis,
      llm: llmFromEnv(env),
      graceMinutes: env.BRIEF_GRACE_MINUTES,
    });
    hubBrief = brief.handle;
    briefRunner = brief.runner;
    briefRunner.start();
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

  const stopSnapshots =
    env.BACKUPS_ENABLED && database.dump
      ? startHubSnapshots({
          dump: database.dump,
          dir: env.BACKUP_DIR,
          scheduler: new TimerScheduler(),
          now: () => clock.now(),
        })
      : null;

  const server = serve({ fetch: app.fetch, hostname: env.BIND_HOST, port: env.PORT }, (address) =>
    log.info('listening', {
      port: address.port,
      driver: env.DB_DRIVER,
      profile: env.SERVER_PROFILE,
    }),
  );

  let stopping = false;
  const shutDown = () => {
    if (stopping) return;
    stopping = true;
    log.info('shutting down');
    briefRunner?.stop();
    device?.stop();
    embedder?.stop();
    stopSnapshots?.();
    let closed = false;
    const closeDatabase = () => {
      if (closed) return;
      closed = true;
      void database.close().finally(() => process.exit(0));
    };
    // A request held open, such as an answer still streaming, mustn't keep the database open.
    const timer = setTimeout(() => {
      if ('closeAllConnections' in server) server.closeAllConnections();
      closeDatabase();
    }, SHUTDOWN_GRACE_MS);
    server.close(() => {
      clearTimeout(timer);
      closeDatabase();
    });
  };
  process.once('SIGINT', shutDown);
  process.once('SIGTERM', shutDown);
  if (env.SHUTDOWN_ON_STDIN_CLOSE) {
    // The desktop app runs the hub with a pipe on stdin and closes it to stop the hub. Windows
    // has no SIGTERM for a child, and the pipe also closes if the app itself crashes.
    process.stdin.once('end', shutDown);
    process.stdin.once('close', shutDown);
    process.stdin.resume();
  }
}

main().catch((error: unknown) => {
  log.error('startup failed', { error: error instanceof Error ? error.message : 'unknown' });
  process.exit(1);
});
