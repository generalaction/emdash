import { NodePtySpawner } from '@emdash/core/pty/node';
import { TuiAgentsRuntime } from '../runtime/runtime';
import type { TuiAgentsRuntimeDeps } from '../runtime/types';

export function createNodeTuiAgentsRuntime(
  deps: Omit<TuiAgentsRuntimeDeps, 'spawner'> & {
    spawner?: TuiAgentsRuntimeDeps['spawner'];
  }
): TuiAgentsRuntime {
  return new TuiAgentsRuntime({
    ...deps,
    spawner: deps.spawner ?? new NodePtySpawner(),
  });
}

export { TuiAgentsRuntime };
export type { TuiAgentsRuntimeDeps };
