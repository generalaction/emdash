ALTER TABLE `automations` ADD `trigger_config` text;--> statement-breakpoint
ALTER TABLE `automations` ADD `conversation_config` text;--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `description`;--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `category`;--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `cron_expr`;--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `cron_tz`;--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `prompt_template`;--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `actions`;--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `is_draft`;--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `deadline_policy`;