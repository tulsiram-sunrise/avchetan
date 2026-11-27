/** What an activity or task needs for `keptOnReorganize`. */
export interface OrganizedItem {
  origin: string;
  isUserEdited: boolean;
}

/** The repository keeps these when an entry is organized again (`repos/extraction.ts`). */
function kept(item: OrganizedItem): boolean {
  return item.isUserEdited || item.origin !== 'extraction';
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The line under *Organize again* when it will leave some of the entry's items alone, so a number
 * that stays the same after organizing again isn't a surprise:
 * "Organize again keeps what you edited or added (1 activity). Change it by hand."
 */
export function keptOnReorganize(items: {
  activities: readonly OrganizedItem[];
  tasks: readonly OrganizedItem[];
}): string | null {
  const activities = items.activities.filter(kept).length;
  const tasks = items.tasks.filter(kept).length;
  if (activities + tasks === 0) return null;
  const parts = [
    activities > 0 ? count(activities, 'activity', 'activities') : null,
    tasks > 0 ? count(tasks, 'task', 'tasks') : null,
  ].filter((part) => part !== null);
  const them = activities + tasks === 1 ? 'it' : 'them';
  return `Organize again keeps what you edited or added (${parts.join(', ')}). Change ${them} by hand.`;
}
