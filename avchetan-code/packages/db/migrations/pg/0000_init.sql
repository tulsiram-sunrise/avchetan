CREATE SEQUENCE "public"."sync_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	"updated_by_device" text NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"server_seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	"created_on_server_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"raw_log_id" uuid,
	"project_id" uuid,
	"category_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"logged_date" date NOT NULL,
	"occurred_at" timestamp(3) with time zone,
	"origin" text NOT NULL,
	"is_user_edited" boolean DEFAULT false NOT NULL,
	"ordinal" integer,
	CONSTRAINT "activities_origin_check" CHECK ("activities"."origin" in ('extraction', 'user', 'system'))
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	"updated_by_device" text NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"server_seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	"created_on_server_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"color" text,
	"icon" text,
	"origin" text NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"merged_into_id" uuid,
	"archived_at" timestamp(3) with time zone,
	CONSTRAINT "categories_origin_check" CHECK ("categories"."origin" in ('seed', 'user', 'llm'))
);
--> statement-breakpoint
CREATE TABLE "context_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	"updated_by_device" text NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"server_seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	"created_on_server_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"app_pattern" text NOT NULL,
	"title_pattern" text,
	"project_id" uuid,
	"tag_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"extraction_mode" text DEFAULT 'self' NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp(3) with time zone,
	"last_pull_cursor" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "devices_platform_check" CHECK ("devices"."platform" in ('windows', 'macos', 'linux', 'android', 'ios')),
	CONSTRAINT "devices_extraction_mode_check" CHECK ("devices"."extraction_mode" in ('self', 'delegate'))
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	"updated_by_device" text NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"server_seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	"created_on_server_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	CONSTRAINT "entities_kind_check" CHECK ("entities"."kind" in ('person', 'place', 'organization', 'project_ref', 'exercise', 'food'))
);
--> statement-breakpoint
CREATE TABLE "entity_mentions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	"updated_by_device" text NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"server_seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	"created_on_server_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"entity_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "entity_mentions_target_type_check" CHECK ("entity_mentions"."target_type" in ('raw_log', 'activity', 'task')),
	CONSTRAINT "entity_mentions_role_check" CHECK ("entity_mentions"."role" in ('with', 'about', 'at', 'owed_to', 'owed_by'))
);
--> statement-breakpoint
CREATE TABLE "entity_tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	"updated_by_device" text NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"server_seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	"created_on_server_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"tag_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"is_inferred" boolean NOT NULL,
	"confidence" double precision,
	CONSTRAINT "entity_tags_target_type_check" CHECK ("entity_tags"."target_type" in ('raw_log', 'activity', 'task'))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	"updated_by_device" text NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"server_seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	"created_on_server_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"color" text,
	"archived_at" timestamp(3) with time zone
);
--> statement-breakpoint
CREATE TABLE "raw_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	"updated_by_device" text NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"server_seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	"created_on_server_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"content" text NOT NULL,
	"captured_at" timestamp(3) with time zone NOT NULL,
	"captured_tz" text NOT NULL,
	"source" text NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"privacy" text DEFAULT 'normal' NOT NULL,
	"status" text NOT NULL,
	"origin_device_id" text NOT NULL,
	"processing_attempts" integer DEFAULT 0 NOT NULL,
	"processing_lease_owner" text,
	"processing_lease_until" timestamp(3) with time zone,
	"next_attempt_at" timestamp(3) with time zone,
	"processed_by" text,
	"processed_at" timestamp(3) with time zone,
	"extraction_model" text,
	"extraction_version" integer,
	"last_error" text,
	CONSTRAINT "raw_logs_source_check" CHECK ("raw_logs"."source" in ('desktop_text', 'desktop_voice', 'mobile_text', 'mobile_voice', 'mobile_widget', 'system')),
	CONSTRAINT "raw_logs_privacy_check" CHECK ("raw_logs"."privacy" in ('normal', 'local_only')),
	CONSTRAINT "raw_logs_status_check" CHECK ("raw_logs"."status" in ('pending_llm', 'processed', 'error', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "server_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"target_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "server_jobs_status_check" CHECK ("server_jobs"."status" in ('pending', 'running', 'done', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "server_meta" (
	"server_id" uuid PRIMARY KEY NOT NULL,
	"sync_token_hash" text,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	"updated_by_device" text NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"server_seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	"created_on_server_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"parent_id" uuid,
	"color" text,
	"merged_into_id" uuid
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	"updated_by_device" text NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"server_seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	"created_on_server_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"raw_log_id" uuid,
	"project_id" uuid,
	"category_id" uuid,
	"title" text NOT NULL,
	"notes" text,
	"due_date" date,
	"completed_at" timestamp(3) with time zone,
	"origin" text NOT NULL,
	"is_user_edited" boolean DEFAULT false NOT NULL,
	"ordinal" integer,
	CONSTRAINT "tasks_origin_check" CHECK ("tasks"."origin" in ('extraction', 'user', 'system'))
);
--> statement-breakpoint
CREATE INDEX "activities_server_seq_idx" ON "activities" USING btree ("server_seq");--> statement-breakpoint
CREATE INDEX "activities_logged_date_idx" ON "activities" USING btree ("logged_date");--> statement-breakpoint
CREATE INDEX "activities_category_id_logged_date_idx" ON "activities" USING btree ("category_id","logged_date");--> statement-breakpoint
CREATE INDEX "activities_raw_log_id_idx" ON "activities" USING btree ("raw_log_id");--> statement-breakpoint
CREATE INDEX "activities_project_id_idx" ON "activities" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "categories_server_seq_idx" ON "categories" USING btree ("server_seq");--> statement-breakpoint
CREATE INDEX "categories_slug_idx" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "context_rules_server_seq_idx" ON "context_rules" USING btree ("server_seq");--> statement-breakpoint
CREATE INDEX "entities_server_seq_idx" ON "entities" USING btree ("server_seq");--> statement-breakpoint
CREATE INDEX "entities_kind_normalized_name_idx" ON "entities" USING btree ("kind","normalized_name");--> statement-breakpoint
CREATE INDEX "entity_mentions_server_seq_idx" ON "entity_mentions" USING btree ("server_seq");--> statement-breakpoint
CREATE INDEX "entity_mentions_entity_id_idx" ON "entity_mentions" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "entity_mentions_target_idx" ON "entity_mentions" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "entity_tags_server_seq_idx" ON "entity_tags" USING btree ("server_seq");--> statement-breakpoint
CREATE INDEX "entity_tags_target_idx" ON "entity_tags" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "entity_tags_tag_id_idx" ON "entity_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "projects_server_seq_idx" ON "projects" USING btree ("server_seq");--> statement-breakpoint
CREATE INDEX "projects_slug_idx" ON "projects" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "raw_logs_server_seq_idx" ON "raw_logs" USING btree ("server_seq");--> statement-breakpoint
CREATE INDEX "raw_logs_status_captured_at_idx" ON "raw_logs" USING btree ("status","captured_at");--> statement-breakpoint
CREATE INDEX "raw_logs_captured_at_idx" ON "raw_logs" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX "server_jobs_status_run_after_idx" ON "server_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "tags_server_seq_idx" ON "tags" USING btree ("server_seq");--> statement-breakpoint
CREATE INDEX "tags_path_idx" ON "tags" USING btree ("path");--> statement-breakpoint
CREATE INDEX "tags_parent_id_idx" ON "tags" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "tasks_server_seq_idx" ON "tasks" USING btree ("server_seq");--> statement-breakpoint
CREATE INDEX "tasks_completed_at_due_date_idx" ON "tasks" USING btree ("completed_at","due_date");--> statement-breakpoint
CREATE INDEX "tasks_raw_log_id_idx" ON "tasks" USING btree ("raw_log_id");