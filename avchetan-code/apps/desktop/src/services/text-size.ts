import { createLogger } from '@avchetan/shared';

const log = createLogger('text-size');

/**
 * The root font size for Windows' Text size (docs/product/tasks-routines-reminders.md §13):
 * text and spacing are in `rem`, so the whole window grows with it, as in Windows' own apps.
 * Anything outside 100–225% is taken as 100%.
 */
export function rootFontSize(factor: number): string {
  const safe = Number.isFinite(factor) && factor >= 1 ? Math.min(factor, 2.25) : 1;
  return `${Math.round(safe * 100)}%`;
}

/**
 * Follows Windows' Text size in this window: at start, and each time the window comes to the
 * front (the setting is changed in another window, Settings).
 */
export async function followTextSize(
  textScale: () => Promise<number>,
  root: HTMLElement = document.documentElement,
): Promise<void> {
  const apply = async () => {
    try {
      root.style.fontSize = rootFontSize(await textScale());
    } catch {
      log.warn('could not read the text size');
    }
  };
  window.addEventListener('focus', () => void apply());
  await apply();
}
