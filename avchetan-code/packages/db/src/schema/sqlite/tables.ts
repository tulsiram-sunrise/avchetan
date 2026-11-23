import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import * as E from '../enums';

/**
 * Client (SQLite) schema. Instants are ISO-8601 UTC text, local dates `YYYY-MM-DD` text,
 * booleans integers, JSON text. Synced tables have no UNIQUE constraints besides the
 * primary key: rows arrive via LWW sync and must always be accepted
 * (docs/conventions/database.md). Foreign keys are logical only (ADR-0011).
 */

const syncColumns = () => ({
  id: text('id').primaryKey(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  updatedByDevice: text('updated_by_device').notNull(),
  deletedAt: text('deleted_at'),
});

const jsonObject = (name: string) =>
  text(name, { mode: 'json' }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`);

const jsonArray = <T>(name: string) =>
  text(name, { mode: 'json' }).$type<T[]>().notNull().default(sql`'[]'`);

const bool = (name: string) => integer(name, { mode: 'boolean' });

// ---------------------------------------------------------------- synced tables

export const rawLogs = sqliteTable(
  'raw_logs',
  {
    ...syncColumns(),
    content: text('content').notNull(),
    capturedAt: text('captured_at').notNull(),
    capturedTz: text('captured_tz').notNull(),
    source: text('source', { enum: E.RAW_LOG_SOURCES }).notNull(),
    context: jsonObject('context'),
    privacy: text('privacy', { enum: E.RAW_LOG_PRIVACY }).notNull().default('normal'),
    status: text('status', { enum: E.RAW_LOG_STATUSES }).notNull(),
    originDeviceId: text('origin_device_id').notNull(),
    processingAttempts: integer('processing_attempts').notNull().default(0),
    processingLeaseOwner: text('processing_lease_owner'),
    processingLeaseUntil: text('processing_lease_until'),
    nextAttemptAt: text('next_attempt_at'),
    processedBy: text('processed_by'),
    processedAt: text('processed_at'),
    extractionModel: text('extraction_model'),
    extractionVersion: integer('extraction_version'),
    lastError: text('last_error'),
    exampleForgottenAt: text('example_forgotten_at'),
  },
  (t) => [
    index('raw_logs_status_captured_at_idx').on(t.status, t.capturedAt),
    index('raw_logs_captured_at_idx').on(t.capturedAt),
    index('raw_logs_updated_at_idx').on(t.updatedAt),
  ],
);

export const categories = sqliteTable(
  'categories',
  {
    ...syncColumns(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    color: text('color'),
    icon: text('icon'),
    origin: text('origin', { enum: E.CATEGORY_ORIGINS }).notNull(),
    needsReview: bool('needs_review').notNull().default(false),
    mergedIntoId: text('merged_into_id'),
    archivedAt: text('archived_at'),
  },
  (t) => [index('categories_slug_idx').on(t.slug)],
);

export const projects = sqliteTable(
  'projects',
  {
    ...syncColumns(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    color: text('color'),
    archivedAt: text('archived_at'),
  },
  (t) => [index('projects_slug_idx').on(t.slug)],
);

export const activities = sqliteTable(
  'activities',
  {
    ...syncColumns(),
    rawLogId: text('raw_log_id'),
    projectId: text('project_id'),
    categoryId: text('category_id').notNull(),
    title: text('title').notNull(),
    notes: text('notes'),
    metrics: jsonObject('metrics'),
    loggedDate: text('logged_date').notNull(),
    occurredAt: text('occurred_at'),
    origin: text('origin', { enum: E.ROW_ORIGINS }).notNull(),
    isUserEdited: bool('is_user_edited').notNull().default(false),
    ordinal: integer('ordinal'),
  },
  (t) => [
    index('activities_logged_date_idx').on(t.loggedDate),
    index('activities_category_id_logged_date_idx').on(t.categoryId, t.loggedDate),
    index('activities_raw_log_id_idx').on(t.rawLogId),
    index('activities_project_id_idx').on(t.projectId),
  ],
);

export const tasks = sqliteTable(
  'tasks',
  {
    ...syncColumns(),
    rawLogId: text('raw_log_id'),
    projectId: text('project_id'),
    categoryId: text('category_id'),
    title: text('title').notNull(),
    notes: text('notes'),
    dueDate: text('due_date'),
    completedAt: text('completed_at'),
    origin: text('origin', { enum: E.ROW_ORIGINS }).notNull(),
    isUserEdited: bool('is_user_edited').notNull().default(false),
    ordinal: integer('ordinal'),
    completionNote: text('completion_note'),
    progressPct: integer('progress_pct'),
    cancelledAt: text('cancelled_at'),
    /** A repeating task: its routine (kind `task`) and the occurrence it stands for (§6). */
    routineId: text('routine_id'),
    routineDate: text('routine_date'),
    /** When to remind, a UTC instant (§7). Each device that rings schedules it. */
    remindAt: text('remind_at'),
  },
  (t) => [
    index('tasks_completed_at_due_date_idx').on(t.completedAt, t.dueDate),
    index('tasks_raw_log_id_idx').on(t.rawLogId),
  ],
);

export const tags = sqliteTable(
  'tags',
  {
    ...syncColumns(),
    name: text('name').notNull(),
    path: text('path').notNull(),
    parentId: text('parent_id'),
    color: text('color'),
    mergedIntoId: text('merged_into_id'),
    /** Entries with this tag, or one under it, are private (docs/product/private-entries.md). */
    makesPrivate: bool('makes_private').notNull().default(false),
  },
  (t) => [index('tags_path_idx').on(t.path), index('tags_parent_id_idx').on(t.parentId)],
);

export const entityTags = sqliteTable(
  'entity_tags',
  {
    ...syncColumns(),
    tagId: text('tag_id').notNull(),
    targetType: text('target_type', { enum: E.LINK_TARGET_TYPES }).notNull(),
    targetId: text('target_id').notNull(),
    isInferred: bool('is_inferred').notNull(),
    confidence: real('confidence'),
  },
  (t) => [
    index('entity_tags_target_idx').on(t.targetType, t.targetId),
    index('entity_tags_tag_id_idx').on(t.tagId),
  ],
);

export const entities = sqliteTable(
  'entities',
  {
    ...syncColumns(),
    kind: text('kind', { enum: E.ENTITY_KINDS }).notNull(),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    aliases: jsonArray<string>('aliases'),
    needsReview: bool('needs_review').notNull().default(false),
  },
  (t) => [index('entities_kind_normalized_name_idx').on(t.kind, t.normalizedName)],
);

export const entityMentions = sqliteTable(
  'entity_mentions',
  {
    ...syncColumns(),
    entityId: text('entity_id').notNull(),
    targetType: text('target_type', { enum: E.LINK_TARGET_TYPES }).notNull(),
    targetId: text('target_id').notNull(),
    role: text('role', { enum: E.MENTION_ROLES }).notNull(),
  },
  (t) => [
    index('entity_mentions_entity_id_idx').on(t.entityId),
    index('entity_mentions_target_idx').on(t.targetType, t.targetId),
  ],
);

export const contextRules = sqliteTable('context_rules', {
  ...syncColumns(),
  appPattern: text('app_pattern').notNull(),
  titlePattern: text('title_pattern'),
  projectId: text('project_id'),
  tagPaths: jsonArray<string>('tag_paths'),
  enabled: bool('enabled').notNull().default(true),
});

export const routines = sqliteTable('routines', {
  ...syncColumns(),
  title: text('title').notNull(),
  kind: text('kind', { enum: E.ROUTINE_KINDS }).notNull(),
  /** Checked with `repeatRuleSchema` by the repository and on sync (ADR-0030). */
  repeatRule: text('repeat_rule', { mode: 'json' }).$type<unknown>().notNull(),
  windowStart: text('window_start'),
  windowEnd: text('window_end'),
  categoryId: text('category_id'),
  tagId: text('tag_id'),
  pausedAt: text('paused_at'),
});

export const routineDays = sqliteTable(
  'routine_days',
  {
    ...syncColumns(),
    routineId: text('routine_id').notNull(),
    scheduledDate: text('scheduled_date').notNull(),
    status: text('status', { enum: E.ROUTINE_DAY_STATUSES }).notNull(),
    statusAt: text('status_at'),
    rawLogId: text('raw_log_id'),
  },
  (t) => [
    index('routine_days_scheduled_date_idx').on(t.scheduledDate),
    index('routine_days_routine_id_idx').on(t.routineId),
  ],
);

// ----------------------------------------------------------- client-local tables

export const syncOutbox = sqliteTable(
  'sync_outbox',
  {
    tableName: text('table_name').notNull(),
    recordId: text('record_id').notNull(),
    enqueuedAt: text('enqueued_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    /** The waiting change was made by hand, so losing it to another device is shown (ADR-0034). */
    byUser: bool('by_user').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.tableName, t.recordId] })],
);

/** A hand edit that lost to another device's, until the person picks one (ADR-0034). */
export const syncConflicts = sqliteTable(
  'sync_conflicts',
  {
    tableName: text('table_name').notNull(),
    recordId: text('record_id').notNull(),
    /** The row as this device had it, whole: Keep this one writes its visible fields again. */
    lostRow: text('lost_row', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    detectedAt: text('detected_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tableName, t.recordId] })],
);

/** Pulled rows this app couldn't read, tried again on every sync (ADR-0032). */
export const syncSetAside = sqliteTable(
  'sync_set_aside',
  {
    tableName: text('table_name').notNull(),
    recordId: text('record_id').notNull(),
    row: text('row', { mode: 'json' }).$type<unknown>().notNull(),
    setAsideAt: text('set_aside_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tableName, t.recordId] })],
);

export const syncState = sqliteTable('sync_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const llmRuns = sqliteTable(
  'llm_runs',
  {
    id: text('id').primaryKey(),
    rawLogId: text('raw_log_id'),
    purpose: text('purpose', { enum: E.LLM_PURPOSES }).notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    latencyMs: integer('latency_ms'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    ok: bool('ok').notNull(),
    errorCode: text('error_code'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('llm_runs_created_at_idx').on(t.createdAt)],
);

export const askHistory = sqliteTable('ask_history', {
  id: text('id').primaryKey(),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  citedIds: jsonArray<string>('cited_ids'),
  createdAt: text('created_at').notNull(),
});

export const extractionCorrections = sqliteTable(
  'extraction_corrections',
  {
    id: text('id').primaryKey(),
    rawLogId: text('raw_log_id').notNull(),
    targetType: text('target_type', { enum: E.CORRECTION_TARGET_TYPES }).notNull(),
    targetId: text('target_id').notNull(),
    field: text('field').notNull(),
    before: text('before', { mode: 'json' }).$type<unknown>(),
    after: text('after', { mode: 'json' }).$type<unknown>(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('extraction_corrections_created_at_idx').on(t.createdAt)],
);
