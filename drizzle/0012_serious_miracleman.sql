CREATE TABLE `project_repo_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`label` text,
	`kind` text NOT NULL,
	`connection_id` text,
	`path` text,
	`remote_url` text,
	`is_fork` integer DEFAULT 0 NOT NULL,
	`is_primary` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `ssh_connections`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_project_repo_instances_project_id` ON `project_repo_instances` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_project_repo_instances_connection_id` ON `project_repo_instances` (`connection_id`);