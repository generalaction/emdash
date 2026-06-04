DROP INDEX IF EXISTS `idx_automations_enabled_next_run`;--> statement-breakpoint
CREATE INDEX `idx_automation_runs_status_scheduled` ON `automation_runs` (`status`,`scheduled_at`);--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `last_run_at`;--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `next_run_at`;