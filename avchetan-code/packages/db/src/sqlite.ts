/** Client (SQLite) entry point: `@avchetan/db/sqlite`. */
export { type ApplyResult, applyRemoteChanges, type RemoteChange } from './client/apply-remote';
export {
  BACKUPS_KEPT,
  backupFileName,
  type DailyBackupOptions,
  startDailyBackups,
} from './client/backup';
export type {
  Collection,
  CollectionMetric,
  CollectionSummary,
} from './client/collections';
export {
  type ClientDatabase,
  type ClientDb,
  type ClientSchema,
  createClientDatabase,
  type SqliteExecutor,
  type Tx,
} from './client/database';
export {
  collectExport,
  type DataExport,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  type ExportFile,
  exportFiles,
  exportFolderName,
  toCsv,
} from './client/export';
export {
  getSetting,
  getSyncState,
  insertLlmRun,
  loadOverdueOpen,
  type NewLlmRun,
  OVERDUE_OPEN_SETTING,
  type SyncStateKey,
  saveOverdueOpen,
  setSetting,
  setSyncState,
} from './client/local';
export { compareVersions, type RowVersion } from './client/lww';
export { ackOutbox, listOutbox, type OutboxEntry } from './client/outbox';
export type {
  DuplicatePair,
  EntitySummary,
  PersonDetail,
  PersonSummary,
  PromiseDirection,
  PromiseItem,
  PromiseLink,
  PromiseStatus,
} from './client/people';
export * as people from './client/people';
export type { DataScope } from './client/privacy';
export type {
  CorrectedActivity,
  CorrectedEntry,
  CorrectedItem,
  CorrectedTask,
  DayTasks,
  MonthDay,
  RawLogCursor,
  RawLogDetail,
  TaskGroup,
} from './client/queries';
export * as queries from './client/queries';
export { LIST_PAGE, TASK_GROUP_TITLES, TASK_GROUPS } from './client/queries';
export type { Activity, ActivityEdit, NewActivity } from './client/repos/activities';
export {
  type Category,
  SEED_CATEGORIES,
  type SeedCategorySlug,
  seedCategoryId,
} from './client/repos/categories';
export type { ContextRule, ContextRuleFields } from './client/repos/context-rules';
export {
  type Entity,
  type EntityMention,
  isUnnamedPerson,
  normalizeEntityName,
  PROMISE_ROLES,
  type PromiseRole,
} from './client/repos/entities';
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
export {
  type EntryHit,
  filterLogs,
  type HighlightPart,
  hasFilters,
  highlightParts,
  matchQuery,
  type SearchFilters,
  type SearchOptions,
  searchEntries,
  searchTasks,
  type TaskHit,
} from './client/search';
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
export type { TrendFilter, TrendKey, TrendOptions } from './client/trends';
export { sqliteMigrations } from './migrations/sqlite.generated';
export * from './schema/sqlite/tables';
