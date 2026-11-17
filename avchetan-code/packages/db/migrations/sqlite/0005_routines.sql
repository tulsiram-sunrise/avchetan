CREATE TABLE `routine_days` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by_device` text NOT NULL,
	`deleted_at` text,
	`routine_id` text NOT NULL,
	`scheduled_date` text NOT NULL,
	`status` text NOT NULL,
	`status_at` text,
	`raw_log_id` text
);
--> statement-breakpoint
CREATE INDEX `routine_days_scheduled_date_idx` ON `routine_days` (`scheduled_date`);--> statement-breakpoint
CREATE INDEX `routine_days_routine_id_idx` ON `routine_days` (`routine_id`);--> statement-breakpoint
CREATE TABLE `routines` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by_device` text NOT NULL,
	`deleted_at` text,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`repeat_rule` text NOT NULL,
	`window_start` text,
	`window_end` text,
	`category_id` text,
	`tag_id` text,
	`paused_at` text
);
