import { Terminal } from '@shared/terminals';

export interface TerminalProvider {
  spawnTerminal(terminal: Terminal): Promise<void>;
  killTerminal(terminalId: string): Promise<void>;
  destroyAll(): Promise<void>;
}
