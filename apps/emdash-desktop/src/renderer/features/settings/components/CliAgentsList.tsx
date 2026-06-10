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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { log } from '@renderer/utils/logger';
import { isValidProviderId, type AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import type { AgentPayload } from '@shared/core/agents/agent-payload';

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
    <IntegrationRow
      logoSrc={logo}
      logoSrcDark={logoDark}
      invertInDark={agent.invertInDark}
      icon={
        logo ? undefined : (
          <Sparkles className="text-muted-foreground h-3.5 w-3.5" aria-hidden="true" />
        )
      }
      name={agent.name}
      onNameClick={handleNameClick}
      status={isDetected ? 'connected' : 'missing'}
      statusLabel={statusLabel}
      showStatusPill={false}
      installCommand={agent.settings.defaults.cli ?? null}
      middle={
        <span className="text-muted-foreground flex items-center gap-2 text-sm">
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
                  onClick={onSettingsClick}
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
            canInstall={canInstall}
            isInstalled={isDetected}
            isInstalling={isInstalling}
            tooltipSide="top"
            onInstall={onInstallClick}
          />
        ) : null
      }
    />
  );
};

// ---------------------------------------------------------------------------
// SectionLabel
// ---------------------------------------------------------------------------

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="px-3 pb-1 pt-2">
    <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
      {children}
    </span>
  </div>
);

// ---------------------------------------------------------------------------
// CliAgentsList
// ---------------------------------------------------------------------------

export const CliAgentsList: React.FC = observer(() => {
  const [customModalAgentId, setCustomModalAgentId] = useState<string | null>(null);
  const { toast } = useToast();
  const agentPayloads = appState.dependencies.agents.data;

  const installed = useMemo(
    () =>
      (agentPayloads ?? [])
        .filter((a) => a.status === 'available')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [agentPayloads]
  );

  const supported = useMemo(
    () =>
      (agentPayloads ?? [])
        .filter((a) => a.status !== 'available')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [agentPayloads]
  );

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
    <div className="space-y-1">
      {installed.length > 0 && (
        <>
          <SectionLabel>Installed</SectionLabel>
          {installed.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              isInstalling={isValidProviderId(agent.id) ? isInstalling(agent.id) : false}
              onInstallClick={() => void handleInstall(agent)}
              onSettingsClick={() => setCustomModalAgentId(agent.id)}
            />
          ))}
        </>
      )}

      <SectionLabel>Supported</SectionLabel>
      {supported.map((agent) => (
        <AgentRow
          key={agent.id}
          agent={agent}
          isInstalling={isValidProviderId(agent.id) ? isInstalling(agent.id) : false}
          onInstallClick={() => void handleInstall(agent)}
          onSettingsClick={() => setCustomModalAgentId(agent.id)}
        />
      ))}

      <CustomCommandModal
        isOpen={customModalAgentId !== null}
        onClose={() => setCustomModalAgentId(null)}
        providerId={customModalAgentId ?? ''}
      />
    </div>
  );
});
