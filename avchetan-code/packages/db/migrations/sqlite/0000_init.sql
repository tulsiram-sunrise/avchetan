CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by_device` text NOT NULL,
	`deleted_at` text,
	`raw_log_id` text,
	`project_id` text,
	`category_id` text NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`metrics` text DEFAULT '{}' NOT NULL,
	`logged_date` text NOT NULL,
	`occurred_at` text,
	`origin` text NOT NULL,
	`is_user_edited` integer DEFAULT false NOT NULL,
	`ordinal` integer
);
--> statement-breakpoint
CREATE INDEX `activities_logged_date_idx` ON `activities` (`logged_date`);--> statement-breakpoint
CREATE INDEX `activities_category_id_logged_date_idx` ON `activities` (`category_id`,`logged_date`);--> statement-breakpoint
CREATE INDEX `activities_raw_log_id_idx` ON `activities` (`raw_log_id`);--> statement-breakpoint
CREATE INDEX `activities_project_id_idx` ON `activities` (`project_id`);--> statement-breakpoint
CREATE TABLE `ask_history` (
	`id` text PRIMARY KEY NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`cited_ids` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by_device` text NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`color` text,
	`icon` text,
	`origin` text NOT NULL,
	`needs_review` integer DEFAULT false NOT NULL,
	`merged_into_id` text,
	`archived_at` text
);
--> statement-breakpoint
CREATE INDEX `categories_slug_idx` ON `categories` (`slug`);--> statement-breakpoint
CREATE TABLE `context_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by_device` text NOT NULL,
	`deleted_at` text,
	`app_pattern` text NOT NULL,
	`title_pattern` text,
	`project_id` text,
	`tag_paths` text DEFAULT '[]' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `entities` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by_device` text NOT NULL,
	`deleted_at` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`needs_review` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `entities_kind_normalized_name_idx` ON `entities` (`kind`,`normalized_name`);--> statement-breakpoint
CREATE TABLE `entity_mentions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by_device` text NOT NULL,
	`deleted_at` text,
	`entity_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`role` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `entity_mentions_entity_id_idx` ON `entity_mentions` (`entity_id`);--> statement-breakpoint
CREATE INDEX `entity_mentions_target_idx` ON `entity_mentions` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `entity_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by_device` text NOT NULL,
	`deleted_at` text,
	`tag_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`is_inferred` integer NOT NULL,
	`confidence` real
);
--> statement-breakpoint
CREATE INDEX `entity_tags_target_idx` ON `entity_tags` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `entity_tags_tag_id_idx` ON `entity_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `extraction_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_log_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`field` text NOT NULL,
	`before` text,
	`after` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `extraction_corrections_created_at_idx` ON `extraction_corrections` (`created_at`);--> statement-breakpoint
CREATE TABLE `llm_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_log_id` text,
	`purpose` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`latency_ms` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`ok` integer NOT NULL,
	`error_code` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `llm_runs_created_at_idx` ON `llm_runs` (`created_at`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by_device` text NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`color` text,
	`archived_at` text
);
--> statement-breakpoint
CREATE INDEX `projects_slug_idx` ON `projects` (`slug`);--> statement-breakpoint
CREATE TABLE `raw_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by_device` text NOT NULL,
	`deleted_at` text,
	`content` text NOT NULL,
	`captured_at` text NOT NULL,
	`captured_tz` text NOT NULL,
	`source` text NOT NULL,
	`context` text DEFAULT '{}' NOT NULL,
	`privacy` text DEFAULT 'normal' NOT NULL,
	`status` text NOT NULL,
	`origin_device_id` text NOT NULL,
	`processing_attempts` integer DEFAULT 0 NOT NULL,
	`processing_lease_owner` text,
	`processing_lease_until` text,
	`next_attempt_at` text,
	`processed_by` text,
	`processed_at` text,
	`extraction_model` text,
	`extraction_version` integer,
	`last_error` text
);
--> statement-breakpoint
CREATE INDEX `raw_logs_status_captured_at_idx` ON `raw_logs` (`status`,`captured_at`);--> statement-breakpoint
CREATE INDEX `raw_logs_captured_at_idx` ON `raw_logs` (`captured_at`);--> statement-breakpoint
CREATE INDEX `raw_logs_updated_at_idx` ON `raw_logs` (`updated_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_outbox` (
	`table_name` text NOT NULL,
	`record_id` text NOT NULL,
	`enqueued_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	PRIMARY KEY(`table_name`, `record_id`)
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by_device` text NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`parent_id` text,
	`color` text,
	`merged_into_id` text
);
--> statement-breakpoint
CREATE INDEX `tags_path_idx` ON `tags` (`path`);--> statement-breakpoint
CREATE INDEX `tags_parent_id_idx` ON `tags` (`parent_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by_device` text NOT NULL,
	`deleted_at` text,
	`raw_log_id` text,
	`project_id` text,
	`category_id` text,
	`title` text NOT NULL,
	`notes` text,
	`due_date` text,
	`completed_at` text,
	`origin` text NOT NULL,
	`is_user_edited` integer DEFAULT false NOT NULL,
	`ordinal` integer
);
--> statement-breakpoint
CREATE INDEX `tasks_completed_at_due_date_idx` ON `tasks` (`completed_at`,`due_date`);--> statement-breakpoint
CREATE INDEX `tasks_raw_log_id_idx` ON `tasks` (`raw_log_id`);