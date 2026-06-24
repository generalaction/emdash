import { agentHookService } from '@main/core/agent-hooks/agent-hook-service';
import { isAppFocused } from '@main/core/agent-hooks/notification';
import { getPlugin } from '@main/core/agents/plugin-registry';
import { setProviderSessionId } from '@main/core/conversations/set-provider-session-id';
import { updateConversationModel } from '@main/core/conversations/updateConversationModel';
import { localDependencyManager } from '@main/core/dependencies/dependency-managers';
import { hostDependencyStore } from '@main/core/dependencies/host-dependency-store';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { buildAgentEnv } from '@main/core/pty/pty-env';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { resolveAgentExecutable } from '../conversations/impl/resolve-agent-executable';
import { AcpSessionManager } from './acp-session-manager';

export const acpSessionManager = new AcpSessionManager({
  getPlugin,
  resolveSpawnContext: async (providerId, plugin) => {
    const agentEnv = buildAgentEnv({ agentApiVars: true });
    const binaryName = plugin.capabilities.hostDependency.binaryNames[0] ?? providerId;
    const cachedStatePath = localDependencyManager.get(providerId as never)?.path;
    const cli = await resolveAgentExecutable({
      providerId,
      binaryName,
      ctx: new LocalExecutionContext(),
      hostDependencyStore,
      cachedStatePath,
    });
    const filteredEnv = Object.fromEntries(
      Object.entries(agentEnv).filter((e): e is [string, string] => e[1] !== undefined)
    );
    return { cli, agentEnv: filteredEnv };
  },
  events,
  setProviderSessionId,
  updateConversationModel,
  emitAgentEvent: (event) => agentHookService.emitAgentEvent(event, isAppFocused()),
  log,
});
