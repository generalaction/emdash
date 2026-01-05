ALTER TABLE `tasks` ADD COLUMN `use_worktree` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
UPDATE `tasks` SET `use_worktree` = 1 WHERE `use_worktree` IS NULL;
