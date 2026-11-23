import { createLogger, LlmError, type LocalDate, SyncError, toAppError } from '@avchetan/shared';
import { saveBriefFailure } from '../analysis/brief-schedule';
import { makeDailyBrief } from '../analysis/daily-brief';
import { loadAnalysisMode, loadAnalysisModel } from '../extraction/settings';
import { llmDepsFor } from '../llm/llm-deps';
import { PROVIDER_ADAPTERS } from '../providers/registry';
import type { DeviceDeps } from './device-deps';

const log = createLogger('brief');

export type BriefMakerDeps = DeviceDeps & {
  /** The device's sync: a brief the hub made arrives with the next one. */
  sync: { syncNow(): Promise<unknown>; schedule(): void };
};

/** How a device makes its daily brief; the app adds its notification and screen state. */
export type DeviceBriefMaker = {
  /** Makes a day's brief and records how it went for the Days page. */
  make(day: LocalDate, replace: boolean): Promise<'made' | 'empty'>;
  /** Whether a brief can be made now: a model or a hub, and a network when it needs one. */
  canMake(): Promise<boolean>;
  /** Before deciding which days are due: a brief another device made may be waiting. */
  beforeCheck(): Promise<void>;
};

/**
 * The daily brief on a device (docs/product/daily-brief.md): made with its own analysis model,
 * or asked of the hub when answers come from the hub.
 */
export function createDeviceBriefMaker(deps: BriefMakerDeps): DeviceBriefMaker {
  const { store, platform, hub, sync, timeZone, words } = deps;

  async function makeHere(day: LocalDate, replace: boolean): Promise<'made' | 'empty'> {
    if ((await loadAnalysisMode(store)) === 'hub') {
      if (!platform.network.isOnline()) {
        throw new SyncError('server_unreachable', `This ${words.device} is offline`);
      }
      const { status } = await hub.brief({ date: day, timeZone: timeZone(), replace });
      await sync.syncNow();
      return status === 'empty' ? 'empty' : 'made';
    }
    const model = await loadAnalysisModel(store);
    if (!model) throw new LlmError('llm_auth', `Choose a model in ${words.modelsPlace} first`);
    const result = await makeDailyBrief(
      store,
      { day, timeZone: timeZone(), models: [model] },
      llmDepsFor(store, platform),
    );
    sync.schedule();
    return result.status;
  }

  return {
    async make(day, replace) {
      try {
        const result = await makeHere(day, replace);
        await saveBriefFailure(store, null);
        return result;
      } catch (error) {
        const { code, message } = toAppError(error);
        log.warn('daily brief failed', { code });
        await saveBriefFailure(store, { day, code, message });
        throw error;
      }
    },
    async canMake() {
      if ((await loadAnalysisMode(store)) === 'hub') {
        return platform.network.isOnline() && (await hub.isSetUp());
      }
      const model = await loadAnalysisModel(store);
      if (!model) return false;
      return platform.network.isOnline() || PROVIDER_ADAPTERS[model.provider].local;
    },
    async beforeCheck() {
      if (await hub.isSetUp()) await sync.syncNow();
    },
  };
}
