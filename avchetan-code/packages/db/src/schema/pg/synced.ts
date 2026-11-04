import * as S from './tables';

/** Synced tables by name on the server, for code that handles any of them. */
export const PG_SYNCED_TABLES = {
  raw_logs: S.rawLogs,
  categories: S.categories,
  projects: S.projects,
  activities: S.activities,
  tasks: S.tasks,
  tags: S.tags,
  entity_tags: S.entityTags,
  entities: S.entities,
  entity_mentions: S.entityMentions,
  context_rules: S.contextRules,
} as const;

export type PgSyncedTableName = keyof typeof PG_SYNCED_TABLES;
