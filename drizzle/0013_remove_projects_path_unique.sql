-- Drop the unique index on projects.path to allow remote projects with the same path but different sshConnectionId
DROP INDEX IF EXISTS idx_projects_path;
