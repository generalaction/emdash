ALTER TABLE `conversations` ADD `external_session_id` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `external_source_path` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `imported` integer DEFAULT false NOT NULL;