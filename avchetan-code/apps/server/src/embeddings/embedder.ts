import { createHash } from 'node:crypto';
import { embeddingText, embedTexts, type ModelConfig, PROVIDER_ADAPTERS } from '@avchetan/core';
import {
  activities,
  entityTags,
  logEmbeddings,
  rawLogs,
  serverJobs,
  tags,
  tasks,
} from '@avchetan/db/pg';
import { createLogger, createLoop, type Scheduler, toAppError } from '@avchetan/shared';
import type { EmbeddingModel } from 'ai';
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { ServerDb } from '../db/client';
import { EMBED_JOB, enqueueMissing } from './jobs';

const log = createLogger('embedder');

/** docs/architecture/server.md: the embedder looks every 10 s, and after every push. */
const POLL_MS = 10_000;
/** docs/architecture/retrieval.md: up to 64 logs per call to the model. */
const BATCH = 64;
const MAX_ATTEMPTS = 5;

export type EmbedderDeps = {
  db: ServerDb;
  model: ModelConfig;
  resolveModel: () => Promise<EmbeddingModel>;
  scheduler: Scheduler;
};

export type Embedder = {
  wake: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => void;
};

/** How rows record which model made them, e.g. `ollama:qwen3-embedding:0.6b`. */
export const embeddingModelId = (model: ModelConfig) => `${model.provider}:${model.model}`;

/** Where the search query finds the vectors. Only rows of this length use the index. */
export const indexName = (dims: number) => `log_embeddings_hnsw_${dims}`;

const hashOf = (text: string) => createHash('sha256').update(text).digest('hex');

type Source = { id: string; text: string; privacy: string };

/** The live raw logs among `ids`, with the titles and tags extracted from them. */
async function loadSources(db: ServerDb, ids: readonly string[]): Promise<Source[]> {
  const logs = await db
    .select({ id: rawLogs.id, content: rawLogs.content, privacy: rawLogs.privacy })
    .from(rawLogs)
    .where(and(inArray(rawLogs.id, [...ids]), isNull(rawLogs.deletedAt)));
  if (logs.length === 0) return [];
  const liveIds = logs.map((row) => row.id);

  const titles = new Map<string, string[]>();
  const tagPaths = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, id: string | null, value: string) => {
    if (id) map.set(id, [...(map.get(id) ?? []), value]);
  };

  const itemOwner = new Map<string, string>();
  for (const table of [activities, tasks]) {
    const rows = await db
      .select({ id: table.id, rawLogId: table.rawLogId, title: table.title })
      .from(table)
      .where(and(inArray(table.rawLogId, liveIds), isNull(table.deletedAt)))
      .orderBy(asc(table.createdAt));
    for (const row of rows) {
      add(titles, row.rawLogId, row.title);
      if (row.rawLogId) itemOwner.set(row.id, row.rawLogId);
    }
  }

  const links = await db
    .select({ targetId: entityTags.targetId, path: tags.path })
    .from(entityTags)
    .innerJoin(tags, eq(tags.id, entityTags.tagId))
    .where(
      and(
        isNull(entityTags.deletedAt),
        isNull(tags.deletedAt),
        inArray(entityTags.targetId, [...liveIds, ...itemOwner.keys()]),
      ),
    );
  for (const { targetId, path } of links) {
    const owner = itemOwner.get(targetId) ?? targetId;
    if (!tagPaths.get(owner)?.includes(path)) add(tagPaths, owner, path);
  }

  return logs.map((row) => ({
    id: row.id,
    privacy: row.privacy,
    text: embeddingText({
      content: row.content,
      titles: titles.get(row.id) ?? [],
      tagPaths: tagPaths.get(row.id) ?? [],
    }),
  }));
}

/**
 * Keeps `log_embeddings` in step with raw logs (docs/architecture/retrieval.md): embeds what
 * changed, removes vectors of deleted logs, and never sends a private log to a cloud model.
 */
