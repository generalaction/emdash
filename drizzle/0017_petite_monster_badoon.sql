ALTER TABLE `conversations` ADD `agent_status` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `agent_status_seen` integer DEFAULT 1;