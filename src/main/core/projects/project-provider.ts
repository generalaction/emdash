import { Conversation } from '@shared/conversations';
import type { Result } from '@shared/result';
import { Task, TaskBootstrapStatus } from '@shared/tasks';
import { Terminal } from '@shared/terminals';
import type { FileSystemProvider } from '@main/core/fs/types';
import { ConversationProvider } from '../conversations/types';
import type { GitProvider } from '../git/types';
import type { TaskLifecycleService } from '../tasks/task-lifecycle-service';
import { TerminalProvider } from '../terminals/terminal-provider';
import { ProjectSettingsProvider } from './settings/schema';

export type BaseTaskProvisionArgs = {
  taskId: string;
  conversations: Conversation[];
  terminals: Terminal[];
};

export type ProvisionTaskError =
  | { type: 'timeout'; message: string; timeout: number }
  | { type: 'error'; message: string };

export type TeardownTaskError =
  | { type: 'timeout'; message: string; timeout: number }
  | { type: 'error'; message: string };

export interface TaskProvider {
  readonly taskId: string;
  readonly taskPath: string;
  readonly taskBranch: string | undefined;
  readonly sourceBranch: string;
  readonly taskEnvVars: Record<string, string>;
  readonly fs: FileSystemProvider;
  readonly git: GitProvider;
  readonly conversations: ConversationProvider;
  readonly terminals: TerminalProvider;
  readonly settings: ProjectSettingsProvider;
  readonly lifecycleService?: TaskLifecycleService;
}

export interface ProjectProvider {
  readonly type: string;
  readonly settings: ProjectSettingsProvider;
  readonly git: GitProvider;
  readonly fs: FileSystemProvider;
  provisionTask(
    args: Task,
    conversations: Conversation[],
    terminals: Terminal[]
  ): Promise<Result<TaskProvider, ProvisionTaskError>>;
  getTask(taskId: string): TaskProvider | undefined;
  getTaskBootstrapStatus(taskId: string): TaskBootstrapStatus;
  teardownTask(taskId: string): Promise<Result<void, TeardownTaskError>>;
  removeTaskWorktree(taskBranch: string): Promise<void>;
  cleanup(): Promise<void>;
}
