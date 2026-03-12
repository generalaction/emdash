import { Conversation } from '@shared/conversations/types';
import { Terminal } from '@shared/terminal/types';
import type { IFileSystem } from '@main/core/fs/types';
import type { Pty } from '@main/core/pty/pty';
import { IConversationProvider } from '../conversations/types';
import type { IGitProvider } from '../git/types';
import { ITerminalProvider } from '../terminals/terminal-provider';

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
  readonly agentProvider: IConversationProvider;
  readonly terminalProvider: ITerminalProvider;
  /** Returns a fresh PTY for running lifecycle scripts (setup/teardown). */
  readonly getPty: () => Promise<Pty>;
}

export interface ProjectProvider<TArgs extends BaseTaskProvisionArgs = BaseTaskProvisionArgs> {
  readonly type: string;
  provisionTask(args: TArgs): Promise<TaskProvider>;
  getTask(taskId: string): TaskProvider | undefined;
  teadownTask(taskId: string): Promise<void>;
  cleanup(): Promise<void>;
}
