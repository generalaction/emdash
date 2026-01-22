import React, { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import IntegrationRow from './IntegrationRow';
import { CliAgentStatus } from '../types/connections';
import { PROVIDERS } from '@shared/providers/registry';
import { agentAssets } from '@/providers/assets';

interface CliAgentsListProps {
  agents: CliAgentStatus[];
  isLoading: boolean;
  error?: string | null;
}

export const BASE_CLI_AGENTS: CliAgentStatus[] = PROVIDERS.filter(
  (provider) => provider.detectable !== false
).map((provider) => ({
  id: provider.id,
  name: provider.name,
  status: 'missing' as const,
  docUrl: provider.docUrl ?? null,
  installCommand: provider.installCommand ?? null,
}));

const renderAgentRow = (agent: CliAgentStatus) => {
  const logo = agentAssets[agent.id as keyof typeof agentAssets]?.logo;

  const handleNameClick =
    agent.docUrl && window?.electronAPI?.openExternal
      ? async () => {
          try {
            await window.electronAPI.openExternal(agent.docUrl!);
          } catch (openError) {
            console.error(`Failed to open ${agent.name} docs:`, openError);
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
    />
  );
};

const CliAgentsList: React.FC<CliAgentsListProps> = ({ agents, error }) => {
  const sortedAgents = useMemo(() => {
    const source = agents.length ? agents : BASE_CLI_AGENTS;
    return [...source].sort((a, b) => {
      if (a.status === 'connected' && b.status !== 'connected') return -1;
      if (b.status === 'connected' && a.status !== 'connected') return 1;
      return a.name.localeCompare(b.name);
    });
  }, [agents]);

  return (
    <div className="space-y-3">
      {error ? (
        <div className="rounded-md border border-red-200/70 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:border-red-500/40 dark:text-red-400">
          {error}
        </div>
      ) : null}

      <div className="space-y-2">{sortedAgents.map((agent) => renderAgentRow(agent))}</div>
    </div>
  );
};

export default CliAgentsList;
