import { type ClientStore, getSetting, setSetting } from '@avchetan/db/sqlite';
import { z } from 'zod';

const SEE_THROUGH = 'dock.seeThrough';

/**
 * How much of Windows' blurred backdrop shows through the capture box: how opaque the panel
 * drawn over it is. Steps, not a slider: below 60% text over a bright window is hard to read
 * (docs/product/capture-box-redesign.md#3-the-new-look).
 */
export const seeThroughSchema = z.enum(['solid', 'light', 'medium', 'strong']);
export type SeeThrough = z.infer<typeof seeThroughSchema>;
export const DEFAULT_SEE_THROUGH: SeeThrough = 'medium';

/** Percent of the surface colour drawn over the backdrop. */
export const PANEL_OPACITY: Record<SeeThrough, number> = {
  solid: 100,
  light: 85,
  medium: 75,
  strong: 60,
};

export const SEE_THROUGH_OPTIONS: { value: SeeThrough; label: string }[] = [
  { value: 'solid', label: 'Solid: nothing shows through' },
  { value: 'light', label: 'Light' },
  { value: 'medium', label: 'Medium (default)' },
  { value: 'strong', label: 'Strong: best on a dark background' },
];

export async function loadSeeThrough(store: ClientStore): Promise<SeeThrough> {
  const parsed = seeThroughSchema.safeParse(await getSetting(store.db, SEE_THROUGH));
  return parsed.success ? parsed.data : DEFAULT_SEE_THROUGH;
}

export async function saveSeeThrough(store: ClientStore, seeThrough: SeeThrough): Promise<void> {
  await store.write((tx) => setSetting(tx, SEE_THROUGH, seeThrough, store.clock.now()));
}

/** The panel's background over the backdrop, as a CSS colour. */
export function panelBackground(seeThrough: SeeThrough): string {
  return `color-mix(in oklab, var(--color-surface) ${PANEL_OPACITY[seeThrough]}%, transparent)`;
}
