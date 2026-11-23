import type { WriteContext } from '@avchetan/core';
import type { ClientStore } from '@avchetan/db/sqlite';
import { localDate, systemTimeZone } from '@avchetan/shared';

/** What core's shared writes need from this phone. */
export function writeContext(store: ClientStore): WriteContext {
  return {
    store,
    today: () => localDate(store.clock.now(), systemTimeZone()),
    textSource: 'mobile_text',
  };
}
