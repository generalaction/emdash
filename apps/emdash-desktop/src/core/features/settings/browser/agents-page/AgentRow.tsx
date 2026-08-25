import { Tooltip } from '@emdash/ui/react/primitives';
import { MessageSquare, SquareTerminal } from 'lucide-react';
import type { ReactNode } from 'react';
import { getAgentUpdateActionState } from '@core/features/agents/api/browser/components/agent-selector/agent-install';
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
          {/* Every agent runs in the terminal; ACP-capable ones also offer the chat UI. */}
          {supportsChatUi && (
            <CapabilityIcon label="Supports Chat UI">
              <MessageSquare className="size-3.5 text-foreground-passive" aria-hidden />
            </CapabilityIcon>
          )}
          <CapabilityIcon label="Supports TUI">
            <SquareTerminal className="size-3.5 text-foreground-passive" aria-hidden />
          </CapabilityIcon>
        </div>
      </div>
    </div>
  );
};

function CapabilityIcon({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Provider delay={150}>
      <Tooltip.Root>
        <Tooltip.Trigger render={<span className="inline-flex" aria-label={label} />}>
          {children}
        </Tooltip.Trigger>
        <Tooltip.Content>{label}</Tooltip.Content>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
