import { getAgentUpdateActionState } from '@core/features/agents/api/browser/components/agent-selector/agent-install';
import { AgentCapabilityIcons } from '@core/features/agents/contributions/browser/agent-capability-icons';
import { AgentIcon } from '@core/features/agents/contributions/browser/agent-icon';
import { UpdateAvailableBadge } from '@core/features/settings/browser/agents-page/agent-status-badge';
import { agentSupportsAcp, type AgentPayload } from '@core/primitives/agents/api';

/** Row content (icon tile + name + capability cluster) — the CollectionView shell owns interaction. */
export const AgentRow = ({ agent }: { agent: AgentPayload }) => {
  // Installed state is not repeated here: the list sections already group by it.
  const supportsChatUi = agentSupportsAcp(agent.capabilities);

  const updates = agent.capabilities.hostDependency.updates;
  const updateStrategyKind = updates.kind === 'supported' ? updates.update.kind : 'none';
  const updateState = getAgentUpdateActionState({
    updateAvailable: agent.updateAvailable,
    updateStrategyKind,
    version: agent.version,
    latestVersion: agent.latestVersion,
    isUpdating: false,
  });

  return (
    <div className="group flex w-full items-center gap-3">
      <div className="flex size-6 items-center justify-center rounded-lg bg-background-1 p-1.5 group-hover:bg-background-2">
        <AgentIcon id={agent.id} size={16} />
      </div>
      <div className="flex w-full items-center justify-between">
        <span className="text-sm text-foreground">{agent.name}</span>
        <div className="flex items-center gap-2">
          {updateState.render && <UpdateAvailableBadge />}
          <AgentCapabilityIcons supportsChatUi={supportsChatUi} />
        </div>
      </div>
    </div>
  );
};
