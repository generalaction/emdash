import type { RepositoryGitProvider } from './repository-git-provider';
import type { WorkspaceGitProvider } from './workspace-git-provider';

export type { RepositoryGitProvider } from './repository-git-provider';
export type { WorkspaceGitProvider } from './workspace-git-provider';

export type GitProvider = RepositoryGitProvider & WorkspaceGitProvider;
