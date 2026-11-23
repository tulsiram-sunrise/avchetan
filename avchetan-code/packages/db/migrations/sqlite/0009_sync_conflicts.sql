CREATE TABLE `sync_conflicts` (
	`table_name` text NOT NULL,
	`record_id` text NOT NULL,
	`lost_row` text NOT NULL,
	`detected_at` text NOT NULL,
	PRIMARY KEY(`table_name`, `record_id`)
);
--> statement-breakpoint
ALTER TABLE `sync_outbox` ADD `by_user` integer DEFAULT false NOT NULL;