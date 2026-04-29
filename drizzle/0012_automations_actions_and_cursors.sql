CREATE TABLE `automation_event_cursors` (
	`provider` text NOT NULL,
	`project_id` text NOT NULL,
	`last_polled_at` integer NOT NULL,
	`cursor` text,
	PRIMARY KEY(`provider`, `project_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `automations` ADD `event_provider` text;--> statement-breakpoint
ALTER TABLE `automations` ADD `actions` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_automation_event_cursors_project` ON `automation_event_cursors` (`project_id`);