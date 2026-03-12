import { LocalSpawnError } from '@main/core/pty/local-pty';
import { Ssh2OpenError } from '@main/core/pty/ssh2-pty';

export type CreateSessionError = LocalSpawnError | Ssh2OpenError;

export type TerminalSpawnOptions = {
  projectId: string;
  terminalId: string;
  taskId: string;
  cwd: string;
  shellSetup?: string;
};

export interface ITerminalProvider {
  spawnTerminal(opts: TerminalSpawnOptions): Promise<void>;
  killTerminal(terminalId: string): Promise<void>;
  destroyAll(): Promise<void>;
}
