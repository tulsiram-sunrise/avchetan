import * as E from './enums';

/**
 * Dialect-neutral description of every table (ADR-0007). The SQLite and Postgres
 * Drizzle schemas implement it; `schema-parity.test.ts` fails if either drifts.
 * Source of truth for humans: docs/architecture/data-model.md.
 */

export type LogicalType =
  | 'uuid'
  | 'text'
  | 'instant'
  | 'local_date'
  | 'bool'
  | 'json'
  | 'int'
  | 'real'
  | 'bigint';

export type ColumnSpec = {
  type: LogicalType;
  nullable: boolean;
  enum?: readonly string[];
};

/** synced = both dialects; local = SQLite clients only; server = Postgres only. */
export type TableScope = 'synced' | 'local' | 'server';

export type TableSpec = { scope: TableScope; columns: Record<string, ColumnSpec> };

const req = (type: LogicalType, values?: readonly string[]): ColumnSpec =>
  values ? { type, nullable: false, enum: values } : { type, nullable: false };
const opt = (type: LogicalType): ColumnSpec => ({ type, nullable: true });

/** Present on every synced table (docs/architecture/data-model.md#common-sync-columns). */
export const SYNC_COLUMNS = {
  id: req('uuid'),
  created_at: req('instant'),
  updated_at: req('instant'),
  updated_by_device: req('text'),
  deleted_at: opt('instant'),
} satisfies Record<string, ColumnSpec>;

/** Added to every synced table on Postgres only. */
export const SERVER_SYNC_COLUMNS = {
  server_seq: req('bigint'),
  created_on_server_at: req('instant'),
} satisfies Record<string, ColumnSpec>;

const synced = (columns: Record<string, ColumnSpec>): TableSpec => ({
  scope: 'synced',
  columns: { ...SYNC_COLUMNS, ...columns },
});

export const TABLES = {
  raw_logs: synced({
    content: req('text'),
    captured_at: req('instant'),
    captured_tz: req('text'),
    source: req('text', E.RAW_LOG_SOURCES),
    context: req('json'),
    privacy: req('text', E.RAW_LOG_PRIVACY),
    status: req('text', E.RAW_LOG_STATUSES),
    origin_device_id: req('text'),
    processing_attempts: req('int'),
    processing_lease_owner: opt('text'),
    processing_lease_until: opt('instant'),
    next_attempt_at: opt('instant'),
    processed_by: opt('text'),
    processed_at: opt('instant'),
    extraction_model: opt('text'),
    extraction_version: opt('int'),
    last_error: opt('text'),
  }),
  categories: synced({
    name: req('text'),
    slug: req('text'),
    description: opt('text'),
    color: opt('text'),
    icon: opt('text'),
    origin: req('text', E.CATEGORY_ORIGINS),
    needs_review: req('bool'),
    merged_into_id: opt('uuid'),
    archived_at: opt('instant'),
  }),
  projects: synced({
    name: req('text'),
    slug: req('text'),
    description: opt('text'),
    color: opt('text'),
    archived_at: opt('instant'),
  }),
  activities: synced({
    raw_log_id: opt('uuid'),
    project_id: opt('uuid'),
    category_id: req('uuid'),
    title: req('text'),
    notes: opt('text'),
    metrics: req('json'),
    logged_date: req('local_date'),
    occurred_at: opt('instant'),
    origin: req('text', E.ROW_ORIGINS),
    is_user_edited: req('bool'),
    ordinal: opt('int'),
  }),
  tasks: synced({
    raw_log_id: opt('uuid'),
    project_id: opt('uuid'),
    category_id: opt('uuid'),
    title: req('text'),
    notes: opt('text'),
    due_date: opt('local_date'),
    completed_at: opt('instant'),
    origin: req('text', E.ROW_ORIGINS),
    is_user_edited: req('bool'),
    ordinal: opt('int'),
  }),
  tags: synced({
    name: req('text'),
    path: req('text'),
    parent_id: opt('uuid'),
    color: opt('text'),
    merged_into_id: opt('uuid'),
  }),
  entity_tags: synced({
    tag_id: req('uuid'),
    target_type: req('text', E.LINK_TARGET_TYPES),
    target_id: req('uuid'),
    is_inferred: req('bool'),
    confidence: opt('real'),
  }),
  entities: synced({
    kind: req('text', E.ENTITY_KINDS),
    name: req('text'),
    normalized_name: req('text'),
    aliases: req('json'),
    needs_review: req('bool'),
  }),
  entity_mentions: synced({
    entity_id: req('uuid'),
    target_type: req('text', E.LINK_TARGET_TYPES),
    target_id: req('uuid'),
    role: req('text', E.MENTION_ROLES),
  }),
  context_rules: synced({
    app_pattern: req('text'),
    title_pattern: opt('text'),
    project_id: opt('uuid'),
    tag_paths: req('json'),
    enabled: req('bool'),
  }),

  sync_outbox: {
    scope: 'local',
    columns: {
      table_name: req('text'),
      record_id: req('text'),
      enqueued_at: req('instant'),
      attempts: req('int'),
      last_error: opt('text'),
    },
  },
  sync_state: {
    scope: 'local',
    columns: { key: req('text'), value: req('text') },
  },
  settings: {
    scope: 'local',
    columns: { key: req('text'), value: req('json'), updated_at: req('instant') },
  },
  llm_runs: {
    scope: 'local',
    columns: {
      id: req('uuid'),
      raw_log_id: opt('uuid'),
      purpose: req('text', E.LLM_PURPOSES),
      provider: req('text'),
      model: req('text'),
      latency_ms: opt('int'),
      input_tokens: opt('int'),
      output_tokens: opt('int'),
      ok: req('bool'),
      error_code: opt('text'),
      created_at: req('instant'),
    },
  },
  ask_history: {
    scope: 'local',
    columns: {
      id: req('uuid'),
      question: req('text'),
      answer: req('text'),
      cited_ids: req('json'),
      created_at: req('instant'),
    },
  },
  extraction_corrections: {
    scope: 'local',
    columns: {
      id: req('uuid'),
      raw_log_id: req('uuid'),
      target_type: req('text', E.CORRECTION_TARGET_TYPES),
      target_id: req('uuid'),
      field: req('text'),
      before: opt('json'),
      after: opt('json'),
      created_at: req('instant'),
    },
  },

  devices: {
    scope: 'server',
    columns: {
      id: req('uuid'),
      name: req('text'),
      platform: req('text', E.DEVICE_PLATFORMS),
      extraction_mode: req('text', E.EXTRACTION_MODES),
      created_at: req('instant'),
      last_seen_at: opt('instant'),
      last_pull_cursor: req('bigint'),
    },
  },
  server_meta: {
    scope: 'server',
    columns: {
      server_id: req('uuid'),
      sync_token_hash: opt('text'),
      created_at: req('instant'),
    },
  },
  server_jobs: {
    scope: 'server',
    columns: {
      id: req('uuid'),
      kind: req('text'),
      target_id: opt('uuid'),
      status: req('text', E.SERVER_JOB_STATUSES),
      attempts: req('int'),
      run_after: req('instant'),
      last_error: opt('text'),
      created_at: req('instant'),
      updated_at: req('instant'),
    },
  },
} satisfies Record<string, TableSpec>;

export type TableName = keyof typeof TABLES;

export const SYNCED_TABLE_NAMES = (Object.keys(TABLES) as TableName[]).filter(
  (name) => TABLES[name].scope === 'synced',
);
