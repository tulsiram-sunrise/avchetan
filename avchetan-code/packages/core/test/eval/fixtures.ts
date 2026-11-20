import { localDate } from '@avchetan/shared';
import { z } from 'zod';
import type { ChoreChoice } from '../../src/extraction/input';
import entries from '../fixtures/extraction/entries.json';

/** Made-up entries with what a good extraction must contain. See docs/architecture/extraction-pipeline.md §8. */
const expectedActivity = z.object({
  /** A slug, any of several, or "new" for a category the model proposed. */
  category: z.union([z.string(), z.array(z.string())]).optional(),
  date: z.string().optional(),
  metrics: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  exercises: z.array(z.string()).optional(),
  project: z.string().optional(),
});

const expectedTask = z.object({
  dueDate: z.string().nullable().optional(),
  /** The reminder as a UTC instant (fixtures are in UTC), or null for none (§8). */
  remindAt: z.string().nullable().optional(),
  titleHas: z.string().optional(),
});

/** A task linked to a person as a promise (docs/product/people-and-promises.md). */
const expectedPromise = z.object({
  person: z.string(),
  /** owed_to: the user owes the person; owed_by: the person owes the user. */
  role: z.enum(['owed_to', 'owed_by']),
  titleHas: z.string().optional(),
});

export const fixtureSchema = z.object({
  id: z.string(),
  text: z.string(),
  at: z.string(),
  /** Text attached with clipboard snap (docs/product/clipboard-snap.md). */
  clipboard: z.string().optional(),
  /** Titles of the chores still open that day (docs/product/tasks-routines-reminders.md §5). */
  chores: z.array(z.string()).default([]),
  expect: z.object({
    activities: z.array(expectedActivity).default([]),
    tasks: z.array(expectedTask).default([]),
    tags: z.array(z.string()).default([]),
    entities: z.array(z.string()).default([]),
    /** When given, exactly these promise links (an empty list: none). */
    promises: z.array(expectedPromise).optional(),
    /** When given, exactly these chores are ticked (an empty list: none). */
    choresDone: z.array(z.string()).optional(),
    newCategory: z.boolean().default(false),
    skip: z.boolean().default(false),
  }),
});
export type Fixture = z.infer<typeof fixtureSchema>;

export const FIXTURES: readonly Fixture[] = z.array(fixtureSchema).parse(entries);

/** Every fixture is captured here, so day names resolve the same on every run. */
export const FIXTURE_TIME_ZONE = 'UTC';

const CHORE_ID = 'chore:';

/** A fixture's open chores. The routine ID carries the title, so a tick reads back as its title. */
export function fixtureChores(fixture: Fixture): ChoreChoice[] {
  const date = localDate(fixture.at, FIXTURE_TIME_ZONE);
  return fixture.chores.map((title) => ({ routineId: CHORE_ID + title, date, title }));
}

export const choreTitleOf = (routineId: string) => routineId.slice(CHORE_ID.length);
