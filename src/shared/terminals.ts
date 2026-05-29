import type { TerminalShellId } from './terminal-settings';
import { createHash } from './utils';

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

export async function createScriptTerminalId({
  projectId,
  scopeId,
  taskId,
  type,
  script,
}: {
  projectId: string;
  scopeId?: string;
  taskId?: string;
  type: 'setup' | 'run' | 'teardown';
  script: string;
}) {
  const resolvedScopeId = scopeId ?? taskId;
  if (!resolvedScopeId) {
    throw new Error('createScriptTerminalId requires scopeId');
  }
  const key = `${projectId}::${resolvedScopeId}::${type}::${script}`;
  const hash = await createHash(key);
  return hash.slice(0, 32);
}

export function createLifecycleScriptTerminalId(type: 'setup' | 'run' | 'teardown') {
  return `script-lifecycle-${type}`;
}
