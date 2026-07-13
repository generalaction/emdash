import { TuiAgentsRuntime } from '@runtimes/tui-agents/node/runtime/runtime';
import type { TuiAgentsRuntimeDeps } from '@runtimes/tui-agents/node/runtime/types';
import { NodePtySpawner } from '@services/pty/node';

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
