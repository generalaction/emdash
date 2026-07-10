import { tuiAgentsContract } from '@emdash/core/workspace-server';
import { createController } from '@emdash/wire';
import type { TuiAgentsRuntime } from '../runtime/runtime';
import { createTuiAgentsProcedures } from './procedures';

export function createTuiAgentsController(runtime: TuiAgentsRuntime) {
  const procedures = createTuiAgentsProcedures(runtime);
  return createController(tuiAgentsContract, {
    ...procedures,
    output: (key) => runtime.outputLog(key),
    sessions: runtime.sessionsLiveHost(),
    notifications: runtime.notificationsLiveHost(),
  });
}
