ALTER TABLE `pull_requests` ADD `merged_at` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `auto_cleanup_opt_out` integer DEFAULT false NOT NULL;