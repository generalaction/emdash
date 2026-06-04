ALTER TABLE `automation_runs` ADD `trigger_config_snapshot` text NOT NULL DEFAULT '{}';--> statement-breakpoint
ALTER TABLE `automation_runs` ADD `conversation_config_snapshot` text NOT NULL DEFAULT '{}';--> statement-breakpoint
ALTER TABLE `automation_runs` ADD `task_config_snapshot` text;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_automation_runs_created_task_id`;--> statement-breakpoint
ALTER TABLE `automation_runs` DROP COLUMN `created_task_id`;--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `deadline_ms`;
