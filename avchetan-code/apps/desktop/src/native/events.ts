import { clipboardReadSchema, windowContextSchema } from '@avchetan/core';
import { createLogger } from '@avchetan/shared';
import { emit, listen } from '@tauri-apps/api/event';
import { z } from 'zod';
import { settingsTabSchema } from '../main-window/settings-tabs';
import { actionRequestSchema, actionResultSchema } from '../services/actions';
import { lockStatusSchema } from './lock';

const log = createLogger('events');

const mainViewSchema = z.enum([
  'timeline',
  'tasks',
  'people',
  'review',
  'categories',
  'tags',
  'projects',
  'settings',
  'setup',
  'check',
]);
export type MainView = z.infer<typeof mainViewSchema>;

/** App-wide events, local to this app. Only action requests carry user text; none are logged. */
const eventSchemas = {
  /**
   * Rust → dock: the dock was just shown. `context` is the window that was in front when the
   * hotkey fired (null from the tray), before any setting is applied (window-context.md).
   * `clipboard` is set only by the clipboard shortcut; `already_open` means the dock was in
   * front then, so its window and text stay (clipboard-snap.md).
   */
  'dock:shown': z.object({
    context: windowContextSchema.nullable(),
    clipboard: clipboardReadSchema.nullable().default(null),
    already_open: z.boolean().default(false),
  }),
  /** Rust (tray) → dock: pause window context for an hour, or resume it. */
  'context:toggle-pause': z.null(),
  /** Any window → all: these tables changed; refetch queries keyed by them. */
  'logs:changed': z.object({ tables: z.array(z.string()) }),
  /**
   * Rust or a window → main: switch to a view; `day` opens that day in Days (a brief
   * notification), `tab` a tab of Settings.
   */
  'main:navigate': z.object({
    view: mainViewSchema,
    day: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullish(),
    tab: settingsTabSchema.nullish(),
  }),
  /** Main → dock: make this day's daily brief now (Make the brief now, Make it again). */
  'brief:make': z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  /** Dock → main: a brief is being made, or no longer. */
  'brief:state': z.object({ day: z.string(), making: z.boolean() }),
  /** Main → dock: please do this write. */
  'action:request': actionRequestSchema,
  /** Dock → main: how it went. */
  'action:result': actionResultSchema,
  /** Rust → all: the app lock was locked, unlocked or changed (src-tauri/src/app_lock.rs). */
  'lock:changed': lockStatusSchema,
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
