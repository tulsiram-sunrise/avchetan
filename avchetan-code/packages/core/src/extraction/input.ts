import type { ClientStore, RawLog } from '@avchetan/db/sqlite';
import { addDays, type LocalDate, localDate, type Weekday, weekdayOf } from '@avchetan/shared';
import { parseCaptureText } from '../normalize/capture-text';

const MAX_TAGS = 150;
const MAX_ENTITIES = 100;
const DAYS_AHEAD = 7;

/** What the user's data already contains. Lets the model reuse names instead of inventing them. */
export type ExtractionVocabulary = {
  categories: { id: string; slug: string; name: string; description: string | null }[];
  /** Old slugs of merged categories, so they keep resolving. */
  categoryAliases: { slug: string; id: string }[];
  projects: { id: string; name: string; description: string | null }[];
  tagPaths: string[];
  entityNames: string[];
};

export async function loadVocabulary(store: ClientStore): Promise<ExtractionVocabulary> {
  const { categories, projects, tags, entities } = store.repos;
  const [activeCategories, categoryAliases, activeProjects, tagPaths, entityNames] =
    await Promise.all([
      categories.listActive(store.db),
      categories.listMergedAliases(store.db),
      projects.listActive(store.db),
      tags.listRecentPaths(store.db, MAX_TAGS),
      entities.listRecentNames(store.db, MAX_ENTITIES),
    ]);
  return {
    categories: activeCategories.map(({ id, slug, name, description }) => ({
      id,
      slug,
      name,
      description,
    })),
    categoryAliases,
    projects: activeProjects.map(({ id, name, description }) => ({ id, name, description })),
    tagPaths,
    entityNames,
  };
}

export type ExtractionInput = {
  content: string;
  explicitTags: string[];
  context: Record<string, unknown>;
  /** Local date of capture, not of processing: "tomorrow" means tomorrow from then. */
  today: LocalDate;
  weekday: Weekday;
  /** The coming days, so the model looks dates up instead of calculating them. */
  upcoming: { date: LocalDate; weekday: Weekday }[];
  vocabulary: ExtractionVocabulary;
};

export function buildExtractionInput(
  rawLog: Pick<RawLog, 'content' | 'context' | 'capturedAt' | 'capturedTz'>,
  vocabulary: ExtractionVocabulary,
): ExtractionInput {
  const today = localDate(rawLog.capturedAt, rawLog.capturedTz);
  const upcoming = Array.from({ length: DAYS_AHEAD }, (_, index) => {
    const date = addDays(today, index + 1);
    return { date, weekday: weekdayOf(date) };
  });
  return {
    content: rawLog.content,
    explicitTags: parseCaptureText(rawLog.content).tagPaths,
    context: rawLog.context,
    today,
    weekday: weekdayOf(today),
    upcoming,
    vocabulary,
  };
}
