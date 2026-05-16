CREATE TABLE `task_activity` (
	`task_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`summary` text,
	`last_event_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `task_touched_files` (
	`task_id` text NOT NULL,
	`file_path` text NOT NULL,
	`last_touched_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`task_id`, `file_path`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_task_touched_files_path` ON `task_touched_files` (`file_path`);--> statement-breakpoint
CREATE INDEX `idx_task_touched_files_task_id` ON `task_touched_files` (`task_id`);