import { Info, Star } from 'lucide-react';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { getAgentUpdateActionState } from '@renderer/lib/components/agent-selector/agent-install';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import type { AgentPayload } from '@shared/core/agents/agent-payload';
import { InstalledBadge, UninstalledBadge, UpdateAvailableBadge } from './agent-status-badge';

export type DefaultAgentControl =
  | { kind: 'current' }
  | { kind: 'set'; onSelect: () => void; disabled?: boolean };

const DefaultAgentButton = ({
  control,
  agentName,
}: {
  control?: DefaultAgentControl;
  agentName: string;
}) => {
  if (!control) return null;

  if (control.kind === 'current') {
    return (
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-warning"
        title="Default agent"
        aria-label="Default agent"
      >
        <Star className="size-3.5 fill-current" />
      </span>
    );
  }

  return (
    <button
      type="button"
      title="Set as default agent"
      aria-label={`Set ${agentName} as default agent`}
      disabled={control.disabled}
      className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground-muted transition hover:bg-background-2 hover:text-foreground-warning focus-visible:bg-background-2 focus-visible:text-foreground-warning focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      onClick={control.onSelect}
    >
      <Star className="size-3.5" />
    </button>
  );
};

export const AgentRow = ({
  agent,
  onClick,
  defaultAgentControl,
}: {
  agent: AgentPayload;
  onClick?: () => void;
  defaultAgentControl?: DefaultAgentControl;
}) => {
  const isInstalled = agent.status === 'available';
  const isClickable = !!onClick;

  const updates = agent.capabilities.hostDependency.updates;
  const updateStrategyKind = updates.kind === 'supported' ? updates.update.kind : 'none';
  const updateState = getAgentUpdateActionState({
    updateAvailable: agent.updateAvailable,
    updateStrategyKind,
    version: agent.version,
    latestVersion: agent.latestVersion,
    isUpdating: false,
  });

  const rowContent = (
    <>
      <div className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-background-1 p-1.5 group-hover:bg-background-2">
        <AgentIcon id={agent.id} size={16} />
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <span className="truncate text-sm text-foreground">{agent.name}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          {updateState.render && <UpdateAvailableBadge />}
          {isInstalled ? <InstalledBadge /> : <UninstalledBadge />}
        </div>
      </div>
    </>
  );
  const contentClassName = `flex min-w-0 flex-1 items-center gap-3${
    isClickable ? ' cursor-pointer text-left' : ''
  }`;
  const canShowDefaultAgentMenuItem = !!defaultAgentControl;

  return (
    <ContextMenu>
      <ContextMenuTrigger className="w-full">
        <div className="group flex w-full items-center gap-2 rounded-lg p-3 hover:bg-background-1">
          {isClickable ? (
            <button type="button" className={contentClassName} onClick={onClick}>
              {rowContent}
            </button>
          ) : (
            <div className={contentClassName}>{rowContent}</div>
          )}
          <DefaultAgentButton control={defaultAgentControl} agentName={agent.name} />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {isClickable && (
          <ContextMenuItem onClick={onClick}>
            <Info className="size-4" />
            View details
          </ContextMenuItem>
        )}
        {canShowDefaultAgentMenuItem && (
          <>
            {isClickable && <ContextMenuSeparator />}
            <ContextMenuItem
              onClick={
                defaultAgentControl.kind === 'set' ? defaultAgentControl.onSelect : undefined
              }
              disabled={
                defaultAgentControl.kind === 'current' ||
                (defaultAgentControl.kind === 'set' && defaultAgentControl.disabled)
              }
            >
              <Star
                className={
                  defaultAgentControl.kind === 'current'
                    ? 'size-4 fill-foreground-warning text-foreground-warning'
                    : 'size-4'
                }
              />
              {defaultAgentControl.kind === 'current' ? 'Default agent' : 'Set as default agent'}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
};
