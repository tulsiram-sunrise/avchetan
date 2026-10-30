import type { Activity, ClientStore, DataScope, Task } from '@avchetan/db/sqlite';
import { type LocalDate, localDate } from '@avchetan/shared';
import { tool } from 'ai';
import { z } from 'zod';
import { aggregate, aggregationSchema, groupingSchema, streaks } from './compute';

const MAX_ROWS = 5000;
const DEFAULT_LIST = 30;
const MAX_LIST = 100;
const MAX_TEXT = 500;

const date = z.string().describe('YYYY-MM-DD').optional();
const filters = {
  category: z.string().optional().describe('Category slug from list_categories'),
  tag: z.string().optional().describe('Tag path; nested tags are included'),
  from: date,
  to: date,
};

const clip = (text: string | null) => (text ? text.slice(0, MAX_TEXT) : null);

/**
 * Answers are shown as plain text. Models also write 【3】 and [1, 2], which become [3] [1] [2],
 * and **bold**, which would show its asterisks.
 */
export function normalizeCitations(text: string): string {
  return text
    .replaceAll('**', '')
    .replace(/[[【]\s*(\d+(?:\s*[,，]\s*\d+)*)\s*[\]】]/g, (_match, numbers: string) =>
      numbers
        .split(/\s*[,，]\s*/)
        .map((number) => `[${number}]`)
        .join(' '),
    );
}

/** Gives each source entry a short number for the model to cite as [3]. */
export function createCitations() {
  const numbers = new Map<string, number>();
  return {
    numberOf(rawLogId: string): number {
      const known = numbers.get(rawLogId);
      if (known) return known;
      numbers.set(rawLogId, numbers.size + 1);
      return numbers.size;
    },
    /** Removes citations nothing was ever numbered with: a model sometimes cites a total. */
    withoutInvented(answer: string): string {
      const known = new Set(numbers.values());
      return answer.replace(/\s*\[(\d+)\]/g, (citation, number) =>
        known.has(Number(number)) ? citation : '',
      );
    },
    /** Log IDs for the numbers really found in `answer`. */
    citedIn(answer: string): { number: number; rawLogId: string }[] {
      const used = new Set(
        [...normalizeCitations(answer).matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])),
      );
      return [...numbers]
        .filter(([, number]) => used.has(number))
        .map(([rawLogId, number]) => ({ number, rawLogId }));
    },
  };
}
export type Citations = ReturnType<typeof createCitations>;

/**
 * Read-only tools the model answers from. `scope` decides whether private entries are visible:
 * they never are when the model is a cloud one, whatever the question.
 */
