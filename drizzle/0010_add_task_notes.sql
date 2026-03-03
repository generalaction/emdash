CREATE TABLE `task_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`type` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_task_notes_task_id` ON `task_notes` (`task_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_task_notes_task_id_type` ON `task_notes` (`task_id`, `type`);