export function createEmbedder(deps: EmbedderDeps): Embedder {
  const { db, model } = deps;
  const modelId = embeddingModelId(model);
  const localModel = PROVIDER_ADAPTERS[model.provider].local;
  const indexed = new Set<number>();

  async function finish(jobIds: readonly string[]) {
    if (jobIds.length > 0) await db.delete(serverJobs).where(inArray(serverJobs.id, [...jobIds]));
  }

  async function ensureIndex(dims: number) {
    if (indexed.has(dims)) return;
    // The column has no fixed length, so the index is on rows of this model's length.
    await db.execute(
      sql.raw(
        `create index if not exists ${indexName(dims)} on log_embeddings ` +
          `using hnsw ((embedding::vector(${dims})) vector_cosine_ops) where dims = ${dims}`,
      ),
    );
    indexed.add(dims);
  }

  async function run(): Promise<'idle' | 'more'> {
    const jobs = await db
      .select({ id: serverJobs.id, rawLogId: serverJobs.targetId, attempts: serverJobs.attempts })
      .from(serverJobs)
      .where(
        and(
          eq(serverJobs.kind, EMBED_JOB),
          eq(serverJobs.status, 'pending'),
          lte(serverJobs.runAfter, sql`now()`),
        ),
      )
      .orderBy(asc(serverJobs.runAfter))
      .limit(BATCH);
    if (jobs.length === 0) return 'idle';

    const rawLogIds = jobs.flatMap((job) => (job.rawLogId ? [job.rawLogId] : []));
    const sources = (await loadSources(db, rawLogIds)).filter(
      (source) => source.privacy === 'normal' || localModel,
    );
    const keep = new Set(sources.map((source) => source.id));
    // Deleted logs, and private ones this model may not see, have no vector.
    const gone = rawLogIds.filter((id) => !keep.has(id));
    if (gone.length > 0) {
      await db.delete(logEmbeddings).where(inArray(logEmbeddings.rawLogId, gone));
    }

    const stored = new Map(
      (
        await db
          .select({
            id: logEmbeddings.rawLogId,
            hash: logEmbeddings.contentHash,
            model: logEmbeddings.model,
          })
          .from(logEmbeddings)
          .where(inArray(logEmbeddings.rawLogId, [...keep]))
      ).map((row) => [row.id, row]),
    );
    const changed = sources.filter((source) => {
      const current = stored.get(source.id);
      return current?.model !== modelId || current.hash !== hashOf(source.text);
    });

    try {
      const vectors = await embedTexts(
        await deps.resolveModel(),
        changed.map((source) => source.text),
      );
      for (const [index, source] of changed.entries()) {
        const embedding = vectors[index] as number[];
        const values = {
          model: modelId,
          dims: embedding.length,
          contentHash: hashOf(source.text),
          embedding,
          updatedAt: sql`now()`,
        };
        await db
          .insert(logEmbeddings)
          .values({ rawLogId: source.id, ...values })
          .onConflictDoUpdate({ target: logEmbeddings.rawLogId, set: values });
        await ensureIndex(embedding.length);
      }
    } catch (error) {
      const { code } = toAppError(error);
      await db
        .update(serverJobs)
        .set({
          attempts: sql`${serverJobs.attempts} + 1`,
          status: sql`case when ${serverJobs.attempts} + 1 >= ${MAX_ATTEMPTS} then 'failed' else 'pending' end`,
          runAfter: sql`now() + make_interval(mins => ${serverJobs.attempts} + 1)`,
          lastError: code,
          updatedAt: sql`now()`,
        })
        .where(
          inArray(
            serverJobs.id,
            jobs.map((job) => job.id),
          ),
        );
      throw error;
    }

    await finish(jobs.map((job) => job.id));
    log.debug('embedded', { jobs: jobs.length, embedded: changed.length, removed: gone.length });
    return jobs.length === BATCH ? 'more' : 'idle';
  }

  const loop = createLoop({
    name: 'embedder',
    run,
    intervalMs: POLL_MS,
    backoff: { minMs: 10_000, maxMs: 300_000 },
    scheduler: deps.scheduler,
    log,
  });

  return {
    wake: loop.wake,
    async start() {
      const queued = await enqueueMissing(db, modelId);
      log.info('started', { provider: model.provider, queued });
      loop.start();
      void loop.wake();
    },
    stop: () => loop.stop(),
  };
}
