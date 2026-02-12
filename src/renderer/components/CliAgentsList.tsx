import React, { useMemo, useState } from 'react';
import { Settings2, Sparkles } from 'lucide-react';
import IntegrationRow from './IntegrationRow';
import CustomCommandModal from './CustomCommandModal';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
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

const ICON_BUTTON =
  'rounded-md p-1.5 text-muted-foreground transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

const renderAgentRow = (agent: CliAgentStatus, onSettingsClick: (id: string) => void) => {
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
      rightExtra={
        isDetected ? (
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
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

const CliAgentsList: React.FC<CliAgentsListProps> = (props) => {
  const [customModalAgentId, setCustomModalAgentId] = useState<string | null>(null);

  const sortedAgents = useMemo(() => {
    const source = props.agents.length ? props.agents : BASE_CLI_AGENTS;
    return [...source].sort((a, b) => {
      if (a.status === 'connected' && b.status !== 'connected') return -1;
      if (b.status === 'connected' && a.status !== 'connected') return 1;
      return a.name.localeCompare(b.name);
    });
  }, [props.agents]);

  return (
    <div className="space-y-3">
      {props.error ? (
        <div className="rounded-md border border-red-200/70 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:border-red-500/40 dark:text-red-400">
          {props.error}
        </div>
      ) : null}

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
};

export default CliAgentsList;
