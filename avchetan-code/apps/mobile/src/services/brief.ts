import {
  type BriefRunner,
  createBriefRunner,
  createModel,
  loadAnalysisMode,
  loadAnalysisModel,
  makeDailyBrief,
  PROVIDER_ADAPTERS,
  saveBriefFailure,
} from '@avchetan/core';
import type { ClientStore } from '@avchetan/db/sqlite';
import {
  createLogger,
  LlmError,
  type LocalDate,
  SyncError,
  systemTimeZone,
  toAppError,
} from '@avchetan/shared';
import { loadServerUrls, requestHubBrief, type SyncEngine } from '@avchetan/sync';
import type { Platform } from '../platform';
import { refreshAll } from '../query-client';

const log = createLogger('brief');

export type BriefService = BriefRunner & {
  /** Days being made right now, for the Days screen. */
  making: () => ReadonlySet<LocalDate>;
};

/**
 * The daily brief on the phone (docs/product/daily-brief.md). Android can't be counted on to
 * run the app at the brief time, so it is made when the app is open: on start, when Days opens,
 * and when the reminder is tapped. With answers from the hub, the hub makes it.
 */
export function createBriefService(deps: {
  store: ClientStore;
  platform: Platform;
  sync: SyncEngine;
}): BriefService {
  const { store, platform, sync } = deps;
  const { fetch, secrets, network } = platform;
  const making = new Set<LocalDate>();

  const hasServer = async () => (await loadServerUrls(store)).length > 0;

  async function makeHere(day: LocalDate, replace: boolean): Promise<'made' | 'empty'> {
    if ((await loadAnalysisMode(store)) === 'hub') {
      if (!network.isOnline()) throw new SyncError('server_unreachable', 'This phone is offline');
      const { status } = await requestHubBrief(
        { store, fetch, secrets },
        { date: day, timeZone: systemTimeZone(), replace },
      );
      await sync.syncNow();
      return status === 'empty' ? 'empty' : 'made';
    }
    const model = await loadAnalysisModel(store);
    if (!model) throw new LlmError('llm_auth', 'Choose a model in More → AI models first');
    const result = await makeDailyBrief(
      store,
      { day, timeZone: systemTimeZone(), models: [model] },
      {
        resolveModel: (config) => createModel(config, { fetch, secrets }),
        recordRun: (run) => store.recordLlmRun(run),
      },
    );
    sync.schedule();
    return result.status;
  }

  async function make(day: LocalDate, replace: boolean): Promise<'made' | 'empty'> {
    making.add(day);
    refreshAll();
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
      making.delete(day);
      refreshAll();
    }
  }

  const runner = createBriefRunner({
    store,
    scheduler: platform.scheduler,
    timeZone: systemTimeZone,
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
  });

  return {
    ...runner,
    makeNow: (day) => make(day, true),
    making: () => making,
  };
}
