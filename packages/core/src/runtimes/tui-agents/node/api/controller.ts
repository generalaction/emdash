import { createController } from '@emdash/wire';
import { tuiAgentsContract } from '@runtimes/tui-agents/api';
import type { TuiAgentsRuntime } from '@runtimes/tui-agents/node/runtime/runtime';
import { createTuiAgentsProcedures } from './procedures';

export function createTuiAgentsController(runtime: TuiAgentsRuntime) {
  const procedures = createTuiAgentsProcedures(runtime);
  return createController(tuiAgentsContract, {
    ...procedures,
    output: (key) => runtime.outputLog(key),
    sessions: runtime.sessionsLiveHost(),
    agentStates: runtime.agentStatesLiveHost(),
  });
}
