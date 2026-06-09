import { Circle, CircleAlert, CircleCheck, Loader2, Plus, Trash2, X } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { useIntegrationsContext } from '@renderer/features/integrations/integrations-provider';
import { ISSUE_PROVIDER_META } from '@renderer/features/integrations/issue-provider-meta';
import { PROVIDER_ICON_COMPONENTS } from '@renderer/features/integrations/provider-icons';
import {
  GitHubCredentialSourceBadge,
  GitHubDefaultAccountBadge,
} from '@renderer/features/projects/components/github-account-select';
import { sortGitHubAccountsByDefault } from '@renderer/features/projects/components/github-account-select-model';
import { useToast } from '@renderer/lib/hooks/use-toast';
import {
  useGitHubAccounts,
  useRemoveGitHubAccount,
  useSetDefaultGitHubAccount,
} from '@renderer/lib/hooks/useGithubAccounts';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { MicroLabel } from '@renderer/lib/ui/label';
import { Sheet, SheetContent } from '@renderer/lib/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import type { GitHubAccountSummary } from '@shared/github';
import type { IssueProviderType } from '@shared/issue-providers';

type SetupIntegrationType = Exclude<IssueProviderType, 'github'>;

type IntegrationItem = {
  id: IssueProviderType;
  name: string;
  description: string;
  cardDescription: string;
  features: string[];
  connected: boolean;
  connectionKnown: boolean;
  loading: boolean;
  connectionError?: string;
  displayName?: string;
  displayDetail?: string;
  onConnect: () => void;
  onDisconnect?: () => void | Promise<void>;
};

const INTEGRATION_PROVIDER_ORDER: IssueProviderType[] = [
  'github',
  'linear',
  'jira',
  'gitlab',
  'forgejo',
  'trello',
  'asana',
  'monday',
  'featurebase',
  'plain',
];

const INTEGRATION_CARD_DESCRIPTIONS: Record<IssueProviderType, string> = {
  github: 'Work on GitHub issues and PRs',
  linear: 'Work on Linear tickets',
  jira: 'Work on Jira tickets',
  gitlab: 'Work on GitLab issues',
  forgejo: 'Work on Forgejo issues',
  trello: 'Work on Trello cards',
  asana: 'Work on Asana tasks',
  monday: 'Work on Monday.com items',
  featurebase: 'Work on Featurebase posts',
  plain: 'Work on Plain threads',
};

const PROVIDER_FEATURES: Record<IssueProviderType, string[]> = {
  github: ['issues', 'pullRequests', 'repositories'],
  linear: ['issues'],
  jira: ['issues'],
  gitlab: ['issues'],
  forgejo: ['issues'],
  featurebase: ['issues'],
  plain: ['issues'],
  asana: ['issues'],
  monday: ['issues'],
  trello: ['issues'],
};

const FEATURE_LABELS: Record<string, string> = {
  issues: 'Issues',
  pullRequests: 'Pull Requests',
  repositories: 'Repositories',
};

const PROVIDER_DISCONNECT_CREDENTIALS: Partial<Record<SetupIntegrationType, string>> = {
  linear: 'API key',
  jira: 'credentials',
  gitlab: 'credentials',
  plain: 'API key',
  forgejo: 'credentials',
  asana: 'access token',
  monday: 'API token',
  trello: 'credentials',
};

const PROVIDER_DISCONNECT_METHOD: Record<
  SetupIntegrationType,
  keyof Pick<
    ReturnType<typeof useIntegrationsContext>,
    | 'disconnectLinear'
    | 'disconnectJira'
    | 'disconnectGitlab'
    | 'disconnectPlain'
    | 'disconnectForgejo'
    | 'disconnectFeaturebase'
    | 'disconnectAsana'
    | 'disconnectMonday'
    | 'disconnectTrello'
  >
> = {
  linear: 'disconnectLinear',
  jira: 'disconnectJira',
  gitlab: 'disconnectGitlab',
  plain: 'disconnectPlain',
  forgejo: 'disconnectForgejo',
  featurebase: 'disconnectFeaturebase',
  asana: 'disconnectAsana',
  monday: 'disconnectMonday',
  trello: 'disconnectTrello',
};

