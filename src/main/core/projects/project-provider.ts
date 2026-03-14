import { Conversation } from '@shared/conversations';
import { Task } from '@shared/tasks';
import { Terminal } from '@shared/terminals';
import type { FileSystemProvider } from '@main/core/fs/types';
import { ConversationProvider } from '../conversations/types';
import type { GitProvider } from '../git/types';
import { TerminalProvider } from '../terminals/terminal-provider';
import { ProjectSettingsProvider } from './settings/schema';

export type BaseTaskProvisionArgs = {
  taskId: string;
  conversations: Conversation[];
  terminals: Terminal[];
};

export interface TaskProvider {
  readonly taskId: string;
  readonly taskPath: string;
  readonly fs: FileSystemProvider;
  readonly git: GitProvider;
  readonly conversations: ConversationProvider;
  readonly terminals: TerminalProvider;
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
  ): Promise<TaskProvider>;
  getTask(taskId: string): TaskProvider | undefined;
  teadownTask(taskId: string): Promise<void>;
  cleanup(): Promise<void>;
}
