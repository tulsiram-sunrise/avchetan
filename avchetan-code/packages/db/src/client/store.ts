import {
  type Clock,
  createMonotonicClock,
  newId as defaultNewId,
  type IdGenerator,
} from '@avchetan/shared';
import { type ApplyResult, applyRemoteChanges, type RemoteChange } from './apply-remote';
import { createClientDatabase, type SqliteExecutor, type Tx } from './database';
import { getSyncState, insertLlmRun, type NewLlmRun, setSyncState } from './local';
import { ackOutbox, listOutbox } from './outbox';
import * as queries from './queries';
import { activitiesRepo } from './repos/activities';
import { categoriesRepo } from './repos/categories';
import { entitiesRepo } from './repos/entities';
import { projectsRepo } from './repos/projects';
import { rawLogsRepo } from './repos/raw-logs';
import { tagsRepo } from './repos/tags';
import { tasksRepo } from './repos/tasks';
import type { RepoDeps } from './synced';

export type OpenClientStoreOptions = {
  executor: SqliteExecutor;
  /** Injectable for tests. */
  newId?: IdGenerator;
  /** Wall clock in epoch ms; injectable for tests. */
  wallClock?: () => number;
};

/**
 * Opens the device's local store: migrates, loads (or creates) the device ID, restores the
 * monotonic clock, seeds default categories, and wires the repositories. Each app calls
 * this once from its composition root with its own SqliteExecutor.
 */
export async function openClientStore(options: OpenClientStoreOptions) {
  const wallClock = options.wallClock ?? (() => Date.now());
  const newId = options.newId ?? defaultNewId;
  const database = createClientDatabase(options.executor);

  await database.migrate(() => new Date(wallClock()).toISOString());

  let deviceId = await getSyncState(database.db, 'device_id');
  if (!deviceId) {
    const created = newId();
    await database.write((tx) => setSyncState(tx, 'device_id', created));
    deviceId = created;
  }

  const clock: Clock = createMonotonicClock({
    restoredLast: (await getSyncState(database.db, 'clock_last')) ?? null,
    source: wallClock,
  });

  /** Transaction that also persists the clock high-water mark, keeping restarts monotonic. */
  function write<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return database.write(async (tx) => {
      const before = clock.lastIssued();
      const result = await fn(tx);
      const after = clock.lastIssued();
      if (after && after !== before) await setSyncState(tx, 'clock_last', after);
      return result;
    });
  }

  const deps: RepoDeps = { deviceId, clock, newId };
  const tags = tagsRepo(deps);
  const repos = {
    rawLogs: rawLogsRepo(deps, tags),
    activities: activitiesRepo(deps),
    tasks: tasksRepo(deps),
    categories: categoriesRepo(deps),
    projects: projectsRepo(deps),
    tags,
    entities: entitiesRepo(deps),
  };

  await write((tx) => repos.categories.ensureSeeds(tx));

  return {
    db: database.db,
    deviceId,
    clock,
    write,
    repos,
    queries,
    recordLlmRun: (run: Omit<NewLlmRun, 'id' | 'createdAt'>): Promise<void> =>
      write((tx) => insertLlmRun(tx, { ...run, id: newId(), createdAt: clock.now() })),
    sync: {
      listOutbox: (limit?: number) => listOutbox(database.db, limit),
      ackOutbox: (entries: Parameters<typeof ackOutbox>[1]) =>
        database.write((tx) => ackOutbox(tx, entries)),
      applyRemote: (changes: readonly RemoteChange[]): Promise<ApplyResult> =>
        database.write((tx) => applyRemoteChanges(tx, changes)),
    },
  };
}

export type ClientStore = Awaited<ReturnType<typeof openClientStore>>;
