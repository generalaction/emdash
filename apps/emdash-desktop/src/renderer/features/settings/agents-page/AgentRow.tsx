import { observer } from 'mobx-react-lite';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { getAgentUpdateActionState } from '@renderer/lib/components/agent-selector/agent-install';
import { appState } from '@renderer/lib/stores/app-state';
import type { AgentPayload } from '@shared/core/agents/agent-payload';

function formatSupportsText(agent: AgentPayload) {
  const supportsHooks = agent.capabilities.hooks.kind !== 'none';
  const supportsSessions = agent.capabilities.sessions.kind !== 'stateless';
  return `Supports: Prompts${supportsHooks ? ', Hooks' : ''}${supportsSessions ? ', Sessions' : ''}`;
}

export const AgentRow = observer(
  ({ agent, onClick }: { agent: AgentPayload; onClick?: () => void }) => {
    const isInstalled = agent.status === 'available';
    const isClickable = !!onClick;
    const Tag = isClickable ? 'button' : 'div';

    const updateStrategyKind =
      agent.capabilities.updates.kind === 'supported'
        ? agent.capabilities.updates.update.kind
        : 'none';
    const isUpdating = appState.dependencies.isUpdating(agent.id as never);
    const updateState = getAgentUpdateActionState({
      updateAvailable: agent.updateAvailable,
      updateStrategyKind,
      version: agent.version,
      latestVersion: agent.latestVersion,
      isUpdating,
    });

    return (
      <Tag
        className={`group flex w-full items-center gap-3 rounded-lg p-3 hover:bg-background-1${isClickable ? ' cursor-pointer text-left' : ''}`}
        onClick={isClickable ? onClick : undefined}
      >
        <div className="flex size-9 items-center justify-center rounded-lg bg-background-1 p-1.5 group-hover:bg-background-2">
          <AgentIcon id={agent.id} size={20} />
        </div>
        <div className="flex w-full flex-col gap-0.5">
          <div className="flex w-full items-center justify-between">
            <span className="text-sm text-foreground">{agent.name}</span>
            <div className="flex items-center gap-1.5">
              {updateState.render && (
                <span className="rounded-md bg-background-warning px-1.5 py-0.5 text-xs text-foreground-warning">
                  Update available
                </span>
              )}
              {isInstalled && !updateState.render && (
                <span className="rounded-md bg-background-success px-1.5 py-0.5 text-xs text-foreground-success">
                  Installed
                </span>
              )}
              {
                !isInstalled && ( 
                  <span className="rounded-md bg-background-2 px-1.5 py-0.5 text-xs text-foreground-passive">
                    Uninstalled
                  </span>
                )
              }
            </div>
          </div>
          <div className="flex w-full items-center justify-between">
            <span className="text-xs text-foreground-muted">{formatSupportsText(agent)}</span>
            <div className="flex items-center gap-2">
              {agent.version && (
                <span className="text-tiny text-foreground-passive">
                  {updateState.versionLabel ?? `v${agent.version}`}
                </span>
              )}
              {!agent.version && agent.latestVersion && (
                <span className="text-tiny text-foreground-passive">
                  v{agent.latestVersion} available
                </span>
              )}
            </div>
          </div>
        </div>
      </Tag>
    );
  }
);
