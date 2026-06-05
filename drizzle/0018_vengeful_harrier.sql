ALTER TABLE `automation_runs` ADD `task_created_at` integer;--> statement-breakpoint
ALTER TABLE `automation_runs` ADD `launched_at` integer;--> statement-breakpoint
ALTER TABLE `automation_runs` DROP COLUMN `worker_id`;