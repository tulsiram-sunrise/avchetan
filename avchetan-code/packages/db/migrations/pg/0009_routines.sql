CREATE TABLE "routine_days" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	"updated_by_device" text NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"server_seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	"created_on_server_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"routine_id" uuid NOT NULL,
	"scheduled_date" date NOT NULL,
	"status" text NOT NULL,
	"status_at" timestamp(3) with time zone,
	"raw_log_id" uuid,
	CONSTRAINT "routine_days_status_check" CHECK ("routine_days"."status" in ('open', 'done', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE "routine_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "routines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	"updated_by_device" text NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"server_seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	"created_on_server_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"repeat_rule" jsonb NOT NULL,
	"window_start" text,
	"window_end" text,
	"category_id" uuid,
	"tag_id" uuid,
	"paused_at" timestamp(3) with time zone,
	CONSTRAINT "routines_kind_check" CHECK ("routines"."kind" in ('assumed', 'confirm', 'task'))
);
--> statement-breakpoint
ALTER TABLE "routines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "routine_days_server_seq_idx" ON "routine_days" USING btree ("server_seq");--> statement-breakpoint
CREATE INDEX "routine_days_scheduled_date_idx" ON "routine_days" USING btree ("scheduled_date");--> statement-breakpoint
CREATE INDEX "routine_days_routine_id_idx" ON "routine_days" USING btree ("routine_id");--> statement-breakpoint
CREATE INDEX "routines_server_seq_idx" ON "routines" USING btree ("server_seq");