ALTER TABLE "activities" DROP CONSTRAINT "activities_origin_check";--> statement-breakpoint
ALTER TABLE "categories" DROP CONSTRAINT "categories_origin_check";--> statement-breakpoint
ALTER TABLE "entities" DROP CONSTRAINT "entities_kind_check";--> statement-breakpoint
ALTER TABLE "entity_mentions" DROP CONSTRAINT "entity_mentions_target_type_check";--> statement-breakpoint
ALTER TABLE "entity_mentions" DROP CONSTRAINT "entity_mentions_role_check";--> statement-breakpoint
ALTER TABLE "entity_tags" DROP CONSTRAINT "entity_tags_target_type_check";--> statement-breakpoint
ALTER TABLE "raw_logs" DROP CONSTRAINT "raw_logs_source_check";--> statement-breakpoint
ALTER TABLE "raw_logs" DROP CONSTRAINT "raw_logs_privacy_check";--> statement-breakpoint
ALTER TABLE "raw_logs" DROP CONSTRAINT "raw_logs_status_check";--> statement-breakpoint
ALTER TABLE "routine_days" DROP CONSTRAINT "routine_days_status_check";--> statement-breakpoint
ALTER TABLE "routines" DROP CONSTRAINT "routines_kind_check";--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_origin_check";