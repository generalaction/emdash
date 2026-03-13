import { Terminal } from '@shared/terminals';

export interface ITerminalProvider {
  spawnTerminal(terminal: Terminal): Promise<void>;
  killTerminal(terminalId: string): Promise<void>;
  destroyAll(): Promise<void>;
}
