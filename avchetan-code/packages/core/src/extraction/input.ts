import type { ClientStore, CorrectedEntry, DataScope, RawLog } from '@avchetan/db/sqlite';
import { addDays, type LocalDate, localDate, type Weekday, weekdayOf } from '@avchetan/shared';
import { windowContextOf } from '../context/window-context';
import { parseCaptureText } from '../normalize/capture-text';
import { chooseExamples, loadCorrectionPool, renderExample } from './corrections';

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
  /** Recently corrected entries; each extraction picks its examples from these. */
  corrections: CorrectedEntry[];
};

/** The default scope is the safe one: nothing from private entries. */
export async function loadVocabulary(
  store: ClientStore,
  scope: DataScope = { includePrivate: false },
  options: { corrections?: boolean } = {},
): Promise<ExtractionVocabulary> {
  const { categories, projects, tags, entities } = store.repos;
  const [activeCategories, categoryAliases, activeProjects, tagPaths, entityNames, corrections] =
    await Promise.all([
      categories.listActive(store.db, scope),
      categories.listMergedAliases(store.db),
      projects.listActive(store.db),
      tags.listRecentPaths(store.db, MAX_TAGS, scope),
      entities.listRecentNames(store.db, MAX_ENTITIES, scope),
      options.corrections ? loadCorrectionPool(store, scope) : [],
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
    corrections,
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
  /** The user's past corrections most like this entry, as prompt text. */
  corrections: string[];
};

/**
 * What the model may see of an entry's context: the window it was typed over, as a hint
 * (window-context.md). Not the rule matches (rules decide on their own) nor bookkeeping keys.
 */
function promptContext(context: Record<string, unknown>): Record<string, unknown> {
  const window = windowContextOf(context);
  if (!window) return {};
  return {
    app: window.app_name,
    ...(window.window_title ? { window_title: window.window_title } : {}),
  };
}

export function buildExtractionInput(
  rawLog: Pick<RawLog, 'id' | 'content' | 'context' | 'capturedAt' | 'capturedTz'>,
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
    context: promptContext(rawLog.context),
    today,
    weekday: weekdayOf(today),
    upcoming,
    vocabulary,
    corrections: chooseExamples(rawLog.content, rawLog.id, vocabulary.corrections).map(
      renderExample,
    ),
  };
}
