import type { TerminalShellId } from './terminal-settings';

export type Terminal = {
  id: string;
  projectId: string;
  taskId: string;
  ssh?: boolean;
  shellId: TerminalShellId;
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

/** Prefix for the synthetic terminal ids of workspace lifecycle scripts. */
export const LIFECYCLE_SCRIPT_TERMINAL_ID_PREFIX = 'script-lifecycle-';

export function createLifecycleScriptTerminalId(type: 'setup' | 'run' | 'teardown') {
  return `${LIFECYCLE_SCRIPT_TERMINAL_ID_PREFIX}${type}`;
}
