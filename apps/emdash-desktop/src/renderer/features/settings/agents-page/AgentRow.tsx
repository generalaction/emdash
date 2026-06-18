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
import { cn } from '@renderer/utils/utils';
import type { AgentPayload } from '@shared/core/agents/agent-payload';
import { InstalledBadge, UninstalledBadge, UpdateAvailableBadge } from './agent-status-badge';

export const AgentRow = ({
  agent,
  onClick,
  isDefault = false,
  onSetDefault,
}: {
  agent: AgentPayload;
  onClick?: () => void;
  /** Whether this agent is the current default (gets a persistent filled star). */
  isDefault?: boolean;
  /** Promote this agent to default. Omit to hide the set-default control entirely. */
  onSetDefault?: () => void;
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

  // The default agent is marked with a filled star; hovering any other promotable
  // agent reveals a hollow star to make it the default. Only one default at a time.
  const showSetDefaultButton = !isDefault && !!onSetDefault;
  // The default row shows a disabled "Default agent" entry so its state is visible.
  const showDefaultMenuItem = isDefault || !!onSetDefault;

  return (
    <ContextMenu>
      <ContextMenuTrigger className="w-full">
        <div className="group relative flex w-full items-center gap-3 rounded-lg p-3 hover:bg-background-1">
          {isClickable && (
            <button
              type="button"
              aria-label={`View ${agent.name} details`}
              className="absolute inset-0 cursor-pointer rounded-lg"
              onClick={onClick}
            />
          )}
          <div className="pointer-events-none relative flex size-6 items-center justify-center rounded-lg bg-background-1 p-1.5 group-hover:bg-background-2">
            <AgentIcon id={agent.id} size={16} />
          </div>
          <div className="pointer-events-none relative flex w-full flex-col gap-0.5">
            <div className="flex w-full items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-sm text-foreground">{agent.name}</span>
                {isDefault && (
                  <span
                    className="flex shrink-0 items-center"
                    title="Default agent"
                    aria-label="Default agent"
                  >
                    <Star className="size-3.5 fill-foreground-warning text-foreground-warning" />
                  </span>
                )}
                {showSetDefaultButton && (
                  <button
                    type="button"
                    title="Set as default agent"
                    aria-label={`Set ${agent.name} as default agent`}
                    className="pointer-events-auto relative z-10 flex shrink-0 cursor-pointer items-center rounded-sm text-foreground-muted opacity-0 transition group-hover:opacity-100 hover:text-foreground-warning focus-visible:opacity-100"
                    onClick={onSetDefault}
                  >
                    <Star className="size-3.5" />
                  </button>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {updateState.render && <UpdateAvailableBadge />}
                {isInstalled ? <InstalledBadge /> : <UninstalledBadge />}
              </div>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {isClickable && (
          <ContextMenuItem onClick={onClick}>
            <Info className="size-4" />
            View details
          </ContextMenuItem>
        )}
        {showDefaultMenuItem && (
          <>
            {isClickable && <ContextMenuSeparator />}
            <ContextMenuItem onClick={isDefault ? undefined : onSetDefault} disabled={isDefault}>
              <Star
                className={cn(
                  'size-4',
                  isDefault && 'fill-foreground-warning text-foreground-warning'
                )}
              />
              {isDefault ? 'Default agent' : 'Set as default agent'}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
};
