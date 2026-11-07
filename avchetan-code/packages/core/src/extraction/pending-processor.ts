import type { ClientStore, RawLog } from '@avchetan/db/sqlite';
import {
  createLogger,
  createLoop,
  type LoopRunResult,
  type NetworkMonitor,
  type Scheduler,
} from '@avchetan/shared';
import type { LlmDeps } from '../llm/generate-structured';
import type { ModelConfig } from '../providers/config';
import { toLlmError } from '../providers/errors';
import { PROVIDER_ADAPTERS } from '../providers/registry';
import { processRawLog } from './extract';
import { attemptBackoffMs, decideFailure, MAX_ATTEMPTS } from './failure-policy';
import { type ExtractionVocabulary, loadVocabulary } from './input';
import { type ExtractionSettings, loadExtractionSettings } from './settings';

const log = createLogger('extraction');

const POLL_MS = 60_000;
/** Longer than the slowest call: a local model on a CPU has up to three minutes. */
const LEASE_MS = 300_000;

export type PendingProcessorDeps = {
  store: ClientStore;
  llm: LlmDeps;
  network: NetworkMonitor;
  scheduler: Scheduler;
  loadSettings?: (store: ClientStore) => Promise<ExtractionSettings>;
  /**
   * The pending logs this processor may take now, oldest first. Defaults to this device's own
   * captures; the server's device takes those other devices left waiting.
   */
  findClaimable?: (options: ClaimOptions) => Promise<RawLog[]>;
  /** Called when a log's state changed, so the UI can refresh. */
  onChange?: () => void;
};

export type ClaimOptions = {
  now: string;
  maxAttempts: number;
  limit: number;
  /** A local model is available: private logs may be taken (docs/product/private-entries.md). */
  includePrivate: boolean;
};

export type PendingProcessor = {
  /** Look for work now. Never awaited by capture. */
  wake: () => Promise<void>;
  /** Works through at most `limit` logs, for a platform's short background window. */
  drain: (limit: number) => Promise<void>;
  start: () => void;
  stop: () => void;
  /** Lifts a wait, e.g. after the user fixes a key. */
  resume: () => void;
};

/**
 * Works through this device's pending logs one at a time, oldest first
 * (docs/architecture/extraction-pipeline.md §2). On desktop it runs only in the dock, which is
 * always alive.
 */
