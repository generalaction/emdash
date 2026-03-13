import { Terminal } from '@shared/terminal/types';
import { LocalSpawnError } from '@main/core/pty/local-pty';
import { Ssh2OpenError } from '@main/core/pty/ssh2-pty';

export type CreateSessionError = LocalSpawnError | Ssh2OpenError;

export interface ITerminalProvider {
  spawnTerminal(terminal: Terminal): Promise<void>;
  killTerminal(terminalId: string): Promise<void>;
  destroyAll(): Promise<void>;
}
