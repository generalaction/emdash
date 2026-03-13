CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`title` text NOT NULL,
	`provider` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `kv` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `line_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`file_path` text NOT NULL,
	`line_number` integer NOT NULL,
	`line_content` text,
	`content` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`sent_at` text,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`content` text NOT NULL,
	`sender` text NOT NULL,
	`timestamp` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`metadata` text,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`workspace_provider` text DEFAULT 'local' NOT NULL,
	`base_ref` text,
	`git_remote` text,
	`ssh_connection_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`ssh_connection_id`) REFERENCES `ssh_connections`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `pull_requests` (
	`url` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`provider` text DEFAULT 'github' NOT NULL,
	`author` text,
	`metadata` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ssh_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`host` text NOT NULL,
	`port` integer DEFAULT 22 NOT NULL,
	`username` text NOT NULL,
	`auth_type` text DEFAULT 'agent' NOT NULL,
	`private_key_path` text,
	`use_agent` integer DEFAULT 0 NOT NULL,
	`metadata` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`source_branch` text NOT NULL,
	`task_branch` text,
	`linked_issue` text,
	`archived_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tasks_pull_requests` (
	`task_id` text NOT NULL,
	`pull_request_url` text NOT NULL,
	PRIMARY KEY(`task_id`, `pull_request_url`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pull_request_url`) REFERENCES `pull_requests`(`url`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `terminals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_app_settings_key` ON `app_settings` (`key`);--> statement-breakpoint
CREATE INDEX `idx_conversations_task_id` ON `conversations` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_kv_key` ON `kv` (`key`);--> statement-breakpoint
CREATE INDEX `idx_line_comments_task_file` ON `line_comments` (`task_id`,`file_path`);--> statement-breakpoint
CREATE INDEX `idx_messages_conversation_id` ON `messages` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `idx_messages_timestamp` ON `messages` (`timestamp`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_projects_path` ON `projects` (`path`);--> statement-breakpoint
CREATE INDEX `idx_projects_ssh_connection_id` ON `projects` (`ssh_connection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pull_requests_url` ON `pull_requests` (`url`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ssh_connections_name` ON `ssh_connections` (`name`);--> statement-breakpoint
CREATE INDEX `idx_ssh_connections_host` ON `ssh_connections` (`host`);--> statement-breakpoint
CREATE INDEX `idx_tasks_project_id` ON `tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_terminals_task_id` ON `terminals` (`task_id`);