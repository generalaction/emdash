DROP INDEX IF EXISTS `idx_automation_runs_created_task_id`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_automations_enabled_next_run`;--> statement-breakpoint
ALTER TABLE `automation_runs` ADD `task_created_at` integer;--> statement-breakpoint
ALTER TABLE `automation_runs` ADD `launched_at` integer;--> statement-breakpoint
ALTER TABLE `automation_runs` ADD `trigger_config_snapshot` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `automation_runs` ADD `conversation_config_snapshot` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `automation_runs` ADD `task_config_snapshot` text;--> statement-breakpoint
ALTER TABLE `automations` ADD `trigger_config` text;--> statement-breakpoint
ALTER TABLE `automations` ADD `conversation_config` text;--> statement-breakpoint
CREATE INDEX `idx_automation_runs_status_scheduled` ON `automation_runs` (`status`,`scheduled_at`);--> statement-breakpoint
ALTER TABLE `automation_runs` DROP COLUMN `created_task_id`;--> statement-breakpoint
ALTER TABLE `automation_runs` DROP COLUMN `worker_id`;--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `description`;--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `category`;--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `cron_expr`;--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `cron_tz`;--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `prompt_template`;--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `actions`;--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `is_draft`;--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `last_run_at`;--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `next_run_at`;--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `deadline_policy`;--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `deadline_ms`;