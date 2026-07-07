import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { getAgentUpdateActionState } from '@renderer/lib/components/agent-selector/agent-install';
import type { AgentPayload } from '@shared/core/agents/agent-payload';
import { InstalledBadge, UninstalledBadge, UpdateAvailableBadge } from './agent-status-badge';

export const AgentRow = ({ agent, onClick }: { agent: AgentPayload; onClick?: () => void }) => {
  const isInstalled = agent.status === 'available';
  const isClickable = !!onClick;
  const Tag = isClickable ? 'button' : 'div';

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
    <Tag
      className={`group flex w-full items-center gap-3 rounded-lg p-3 hover:bg-background-1${isClickable ? ' cursor-pointer text-left' : ''}`}
      onClick={isClickable ? onClick : undefined}
    >
      <div className="flex size-6 items-center justify-center rounded-lg bg-background-1 p-1.5 group-hover:bg-background-2">
        <AgentIcon id={agent.id} size={16} />
      </div>
      <div className="flex w-full flex-col gap-0.5">
        <div className="flex w-full items-center justify-between">
          <span className="text-sm text-foreground">{agent.name}</span>
          <div className="flex items-center gap-1.5">
            <>
              {updateState.render && <UpdateAvailableBadge />}
              {isInstalled ? <InstalledBadge /> : <UninstalledBadge />}
            </>
          </div>
        </div>
      </div>
    </Tag>
  );
};
