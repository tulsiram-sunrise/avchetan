/**
 * Category colours for the Days view (docs/product/days-view.md). Each has a value for light
 * and for dark backgrounds. A category's own `color` wins; otherwise the seeds have fixed ones
 * and any other slug picks one by hash, so every device agrees without syncing a colour.
 */
export type ColorScheme = 'light' | 'dark';

type Swatch = { light: string; dark: string };

export const CATEGORY_PALETTE: readonly Swatch[] = [
  { light: '#2563eb', dark: '#60a5fa' }, // blue
  { light: '#16a34a', dark: '#4ade80' }, // green
  { light: '#ea580c', dark: '#fb923c' }, // orange
  { light: '#dc2626', dark: '#f87171' }, // red
  { light: '#9333ea', dark: '#c084fc' }, // purple
  { light: '#0d9488', dark: '#2dd4bf' }, // teal
  { light: '#db2777', dark: '#f472b6' }, // pink
  { light: '#ca8a04', dark: '#facc15' }, // amber
];

/** For entries nothing was organized from yet. */
export const UNORGANIZED_COLOR: Swatch = { light: '#9ca3af', dark: '#6b7280' };

const SEED_SWATCH: Record<string, number> = {
  work: 0,
  workout: 1,
  diet: 2,
  health: 3,
  reflection: 4,
  other: 5,
};

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

const HEX = /^#[0-9a-f]{6}$/i;

export function categoryColor(
  category: { slug: string; color?: string | null },
  scheme: ColorScheme,
): string {
  if (category.color && HEX.test(category.color)) return category.color;
  const index = SEED_SWATCH[category.slug] ?? hash(category.slug) % CATEGORY_PALETTE.length;
  return (CATEGORY_PALETTE[index] as Swatch)[scheme];
}
