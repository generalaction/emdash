DROP INDEX IF EXISTS `idx_projects_path`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_projects_local_path` ON `projects` (`path`) WHERE "projects"."ssh_connection_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_projects_ssh_connection_path` ON `projects` (`ssh_connection_id`,`path`) WHERE "projects"."ssh_connection_id" is not null;