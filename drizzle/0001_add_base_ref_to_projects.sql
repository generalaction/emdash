ALTER TABLE `projects` ADD COLUMN `base_ref` text;
--> statement-breakpoint
UPDATE `projects`
SET `base_ref` = CASE
  WHEN git_branch IS NOT NULL AND length(trim(git_branch)) > 0 THEN
    CASE
      WHEN instr(git_branch, '/') > 0 THEN trim(git_branch)
      ELSE printf('%s/%s', COALESCE(NULLIF(trim(git_remote), ''), 'origin'), trim(git_branch))
    END
  ELSE NULL
END;
