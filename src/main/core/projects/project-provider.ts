import type { Branch, FetchError } from '@shared/git';
import type { ProjectRemoteState } from '@shared/projects';
import type { Result } from '@shared/result';
import type { FileSystemProvider } from '@main/core/fs/types';
import type { GitFetchService } from '@main/core/git/git-fetch-service';
import type { ExecFn } from '@main/core/utils/exec';
import type { ConversationProvider } from '../conversations/types';
import type { GitRepositoryService } from '../git/repository-service';
import type { TerminalProvider } from '../terminals/terminal-provider';
import type { ProjectSettingsProvider } from './settings/schema';
import type { WorkspaceType } from './workspace-factory';
import type { WorktreeService } from './worktrees/worktree-service';

export type ProvisionTaskError =
  | { type: 'timeout'; message: string; timeout: number }
  | { type: 'branch-not-found'; branch: string }
  | { type: 'worktree-setup-failed'; branch: string; message?: string }
  | { type: 'error'; message: string };

export type TeardownTaskError =
  | { type: 'timeout'; message: string; timeout: number }
  | { type: 'error'; message: string };

export type WorkspaceProviderData = {
  provisionCommand: string;
  terminateCommand: string;
  remoteWorkspaceId?: string;
};

export type ProvisionResult = {
  taskProvider: TaskProvider;
  persistData: {
    workspaceId: string;
    workspaceProviderData?: WorkspaceProviderData;
    sshConnectionId?: string;
    worktreeGitDir?: string;
  };
};

export interface TaskProvider {
  readonly taskId: string;
  readonly taskBranch: string | undefined;
  readonly sourceBranch: Branch | undefined;
  readonly taskEnvVars: Record<string, string>;
  readonly conversations: ConversationProvider;
  readonly terminals: TerminalProvider;
}

export interface ProjectProvider {
  readonly type: string;
  readonly projectId: string;
  readonly repoPath: string;
  readonly exec: ExecFn;
  readonly settings: ProjectSettingsProvider;
  readonly repository: GitRepositoryService;
  readonly fs: FileSystemProvider;
  readonly worktreeService: WorktreeService;
  readonly gitFetchService: GitFetchService;
  readonly workspaceType: WorkspaceType;
  getRemoteState(): Promise<ProjectRemoteState>;
  getWorktreeForBranch(branchName: string): Promise<string | undefined>;
  removeTaskWorktree(taskBranch: string): Promise<void>;
  fetch(): Promise<Result<void, FetchError>>;
  cleanup(): Promise<void>;
}
