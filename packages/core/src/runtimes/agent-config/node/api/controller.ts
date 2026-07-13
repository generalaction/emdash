import { createController } from '@emdash/wire';
import { agentConfigContract } from '@runtimes/agent-config/api';
import type { AgentConfigRuntime } from '@runtimes/agent-config/node/runtime/runtime';
import { createAgentConfigProcedures } from './procedures';

export function createAgentConfigController(runtime: AgentConfigRuntime) {
  const procedures = createAgentConfigProcedures(runtime);
  return createController(agentConfigContract, {
    ...procedures,
    installAgent: {
      run: (input, ctx) => runtime.installAgent(input.providerId, input.strategy, ctx),
      toError: (error) => ({
        type: 'command-failed' as const,
        message: error instanceof Error ? error.message : String(error),
        output: '',
      }),
    },
    agents: runtime.agentsLiveHost(),
    loginOutput: (key) => runtime.loginOutputLog(key.providerId),
    mcpServers: runtime.mcpLiveHost(),
    skills: runtime.skillsLiveHost(),
  });
}
