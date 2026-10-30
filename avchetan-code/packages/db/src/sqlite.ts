/** Client (SQLite) entry point: `@avchetan/db/sqlite`. */
export { type ApplyResult, applyRemoteChanges, type RemoteChange } from './client/apply-remote';
export {
  type ClientDatabase,
  type ClientDb,
  type ClientSchema,
  createClientDatabase,
  type SqliteExecutor,
  type Tx,
} from './client/database';
export {
  getSetting,
  getSyncState,
  insertLlmRun,
  type NewLlmRun,
  type SyncStateKey,
  setSetting,
  setSyncState,
} from './client/local';
export { compareVersions, type RowVersion } from './client/lww';
export { ackOutbox, listOutbox, type OutboxEntry } from './client/outbox';
export type { DataScope } from './client/privacy';
export type { RawLogCursor, RawLogDetail } from './client/queries';
export * as queries from './client/queries';
export type { Activity, ActivityEdit, NewActivity } from './client/repos/activities';
export {
  type Category,
  SEED_CATEGORIES,
  type SeedCategorySlug,
  seedCategoryId,
} from './client/repos/categories';
export { type Entity, type EntityMention, normalizeEntityName } from './client/repos/entities';
export {
  CATEGORY_SUGGESTIONS_SETTING,
  type CategoryProposal,
  type ExtractionPlan,
  type MentionTarget,
  NEW_CATEGORY,
  type PlannedActivity,
  type PlannedEntity,
  type PlannedTask,
} from './client/repos/extraction';
export type { Project } from './client/repos/projects';
export type { CaptureInput, RawLog } from './client/repos/raw-logs';
export type { Tag, TagLink } from './client/repos/tags';
export type { NewTask, Task, TaskEdit } from './client/repos/tasks';
export { type ClientStore, type OpenClientStoreOptions, openClientStore } from './client/store';
export {
  getById,
  insertSynced,
  insertSyncedRow,
  live,
  type NewRow,
  type RepoDeps,
  type Row,
  type RowPatch,
  SYNCED_TABLES,
  type SyncedTable,
  type SyncedTableName,
  softDeleteSynced,
  updateSynced,
  upsertSynced,
} from './client/synced';
export { sqliteMigrations } from './migrations/sqlite.generated';
export * from './schema/sqlite/tables';
