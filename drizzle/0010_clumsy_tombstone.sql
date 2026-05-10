ALTER TABLE `projects` ADD `archived` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `icon` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `icon_color` text;