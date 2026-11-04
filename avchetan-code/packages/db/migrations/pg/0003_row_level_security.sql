ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "context_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entity_mentions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entity_tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "log_embeddings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "raw_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "server_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "server_meta" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- The migration runner creates this table itself, outside the schema.
ALTER TABLE "avchetan_migrations" ENABLE ROW LEVEL SECURITY;