import React, { useMemo, useState } from 'react';
import { isIssueIntegration } from '@core/features/integrations/browser/integration-display';
import { useIntegrationsContext } from '@core/features/integrations/browser/integrations-provider';
import { sortGitHubAccountsByDefault } from '@core/features/projects/browser/components/github-account-select-model';
import type { AgentIconAsset } from '@core/primitives/agents/api';
import type { ConnectionStatus, IssueProviderType } from '@core/primitives/issue-providers/api';
import { useGitHubAccounts } from '@renderer/lib/hooks/useGithubAccounts';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Sheet, SheetContent } from '@renderer/lib/ui/sheet';
import { TooltipProvider } from '@renderer/lib/ui/tooltip';
import { IntegrationDetailSidebar } from './IntegrationDetailSidebar';
import { IntegrationGridCard } from './IntegrationGridCard';

export type IntegrationItem = {
  id: IssueProviderType;
  name: string;
  description: string;
  icon: AgentIconAsset;
  features: string[];
  isConfigured: boolean;
  isConfigurationKnown: boolean;
  isMutating: boolean;
  connectionError?: string;
  displayName?: string;
  displayDetail?: string;
  onConnect: () => void;
  onDisconnect?: () => void | Promise<void>;
};

const IntegrationsCard: React.FC = () => {
  const {
    connectionStatus,
    configuredConnections,
    isCheckingConfiguredConnections,
    disconnectIntegration,
    integrations: integrationMetadata,
    isIntegrationMutating,
  } = useIntegrationsContext();
  const { data: githubAccounts = [] } = useGitHubAccounts();
  const sortedGithubAccounts = useMemo(
    () => sortGitHubAccountsByDefault(githubAccounts),
    [githubAccounts]
  );
  const [selectedProvider, setSelectedProvider] = useState<IssueProviderType | null>(null);
  const showIntegrationSetup = useShowModal('integrationSetupModal');
  const showConnectGitHub = useShowModal('githubConnectModal');
  const showConfirm = useShowModal('confirmActionModal');

  const confirmDisconnect = ({
    name,
    credential,
    onDisconnect,
  }: {
    name: string;
    credential?: string;
    onDisconnect: () => void | Promise<void>;
  }) => {
    showConfirm({
      title: `Disconnect ${name}`,
      description: credential
        ? `This will delete the saved ${name} ${credential} and disconnect ${name}.`
        : `This will disconnect ${name}.`,
      confirmLabel: 'Disconnect',
      onSuccess: () => {
        void onDisconnect();
      },
    });
  };

  const integrations: IntegrationItem[] = integrationMetadata
    .filter(isIssueIntegration)
    .map((integration) => {
      const provider = integration.id;
      const status: ConnectionStatus = connectionStatus[provider] ?? {
        connected: false,
        capabilities: integration.capabilities,
      };
      const isConfigured = configuredConnections[provider] ?? false;
      const isConfigurationKnown =
        provider in configuredConnections || !isCheckingConfiguredConnections;

      if (provider === 'github') {
        return {
          id: provider,
          name: integration.name,
          description: integration.description,
          icon: integration.icon,
          features: integration.features,
          isConfigured,
          isConfigurationKnown,
          isMutating: false,
          connectionError: isConfigured ? status.error : undefined,
          displayName: sortedGithubAccounts[0]?.login ?? status.displayName,
          displayDetail: status.displayDetail,
          onConnect: () => showConnectGitHub({}),
        };
      }

      return {
        id: provider,
        name: integration.name,
        description: integration.description,
        icon: integration.icon,
        features: integration.features,
        isConfigured,
        isConfigurationKnown,
        isMutating: isIntegrationMutating(provider),
        connectionError: isConfigured ? status.error : undefined,
        displayName: status.displayName,
        displayDetail: status.displayDetail,
        onConnect: () => showIntegrationSetup({ integration: provider }),
        onDisconnect: () =>
          confirmDisconnect({
            name: integration.name,
            credential: integration.disconnectCredentialLabel,
            onDisconnect: () => {
              void disconnectIntegration(provider);
            },
          }),
      };
    });

  const connectedIntegrations = integrations.filter((integration) => integration.isConfigured);
  const availableIntegrations = integrations.filter(
    (integration) => integration.isConfigurationKnown && !integration.isConfigured
  );
  const selectedIntegration = selectedProvider
    ? (integrations.find((integration) => integration.id === selectedProvider) ?? null)
    : null;

  function closeSheet() {
    setSelectedProvider(null);
  }

  return (
    <TooltipProvider delay={150}>
      <div className="space-y-8">
        {connectedIntegrations.length > 0 && (
          <IntegrationSection title="Connected">
            {connectedIntegrations.map((integration) => (
              <IntegrationGridCard
                key={integration.id}
                integration={integration}
                selected={integration.id === selectedProvider}
                onSelect={() => setSelectedProvider(integration.id)}
              />
            ))}
          </IntegrationSection>
        )}

        <IntegrationSection title="Available">
          {availableIntegrations.map((integration) => (
            <IntegrationGridCard
              key={integration.id}
              integration={integration}
              selected={integration.id === selectedProvider}
              onSelect={() => setSelectedProvider(integration.id)}
            />
          ))}
        </IntegrationSection>
      </div>

      <Sheet open={selectedIntegration !== null} onOpenChange={(open) => !open && closeSheet()}>
        <SheetContent showCloseButton={false} className="[-webkit-app-region:no-drag]">
          {selectedIntegration && (
            <IntegrationDetailSidebar
              integration={selectedIntegration}
              githubAccounts={sortedGithubAccounts}
              onClose={closeSheet}
            />
          )}
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  );
};

function IntegrationSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-normal text-foreground">{title}</h3>
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}
      >
        {children}
      </div>
    </section>
  );
}

export default IntegrationsCard;