const PROVIDER_LOADING_FIELD: Record<
  SetupIntegrationType,
  keyof Pick<
    ReturnType<typeof useIntegrationsContext>,
    | 'isLinearLoading'
    | 'isJiraLoading'
    | 'isGitlabLoading'
    | 'isPlainLoading'
    | 'isForgejoLoading'
    | 'isFeaturebaseLoading'
    | 'isAsanaLoading'
    | 'isMondayLoading'
    | 'isTrelloLoading'
  >
> = {
  linear: 'isLinearLoading',
  jira: 'isJiraLoading',
  gitlab: 'isGitlabLoading',
  plain: 'isPlainLoading',
  forgejo: 'isForgejoLoading',
  featurebase: 'isFeaturebaseLoading',
  asana: 'isAsanaLoading',
  monday: 'isMondayLoading',
  trello: 'isTrelloLoading',
};

const IntegrationsCard: React.FC = () => {
  const integrationsContext = useIntegrationsContext();
  const {
    connectionStatus,
    isCheckingConnections,
    configuredConnections,
    isCheckingConfiguredConnections,
  } = integrationsContext;
  const { data: githubAccounts = [], isLoading: isLoadingGithubAccounts } = useGitHubAccounts();
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

  const integrations: IntegrationItem[] = INTEGRATION_PROVIDER_ORDER.map((provider) => {
    const meta = ISSUE_PROVIDER_META[provider];
    const status = connectionStatus[provider];

    if (provider === 'github') {
      const connected = sortedGithubAccounts.length > 0;

      return {
        id: provider,
        name: meta.displayName,
        description: INTEGRATION_CARD_DESCRIPTIONS[provider],
        cardDescription: INTEGRATION_CARD_DESCRIPTIONS[provider],
        features: PROVIDER_FEATURES[provider],
        connected,
        connectionKnown: !isLoadingGithubAccounts,
        loading: isLoadingGithubAccounts || isCheckingConnections,
        connectionError: connected ? status.error : undefined,
        displayName: sortedGithubAccounts[0]?.login ?? status.displayName,
        displayDetail: status.displayDetail,
        onConnect: () => showConnectGitHub({}),
      };
    }

    const connected = configuredConnections[provider] ?? false;

    return {
      connectionKnown: provider in configuredConnections || !isCheckingConfiguredConnections,
      id: provider,
      name: meta.displayName,
      description: INTEGRATION_CARD_DESCRIPTIONS[provider],
      cardDescription: INTEGRATION_CARD_DESCRIPTIONS[provider],
      features: PROVIDER_FEATURES[provider],
      connected,
      loading: !!integrationsContext[PROVIDER_LOADING_FIELD[provider]],
      connectionError: connected ? status.error : undefined,
      displayName: status.displayName,
      displayDetail: status.displayDetail,
      onConnect: () => showIntegrationSetup({ integration: provider }),
      onDisconnect: () =>
        confirmDisconnect({
          name: meta.displayName,
          credential: PROVIDER_DISCONNECT_CREDENTIALS[provider],
          onDisconnect: integrationsContext[PROVIDER_DISCONNECT_METHOD[provider]],
        }),
    };
  });

  const connectedIntegrations = integrations.filter((integration) => integration.connected);
  const availableIntegrations = integrations.filter(
    (integration) => integration.connectionKnown && !integration.connected
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

function IntegrationGridCard({
  integration,
  selected,
  onSelect,
}: {
  integration: IntegrationItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = PROVIDER_ICON_COMPONENTS[integration.id];

  return (
    <div className="flex h-full min-h-0">
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'group relative flex w-full items-center gap-4 rounded-lg border border-border bg-background-1 p-4 text-left text-card-foreground transition-all hover:bg-background-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          selected && 'bg-background-2'
        )}
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-background-2 transition-colors group-hover:bg-background-3">
          <Icon size={32} />
        </span>
        <span
          className={cn(
            'flex min-w-0 flex-1 flex-col gap-0.5',
            integration.connectionError && 'pr-6'
          )}
        >
          <span className="text-sm font-medium text-foreground">{integration.name}</span>
          <span className="truncate text-sm text-foreground-muted">
            {integration.cardDescription}
          </span>
        </span>
        {integration.connectionError && (
          <ConnectionIssueIndicator
            providerName={integration.name}
            error={integration.connectionError}
          />
        )}
      </button>
    </div>
  );
}

function ConnectionIssueIndicator({
  providerName,
  error,
}: {
  providerName: string;
  error: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="text-destructive absolute top-3 right-3 inline-flex h-5 w-5 items-center justify-center rounded-full"
            aria-label={`${providerName} connection issue`}
          >
            <CircleAlert className="h-4 w-4" />
          </span>
        }
      />
      <TooltipContent side="top">{error || 'Connection issue'}</TooltipContent>
    </Tooltip>
  );
}

