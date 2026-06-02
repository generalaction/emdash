ALTER TABLE `conversations` ADD `session_id` text;
--> statement-breakpoint
UPDATE `conversations` SET `session_id` = `id`;