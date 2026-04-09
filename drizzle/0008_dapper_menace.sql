/*
 SQLite does not support dropping foreign keys via ALTER TABLE.
 We recreate the editor_buffers table: replace task_id (FK → tasks) with
 workspace_id (plain text, no FK) and update the composite index accordingly.
 Existing rows are discarded — editor buffers are crash-recovery only.
*/--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TABLE IF EXISTS `editor_buffers`;--> statement-breakpoint
CREATE TABLE `editor_buffers` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`file_path` text NOT NULL,
	`content` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `idx_editor_buffers_workspace_file` ON `editor_buffers` (`workspace_id`,`file_path`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
