import { Conversation } from '@shared/conversations/types';
import { Task } from '@shared/tasks/types';
import { Terminal } from '@shared/terminal/types';
import type { IFileSystem } from '@main/core/fs/types';
import type { Pty } from '@main/core/pty/pty';
import { IConversationProvider } from '../conversations/types';
import type { IGitProvider } from '../git/types';
import { ITerminalProvider } from '../terminals/terminal-provider';
import { ProjectSettingsProvider } from './settings/schema';

export type BaseTaskProvisionArgs = {
  taskId: string;
  conversations: Conversation[];
  terminals: Terminal[];
};

export interface TaskProvider {
  readonly taskId: string;
  readonly taskPath: string;
  readonly fs: IFileSystem;
  readonly git: IGitProvider;
  readonly conversationProvider: IConversationProvider;
  readonly terminalProvider: ITerminalProvider;
  /** Returns a fresh PTY for running lifecycle scripts (setup/teardown). */
  readonly getPty: () => Promise<Pty>;
}

export interface ProjectProvider {
  readonly type: string;
  readonly settings: ProjectSettingsProvider;
  provisionTask(
    args: Task,
    conversations: Conversation[],
    terminals: Terminal[]
  ): Promise<TaskProvider>;
  getTask(taskId: string): TaskProvider | undefined;
  teadownTask(taskId: string): Promise<void>;
  cleanup(): Promise<void>;
}
