export type RemoteLocator = {
  sshConnectionId?: string;
  taskId?: string;
  projectId?: string;
};

export type TaskPathLocator = {
  taskPath: string;
} & RemoteLocator;

export type ProjectPathLocator = {
  projectPath: string;
} & RemoteLocator;

export type RepoPathLocator = {
  repoPath: string;
} & RemoteLocator;

export type WorktreePathLocator = {
  worktreePath: string;
} & RemoteLocator;
