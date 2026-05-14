ALTER TABLE `automation_runs` ADD `scheduled_at` integer;--> statement-breakpoint
ALTER TABLE `automation_runs` ADD `worker_id` text;--> statement-breakpoint
CREATE INDEX `idx_automation_runs_automation_scheduled` ON `automation_runs` (`automation_id`,`scheduled_at`);