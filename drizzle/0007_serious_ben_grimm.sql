ALTER TABLE `pull_requests` ADD `head_ref_name` text;--> statement-breakpoint
CREATE INDEX `idx_pull_requests_head_ref_name` ON `pull_requests` (`head_ref_name`);