CREATE TABLE `pull_request_reviewers` (
	`pull_request_url` text NOT NULL,
	`user_id` text NOT NULL,
	`review_state` text NOT NULL,
	PRIMARY KEY(`pull_request_url`, `user_id`),
	FOREIGN KEY (`pull_request_url`) REFERENCES `pull_requests`(`url`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `pull_request_users`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_prr_pull_request_url` ON `pull_request_reviewers` (`pull_request_url`);--> statement-breakpoint
CREATE INDEX `idx_prr_user_id` ON `pull_request_reviewers` (`user_id`);