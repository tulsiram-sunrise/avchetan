import type { ClientStore, Conflict, ConflictField } from '@avchetan/db/sqlite';
import { describeRepeatRule, formatDay, formatTime, repeatRuleSchema } from '@avchetan/shared';
import { metricsText } from '../normalize/metrics-display';

/** How the *Changed on two devices* notice names each field (ADR-0034). */
const FIELD_LABELS: Record<ConflictField, string> = {
  title: 'Title',
  notes: 'Notes',
  dueDate: 'Due',
  completedAt: 'Done',
  completionNote: 'How it went',
  progressPct: 'Partly done',
  cancelledAt: 'Cancelled',
  remindAt: 'Reminder',
  deletedAt: 'Deleted',
  categoryId: 'Category',
  metrics: 'Numbers',
  loggedDate: 'Day',
  kind: 'Kind',
  repeatRule: 'Repeats',
  windowStart: 'From',
  windowEnd: 'Until',
  pausedAt: 'Paused',
  privacy: 'Private',
};

const YES_NO = new Set<ConflictField>(['completedAt', 'cancelledAt', 'pausedAt', 'deletedAt']);

export type ConflictLine = { label: string; mine: string; theirs: string };

export type ConflictNotice = {
  /** What changed: a task's or routine's title, or the start of an entry. */
  title: string;
  /** What kind of thing it is, for the line under the title. */
  kind: string;
  lines: ConflictLine[];
};

const KINDS: Record<Conflict['table'], string> = {
  tasks: 'Task',
  activities: 'Activity',
  routines: 'Routine',
  raw_logs: 'Entry',
};

function shown(field: ConflictField, value: unknown, categoryName: (id: string) => string): string {
  if (YES_NO.has(field)) return value == null ? 'no' : 'yes';
  if (field === 'privacy') return value === 'normal' ? 'no' : 'yes';
  if (value == null || value === '') return 'none';
  if (field === 'progressPct') return `${String(value)}%`;
  if (field === 'remindAt' && typeof value === 'string') {
    return `${formatDay(value)}, ${formatTime(value)}`;
  }
  if (field === 'categoryId' && typeof value === 'string') return categoryName(value);
  if (field === 'metrics' && typeof value === 'object') {
    return metricsText(value as Record<string, unknown>) || 'none';
  }
  if (field === 'repeatRule') {
    const rule = repeatRuleSchema.safeParse(value);
    return rule.success ? describeRepeatRule(rule.data) : 'a rule this app can’t read';
  }
  return String(value);
}

/** The notice's text for one conflict: what it is, and each visible field on both devices. */
export function describeConflict(
  conflict: Conflict,
  categoryName: (id: string) => string = () => 'another category',
): ConflictNotice {
  const current = conflict.current as Record<string, unknown>;
  const name =
    typeof current.title === 'string'
      ? current.title
      : typeof current.content === 'string'
        ? current.content.replace(/\s+/g, ' ').trim()
        : '';
  return {
    title: name.length > 60 ? `${name.slice(0, 60)}…` : name,
    kind: KINDS[conflict.table],
    lines: conflict.changes.map(({ field, mine, theirs }) => ({
      label: FIELD_LABELS[field],
      mine: shown(field, mine, categoryName),
      theirs: shown(field, theirs, categoryName),
    })),
  };
}

/** The edits made on two devices to show on this device, newest first, with their text. */
export async function loadConflictNotices(
  store: ClientStore,
): Promise<(ConflictNotice & { table: Conflict['table']; id: string })[]> {
  const conflicts = await store.conflicts();
  if (conflicts.length === 0) return [];
  const categories = await store.repos.categories.listActive(store.db);
  const names = new Map(categories.map((category) => [category.id, category.name]));
  return conflicts.map((conflict) => ({
    table: conflict.table,
    id: conflict.id,
    ...describeConflict(conflict, (id) => names.get(id) ?? 'another category'),
  }));
}
