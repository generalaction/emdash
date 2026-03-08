import { LocalSpawnError } from '@main/core/pty/local-pty';
import { Ssh2OpenError } from '@main/core/pty/ssh2-pty';
import { Result } from '@main/lib/result';

export type CreateSessionError = LocalSpawnError | Ssh2OpenError;

export type TerminalSpawnOptions = {
  projectId: string;
  terminalId: string;
  taskId: string;
  cwd: string;
  projectPath: string;
  shellSetup?: string;
};

export interface ITerminalProvider {
  spawnTerminal(opts: TerminalSpawnOptions): Promise<Result<void, CreateSessionError>>;
  killTerminal(terminalId: string): void;
}
