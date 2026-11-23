import { type EventSubscription, requireOptionalNativeModule } from 'expo';

export type Shared = { text: string; subject: string | null };

type Native = {
  takeShared(): Shared | null;
  addListener(event: 'onShare', listener: () => void): EventSubscription;
};

/** Android's share sheet (android/…/ShareIntentModule.kt); absent in tests and on the web. */
const native = requireOptionalNativeModule<Native>('ShareIntent');

/** What another app shared to Avchetan, once (docs/product/tasks-routines-reminders.md §12). */
export function takeShared(): Shared | null {
  return native?.takeShared() ?? null;
}

/** Called when a share reaches the app while it is open; take it with `takeShared`. */
export function onShare(listener: () => void): () => void {
  const subscription = native?.addListener('onShare', listener);
  return () => subscription?.remove();
}
