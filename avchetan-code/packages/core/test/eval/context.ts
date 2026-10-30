import type { ClientStore, RawLog } from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import { type ExtractionVocabulary, loadVocabulary } from '../../src/extraction/input';
import { FIXTURE_TIME_ZONE, type Fixture } from './fixtures';
import type { MatchContext } from './match';

export type EvalContext = {
  store: ClientStore;
  vocabulary: ExtractionVocabulary;
  match: MatchContext;
};

/** The data every fixture runs against: default categories, one project, one nested tag. */
export async function openEvalContext(): Promise<EvalContext> {
  const { store } = await openTestStore();
  await store.write(async (tx) => {
    await store.repos.projects.create(tx, {
      name: 'Home Renovation',
      description: 'Fixing up the flat: tiles, paint, furniture',
    });
    const tag = await store.repos.tags.ensurePath(tx, 'health/knee');
    const log = await store.repos.rawLogs.capture(tx, {
      content: 'made-up seed entry',
      source: 'desktop_text',
      capturedTz: FIXTURE_TIME_ZONE,
    });
    await store.repos.tags.link(tx, {
      tagId: tag.id,
      targetType: 'raw_log',
      targetId: log.id,
      isInferred: false,
    });
  });
  const vocabulary = await loadVocabulary(store);
  const slugs = new Map(vocabulary.categories.map(({ id, slug }) => [id, slug]));
  const projects = new Map(vocabulary.projects.map(({ id, name }) => [id, name]));
  return {
    store,
    vocabulary,
    match: {
      slugOf: (id) => slugs.get(id) ?? 'unknown',
      projectOf: (id) => projects.get(id) ?? 'unknown',
    },
  };
}

export function captureFixture(store: ClientStore, fixture: Fixture): Promise<RawLog> {
  return store.write((tx) =>
    store.repos.rawLogs.capture(tx, {
      content: fixture.text,
      source: 'desktop_text',
      capturedTz: FIXTURE_TIME_ZONE,
      capturedAt: fixture.at,
    }),
  );
}
