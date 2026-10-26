/**
 * Closed value sets used by both dialects, Zod schemas and the parity test.
 * Values are lowercase snake_case (docs/conventions/naming.md). Adding a value is a
 * migration on Postgres (CHECK constraint) and a no-op on SQLite.
 */

export const RAW_LOG_SOURCES = [
  'desktop_text',
  'desktop_voice',
  'mobile_text',
  'mobile_voice',
  'mobile_widget',
  'system',
] as const;
export type RawLogSource = (typeof RAW_LOG_SOURCES)[number];

export const RAW_LOG_PRIVACY = ['normal', 'local_only'] as const;
export type RawLogPrivacy = (typeof RAW_LOG_PRIVACY)[number];

export const RAW_LOG_STATUSES = ['pending_llm', 'processed', 'error', 'skipped'] as const;
export type RawLogStatus = (typeof RAW_LOG_STATUSES)[number];

export const CATEGORY_ORIGINS = ['seed', 'user', 'llm'] as const;
export type CategoryOrigin = (typeof CATEGORY_ORIGINS)[number];

/** Who produced an activity/task row. */
export const ROW_ORIGINS = ['extraction', 'user', 'system'] as const;
export type RowOrigin = (typeof ROW_ORIGINS)[number];

/** Targets of polymorphic links (tags, mentions). */
export const LINK_TARGET_TYPES = ['raw_log', 'activity', 'task'] as const;
export type LinkTargetType = (typeof LINK_TARGET_TYPES)[number];

export const ENTITY_KINDS = [
  'person',
  'place',
  'organization',
  'project_ref',
  'exercise',
  'food',
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const MENTION_ROLES = ['with', 'about', 'at', 'owed_to', 'owed_by'] as const;
export type MentionRole = (typeof MENTION_ROLES)[number];

export const CORRECTION_TARGET_TYPES = ['activity', 'task'] as const;
export type CorrectionTargetType = (typeof CORRECTION_TARGET_TYPES)[number];

export const LLM_PURPOSES = ['extraction', 'analysis', 'embedding', 'transcription'] as const;
export type LlmPurpose = (typeof LLM_PURPOSES)[number];

export const DEVICE_PLATFORMS = ['windows', 'macos', 'linux', 'android', 'ios'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export const EXTRACTION_MODES = ['self', 'delegate'] as const;
export type ExtractionMode = (typeof EXTRACTION_MODES)[number];

export const SERVER_JOB_STATUSES = ['pending', 'running', 'done', 'failed'] as const;
export type ServerJobStatus = (typeof SERVER_JOB_STATUSES)[number];
