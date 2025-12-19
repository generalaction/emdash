ALTER TABLE `projects` ADD COLUMN `run_config_status` text;
--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `run_config_error` text;
--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `run_config_provider` text;
--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `run_config_updated_at` text;

