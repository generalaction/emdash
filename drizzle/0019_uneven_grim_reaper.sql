-- Add type + automation_run_id to tasks
ALTER TABLE `tasks` ADD `type` text DEFAULT 'task' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `automation_run_id` text;--> statement-breakpoint
-- Remove task_id from automation_runs via table recreation (SQLite does not support
-- dropping FK columns with ALTER TABLE ... DROP COLUMN)
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `automation_runs_new` (
  `id` text PRIMARY KEY NOT NULL,
  `automation_id` text NOT NULL,
  `scheduled_at` integer,
  `deadline_at` integer,
  `started_at` integer,
  `task_created_at` integer,
  `launched_at` integer,
  `finished_at` integer,
  `status` text NOT NULL,
  `error` text,
  `trigger_kind` text NOT NULL,
  `trigger_config_snapshot` text DEFAULT '{}' NOT NULL,
  `conversation_config_snapshot` text DEFAULT '{}' NOT NULL,
  `task_config_snapshot` text,
  `generated_task_name` text,
  FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `automation_runs_new` SELECT
  `id`, `automation_id`, `scheduled_at`, `deadline_at`, `started_at`,
  `task_created_at`, `launched_at`, `finished_at`, `status`, `error`,
  `trigger_kind`, `trigger_config_snapshot`, `conversation_config_snapshot`,
  `task_config_snapshot`, `generated_task_name`
FROM `automation_runs`;--> statement-breakpoint
DROP TABLE `automation_runs`;--> statement-breakpoint
ALTER TABLE `automation_runs_new` RENAME TO `automation_runs`;--> statement-breakpoint
CREATE INDEX `idx_automation_runs_automation_started` ON `automation_runs` (`automation_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_automation_runs_automation_scheduled` ON `automation_runs` (`automation_id`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `idx_automation_runs_automation_status` ON `automation_runs` (`automation_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_automation_runs_status` ON `automation_runs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_automation_runs_status_scheduled` ON `automation_runs` (`status`,`scheduled_at`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