function IntegrationDetailSidebar({
  integration,
  githubAccounts,
  onClose,
}: {
  integration: IntegrationItem;
  githubAccounts: GitHubAccountSummary[];
  onClose: () => void;
}) {
  const Icon = PROVIDER_ICON_COMPONENTS[integration.id];
  const accountLabel = integration.id === 'github' ? 'Accounts' : 'Account';
  return (
    <div className="relative flex h-full flex-col">
      <Button
        variant="ghost"
        size="sm"
        onClick={onClose}
        className="absolute top-4 right-4 p-0"
        aria-label="Close"
      >
        <X className="size-4" />
      </Button>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-4">
        <div className="space-y-3">
          <div>
            <MicroLabel>Integration</MicroLabel>
            <div className="mt-3 flex items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center">
                <Icon size={36} />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h2 className="text-sm font-medium text-foreground">{integration.name}</h2>
                  <div className="flex flex-wrap items-center gap-1">
                    {integration.features.map((feature) => (
                      <CapabilityBadge key={feature}>
                        {FEATURE_LABELS[feature] ?? feature}
                      </CapabilityBadge>
                    ))}
                  </div>
                </div>
                <p className="text-sm leading-5 text-foreground-muted">{integration.description}</p>
              </div>
            </div>
          </div>

          <div>
            <MicroLabel>{accountLabel}</MicroLabel>
            <div className="mt-3">
              {integration.id === 'github' ? (
                <GitHubAccountsList accounts={githubAccounts} integration={integration} />
              ) : integration.connected ? (
                <SingleIntegrationAccount integration={integration} />
              ) : (
                <AddAccountCard integration={integration} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CapabilityBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-5 items-center rounded bg-background-2 px-1.5 text-xs font-medium text-foreground-muted">
      {children}
    </span>
  );
}

function GitHubAccountsList({
  accounts,
  integration,
}: {
  accounts: GitHubAccountSummary[];
  integration: IntegrationItem;
}) {
  const setDefaultMutation = useSetDefaultGitHubAccount();
  const removeMutation = useRemoveGitHubAccount();
  const showConfirmRemove = useShowModal('confirmActionModal');
  const { toast } = useToast();

  const setDefaultAccount = async (account: GitHubAccountSummary) => {
    const result = await setDefaultMutation.mutateAsync(account.accountId);
    if (!result.success) {
      toast({
        title: 'Unable to update default account',
        description: result.error,
        variant: 'destructive',
      });
      return;
    }
    toast({
      title: 'Default GitHub account updated',
      description: `New projects will use @${account.login} by default.`,
    });
  };

  const removeAccount = async (account: GitHubAccountSummary) => {
    const result = await removeMutation.mutateAsync(account.accountId);
    if (!result.success) {
      toast({
        title: 'Unable to remove GitHub account',
        description: result.error,
        variant: 'destructive',
      });
      return;
    }
    toast({
      title: 'GitHub account removed',
      description: `Removed @${account.login}.`,
    });
  };

  const confirmRemove = async (account: GitHubAccountSummary) => {
    let description = 'This removes the saved GitHub token from Emdash.';
    try {
      const count = await rpc.projects.countProjectsUsingGithubAccount(account.accountId);
      if (count > 0) {
        const projectLabel = count === 1 ? '1 project' : `${count} projects`;
        description = `This account is used by ${projectLabel}. Removing it will disable GitHub features for those projects until another GitHub account is assigned.`;
      }
    } catch {}

    showConfirmRemove({
      title: `Remove @${account.login}?`,
      description,
      confirmLabel: 'Remove',
      onSuccess: () => void removeAccount(account),
    });
  };

  return (
    <div className="space-y-2">
      {accounts.map((account) => (
        <div
          key={account.accountId}
          className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/60 p-3"
        >
          {account.avatarUrl ? (
            <img
              src={account.avatarUrl}
              alt={account.login}
              className="h-9 w-9 shrink-0 rounded-full border border-border/60"
            />
          ) : (
            <AccountIcon provider="github" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <p className="truncate text-sm font-medium text-foreground">@{account.login}</p>
              {account.isDefault && <DefaultGitHubAccountBadge login={account.login} />}
              <GitHubCredentialSourceBadge source={account.credentialSource} />
            </div>
            <p className="truncate text-xs text-foreground-muted">{account.host}</p>
          </div>
          <Tooltip>
            <TooltipTrigger>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={setDefaultMutation.isPending}
                onClick={account.isDefault ? undefined : () => void setDefaultAccount(account)}
                aria-label={
                  account.isDefault
                    ? `@${account.login} is the default GitHub account`
                    : `Set @${account.login} as default GitHub account`
                }
              >
                {account.isDefault ? (
                  <CircleCheck className="text-foreground" />
                ) : (
                  <Circle className="text-foreground-muted" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {account.isDefault ? 'Default account' : 'Set as default'}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={removeMutation.isPending}
                onClick={() => void confirmRemove(account)}
                aria-label={`Remove @${account.login}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Remove account</TooltipContent>
          </Tooltip>
        </div>
      ))}
      <AddAccountCard
        integration={integration}
        label="Add GitHub account"
        detail={
          accounts.length === 0
            ? 'No GitHub accounts are connected.'
            : 'Connect a GitHub or GitHub Enterprise account.'
        }
      />
    </div>
  );
}

function SingleIntegrationAccount({ integration }: { integration: IntegrationItem }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/60 p-3">
      <AccountIcon provider={integration.id} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {integration.displayName ?? `${integration.name} account`}
        </p>
        <p className="truncate text-xs text-foreground-muted">
          {integration.displayDetail ?? 'Connected'}
        </p>
      </div>
      {integration.onDisconnect && (
        <Tooltip>
          <TooltipTrigger>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={integration.onDisconnect}
              aria-label={`Disconnect ${integration.name}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Disconnect</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function AddAccountCard({
  integration,
  label,
  detail,
}: {
  integration: IntegrationItem;
  label?: string;
  detail?: string;
}) {
  return (
    <button
      type="button"
      onClick={integration.onConnect}
      disabled={integration.loading}
      className="focus-visible:ring-ring flex w-full items-center gap-3 rounded-lg border border-dashed border-border/70 p-3 text-left transition-colors hover:border-border hover:bg-background-1 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      aria-label={`Add ${integration.name} account`}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center">
        {integration.loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-foreground-muted" />
        ) : (
          <Plus className="h-4 w-4 text-foreground-muted" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {label ?? `Add ${integration.name} account`}
        </p>
        <p className="truncate text-xs text-foreground-muted">
          {detail ?? `Connect ${integration.name} to start using this integration.`}
        </p>
      </div>
    </button>
  );
}

function AccountIcon({ provider }: { provider: IssueProviderType }) {
  const Icon = PROVIDER_ICON_COMPONENTS[provider];

  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center">
      <Icon size={22} />
    </div>
  );
}

function DefaultGitHubAccountBadge({ login }: { login: string }) {
  return (
    <Tooltip>
      <TooltipTrigger className="inline-flex h-4.5 items-center leading-none">
        <GitHubDefaultAccountBadge />
      </TooltipTrigger>
      <TooltipContent side="top">New projects will use @{login} by default.</TooltipContent>
    </Tooltip>
  );
}

export default IntegrationsCard;
