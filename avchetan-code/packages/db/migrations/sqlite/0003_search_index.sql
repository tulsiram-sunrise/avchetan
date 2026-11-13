-- Local search index (ADR-0029): client-only, never synced, rebuilt from the synced tables.
-- `search_rows` gives every indexed row a stable integer key; the FTS rowid is that key. The
-- source tables' own rowids can't be used: `VACUUM INTO` (daily backups, then a restore) may
-- renumber them, since their primary keys are text.
CREATE TABLE `search_rows` (
	`id` integer PRIMARY KEY,
	`kind` text NOT NULL,
	`ref_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_rows_kind_ref_id_idx` ON `search_rows` (`kind`, `ref_id`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `search_index` USING fts5(
	body,
	tokenize = "unicode61 categories 'L* N* Co M*'"
);
--> statement-breakpoint
CREATE TRIGGER `search_raw_logs_insert` AFTER INSERT ON `raw_logs` WHEN new.deleted_at IS NULL BEGIN
	INSERT INTO search_rows (kind, ref_id) VALUES ('entry', new.id);
	INSERT INTO search_index (rowid, body)
		SELECT id, new.content FROM search_rows WHERE kind = 'entry' AND ref_id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER `search_raw_logs_update` AFTER UPDATE OF content, deleted_at ON `raw_logs`
WHEN old.content IS NOT new.content OR old.deleted_at IS NOT new.deleted_at BEGIN
	DELETE FROM search_index WHERE rowid IN
		(SELECT id FROM search_rows WHERE kind = 'entry' AND ref_id = old.id);
	DELETE FROM search_rows WHERE kind = 'entry' AND ref_id = old.id;
	INSERT INTO search_rows (kind, ref_id) SELECT 'entry', new.id WHERE new.deleted_at IS NULL;
	INSERT INTO search_index (rowid, body)
		SELECT id, new.content FROM search_rows WHERE kind = 'entry' AND ref_id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER `search_raw_logs_delete` AFTER DELETE ON `raw_logs` BEGIN
	DELETE FROM search_index WHERE rowid IN
		(SELECT id FROM search_rows WHERE kind = 'entry' AND ref_id = old.id);
	DELETE FROM search_rows WHERE kind = 'entry' AND ref_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER `search_tasks_insert` AFTER INSERT ON `tasks` WHEN new.deleted_at IS NULL BEGIN
	INSERT INTO search_rows (kind, ref_id) VALUES ('task', new.id);
	INSERT INTO search_index (rowid, body)
		SELECT id, new.title FROM search_rows WHERE kind = 'task' AND ref_id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER `search_tasks_update` AFTER UPDATE OF title, deleted_at ON `tasks`
WHEN old.title IS NOT new.title OR old.deleted_at IS NOT new.deleted_at BEGIN
	DELETE FROM search_index WHERE rowid IN
		(SELECT id FROM search_rows WHERE kind = 'task' AND ref_id = old.id);
	DELETE FROM search_rows WHERE kind = 'task' AND ref_id = old.id;
	INSERT INTO search_rows (kind, ref_id) SELECT 'task', new.id WHERE new.deleted_at IS NULL;
	INSERT INTO search_index (rowid, body)
		SELECT id, new.title FROM search_rows WHERE kind = 'task' AND ref_id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER `search_tasks_delete` AFTER DELETE ON `tasks` BEGIN
	DELETE FROM search_index WHERE rowid IN
		(SELECT id FROM search_rows WHERE kind = 'task' AND ref_id = old.id);
	DELETE FROM search_rows WHERE kind = 'task' AND ref_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER `search_entities_insert` AFTER INSERT ON `entities` WHEN new.deleted_at IS NULL BEGIN
	INSERT INTO search_rows (kind, ref_id) VALUES ('entity', new.id);
	INSERT INTO search_index (rowid, body)
		SELECT id, new.name || coalesce(' ' || (SELECT group_concat(value, ' ') FROM json_each(new.aliases)), '')
		FROM search_rows WHERE kind = 'entity' AND ref_id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER `search_entities_update` AFTER UPDATE OF name, aliases, deleted_at ON `entities`
WHEN old.name IS NOT new.name OR old.aliases IS NOT new.aliases OR old.deleted_at IS NOT new.deleted_at BEGIN
	DELETE FROM search_index WHERE rowid IN
		(SELECT id FROM search_rows WHERE kind = 'entity' AND ref_id = old.id);
	DELETE FROM search_rows WHERE kind = 'entity' AND ref_id = old.id;
	INSERT INTO search_rows (kind, ref_id) SELECT 'entity', new.id WHERE new.deleted_at IS NULL;
	INSERT INTO search_index (rowid, body)
		SELECT id, new.name || coalesce(' ' || (SELECT group_concat(value, ' ') FROM json_each(new.aliases)), '')
		FROM search_rows WHERE kind = 'entity' AND ref_id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER `search_entities_delete` AFTER DELETE ON `entities` BEGIN
	DELETE FROM search_index WHERE rowid IN
		(SELECT id FROM search_rows WHERE kind = 'entity' AND ref_id = old.id);
	DELETE FROM search_rows WHERE kind = 'entity' AND ref_id = old.id;
END;
--> statement-breakpoint
INSERT INTO search_rows (kind, ref_id)
	SELECT 'entry', id FROM raw_logs WHERE deleted_at IS NULL
	UNION ALL SELECT 'task', id FROM tasks WHERE deleted_at IS NULL
	UNION ALL SELECT 'entity', id FROM entities WHERE deleted_at IS NULL;
--> statement-breakpoint
INSERT INTO search_index (rowid, body)
	SELECT s.id, r.content FROM search_rows s JOIN raw_logs r ON r.id = s.ref_id WHERE s.kind = 'entry'
	UNION ALL SELECT s.id, t.title FROM search_rows s JOIN tasks t ON t.id = s.ref_id WHERE s.kind = 'task'
	UNION ALL SELECT s.id, e.name || coalesce(' ' || (SELECT group_concat(value, ' ') FROM json_each(e.aliases)), '')
		FROM search_rows s JOIN entities e ON e.id = s.ref_id WHERE s.kind = 'entity';
