import { Settings2, Sparkles } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useMemo, useState } from 'react';
import {
  AGENT_PROVIDERS,
  isValidProviderId,
  type AgentProviderId,
} from '@shared/agent-provider-registry';
import type { DependencyState } from '@shared/dependencies';
import { type CliAgentStatus } from '@renderer/features/settings/components/connections';
import CustomCommandModal from '@renderer/features/settings/components/CustomCommandModal';
import IntegrationRow from '@renderer/features/settings/components/IntegrationRow';
import { getAgentInstallErrorMessage } from '@renderer/lib/components/agent-selector/agent-install';
import { AgentInstallButton } from '@renderer/lib/components/agent-selector/agent-install-button';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { agentMeta } from '@renderer/lib/providers/meta';
import { appState } from '@renderer/lib/stores/app-state';
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

type AgentRowActions = {
  isInstalling: (id: AgentProviderId) => boolean;
  onInstallClick: (agent: CliAgentStatus) => void;
  onSettingsClick: (id: string) => void;
};

const renderAgentRow = (agent: CliAgentStatus, actions: AgentRowActions) => {
  const logo = agentMeta[agent.id as keyof typeof agentMeta]?.icon;
  const providerId = isValidProviderId(agent.id) ? agent.id : null;

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
                  onClick={() => actions.onSettingsClick(agent.id)}
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
        ) : providerId ? (
          <AgentInstallButton
            agentId={providerId}
            canInstall={!!agent.installCommand}
            isInstalled={isDetected}
            isInstalling={actions.isInstalling(providerId)}
            tooltipSide="top"
            onInstall={() => actions.onInstallClick(agent)}
          />
        ) : null
      }
    />
  );
};

export const CliAgentsList: React.FC = observer(() => {
  const [customModalAgentId, setCustomModalAgentId] = useState<string | null>(null);
  const { toast } = useToast();
  const agentStatuses = appState.dependencies.agentStatuses;

  const sortedAgents = useMemo(() => {
    return mapDependencyStatesToCli(agentStatuses).sort((a, b) => {
      if (a.status === 'connected' && b.status !== 'connected') return -1;
      if (b.status === 'connected' && a.status !== 'connected') return 1;
      return a.name.localeCompare(b.name);
    });
  }, [agentStatuses]);

  const handleInstall = useCallback(
    async (agent: CliAgentStatus) => {
      if (!isValidProviderId(agent.id) || appState.dependencies.isInstalling(agent.id)) {
        return;
      }

      const result = await appState.dependencies.install(agent.id);

      if (result.success) {
        toast({
          title: 'Agent installed',
          description: `${agent.name} is ready.`,
        });
        return;
      }

      toast({
        title: 'Install failed',
        description: getAgentInstallErrorMessage(result.error),
        variant: 'destructive',
      });
    },
    [toast]
  );

  const rowActions = useMemo<AgentRowActions>(
    () => ({
      isInstalling: (id) => appState.dependencies.isInstalling(id),
      onInstallClick: (agent) => {
        void handleInstall(agent);
      },
      onSettingsClick: setCustomModalAgentId,
    }),
    [handleInstall]
  );

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {sortedAgents.map((agent) => renderAgentRow(agent, rowActions))}
      </div>

      <CustomCommandModal
        isOpen={customModalAgentId !== null}
        onClose={() => setCustomModalAgentId(null)}
        providerId={customModalAgentId ?? ''}
      />
    </div>
  );
});
