import {
  type BriefRunner,
  createBriefRunner,
  createModel,
  findDailyBrief,
  loadAnalysisMode,
  loadAnalysisModel,
  makeDailyBrief,
  PROVIDER_ADAPTERS,
  saveBriefFailure,
} from '@avchetan/core';
import { type ClientStore, getSetting, setSetting } from '@avchetan/db/sqlite';
import {
  addDays,
  createLogger,
  LlmError,
  type LocalDate,
  localDate,
  SyncError,
  toAppError,
} from '@avchetan/shared';
import { loadServerUrls, requestHubBrief, type SyncEngine } from '@avchetan/sync';
import { emitAppEvent } from '../native/events';
import type { Platform } from '../platform';
import { announce } from './extraction';
import type { TimeZoneCache } from './time-zone';

const log = createLogger('brief');

/** The newest day a notification was shown for, so each brief notifies once. */
const BRIEF_NOTIFIED_SETTING = 'brief.notified';

async function saveSetting(store: ClientStore, key: string, value: unknown): Promise<void> {
  await store.write((tx) => setSetting(tx, key, value, store.clock.now()));
}

export type BriefService = BriefRunner & {
  /** Notifies about a brief that arrived from the hub. */
  checkReceived: () => Promise<void>;
};

/**
 * The daily brief on this PC (docs/product/daily-brief.md): made with its own analysis model,
 * or asked of the hub when answers come from the hub. Runs in the dock, which never closes.
 */
export function createBriefService(deps: {
  store: ClientStore;
  platform: Platform;
  sync: SyncEngine;
  timeZone: TimeZoneCache;
}): BriefService {
  const { store, platform, sync, timeZone } = deps;
  const { fetch, secrets, network } = platform;

  const hasServer = async () => (await loadServerUrls(store)).length > 0;

  async function makeHere(day: LocalDate, replace: boolean): Promise<'made' | 'empty'> {
    if ((await loadAnalysisMode(store)) === 'hub') {
      if (!network.isOnline()) throw new SyncError('server_unreachable', 'This PC is offline');
      const { status } = await requestHubBrief(
        { store, fetch, secrets },
        { date: day, timeZone: timeZone.current(), replace },
      );
      await sync.syncNow();
      return status === 'empty' ? 'empty' : 'made';
    }
    const model = await loadAnalysisModel(store);
    if (!model) throw new LlmError('llm_auth', 'Choose a model in Settings → AI models first');
    const result = await makeDailyBrief(
      store,
      { day, timeZone: timeZone.current(), models: [model] },
      {
        resolveModel: (config) => createModel(config, { fetch, secrets }),
        recordRun: (run) => store.recordLlmRun(run),
      },
    );
    sync.schedule();
    return result.status;
  }

  async function make(day: LocalDate, replace: boolean): Promise<'made' | 'empty'> {
    void emitAppEvent('brief:state', { day, making: true }).catch(() => undefined);
    try {
      const result = await makeHere(day, replace);
      await saveBriefFailure(store, null);
      return result;
    } catch (error) {
      const { code, message } = toAppError(error);
      log.warn('daily brief failed', { code });
      await saveBriefFailure(store, { day, code, message });
      throw error;
    } finally {
      void announce(store, platform);
      void emitAppEvent('brief:state', { day, making: false }).catch(() => undefined);
    }
  }

  async function notify(day: LocalDate): Promise<void> {
    const notified = await getSetting(store.db, BRIEF_NOTIFIED_SETTING);
    if (typeof notified === 'string' && notified >= day) return;
    await saveSetting(store, BRIEF_NOTIFIED_SETTING, day);
    try {
      await platform.shell.notifyBrief(day);
    } catch (error) {
      log.warn('could not show the brief notification', { code: toAppError(error).code });
    }
  }

  const runner = createBriefRunner({
    store,
    scheduler: platform.scheduler,
    timeZone: timeZone.current,
    make: (day) => make(day, false),
    canMake: async () => {
      if ((await loadAnalysisMode(store)) === 'hub') {
        return network.isOnline() && (await hasServer());
      }
      const model = await loadAnalysisModel(store);
      return model !== null && (network.isOnline() || PROVIDER_ADAPTERS[model.provider].local);
    },
    beforeCheck: async () => {
      if (await hasServer()) await sync.syncNow();
    },
    onMade: (day) => void notify(day),
  });

  return {
    ...runner,
    // Asked for in Days: the person is looking at it, so no notification.
    makeNow: async (day) => {
      await saveSetting(store, BRIEF_NOTIFIED_SETTING, day);
      return make(day, true);
    },
    async checkReceived() {
      const today = localDate(store.clock.now(), timeZone.current());
      for (const day of [addDays(today, -1), today]) {
        const brief = await findDailyBrief(store, day);
        if (brief && brief.deletedAt === null && brief.updatedByDevice !== store.deviceId) {
          await notify(day);
        }
      }
    },
  };
}
