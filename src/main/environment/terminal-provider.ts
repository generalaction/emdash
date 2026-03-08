import { Result } from '@main/lib/result';
import { LocalSpawnError } from '../pty/local-pty';
import { Ssh2OpenError } from '../pty/ssh2-pty';

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
