import type { IFileSystem } from './impl/fs-provider/types';
import type { IGitProvider } from './git-provider';
import type { Pty } from '../pty/pty';
import type { TaskRow, ConversationRow, TerminalRow } from '../db/schema';
import { IAgentProvider } from './agent-provider';
import { ITerminalProvider } from './terminal-provider';

export type ProvisionArgs = {
  task: TaskRow;
  projectPath: string;
  conversations: ConversationRow[];
  terminals: TerminalRow[];
};

export interface TaskEnvironment {
  readonly taskId: string;
  readonly taskPath: string;
  readonly fs: IFileSystem;
  readonly git: IGitProvider;
  readonly agentProvider: IAgentProvider;
  readonly terminalProvider: ITerminalProvider;
  /** Returns a fresh PTY for running lifecycle scripts (setup/teardown). */
  readonly getPty: () => Promise<Pty>;
}

export interface EnvironmentProvider {
  readonly type: string;
  provision(args: ProvisionArgs): Promise<TaskEnvironment>;
  getEnvironment(taskId: string): TaskEnvironment | undefined;
  teardown(taskId: string): Promise<void>;
  teardownAll(): Promise<void>;
}
