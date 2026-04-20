import { Conversation } from '@shared/conversations';
import type { Branch, FetchError } from '@shared/git';
import type { Result } from '@shared/result';
import { Task, TaskBootstrapStatus } from '@shared/tasks';
import { Terminal } from '@shared/terminals';
import type { FileSystemProvider } from '@main/core/fs/types';
import { ConversationProvider } from '../conversations/types';
import type { GitRepositoryService } from '../git/repository-service';
import { TerminalProvider } from '../terminals/terminal-provider';
import type { Workspace } from '../workspaces/workspace';
import { ProjectSettingsProvider } from './settings/schema';

export type BaseTaskProvisionArgs = {
  taskId: string;
  conversations: Conversation[];
  terminals: Terminal[];
};

export type ProvisionTaskError =
  | { type: 'timeout'; message: string; timeout: number }
  | { type: 'branch-not-found'; branch: string }
  | { type: 'worktree-setup-failed'; branch: string; message?: string }
  | { type: 'error'; message: string };

export type TeardownTaskError =
  | { type: 'timeout'; message: string; timeout: number }
  | { type: 'error'; message: string };

export type ProjectRemoteState = {
  hasRemote: boolean;
  selectedRemoteUrl: string | null;
};

export interface TaskProvider {
  readonly taskId: string;
  readonly taskBranch: string | undefined;
  readonly sourceBranch: Branch;
  readonly taskEnvVars: Record<string, string>;
  readonly conversations: ConversationProvider;
  readonly terminals: TerminalProvider;
}

export interface ProjectProvider {
  readonly type: string;
  readonly settings: ProjectSettingsProvider;
  readonly repository: GitRepositoryService;
  readonly fs: FileSystemProvider;
  getRemoteState(): Promise<ProjectRemoteState>;
  getWorkspace(workspaceId: string): Workspace | undefined;
  provisionTask(
    args: Task,
    conversations: Conversation[],
    terminals: Terminal[]
  ): Promise<Result<TaskProvider, ProvisionTaskError>>;
  getTask(taskId: string): TaskProvider | undefined;
  getTaskBootstrapStatus(taskId: string): TaskBootstrapStatus;
  teardownTask(taskId: string): Promise<Result<void, TeardownTaskError>>;
  removeTaskWorktree(taskBranch: string): Promise<void>;
  fetch(): Promise<Result<void, FetchError>>;
  cleanup(): Promise<void>;
}
