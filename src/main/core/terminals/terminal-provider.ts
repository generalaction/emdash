import { Terminal } from '@shared/terminals';

export interface TerminalProvider {
  spawnTerminal(
    terminal: Terminal,
    initialSize: { cols: number; rows: number },
    command?: { command: string; args: string[] }
  ): Promise<void>;
  killTerminal(terminalId: string): Promise<void>;
  runLifecycleScript(
    script: { type: 'setup' | 'run' | 'teardown'; script: string },
    initialSize?: { cols: number; rows: number }
  ): Promise<void>;
  destroyAll(): Promise<void>;
}
