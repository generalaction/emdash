-- Create workspace_instances table for remote workspace provisioning
CREATE TABLE `workspace_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`external_id` text,
	`host` text NOT NULL,
	`port` integer DEFAULT 22 NOT NULL,
	`username` text,
	`worktree_path` text,
	`status` text DEFAULT 'provisioning' NOT NULL,
	`connection_id` text REFERENCES ssh_connections(id) ON DELETE SET NULL,
	`created_at` integer NOT NULL,
	`terminated_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE
);

-- Add indexes for workspace_instances
CREATE INDEX `idx_workspace_instances_task_id` ON `workspace_instances` (`task_id`);
CREATE INDEX `idx_workspace_instances_status` ON `workspace_instances` (`status`);