export function createAnalysisTools(
  store: ClientStore,
  context: { scope: DataScope; today: LocalDate; citations: Citations },
) {
  const { scope, today, citations } = context;
  const { db, queries, repos } = store;
  const cite = (rawLogId: string | null) => (rawLogId ? citations.numberOf(rawLogId) : null);

  async function categoryName(): Promise<(id: string) => string> {
    const rows = await repos.categories.listResolved(db);
    const slugs = new Map(rows.map(({ id, resolved }) => [id, resolved.slug]));
    return (id) => slugs.get(id) ?? 'other';
  }

  /** IDs of rows carrying `tag`, directly or through the entry they came from. */
  async function taggedWith(tag: string) {
    const targets = await queries.tagTargets(db, tag);
    const of = (type: string) =>
      new Set(targets.filter((t) => t.targetType === type).map((t) => t.targetId));
    const logs = of('raw_log');
    const activities = of('activity');
    const tasks = of('task');
    return (row: Activity | Task, type: 'activity' | 'task') =>
      (type === 'activity' ? activities : tasks).has(row.id) ||
      (row.rawLogId !== null && logs.has(row.rawLogId));
  }

  async function matchingActivities(input: {
    category?: string | undefined;
    tag?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
  }) {
    const rows = await queries.activitiesForAnalysis(db, {
      ...scope,
      from: input.from,
      to: input.to,
      limit: MAX_ROWS,
    });
    const slugOf = await categoryName();
    const hasTag = input.tag ? await taggedWith(input.tag) : null;
    return rows.filter(
      (row) =>
        (!input.category || slugOf(row.categoryId) === input.category) &&
        (!hasTag || hasTag(row, 'activity')),
    );
  }

  return {
    list_categories: tool({
      description: 'List the category slugs. Call this before filtering by category.',
      inputSchema: z.object({}),
      execute: async () => {
        const categories = await repos.categories.listActive(db);
        return categories.map(({ slug, name }) => ({ slug, name }));
      },
    }),

    list_tags: tool({
      description: 'List known tags, optionally starting with a prefix.',
      inputSchema: z.object({ prefix: z.string().optional() }),
      execute: async ({ prefix }) => {
        const paths = await repos.tags.listRecentPaths(db, MAX_LIST, scope);
        return prefix ? paths.filter((path) => path.startsWith(prefix)) : paths;
      },
    }),

    search_entries: tool({
      description:
        'Search the original text of entries for a word, like knee or a person’s name. Use this ' +
        'for symptoms, people, places and anything else not in a metric. Newest first.',
      inputSchema: z.object({
        text: z.string().min(1).describe('One word or a short phrase'),
        from: date,
        to: date,
        limit: z.number().int().min(1).max(MAX_LIST).optional(),
      }),
      execute: async ({ text, from, to, limit }) => {
        const logs = await queries.searchLogs(db, {
          ...scope,
          text,
          limit: limit ?? DEFAULT_LIST,
        });
        // "Yesterday my knee hurt" belongs to the day it happened, not the day it was typed.
        const { activities } = await queries.extractedFrom(
          db,
          logs.map((log) => log.id),
        );
        const happenedOn = new Map(activities.map((row) => [row.rawLogId, row.loggedDate]));
        return logs
          .map((log) => ({
            log,
            date: happenedOn.get(log.id) ?? localDate(log.capturedAt, log.capturedTz),
          }))
          .filter(({ date }) => (!from || date >= from) && (!to || date <= to))
          .map(({ log, date }) => ({
            ref: citations.numberOf(log.id),
            date,
            text: clip(log.content),
          }));
      },
    }),

    query_activities: tool({
      description:
        'Find activities that happened, newest first, with their metrics. Each has a ref to cite.',
      inputSchema: z.object({
        ...filters,
        text: z.string().optional().describe('Words in the title or notes'),
        limit: z.number().int().min(1).max(MAX_LIST).optional(),
      }),
      execute: async ({ text, limit, ...input }) => {
        const slugOf = await categoryName();
        const needle = text?.toLowerCase();
        const rows = (await matchingActivities(input)).filter(
          (row) =>
            !needle ||
            row.title.toLowerCase().includes(needle) ||
            row.notes?.toLowerCase().includes(needle),
        );
        return {
          totalFound: rows.length,
          activities: rows.slice(0, limit ?? DEFAULT_LIST).map((row) => ({
            ref: cite(row.rawLogId),
            date: row.loggedDate,
            category: slugOf(row.categoryId),
            title: row.title,
            notes: clip(row.notes),
            metrics: row.metrics,
          })),
        };
      },
    }),

    aggregate_metrics: tool({
      description:
        'Count activities, or total, average, min or max a metric such as duration_min or ' +
        'distance_km. Use this for every number. Omit metric to count activities.',
      inputSchema: z.object({
        ...filters,
        metric: z.string().optional(),
        agg: aggregationSchema,
        groupBy: groupingSchema.optional(),
      }),
      execute: async ({ metric, agg, groupBy, ...input }) => {
        const rows = await matchingActivities(input);
        const used = metric ? rows.filter((row) => typeof row.metrics[metric] === 'number') : rows;
        const measured = used.map((row) => ({
          date: row.loggedDate,
          value: metric ? (row.metrics[metric] as number) : 1,
        }));
        return {
          ...aggregate(measured, metric ? agg : 'count', groupBy ?? 'none'),
          sourceRefs: used.slice(0, 10).map((row) => cite(row.rawLogId)),
        };
      },
    }),

    query_tasks: tool({
      description: 'Find tasks by status: open, done or overdue. Each has a ref to cite.',
      inputSchema: z.object({
        status: z.enum(['open', 'done', 'overdue']),
        from: date,
        to: date,
        tag: filters.tag,
        limit: z.number().int().min(1).max(MAX_LIST).optional(),
      }),
      execute: async ({ status, from, to, tag, limit }) => {
        const rows = await queries.tasksForAnalysis(db, { ...scope, limit: MAX_ROWS });
        const hasTag = tag ? await taggedWith(tag) : null;
        const matches = rows.filter((row) => {
          const done = row.completedAt !== null;
          if (status === 'done' ? !done : done) return false;
          if (status === 'overdue' && !(row.dueDate && row.dueDate < today)) return false;
          if (from && !(row.dueDate && row.dueDate >= from)) return false;
          if (to && !(row.dueDate && row.dueDate <= to)) return false;
          return !hasTag || hasTag(row, 'task');
        });
        return {
          totalFound: matches.length,
          tasks: matches.slice(0, limit ?? DEFAULT_LIST).map((row) => ({
            ref: cite(row.rawLogId),
            title: row.title,
            notes: clip(row.notes),
            dueDate: row.dueDate,
            done: row.completedAt !== null,
          })),
        };
      },
    }),

    streaks: tool({
      description: 'Consecutive days with an activity in a category or tag.',
      inputSchema: z.object({ category: filters.category, tag: filters.tag }),
      execute: async (input) => {
        const rows = await matchingActivities(input);
        return streaks(
          rows.map((row) => row.loggedDate),
          today,
        );
      },
    }),

    get_logs: tool({
      description: 'Read the full text of entries by their ref.',
      inputSchema: z.object({ refs: z.array(z.number().int()).max(10) }),
      execute: async ({ refs }) => {
        const known = citations.citedIn(refs.map((ref) => `[${ref}]`).join(' '));
        const logs = await queries.logsById(
          db,
          known.map((item) => item.rawLogId),
          scope,
        );
        return logs.map((log) => ({
          ref: citations.numberOf(log.id),
          capturedAt: log.capturedAt,
          text: clip(log.content),
        }));
      },
    }),
  };
}
