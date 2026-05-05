-- Defensively ensure tasks.source_branch is nullable for non-git projects.
-- Migration 0006 already made it nullable; this no-ops on DBs where that
-- stuck and repairs DBs where the schema drifted.

PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_tasks_0009` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `name` text NOT NULL,
  `status` text NOT NULL,
  `source_branch` text,
  `task_branch` text,
  `linked_issue` text,
  `archived_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `last_interacted_at` text,
  `status_changed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `is_pinned` integer DEFAULT 0 NOT NULL,
  `workspace_provider` text,
  `workspace_id` text,
  `workspace_provider_data` text,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_tasks_0009` (
  `id`, `project_id`, `name`, `status`, `source_branch`, `task_branch`,
  `linked_issue`, `archived_at`, `created_at`, `updated_at`,
  `last_interacted_at`, `status_changed_at`, `is_pinned`,
  `workspace_provider`, `workspace_id`, `workspace_provider_data`
)
SELECT
  `id`, `project_id`, `name`, `status`, `source_branch`, `task_branch`,
  `linked_issue`, `archived_at`, `created_at`, `updated_at`,
  `last_interacted_at`, `status_changed_at`, `is_pinned`,
  `workspace_provider`, `workspace_id`, `workspace_provider_data`
FROM `tasks`;
--> statement-breakpoint
DROP TABLE `tasks`;
--> statement-breakpoint
ALTER TABLE `__new_tasks_0009` RENAME TO `tasks`;
--> statement-breakpoint
CREATE INDEX `idx_tasks_project_id` ON `tasks` (`project_id`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
