import type { MonthDay } from '@avchetan/db/sqlite';
import { type ColorScheme, categoryColor, UNORGANIZED_COLOR } from '@avchetan/shared';

/** One category's share of a day, for the Days view's summary line (docs/product/days-view.md). */
export type DayCategory = {
  categoryId: string;
  activities: number;
  /** Sum of `duration_min` over the activities that have one, or null when none do. */
  durationMin: number | null;
};

/**
 * A day's activities by category, most activities first. `resolve` follows category merges, so
 * activities of a merged category count under the one it was merged into.
 */
export function dayCategories(
  activities: readonly { categoryId: string; metrics: Record<string, unknown> }[],
  resolve: (categoryId: string) => string = (id) => id,
): DayCategory[] {
  const byCategory = new Map<string, DayCategory>();
  for (const activity of activities) {
    const categoryId = resolve(activity.categoryId);
    let entry = byCategory.get(categoryId);
    if (!entry) {
      entry = { categoryId, activities: 0, durationMin: null };
      byCategory.set(categoryId, entry);
    }
    entry.activities += 1;
    const duration = activity.metrics.duration_min;
    if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
      entry.durationMin = (entry.durationMin ?? 0) + duration;
    }
  }
  return [...byCategory.values()].sort(
    (a, b) => b.activities - a.activities || a.categoryId.localeCompare(b.categoryId),
  );
}

/** "45 min", "1 h 20 min", "2 h". */
export function durationText(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** "Workout 45 min", or "Diet 3" when nothing has a duration. */
export function dayCategoryText(category: DayCategory, name: string): string {
  return category.durationMin !== null
    ? `${name} ${durationText(category.durationMin)}`
    : `${name} ${category.activities}`;
}

/**
 * A calendar day's dots: up to three category colours, most used first (categories merged into
 * one show once), then grey for entries nothing was organized from yet.
 */
export function calendarDots(
  day: MonthDay | undefined,
  categories: ReadonlyMap<string, { id: string; slug: string; color: string | null }> | undefined,
  scheme: ColorScheme,
): { key: string; color: string }[] {
  if (!day) return [];
  const dots: { key: string; color: string }[] = [];
  for (const id of day.categoryIds) {
    const category = categories?.get(id);
    if (!category || dots.some((dot) => dot.key === category.id)) continue;
    dots.push({ key: category.id, color: categoryColor(category, scheme) });
    if (dots.length === 3) return dots;
  }
  if (day.unorganized) dots.push({ key: 'unorganized', color: UNORGANIZED_COLOR[scheme] });
  return dots;
}
