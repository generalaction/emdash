import type { Terminal } from '@shared/terminals';

export type LifecycleScriptSpawnRequest = {
  terminal: Terminal;
  command?: string;
  initialSize?: { cols: number; rows: number };
  respawnOnExit?: boolean;
  preserveBufferOnExit?: boolean;
  watchDevServer?: boolean;
};

export interface TerminalProvider {
  spawnTerminal(
    terminal: Terminal,
    initialSize?: { cols: number; rows: number },
    command?: { command: string; args: string[] }
  ): Promise<void>;
  spawnLifecycleScript(request: LifecycleScriptSpawnRequest): Promise<void>;
  killTerminal(terminalId: string): Promise<void>;
  destroyAll(): Promise<void>;
  detachAll(): Promise<void>;
}
