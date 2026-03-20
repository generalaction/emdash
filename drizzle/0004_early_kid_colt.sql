ALTER TABLE `pull_requests` ADD `id` text PRIMARY KEY NOT NULL;--> statement-breakpoint
ALTER TABLE `pull_requests` ADD `is_draft` integer;--> statement-breakpoint
ALTER TABLE `pull_requests` ADD `fetched_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL;