import { type SQL, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  type PgColumn,
  pgSequence,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import * as E from '../enums';

/**
 * Server (Postgres / PGlite) schema. Mirrors the SQLite schema for synced tables and adds
 * `server_seq` (pull cursor) and `created_on_server_at`. Enums are text + CHECK (no pg
 * enums: easier migrations). No UNIQUE constraints besides primary keys on synced tables
 * (docs/conventions/database.md); foreign keys are logical only (ADR-0011).
 *
 * `log_embeddings` (pgvector) is added in Phase 5, when the embedding dimension is
 * configured (ADR-0012).
 */

/** Global sequence for `server_seq`; every applied write takes the next value. */
export const syncSeq = pgSequence('sync_seq');

const instant = (name: string) =>
  timestamp(name, { precision: 3, withTimezone: true, mode: 'string' });

const localDate = (name: string) => date(name, { mode: 'string' });

const syncColumns = () => ({
  id: uuid('id').primaryKey(),
  createdAt: instant('created_at').notNull(),
  updatedAt: instant('updated_at').notNull(),
  updatedByDevice: text('updated_by_device').notNull(),
  deletedAt: instant('deleted_at'),
  serverSeq: bigint('server_seq', { mode: 'number' }).notNull().default(sql`nextval('sync_seq')`),
  createdOnServerAt: instant('created_on_server_at').notNull().defaultNow(),
});

const jsonObject = (name: string) =>
  jsonb(name).$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`);

const jsonArray = <T>(name: string) => jsonb(name).$type<T[]>().notNull().default(sql`'[]'::jsonb`);

/** CHECK (column IN (...)) for a closed value set. Values are code constants, not input. */
const enumCheck = (column: PgColumn, values: readonly string[]): SQL =>
  sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`;

const seqIndex = (table: string, t: { serverSeq: PgColumn }) =>
  index(`${table}_server_seq_idx`).on(t.serverSeq);

// ---------------------------------------------------------------- synced tables

export const rawLogs = pgTable(
  'raw_logs',
  {
    ...syncColumns(),
    content: text('content').notNull(),
    capturedAt: instant('captured_at').notNull(),
    capturedTz: text('captured_tz').notNull(),
    source: text('source', { enum: E.RAW_LOG_SOURCES }).notNull(),
    context: jsonObject('context'),
    privacy: text('privacy', { enum: E.RAW_LOG_PRIVACY }).notNull().default('normal'),
    status: text('status', { enum: E.RAW_LOG_STATUSES }).notNull(),
    originDeviceId: text('origin_device_id').notNull(),
    processingAttempts: integer('processing_attempts').notNull().default(0),
    processingLeaseOwner: text('processing_lease_owner'),
    processingLeaseUntil: instant('processing_lease_until'),
    nextAttemptAt: instant('next_attempt_at'),
    processedBy: text('processed_by'),
    processedAt: instant('processed_at'),
    extractionModel: text('extraction_model'),
    extractionVersion: integer('extraction_version'),
    lastError: text('last_error'),
  },
  (t) => [
    seqIndex('raw_logs', t),
    index('raw_logs_status_captured_at_idx').on(t.status, t.capturedAt),
    index('raw_logs_captured_at_idx').on(t.capturedAt),
    check('raw_logs_source_check', enumCheck(t.source, E.RAW_LOG_SOURCES)),
    check('raw_logs_privacy_check', enumCheck(t.privacy, E.RAW_LOG_PRIVACY)),
    check('raw_logs_status_check', enumCheck(t.status, E.RAW_LOG_STATUSES)),
  ],
);

export const categories = pgTable(
  'categories',
  {
    ...syncColumns(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    color: text('color'),
    icon: text('icon'),
    origin: text('origin', { enum: E.CATEGORY_ORIGINS }).notNull(),
    needsReview: boolean('needs_review').notNull().default(false),
    mergedIntoId: uuid('merged_into_id'),
    archivedAt: instant('archived_at'),
  },
  (t) => [
    seqIndex('categories', t),
    index('categories_slug_idx').on(t.slug),
    check('categories_origin_check', enumCheck(t.origin, E.CATEGORY_ORIGINS)),
  ],
);

export const projects = pgTable(
  'projects',
  {
    ...syncColumns(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    color: text('color'),
    archivedAt: instant('archived_at'),
  },
  (t) => [seqIndex('projects', t), index('projects_slug_idx').on(t.slug)],
);

export const activities = pgTable(
  'activities',
  {
    ...syncColumns(),
    rawLogId: uuid('raw_log_id'),
    projectId: uuid('project_id'),
    categoryId: uuid('category_id').notNull(),
    title: text('title').notNull(),
    notes: text('notes'),
    metrics: jsonObject('metrics'),
    loggedDate: localDate('logged_date').notNull(),
    occurredAt: instant('occurred_at'),
    origin: text('origin', { enum: E.ROW_ORIGINS }).notNull(),
    isUserEdited: boolean('is_user_edited').notNull().default(false),
    ordinal: integer('ordinal'),
  },
  (t) => [
    seqIndex('activities', t),
    index('activities_logged_date_idx').on(t.loggedDate),
    index('activities_category_id_logged_date_idx').on(t.categoryId, t.loggedDate),
    index('activities_raw_log_id_idx').on(t.rawLogId),
    index('activities_project_id_idx').on(t.projectId),
    check('activities_origin_check', enumCheck(t.origin, E.ROW_ORIGINS)),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    ...syncColumns(),
    rawLogId: uuid('raw_log_id'),
    projectId: uuid('project_id'),
    categoryId: uuid('category_id'),
    title: text('title').notNull(),
    notes: text('notes'),
    dueDate: localDate('due_date'),
    completedAt: instant('completed_at'),
    origin: text('origin', { enum: E.ROW_ORIGINS }).notNull(),
    isUserEdited: boolean('is_user_edited').notNull().default(false),
    ordinal: integer('ordinal'),
  },
  (t) => [
    seqIndex('tasks', t),
    index('tasks_completed_at_due_date_idx').on(t.completedAt, t.dueDate),
    index('tasks_raw_log_id_idx').on(t.rawLogId),
    check('tasks_origin_check', enumCheck(t.origin, E.ROW_ORIGINS)),
  ],
);

export const tags = pgTable(
  'tags',
  {
    ...syncColumns(),
    name: text('name').notNull(),
    path: text('path').notNull(),
    parentId: uuid('parent_id'),
    color: text('color'),
    mergedIntoId: uuid('merged_into_id'),
  },
  (t) => [
    seqIndex('tags', t),
    index('tags_path_idx').on(t.path),
    index('tags_parent_id_idx').on(t.parentId),
  ],
);

export const entityTags = pgTable(
  'entity_tags',
  {
    ...syncColumns(),
    tagId: uuid('tag_id').notNull(),
    targetType: text('target_type', { enum: E.LINK_TARGET_TYPES }).notNull(),
    targetId: uuid('target_id').notNull(),
    isInferred: boolean('is_inferred').notNull(),
    confidence: doublePrecision('confidence'),
  },
  (t) => [
    seqIndex('entity_tags', t),
    index('entity_tags_target_idx').on(t.targetType, t.targetId),
    index('entity_tags_tag_id_idx').on(t.tagId),
    check('entity_tags_target_type_check', enumCheck(t.targetType, E.LINK_TARGET_TYPES)),
  ],
);

export const entities = pgTable(
  'entities',
  {
    ...syncColumns(),
    kind: text('kind', { enum: E.ENTITY_KINDS }).notNull(),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    aliases: jsonArray<string>('aliases'),
    needsReview: boolean('needs_review').notNull().default(false),
  },
  (t) => [
    seqIndex('entities', t),
    index('entities_kind_normalized_name_idx').on(t.kind, t.normalizedName),
    check('entities_kind_check', enumCheck(t.kind, E.ENTITY_KINDS)),
  ],
);

export const entityMentions = pgTable(
  'entity_mentions',
  {
    ...syncColumns(),
    entityId: uuid('entity_id').notNull(),
    targetType: text('target_type', { enum: E.LINK_TARGET_TYPES }).notNull(),
    targetId: uuid('target_id').notNull(),
    role: text('role', { enum: E.MENTION_ROLES }).notNull(),
  },
  (t) => [
    seqIndex('entity_mentions', t),
    index('entity_mentions_entity_id_idx').on(t.entityId),
    index('entity_mentions_target_idx').on(t.targetType, t.targetId),
    check('entity_mentions_target_type_check', enumCheck(t.targetType, E.LINK_TARGET_TYPES)),
    check('entity_mentions_role_check', enumCheck(t.role, E.MENTION_ROLES)),
  ],
);

export const contextRules = pgTable(
  'context_rules',
  {
    ...syncColumns(),
    appPattern: text('app_pattern').notNull(),
    titlePattern: text('title_pattern'),
    projectId: uuid('project_id'),
    tagPaths: jsonArray<string>('tag_paths'),
    enabled: boolean('enabled').notNull().default(true),
  },
  (t) => [seqIndex('context_rules', t)],
);

// ------------------------------------------------------------ server-only tables

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    platform: text('platform', { enum: E.DEVICE_PLATFORMS }).notNull(),
    extractionMode: text('extraction_mode', { enum: E.EXTRACTION_MODES }).notNull().default('self'),
    createdAt: instant('created_at').notNull().defaultNow(),
    lastSeenAt: instant('last_seen_at'),
    lastPullCursor: bigint('last_pull_cursor', { mode: 'number' }).notNull().default(0),
  },
  (t) => [
    check('devices_platform_check', enumCheck(t.platform, E.DEVICE_PLATFORMS)),
    check('devices_extraction_mode_check', enumCheck(t.extractionMode, E.EXTRACTION_MODES)),
  ],
);

export const serverMeta = pgTable('server_meta', {
  serverId: uuid('server_id').primaryKey(),
  syncTokenHash: text('sync_token_hash'),
  createdAt: instant('created_at').notNull().defaultNow(),
});

export const serverJobs = pgTable(
  'server_jobs',
  {
    id: uuid('id').primaryKey(),
    kind: text('kind').notNull(),
    targetId: uuid('target_id'),
    status: text('status', { enum: E.SERVER_JOB_STATUSES }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    runAfter: instant('run_after').notNull().defaultNow(),
    lastError: text('last_error'),
    createdAt: instant('created_at').notNull().defaultNow(),
    updatedAt: instant('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('server_jobs_status_run_after_idx').on(t.status, t.runAfter),
    check('server_jobs_status_check', enumCheck(t.status, E.SERVER_JOB_STATUSES)),
  ],
);
