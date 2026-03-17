import { createHash } from './utils';

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
  initialSize?: { cols: number; rows: number };
};

export async function createScriptTerminalId({
  projectId,
  taskId,
  type,
  script,
}: {
  projectId: string;
  taskId: string;
  type: 'setup' | 'run' | 'teardown';
  script: string;
}) {
  const key = `${projectId}::${taskId}::${type}::${script}`;
  const hash = await createHash(key);
  return hash.slice(0, 32);
}
