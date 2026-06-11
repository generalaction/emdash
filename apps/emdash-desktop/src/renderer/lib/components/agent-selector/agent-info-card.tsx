import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useCallback } from 'react';
import { InstallSection } from '@renderer/features/settings/agents-page/InstallSection';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { rpc } from '@renderer/lib/ipc';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { log } from '@renderer/utils/logger';
import type { AgentPayload } from '@shared/core/agents/agent-payload';
import {
  getDescriptionForProvider,
  getDocUrlForProvider,
  getProvider,
  type AgentProviderId,
} from '@shared/core/agents/agent-provider-registry';
import type { DependencyId, HostDependencySelection } from '@shared/core/dependencies';

type Props = {
  id: AgentProviderId;
  connectionId?: string;
};

export const AgentInfoCard: React.FC<Props> = observer(({ id, connectionId }) => {
  const provider = getProvider(id);
  const description = getDescriptionForProvider(id);
  const docUrl = getDocUrlForProvider(id);
  const title = provider?.name ?? id;

  // Fetch the full agent payload (platform-specific install options) from the main process.
  const { data: payload } = useQuery({
    queryKey: ['agentPayload', id, connectionId ?? 'local'],
    queryFn: () => rpc.agents.get(id, connectionId) as Promise<AgentPayload | null>,
    staleTime: 60_000,
  });

  // Reactively read live status/updateAvailable from the appropriate dependency resource.
  const statuses = connectionId
    ? appState.dependencies.getRemote(connectionId).data
    : appState.dependencies.local.data;
  const depState = statuses?.[id];
  const isInstalled = (depState?.status ?? payload?.status) === 'available';
  const updateAvailable = depState?.updateAvailable ?? payload?.updateAvailable ?? false;

  const handleUseInstallation = useCallback(
    async (selection: HostDependencySelection) => {
      try {
        await appState.dependencies.setUsedInstallation(
          id as DependencyId,
          connectionId,
          selection
        );
      } catch (err) {
        log.error('AgentInfoCard: failed to save install source', err);
      }
    },
    [id, connectionId]
  );

  const pathValue = payload?.installations.find((i) => i.id === 'path')?.source as
    | { kind: 'path'; path: string }
    | undefined;
  const cliValue = payload?.installations.find((i) => i.id === 'cli')?.source as
    | { kind: 'cli'; command: string }
    | undefined;

  return (
    <div className="w-96 bg-background-quaternary p-3">
      <div className="mb-2 flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-2 text-sm">
          <AgentIcon id={id} size={16} className="rounded-sm" />
          <span className="text-sm text-foreground">{title}</span>
        </div>
        {docUrl && (
          <Button
            variant="ghost"
            size="xs"
            className="p-0 text-foreground-muted"
            onClick={() => window.open(docUrl, '_blank', 'noreferrer')}
          >
            View Website
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>

      {description ? (
        <p className="mb-2 text-xs leading-relaxed text-foreground-muted">{description}</p>
      ) : null}

      {payload && (
        <InstallSection
          agentId={id}
          connectionId={connectionId}
          installOptions={payload.installOptions}
          installDocs={payload.installDocs}
          isInstalled={isInstalled}
          updateAvailable={updateAvailable}
          usedInstallationId={payload.usedId || null}
          pathValue={pathValue?.path}
          cliValue={cliValue?.command}
          onUseInstallation={handleUseInstallation}
          hideOverrideOptions={!isInstalled || !!connectionId}
        />
      )}
    </div>
  );
});
