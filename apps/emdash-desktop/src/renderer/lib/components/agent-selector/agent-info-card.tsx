import { ExternalLink } from 'lucide-react';
import React from 'react';
import { InstallSection } from '@renderer/features/settings/agents-page/InstallSection';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { useAgentInstallationStatus } from '@renderer/lib/stores/use-agent-installation-statuses';
import { useAgent } from '@renderer/lib/stores/use-agents';
import { Button } from '@renderer/lib/ui/button';
import {
  getDescriptionForProvider,
  getDocUrlForProvider,
  getProvider,
  type AgentProviderId,
} from '@shared/core/agents/agent-provider-registry';

type Props = {
  id: AgentProviderId;
  connectionId?: string;
};

export const AgentInfoCard: React.FC<Props> = ({ id, connectionId }) => {
  const provider = getProvider(id);
  const description = getDescriptionForProvider(id);
  const docUrl = getDocUrlForProvider(id);
  const title = provider?.name ?? id;

  const { data: payload } = useAgent(id, connectionId);
  const { data: statusData } = useAgentInstallationStatus(id, connectionId);

  const isInstalled = (statusData?.status ?? payload?.status) === 'available';

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
          agentPayload={payload}
          installOptions={payload.installOptions}
          hideOverrideOptions={!isInstalled || !!connectionId}
        />
      )}
    </div>
  );
};
