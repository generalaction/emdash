import React, { useMemo, useState } from 'react';
import { useIntegrationsContext } from '@renderer/features/integrations/integrations-provider';
import {
  ISSUE_PROVIDER_META,
  ISSUE_PROVIDER_ORDER,
} from '@renderer/features/integrations/issue-provider-meta';
import { sortGitHubAccountsByDefault } from '@renderer/features/projects/components/github-account-select-model';
import { useGitHubAccounts } from '@renderer/lib/hooks/useGithubAccounts';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Sheet, SheetContent } from '@renderer/lib/ui/sheet';
import { TooltipProvider } from '@renderer/lib/ui/tooltip';
import type { IssueProviderType } from '@shared/issue-providers';
import { IntegrationDetailSidebar } from './IntegrationDetailSidebar';
import { IntegrationGridCard } from './IntegrationGridCard';

export type IntegrationItem = {
  id: IssueProviderType;
  name: string;
  description: string;
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
  const { connectionStatus, configuredConnections, isCheckingConfiguredConnections, providers } =
    useIntegrationsContext();
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

  const integrations: IntegrationItem[] = ISSUE_PROVIDER_ORDER.map((provider) => {
    const meta = ISSUE_PROVIDER_META[provider];
    const status = connectionStatus[provider];
    const isConfigured = configuredConnections[provider] ?? false;
    const isConfigurationKnown =
      provider in configuredConnections || !isCheckingConfiguredConnections;

    if (provider === 'github') {
      return {
        id: provider,
        name: meta.displayName,
        description: meta.description,
        features: meta.features,
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
      name: meta.displayName,
      description: meta.description,
      features: meta.features,
      isConfigured,
      isConfigurationKnown,
      isMutating: providers[provider].isMutating,
      connectionError: isConfigured ? status.error : undefined,
      displayName: status.displayName,
      displayDetail: status.displayDetail,
      onConnect: () => showIntegrationSetup({ integration: provider }),
      onDisconnect: () =>
        confirmDisconnect({
          name: meta.displayName,
          credential: meta.disconnectCredentialLabel,
          onDisconnect: providers[provider].disconnect,
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