export function createPendingProcessor(deps: PendingProcessorDeps): PendingProcessor {
  const { store, llm, network, scheduler } = deps;
  const loadSettings = deps.loadSettings ?? loadExtractionSettings;
  const findClaimable =
    deps.findClaimable ??
    ((options: ClaimOptions) =>
      store.queries.claimablePendingLogs(store.db, { ...options, deviceId: store.deviceId }));
  /** Set when a failure holds the whole queue. */
  let pausedUntil: string | null = null;
  /** Logs this run may still take; null when there's no limit. */
  let budget: number | null = null;

  const later = (ms: number) => new Date(Date.parse(store.clock.now()) + ms).toISOString();

  async function extract(rawLog: RawLog, models: ModelConfig[], settings: ExtractionSettings) {
    // A prompt that may reach a cloud model can't mention tags, names or corrections from
    // private entries.
    const includePrivate = models.every((model) => PROVIDER_ADAPTERS[model.provider].local);
    const vocabulary = await loadVocabulary(
      store,
      { includePrivate },
      { corrections: settings.learnFromCorrections },
    );
    const options = { ...settings, models, vocabulary };
    try {
      await processRawLog(store, rawLog, options, llm);
    } catch (error) {
      if (toLlmError(error).code !== 'llm_context_overflow') throw error;
      // The one retry leaves out what's longest and least needed: examples, tags and names.
      const trimmed: ExtractionVocabulary = {
        ...vocabulary,
        tagPaths: [],
        entityNames: [],
        corrections: [],
      };
      await processRawLog(store, rawLog, { ...options, vocabulary: trimmed }, llm);
    }
  }

  async function recordFailure(rawLog: RawLog, thrown: unknown): Promise<void> {
    const error = toLlmError(thrown);
    const decision = decideFailure(error);
    const attempts = rawLog.processingAttempts + 1;
    const backoff = decision.kind === 'attempt' ? attemptBackoffMs(attempts) : null;
    const delayMs = decision.kind === 'wait' ? decision.delayMs : backoff;
    log.warn('extraction failed', {
      id: rawLog.id,
      code: error.code,
      attempts,
      decision: decision.kind,
    });

    await store.write((tx) =>
      store.repos.rawLogs.recordFailure(tx, rawLog.id, {
        status: decision.kind !== 'wait' && delayMs === null ? 'error' : 'pending_llm',
        lastError: `${error.code}: ${error.message}`,
        nextAttemptAt: delayMs === null ? null : later(delayMs),
        countsAsAttempt: decision.kind !== 'wait',
      }),
    );
    if (decision.kind === 'wait') pausedUntil = later(decision.delayMs);
  }

  /** Without this, a log whose tries were all cut off would stay pending with no reason shown. */
  async function giveUpOnAbandoned(now: string): Promise<boolean> {
    const [abandoned] = await store.queries.abandonedPendingLogs(store.db, {
      deviceId: store.deviceId,
      now,
      maxAttempts: MAX_ATTEMPTS,
      limit: 1,
    });
    if (!abandoned) return false;
    log.warn('extraction abandoned', { id: abandoned.id });
    await store.write((tx) =>
      store.repos.rawLogs.recordFailure(tx, abandoned.id, {
        status: 'error',
        lastError: 'llm_unavailable: Organizing this entry was interrupted too many times',
        nextAttemptAt: null,
        countsAsAttempt: true,
      }),
    );
    deps.onChange?.();
    return true;
  }

  async function run(): Promise<LoopRunResult> {
    const now = store.clock.now();
    if (budget === 0) return 'idle';
    if (pausedUntil && now < pausedUntil) return 'idle';
    pausedUntil = null;

    const settings = await loadSettings(store);
    const models = settings.models.filter(
      (model) => network.isOnline() || PROVIDER_ADAPTERS[model.provider].local,
    );
    if (models.length === 0) return 'idle';

    // Without a local model, private logs stay pending instead of being skipped.
    const includePrivate = models.some((model) => PROVIDER_ADAPTERS[model.provider].local);
    const [next] = await findClaimable({
      now,
      maxAttempts: MAX_ATTEMPTS,
      limit: 1,
      includePrivate,
    });
    if (!next) return (await giveUpOnAbandoned(now)) ? 'more' : 'idle';

    if (budget !== null) budget -= 1;
    await store.write((tx) => store.repos.rawLogs.claim(tx, next, later(LEASE_MS)));
    try {
      await extract(next, models, settings);
      deps.onChange?.();
      return 'more';
    } catch (error) {
      await recordFailure(next, error);
      deps.onChange?.();
      return pausedUntil ? 'idle' : 'more';
    }
  }

  const loop = createLoop({
    name: 'extraction',
    run,
    intervalMs: POLL_MS,
    backoff: { minMs: 5_000, maxMs: 300_000 },
    scheduler,
    log,
  });

  function resume(): void {
    pausedUntil = null;
    loop.resetBackoff();
    void loop.wake();
  }

  let unsubscribe: (() => void) | null = null;
  return {
    wake: loop.wake,
    async drain(limit) {
      budget = limit;
      try {
        await loop.wake();
      } finally {
        budget = null;
      }
    },
    resume,
    start() {
      unsubscribe ??= network.subscribe((online) => {
        if (online) resume();
      });
      loop.start();
      void loop.wake();
    },
    stop() {
      unsubscribe?.();
      unsubscribe = null;
      loop.stop();
    },
  };
}
