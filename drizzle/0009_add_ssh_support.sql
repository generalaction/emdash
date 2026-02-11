-- Create ssh_connections table
CREATE TABLE `ssh_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`host` text NOT NULL,
	`port` integer DEFAULT 22 NOT NULL,
	`username` text NOT NULL,
	`auth_type` text DEFAULT 'agent' NOT NULL,
	`private_key_path` text,
	`use_agent` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Add indexes for ssh_connections
CREATE UNIQUE INDEX `idx_ssh_connections_name` ON `ssh_connections` (`name`);
CREATE INDEX `idx_ssh_connections_host` ON `ssh_connections` (`host`);

-- Add columns to projects table for SSH support
ALTER TABLE `projects` ADD COLUMN `ssh_connection_id` text REFERENCES ssh_connections(id) ON DELETE SET NULL;
ALTER TABLE `projects` ADD COLUMN `is_remote` integer DEFAULT 0 NOT NULL;
ALTER TABLE `projects` ADD COLUMN `remote_path` text;

-- Add indexes for projects
CREATE INDEX `idx_projects_ssh_connection_id` ON `projects` (`ssh_connection_id`);
CREATE INDEX `idx_projects_is_remote` ON `projects` (`is_remote`);
