import type { ActionBus } from '../services/actions';
import { emitAppEvent, onAppEvent } from './events';

/** Action requests and results travel as app events between the windows. */
export const tauriActionBus: ActionBus = {
  sendRequest: (request) => emitAppEvent('action:request', request),
  sendResult: (result) => emitAppEvent('action:result', result),
  onRequest: (handler) => onAppEvent('action:request', handler),
  onResult: (handler) => onAppEvent('action:result', handler),
};
