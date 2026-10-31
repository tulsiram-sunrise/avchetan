import { z } from 'zod';
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
  titleHas: z.string().optional(),
});

export const fixtureSchema = z.object({
  id: z.string(),
  text: z.string(),
  at: z.string(),
  expect: z.object({
    activities: z.array(expectedActivity).default([]),
    tasks: z.array(expectedTask).default([]),
    tags: z.array(z.string()).default([]),
    entities: z.array(z.string()).default([]),
    newCategory: z.boolean().default(false),
    skip: z.boolean().default(false),
  }),
});
export type Fixture = z.infer<typeof fixtureSchema>;

export const FIXTURES: readonly Fixture[] = z.array(fixtureSchema).parse(entries);

/** Every fixture is captured here, so day names resolve the same on every run. */
export const FIXTURE_TIME_ZONE = 'UTC';
