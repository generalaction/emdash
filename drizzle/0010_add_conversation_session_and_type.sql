ALTER TABLE `conversations` ADD `agent_session_id` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `type` text NOT NULL DEFAULT 'agent';
