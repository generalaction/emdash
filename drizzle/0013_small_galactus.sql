CREATE TABLE `conversation_timeline_items` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_conversation_timeline_items_conversation_id` ON `conversation_timeline_items` (`conversation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_conversation_timeline_items_conversation_sequence` ON `conversation_timeline_items` (`conversation_id`,`sequence`);