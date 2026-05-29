import type { TerminalShellId } from './terminal-settings';

export type Terminal = {
  id: string;
  projectId: string;
  taskId: string;
  ssh?: boolean;
  name: string;
};

export type CreateTerminalParams = {
  id: string;
  projectId: string;
  taskId: string;
  name: string;
  shell?: TerminalShellId;
  initialSize?: { cols: number; rows: number };
};

export function createLifecycleScriptTerminalId(type: 'setup' | 'run' | 'teardown') {
  return `script-lifecycle-${type}`;
}
