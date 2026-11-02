CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "log_embeddings" (
	"raw_log_id" uuid PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"dims" integer NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
