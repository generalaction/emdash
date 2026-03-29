CREATE TABLE `project_pull_requests` (
	`project_id` text NOT NULL,
	`pull_request_url` text NOT NULL,
	PRIMARY KEY(`project_id`, `pull_request_url`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pull_request_url`) REFERENCES `pull_requests`(`url`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pull_request_assignees` (
	`pull_request_id` text NOT NULL,
	`login` text NOT NULL,
	`avatar_url` text,
	PRIMARY KEY(`pull_request_id`, `login`),
	FOREIGN KEY (`pull_request_id`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pull_request_labels` (
	`pull_request_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	PRIMARY KEY(`pull_request_id`, `name`),
	FOREIGN KEY (`pull_request_id`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `pull_requests` ADD `author_login` text;--> statement-breakpoint
ALTER TABLE `pull_requests` ADD `author_display_name` text;--> statement-breakpoint
ALTER TABLE `pull_requests` ADD `author_avatar_url` text;--> statement-breakpoint
CREATE INDEX `idx_project_pull_requests_project_id` ON `project_pull_requests` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_pra_login` ON `pull_request_assignees` (`login`);--> statement-breakpoint
CREATE INDEX `idx_prl_name` ON `pull_request_labels` (`name`);--> statement-breakpoint
CREATE INDEX `idx_pull_requests_author_login` ON `pull_requests` (`author_login`);