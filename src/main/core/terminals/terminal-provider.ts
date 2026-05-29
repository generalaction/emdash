import type { TerminalShellId } from '@shared/terminal-settings';
import type { Terminal } from '@shared/terminals';

export type LifecycleScriptSpawnRequest = {
  terminal: Terminal;
  command?: string;
  shellSetup?: string;
  initialSize?: { cols: number; rows: number };
  respawnOnExit?: boolean;
  preserveBufferOnExit?: boolean;
  watchDevServer?: boolean;
};

export type TerminalSpawnOptions = {
  command?: { command: string; args: string[] };
  shell?: TerminalShellId;
};

export interface TerminalProvider {
  spawnTerminal(
    terminal: Terminal,
    initialSize?: { cols: number; rows: number },
    options?: TerminalSpawnOptions
  ): Promise<void>;
  spawnLifecycleScript(request: LifecycleScriptSpawnRequest): Promise<void>;
  killTerminal(terminalId: string): Promise<void>;
  destroyAll(): Promise<void>;
  detachAll(): Promise<void>;
}
