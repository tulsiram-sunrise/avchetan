import { ENTITY_KINDS, MENTION_ROLES } from '@avchetan/db';
import { z } from 'zod';

/**
 * What the model returns for one raw log. Written for strict JSON-schema providers: every
 * field is required (nullable where it can be absent) and no object is open-ended, so
 * `metrics` is a list of pairs that the normalizer folds back into an object. Nothing here
 * is trusted yet: dates, categories, tags and projects are resolved in `normalize.ts`.
 */
const metricSchema = z.object({
  key: z.string().describe('Metric key from the registry'),
  value: z.string().describe('The value, with its unit if the entry gives one'),
});

const exerciseSchema = z.object({
  name: z.string(),
  sets: z.number().nullable(),
  reps: z.number().nullable(),
  weightKg: z.number().nullable(),
  durationMin: z.number().nullable(),
});

const activitySchema = z.object({
  category: z.string().describe('An existing category slug, or the name of newCategory'),
  title: z.string().describe('Concise standardized title'),
  notes: z.string().nullable().describe('Details the metrics cannot hold'),
  metrics: z.array(metricSchema),
  exercises: z.array(exerciseSchema).describe('Exercises with their sets, reps and weight'),
  loggedDate: z.string().describe('Local date it happened, YYYY-MM-DD'),
  project: z.string().nullable().describe('An existing project name'),
  inferredTags: z.array(z.string()),
});

const taskSchema = z.object({
  title: z.string().describe('Verb-first title'),
  notes: z.string().nullable(),
  dueDate: z.string().nullable().describe('Local date, YYYY-MM-DD'),
  category: z.string().nullable().describe('An existing category slug, or the name of newCategory'),
  project: z.string().nullable().describe('An existing project name'),
  inferredTags: z.array(z.string()),
});

const entitySchema = z.object({
  kind: z.enum(ENTITY_KINDS),
  name: z.string(),
  mentions: z.array(
    z.object({
      target: z.string().describe('"log", "activity:<index>" or "task:<index>"'),
      role: z.enum(MENTION_ROLES),
    }),
  ),
});

export const extractionResultSchema = z.object({
  activities: z.array(activitySchema),
  tasks: z.array(taskSchema),
  newCategory: z
    .object({ name: z.string(), description: z.string() })
    .nullable()
    .describe('Only if no existing category fits'),
  logTags: z.array(z.string()).describe('Tags for the entry as a whole'),
  entities: z.array(entitySchema),
  skip: z
    .object({ reason: z.string() })
    .nullable()
    .describe('Set when the entry holds nothing worth recording'),
});
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
