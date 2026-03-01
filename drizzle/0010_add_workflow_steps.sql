CREATE TABLE `workflow_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`conversation_id` text,
	`step_number` integer NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`pause_after` integer DEFAULT 0 NOT NULL,
	`prompt` text,
	`artifact_paths` text,
	`metadata` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_workflow_steps_task_id` ON `workflow_steps` (`task_id`);
--> statement-breakpoint
CREATE INDEX `idx_workflow_steps_task_step` ON `workflow_steps` (`task_id`, `step_number`);
