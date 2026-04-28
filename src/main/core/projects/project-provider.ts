import type { Branch, FetchError } from '@shared/git';
import type { ProjectRemoteState } from '@shared/projects';
import type { Result } from '@shared/result';
import type { FileSystemProvider } from '@main/core/fs/types';
import type { ConversationProvider } from '../conversations/types';
import type { GitRepositoryService } from '../git/repository-service';
import type { TerminalProvider } from '../terminals/terminal-provider';
import type { ProjectSettingsProvider } from './settings/schema';
import type { TaskProvisionManager } from './task-provision-manager';

export type { TeardownMode } from '../workspaces/workspace-registry';

export type ProvisionTaskError =
  | { type: 'timeout'; message: string; timeout: number }
  | { type: 'branch-not-found'; branch: string }
  | { type: 'worktree-setup-failed'; branch: string; message?: string }
  | { type: 'error'; message: string };

export type TeardownTaskError =
  | { type: 'timeout'; message: string; timeout: number }
  | { type: 'error'; message: string };

export interface TaskProvider {
  readonly taskId: string;
  readonly workspaceId: string;
  readonly taskBranch: string | undefined;
  readonly sourceBranch: Branch | undefined;
  readonly taskEnvVars: Record<string, string>;
  readonly conversations: ConversationProvider;
  readonly terminals: TerminalProvider;
  readonly workspaceProviderData?: string; // JSON, BYOI only; written to DB after provision
}

export interface ProjectProvider {
  readonly type: string;
  readonly settings: ProjectSettingsProvider;
  readonly repository: GitRepositoryService;
  readonly fs: FileSystemProvider;
  readonly tasks: TaskProvisionManager;
  getRemoteState(): Promise<ProjectRemoteState>;
  getWorktreeForBranch(branchName: string): Promise<string | undefined>;
  removeTaskWorktree(taskBranch: string): Promise<void>;
  fetch(): Promise<Result<void, FetchError>>;
  cleanup(): Promise<void>;
}
