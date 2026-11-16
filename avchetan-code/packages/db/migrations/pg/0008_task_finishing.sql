ALTER TABLE "tasks" ADD COLUMN "completion_note" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "progress_pct" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "cancelled_at" timestamp(3) with time zone;