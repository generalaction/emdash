ALTER TABLE `projects` RENAME COLUMN `environment_provider` TO `workspace_provider`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_projects_is_remote`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `git_branch`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `github_repository`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `github_connected`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `is_remote`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `remote_path`;