import type { TerminalShellId } from '@shared/core/terminals/terminal-settings';
import type { Terminal } from '@shared/core/terminals/terminals';

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
  readonly kind: 'local' | 'ssh';
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
