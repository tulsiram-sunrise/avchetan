import { createLogger } from '@avchetan/shared';
import { emit, listen } from '@tauri-apps/api/event';
import { z } from 'zod';

const log = createLogger('events');

const mainViewSchema = z.enum(['timeline', 'settings']);
export type MainView = z.infer<typeof mainViewSchema>;

/** App-wide events. Payloads carry IDs and table names only, never content. */
const eventSchemas = {
  /** Rust → dock: the dock was just shown. */
  'dock:shown': z.null(),
  /** Any window → all: these tables changed; refetch queries keyed by them. */
  'logs:changed': z.object({ tables: z.array(z.string()) }),
  /** Rust → main: switch to a view. */
  'main:navigate': z.object({ view: mainViewSchema }),
};

export type AppEvents = { [K in keyof typeof eventSchemas]: z.infer<(typeof eventSchemas)[K]> };
export type AppEventName = keyof AppEvents;

export function emitAppEvent<K extends keyof AppEvents>(name: K, payload: AppEvents[K]) {
  return emit(name, payload);
}

/** Returns an unsubscribe function (resolves once the listener is registered). */
export function onAppEvent<K extends keyof AppEvents>(
  name: K,
  handler: (payload: AppEvents[K]) => void,
): Promise<() => void> {
  return listen(name, (event) => {
    const parsed = eventSchemas[name].safeParse(event.payload);
    if (!parsed.success) {
      log.warn('dropped event with invalid payload', { event: name });
      return;
    }
    // `parsed.data` is the schema type for `name`; TS can't narrow the indexed schema.
    handler(parsed.data as AppEvents[K]);
  });
}
