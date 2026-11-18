CREATE TABLE `sync_set_aside` (
	`table_name` text NOT NULL,
	`record_id` text NOT NULL,
	`row` text NOT NULL,
	`set_aside_at` text NOT NULL,
	PRIMARY KEY(`table_name`, `record_id`)
);
