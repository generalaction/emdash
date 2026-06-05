CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`source` text,
	`payload` text NOT NULL,
	`headers` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`processed_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_webhook_events_status_created` ON `webhook_events` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_webhook_events_token` ON `webhook_events` (`token`);