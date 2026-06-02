CREATE TABLE `app_secrets` (
	`key` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`scheduled_at` integer,
	`deadline_at` integer,
	`started_at` integer,
	`finished_at` integer,
	`status` text NOT NULL,
	`task_id` text,
	`created_task_id` text,
	`error` text,
	`trigger_kind` text NOT NULL,
	`worker_id` text,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `automations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`category` text NOT NULL,
	`cron_expr` text NOT NULL,
	`cron_tz` text,
	`prompt_template` text DEFAULT '' NOT NULL,
	`actions` text DEFAULT '[]' NOT NULL,
	`task_config` text,
	`project_id` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`is_draft` integer DEFAULT 0 NOT NULL,
	`last_run_at` integer,
	`next_run_at` integer,
	`deadline_policy` text DEFAULT 'next-interval' NOT NULL,
	`deadline_ms` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`title` text NOT NULL,
	`provider` text,
	`config` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_interacted_at` text,
	`is_initial_conversation` integer,
	`session_id` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `editor_buffers` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`file_path` text NOT NULL,
	`content` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `kv` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL
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
CREATE TABLE `project_remotes` (
	`project_id` text NOT NULL,
	`remote_name` text NOT NULL,
	`remote_url` text NOT NULL,
	PRIMARY KEY(`project_id`, `remote_name`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `project_settings` (
	`project_id` text PRIMARY KEY NOT NULL,
	`base_project_settings_json` text DEFAULT '{}' NOT NULL,
	`shareable_project_settings_json` text DEFAULT '{}' NOT NULL,
	`legacy_config_migrated_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`workspace_provider` text DEFAULT 'local' NOT NULL,
	`base_ref` text,
	`ssh_connection_id` text,
	`repository_workspace_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`ssh_connection_id`) REFERENCES `ssh_connections`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `pull_request_assignees` (
	`pull_request_url` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`pull_request_url`, `user_id`),
	FOREIGN KEY (`pull_request_url`) REFERENCES `pull_requests`(`url`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `pull_request_users`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pull_request_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`pull_request_url` text NOT NULL,
	`commit_sha` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`conclusion` text NOT NULL,
	`details_url` text,
	`started_at` text,
	`completed_at` text,
	`workflow_name` text,
	`app_name` text,
	`app_logo_url` text,
	FOREIGN KEY (`pull_request_url`) REFERENCES `pull_requests`(`url`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pull_request_labels` (
	`pull_request_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	PRIMARY KEY(`pull_request_id`, `name`),
	FOREIGN KEY (`pull_request_id`) REFERENCES `pull_requests`(`url`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pull_request_users` (
	`user_id` text PRIMARY KEY NOT NULL,
	`user_name` text NOT NULL,
	`display_name` text,
	`avatar_url` text,
	`url` text,
	`user_updated_at` text,
	`user_created_at` text
);
--> statement-breakpoint
CREATE TABLE `pull_requests` (
	`url` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'github' NOT NULL,
	`repository_url` text NOT NULL,
	`base_ref_name` text NOT NULL,
	`base_ref_oid` text NOT NULL,
	`head_repository_url` text NOT NULL,
	`head_ref_name` text NOT NULL,
	`head_ref_oid` text NOT NULL,
	`identifier` text,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'open' NOT NULL,
	`is_draft` integer,
	`author_user_id` text,
	`additions` integer,
	`deletions` integer,
	`changed_files` integer,
	`commit_count` integer,
	`mergeable_status` text,
	`merge_state_status` text,
	`review_decision` text,
	`pull_request_created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`pull_request_updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`author_user_id`) REFERENCES `pull_request_users`(`user_id`) ON UPDATE no action ON DELETE set null
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
	`source_branch` text,
	`task_branch` text,
	`linked_issue` text,
	`archived_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_interacted_at` text,
	`status_changed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`is_pinned` integer DEFAULT 0 NOT NULL,
	`workspace_id` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `terminals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`ssh` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`shell_id` text DEFAULT 'system' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text,
	`type` text NOT NULL,
	`kind` text,
	`location` text,
	`ssh_connection_id` text,
	`data` text,
	`path` text,
	`config` text,
	`branch_name` text,
	`lines_added` integer,
	`lines_deleted` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`ssh_connection_id`) REFERENCES `ssh_connections`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_app_secrets_key` ON `app_secrets` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_app_settings_key` ON `app_settings` (`key`);--> statement-breakpoint
CREATE INDEX `idx_automation_runs_automation_started` ON `automation_runs` (`automation_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_automation_runs_automation_scheduled` ON `automation_runs` (`automation_id`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `idx_automation_runs_automation_status` ON `automation_runs` (`automation_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_automation_runs_status` ON `automation_runs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_automation_runs_created_task_id` ON `automation_runs` (`created_task_id`);--> statement-breakpoint
CREATE INDEX `idx_automations_enabled_next_run` ON `automations` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE INDEX `idx_automations_project_id` ON `automations` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_conversations_task_id` ON `conversations` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_editor_buffers_workspace_file` ON `editor_buffers` (`workspace_id`,`file_path`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_kv_key` ON `kv` (`key`);--> statement-breakpoint
CREATE INDEX `idx_messages_conversation_id` ON `messages` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `idx_messages_timestamp` ON `messages` (`timestamp`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_projects_path` ON `projects` (`path`);--> statement-breakpoint
CREATE INDEX `idx_projects_ssh_connection_id` ON `projects` (`ssh_connection_id`);--> statement-breakpoint
CREATE INDEX `idx_pra_pull_request_url` ON `pull_request_assignees` (`pull_request_url`);--> statement-breakpoint
CREATE INDEX `idx_pra_user_id` ON `pull_request_assignees` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_prc_pull_request_url` ON `pull_request_checks` (`pull_request_url`);--> statement-breakpoint
CREATE INDEX `idx_prl_name` ON `pull_request_labels` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pull_requests_url` ON `pull_requests` (`url`);--> statement-breakpoint
CREATE INDEX `idx_pull_requests_repository_url` ON `pull_requests` (`repository_url`);--> statement-breakpoint
CREATE INDEX `idx_pull_requests_head_repository_url` ON `pull_requests` (`head_repository_url`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ssh_connections_name` ON `ssh_connections` (`name`);--> statement-breakpoint
CREATE INDEX `idx_ssh_connections_host` ON `ssh_connections` (`host`);--> statement-breakpoint
CREATE INDEX `idx_tasks_project_id` ON `tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_terminals_task_id` ON `terminals` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workspaces_key` ON `workspaces` (`key`) WHERE "workspaces"."key" is not null;