import { Settings2, Sparkles } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useMemo, useState } from 'react';
import { AGENT_PROVIDERS } from '@shared/agent-provider-registry';
import { CliAgentStatus } from '@renderer/features/settings/components/connections';
import CustomCommandModal from '@renderer/features/settings/components/CustomCommandModal';
import IntegrationRow from '@renderer/features/settings/components/IntegrationRow';
import { rpc } from '@renderer/lib/ipc';
import { agentMeta } from '@renderer/lib/providers/meta';
import { appState } from '@renderer/lib/stores/app-state';
import { type DependencyState } from '@renderer/lib/stores/dependencies-store';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { log } from '@renderer/utils/logger';

export const BASE_CLI_AGENTS: CliAgentStatus[] = AGENT_PROVIDERS.filter(
  (provider) => provider.detectable !== false
).map((provider) => ({
  id: provider.id,
  name: provider.name,
  status: 'missing' as const,
  docUrl: provider.docUrl ?? null,
  installCommand: provider.installCommand ?? null,
}));

function mapDependencyStatesToCli(
  agentStatuses: Record<string, DependencyState>
): CliAgentStatus[] {
  const mergedMap = new Map<string, CliAgentStatus>();
  BASE_CLI_AGENTS.forEach((agent) => {
    mergedMap.set(agent.id, { ...agent });
  });
  Object.entries(agentStatuses).forEach(([agentId, state]) => {
    const base = mergedMap.get(agentId);
    mergedMap.set(agentId, {
      ...(base ?? { id: agentId, name: agentId, docUrl: null, installCommand: null }),
      id: agentId,
      name: base?.name ?? agentId,
      status: state.status === 'available' ? 'connected' : state.status,
      version: state.version ?? null,
      command: state.path ?? null,
    });
  });
  return Array.from(mergedMap.values());
}

const ICON_BUTTON =
  'rounded-md p-1.5 text-muted-foreground transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

const renderAgentRow = (agent: CliAgentStatus, onSettingsClick: (id: string) => void) => {
  const logo = agentMeta[agent.id as keyof typeof agentMeta]?.icon;

  const handleNameClick = agent.docUrl
    ? async () => {
        try {
          await rpc.app.openExternal(agent.docUrl!);
        } catch (openError) {
          log.error(`Failed to open ${agent.name} docs:`, openError);
        }
      }
    : undefined;

  const isDetected = agent.status === 'connected';
  const indicatorClass = isDetected ? 'bg-emerald-500' : 'bg-muted-foreground/50';
  const statusLabel = isDetected ? 'Detected' : 'Not detected';

  return (
    <IntegrationRow
      key={agent.id}
      logoSrc={logo}
      icon={
        logo ? undefined : (
          <Sparkles className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        )
      }
      name={agent.name}
      onNameClick={handleNameClick}
      status={agent.status}
      statusLabel={statusLabel}
      showStatusPill={false}
      installCommand={agent.installCommand}
      middle={
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className={`h-1.5 w-1.5 rounded-full ${indicatorClass}`} />
          {statusLabel}
        </span>
      }
      rightExtra={
        isDetected ? (
          <TooltipProvider delay={150}>
            <Tooltip>
              <TooltipTrigger>
                <button
                  type="button"
                  onClick={() => onSettingsClick(agent.id)}
                  className={ICON_BUTTON}
                  aria-label={`${agent.name} execution settings`}
                >
                  <Settings2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                Execution settings
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null
      }
    />
  );
};

export const CliAgentsList: React.FC = observer(() => {
  const [customModalAgentId, setCustomModalAgentId] = useState<string | null>(null);
  const agentStatuses = appState.dependencies.agentStatuses;

  const sortedAgents = useMemo(() => {
    return mapDependencyStatesToCli(agentStatuses).sort((a, b) => {
      if (a.status === 'connected' && b.status !== 'connected') return -1;
      if (b.status === 'connected' && a.status !== 'connected') return 1;
      return a.name.localeCompare(b.name);
    });
  }, [agentStatuses]);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {sortedAgents.map((agent) => renderAgentRow(agent, setCustomModalAgentId))}
      </div>

      <CustomCommandModal
        isOpen={customModalAgentId !== null}
        onClose={() => setCustomModalAgentId(null)}
        providerId={customModalAgentId ?? ''}
      />
    </div>
  );
});
