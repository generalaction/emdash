PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`scheduled_at` integer,
	`deadline_at` integer,
	`started_at` integer,
	`finished_at` integer,
	`status` text NOT NULL,
	`task_id` text,
	`created_task_id` text,
	`error` text,
	`trigger_kind` text NOT NULL,
	`worker_id` text,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_automation_runs` (`id`, `automation_id`, `scheduled_at`, `deadline_at`, `started_at`, `finished_at`, `status`, `task_id`, `created_task_id`, `error`, `trigger_kind`, `worker_id`)
SELECT `id`, `automation_id`, `scheduled_at`, CASE WHEN `status` = 'queued' AND `scheduled_at` IS NOT NULL THEN `scheduled_at` + 300000 ELSE NULL END, `started_at`, `finished_at`, `status`, `task_id`, `created_task_id`, `error`, `trigger_kind`, `worker_id`
FROM `automation_runs`;--> statement-breakpoint
DROP TABLE `automation_runs`;--> statement-breakpoint
ALTER TABLE `__new_automation_runs` RENAME TO `automation_runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_automation_runs_automation_started` ON `automation_runs` (`automation_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_automation_runs_automation_scheduled` ON `automation_runs` (`automation_id`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `idx_automation_runs_automation_status` ON `automation_runs` (`automation_id`,`status`);
