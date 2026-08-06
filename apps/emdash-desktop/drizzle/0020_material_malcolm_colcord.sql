CREATE TABLE `loop_phases` (
	`id` text PRIMARY KEY NOT NULL,
	`loop_id` text NOT NULL,
	`idx` integer NOT NULL,
	`name` text NOT NULL,
	`goal` text NOT NULL,
	`kind` text DEFAULT 'work' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`conversation_id` text,
	`criteria` text,
	`state` text,
	`last_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`loop_id`) REFERENCES `loops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `loops` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`current_phase_index` integer DEFAULT 0 NOT NULL,
	`config` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`state` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_loop_phases_loop_id` ON `loop_phases` (`loop_id`);--> statement-breakpoint
CREATE INDEX `idx_loops_project_id` ON `loops` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_loops_task_id` ON `loops` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_loops_primary_task` ON `loops` (`task_id`) WHERE "loops"."is_primary" = 1;