import { Settings2, Sparkles } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useMemo, useState } from 'react';
import CustomCommandModal from '@renderer/features/settings/components/CustomCommandModal';
import IntegrationRow from '@renderer/features/settings/components/IntegrationRow';
import { getAgentInstallErrorMessage } from '@renderer/lib/components/agent-selector/agent-install';
import { AgentInstallButton } from '@renderer/lib/components/agent-selector/agent-install-button';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { resolveAgentIcon } from '@renderer/lib/providers/meta';
import { appState } from '@renderer/lib/stores/app-state';
import { Label } from '@renderer/lib/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { log } from '@renderer/utils/logger';
import type { AgentPayload } from '@shared/core/agents/agent-payload';
import {
  isValidProviderId,
  type AgentProviderId,
} from '@shared/core/agents/agent-provider-registry';
import { InstalledAgentRow } from './InstalledAgentRow';

const ICON_BUTTON =
  'rounded-md p-1.5 text-muted-foreground transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

// ---------------------------------------------------------------------------
// AgentRow
// ---------------------------------------------------------------------------

type AgentRowProps = {
  agent: AgentPayload;
  isInstalling: boolean;
  onInstallClick: () => void;
  onSettingsClick: () => void;
};

const AgentRow: React.FC<AgentRowProps> = ({
  agent,
  isInstalling,
  onInstallClick,
  onSettingsClick,
}) => {
  const logo = resolveAgentIcon(agent.iconName);
  const logoDark = resolveAgentIcon(agent.iconDarkName);
  const providerId = isValidProviderId(agent.id) ? agent.id : null;
  const canInstall = Object.keys(agent.capabilities.install.installCommands).length > 0;

  const handleNameClick = agent.websiteUrl
    ? async () => {
        try {
          await rpc.app.openExternal(agent.websiteUrl!);
        } catch (openError) {
          log.error(`Failed to open ${agent.name} docs:`, openError);
        }
      }
    : undefined;

  const isDetected = agent.status === 'available';
  const indicatorClass = isDetected ? 'bg-foreground-success' : 'bg-foreground-passive/50';
  const statusLabel = isDetected ? 'Detected' : 'Not detected';

  return (
    <div className="flex w-full items-center justify-between rounded-lg border">
      <span>{agent.name}</span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// SectionLabel
// ---------------------------------------------------------------------------

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="pt pb-1">
    <Label>{children}</Label>
  </div>
);

export type AgentFilter = 'all' | 'installed' | 'uninstalled';

type CliAgentsListProps = {
  searchQuery?: string;
  filter?: AgentFilter;
};

export const CliAgentsList: React.FC<CliAgentsListProps> = observer(
  ({ searchQuery = '', filter = 'all' }) => {
    const [customModalAgentId, setCustomModalAgentId] = useState<string | null>(null);
    const { toast } = useToast();
    const agentPayloads = appState.dependencies.agents.data;
    const normalizedQuery = searchQuery.toLowerCase();

    const installed = useMemo(
      () =>
        (agentPayloads ?? [])
          .filter((a) => a.status === 'available')
          .filter((a) => !normalizedQuery || a.name.toLowerCase().includes(normalizedQuery))
          .sort((a, b) => a.name.localeCompare(b.name)),
      [agentPayloads, normalizedQuery]
    );

    const supported = useMemo(
      () =>
        (agentPayloads ?? [])
          .filter((a) => a.status !== 'available')
          .filter((a) => !normalizedQuery || a.name.toLowerCase().includes(normalizedQuery))
          .sort((a, b) => a.name.localeCompare(b.name)),
      [agentPayloads, normalizedQuery]
    );

    const showInstalled = filter === 'all' || filter === 'installed';
    const showSupported = filter === 'all' || filter === 'uninstalled';

    const handleInstall = useCallback(
      async (agent: AgentPayload) => {
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

    const isInstalling = useCallback(
      (id: AgentProviderId) => appState.dependencies.isInstalling(id),
      []
    );

    return (
      <div>
        {showInstalled && installed.length > 0 && (
          <>
            {installed.map((agent) => (
              <div key={agent.id} className="w-full  py-0.5">
                <InstalledAgentRow key={agent.id} agent={agent} />
              </div>
            ))}
          </>
        )}

        {showSupported && (
          <>
            <SectionLabel>Supported</SectionLabel>
            {supported.map((agent) => (
              <div
                key={agent.id}
                className="w-full rounded-lg border p-3 py-1 hover:bg-background-1"
              >
                <AgentRow
                  agent={agent}
                  isInstalling={isValidProviderId(agent.id) ? isInstalling(agent.id) : false}
                  onInstallClick={() => void handleInstall(agent)}
                  onSettingsClick={() => setCustomModalAgentId(agent.id)}
                />
              </div>
            ))}
          </>
        )}

        <CustomCommandModal
          isOpen={customModalAgentId !== null}
          onClose={() => setCustomModalAgentId(null)}
          providerId={customModalAgentId ?? ''}
        />
      </div>
    );
  }
);
