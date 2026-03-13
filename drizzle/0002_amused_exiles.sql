CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL
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
CREATE TABLE `tasks_pull_requests` (
	`task_id` text NOT NULL,
	`pull_request_url` text NOT NULL,
	PRIMARY KEY(`task_id`, `pull_request_url`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pull_request_url`) REFERENCES `pull_requests`(`url`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `tasks` RENAME COLUMN `branch` TO `task_branch`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_conversations_active`;--> statement-breakpoint
/*
 SQLite does not support "Drop not null from column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html
                  https://stackoverflow.com/questions/2083543/modify-a-columns-type-in-sqlite3

 Due to that we don't generate migration automatically and it has to be done manually
*/--> statement-breakpoint
/*
 SQLite does not support "Drop default from column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html
                  https://stackoverflow.com/questions/2083543/modify-a-columns-type-in-sqlite3

 Due to that we don't generate migration automatically and it has to be done manually
*/--> statement-breakpoint
ALTER TABLE `conversations` ADD `project_id` text NOT NULL REFERENCES projects(id);--> statement-breakpoint
ALTER TABLE `ssh_connections` ADD `metadata` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `source_branch` text NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `linked_issue` text;--> statement-breakpoint
ALTER TABLE `terminals` ADD `project_id` text NOT NULL REFERENCES projects(id);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_app_settings_key` ON `app_settings` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pull_requests_url` ON `pull_requests` (`url`);--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/--> statement-breakpoint
ALTER TABLE `conversations` DROP COLUMN `is_active`;--> statement-breakpoint
ALTER TABLE `conversations` DROP COLUMN `is_main`;--> statement-breakpoint
ALTER TABLE `conversations` DROP COLUMN `display_order`;--> statement-breakpoint
ALTER TABLE `conversations` DROP COLUMN `metadata`;--> statement-breakpoint
ALTER TABLE `conversations` DROP COLUMN `agent_session_id`;--> statement-breakpoint
ALTER TABLE `conversations` DROP COLUMN `type`;--> statement-breakpoint
ALTER TABLE `tasks` DROP COLUMN `path`;--> statement-breakpoint
ALTER TABLE `tasks` DROP COLUMN `agent_id`;--> statement-breakpoint
ALTER TABLE `tasks` DROP COLUMN `metadata`;--> statement-breakpoint
ALTER TABLE `tasks` DROP COLUMN `use_worktree`;--> statement-breakpoint
ALTER TABLE `tasks` DROP COLUMN `setup_script_buffer`;