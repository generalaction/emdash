import { Check, Loader2, Plus, RefreshCw } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useIntegrationsContext } from '@renderer/features/integrations/integrations-provider';
import { PROVIDER_ICON_COMPONENTS } from '@renderer/features/integrations/provider-icons';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { useGithubContext } from '@renderer/lib/providers/github-context-provider';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import type { IssueProviderType } from '@shared/issue-providers';

function githubAuthSourceLabel(tokenSource: string | null): string {
  switch (tokenSource) {
    case 'cli':
      return 'GitHub CLI';
    case 'emdash_oauth':
      return 'OAuth';
    case 'device_flow':
      return 'device flow';
    case 'secure_storage':
      return 'saved token';
    default:
      return 'GitHub';
  }
}

type IntegrationCardItem = {
  id: IssueProviderType;
  name: string;
  description: string;
  connected: boolean;
  loading: boolean;
  onConnect?: () => void;
  onCancel?: () => void;
  onDisconnect?: () => void | Promise<void>;
  rightAction?: React.ReactNode;
  disabledTooltip?: string;
};

const IntegrationsCard: React.FC = () => {
  const { authenticated, user, isLoading, logout, tokenSource, checkStatus } = useGithubContext();
  const { toast } = useToast();
  const [githubCliRefreshing, setGithubCliRefreshing] = useState(false);
  const {
    connectionStatus,
    isLinearConnected,
    isLinearLoading,
    disconnectLinear,
    isJiraConnected,
    isJiraLoading,
    disconnectJira,
    isGitlabConnected,
    isGitlabLoading,
    disconnectGitlab,
    isPlainConnected,
    isPlainLoading,
    disconnectPlain,
    isForgejoConnected,
    isForgejoLoading,
    disconnectForgejo,
    isFeaturebaseConnected,
    isFeaturebaseLoading,
    disconnectFeaturebase,
    isAsanaConnected,
    isAsanaLoading,
    disconnectAsana,
  } = useIntegrationsContext();

  const showIntegrationSetup = useShowModal('integrationSetupModal');
  const showGithubConnect = useShowModal('githubConnectModal');
  const showConfirmDisconnect = useShowModal('confirmActionModal');

  const isGithubCliConnected = authenticated && tokenSource === 'cli';
  const isGithubStoredTokenConnected = authenticated && tokenSource !== 'cli';
  const githubAuthSource = githubAuthSourceLabel(tokenSource);
  const githubDescription =
    authenticated && user
      ? `@${user.login} via ${githubAuthSource}`
      : 'Connect your GitHub repositories';

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  const confirmDisconnect = ({
    name,
    credential,
    onDisconnect,
  }: {
    name: string;
    credential?: string;
    onDisconnect: () => void | Promise<void>;
  }) => {
    showConfirmDisconnect({
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

  const refreshGithubCliStatus = async () => {
    setGithubCliRefreshing(true);
    try {
      const status = await checkStatus({ refresh: true });
      if (status.authenticated && status.tokenSource === 'cli') {
        toast({
          title: 'GitHub CLI is still authenticated',
          description: status.user
            ? `Run gh auth logout to disconnect @${status.user.login}.`
            : 'Run gh auth logout to disconnect.',
        });
      } else {
        toast({
          title: 'GitHub CLI disconnected',
          description: 'Emdash no longer has access to GitHub',
        });
      }
    } finally {
      setGithubCliRefreshing(false);
    }
  };

  const githubAction = isGithubCliConnected ? (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8 shrink-0"
            disabled={githubCliRefreshing}
            onClick={() => void refreshGithubCliStatus()}
            aria-label="Refresh GitHub CLI status"
          >
            {githubCliRefreshing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="text-xs">Run `gh auth logout`, then refresh</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : isGithubStoredTokenConnected ? (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="size-8 shrink-0"
      onClick={() => confirmDisconnect({ name: 'GitHub', onDisconnect: logout })}
      aria-label="Disconnect GitHub"
    >
      <Check className="size-4 text-foreground-success" />
    </Button>
  ) : undefined;

  const integrations: IntegrationCardItem[] = [
    {
      id: 'github',
      name: 'GitHub',
      description: githubDescription,
      connected: authenticated,
      loading: isLoading,
      onConnect: () => showGithubConnect({}),
      rightAction: githubAction,
    },
    {
      id: 'linear',
      name: 'Linear',
      description:
        isLinearConnected && connectionStatus.linear.displayName
          ? connectionStatus.linear.displayName
          : 'Work on Linear tickets',
      connected: !!isLinearConnected,
      loading: isLinearLoading,
      onConnect: () => showIntegrationSetup({ integration: 'linear' }),
      onDisconnect: () =>
        confirmDisconnect({
          name: 'Linear',
          credential: 'API key',
          onDisconnect: disconnectLinear,
        }),
    },
    {
      id: 'jira',
      name: 'Jira',
      description:
        isJiraConnected && connectionStatus.jira.displayName
          ? connectionStatus.jira.displayName
          : 'Work on Jira tickets',
      connected: !!isJiraConnected,
      loading: isJiraLoading,
      onConnect: () => showIntegrationSetup({ integration: 'jira' }),
      onDisconnect: () =>
        confirmDisconnect({
          name: 'Jira',
          credential: 'credentials',
          onDisconnect: disconnectJira,
        }),
    },
    {
      id: 'gitlab',
      name: 'GitLab',
      description:
        isGitlabConnected && connectionStatus.gitlab.displayName
          ? connectionStatus.gitlab.displayName
          : 'Work on GitLab issues',
      connected: !!isGitlabConnected,
      loading: isGitlabLoading,
      onConnect: () => showIntegrationSetup({ integration: 'gitlab' }),
      onDisconnect: () =>
        confirmDisconnect({
          name: 'GitLab',
          credential: 'credentials',
          onDisconnect: disconnectGitlab,
        }),
    },
    {
      id: 'plain',
      name: 'Plain',
      description: 'Work on Plain threads',
      connected: !!isPlainConnected,
      loading: isPlainLoading,
      onConnect: () => showIntegrationSetup({ integration: 'plain' }),
      onDisconnect: () =>
        confirmDisconnect({
          name: 'Plain',
          credential: 'API key',
          onDisconnect: disconnectPlain,
        }),
    },
    {
      id: 'forgejo',
      name: 'Forgejo',
      description:
        isForgejoConnected && connectionStatus.forgejo.displayName
          ? connectionStatus.forgejo.displayName
          : 'Work on Forgejo issues',
      connected: !!isForgejoConnected,
      loading: isForgejoLoading,
      onConnect: () => showIntegrationSetup({ integration: 'forgejo' }),
      onDisconnect: () =>
        confirmDisconnect({
          name: 'Forgejo',
          credential: 'credentials',
          onDisconnect: disconnectForgejo,
        }),
    },
    {
      id: 'featurebase',
      name: 'Featurebase',
      description: 'Work on Featurebase posts',
      connected: !!isFeaturebaseConnected,
      loading: isFeaturebaseLoading,
      onConnect: () => showIntegrationSetup({ integration: 'featurebase' }),
      onDisconnect: disconnectFeaturebase,
    },
    {
      id: 'asana',
      name: 'Asana',
      description:
        isAsanaConnected && connectionStatus.asana.displayName
          ? connectionStatus.asana.displayName
          : 'Work on Asana tasks',
      connected: !!isAsanaConnected,
      loading: isAsanaLoading,
      onConnect: () => showIntegrationSetup({ integration: 'asana' }),
      onDisconnect: () =>
        confirmDisconnect({
          name: 'Asana',
          credential: 'access token',
          onDisconnect: disconnectAsana,
        }),
    },
  ];

  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}
    >
      {integrations.map((integration) => {
        const Icon = PROVIDER_ICON_COMPONENTS[integration.id];

        return (
          <div key={integration.id} className="flex h-full min-h-0">
            <div className="border-muted bg-muted/20 flex w-full items-center gap-4 rounded-lg border p-4">
              <div className="bg-muted/50 flex size-12 shrink-0 items-center justify-center rounded-lg">
                <Icon size={32} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <h3 className="text-sm font-medium text-foreground">{integration.name}</h3>
                <p className="text-muted-foreground text-sm">{integration.description}</p>
              </div>
              {integration.rightAction ? (
                integration.rightAction
              ) : integration.connected ? (
                integration.disabledTooltip ? (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger
                        className="border-input inline-flex size-8 shrink-0 cursor-default items-center justify-center rounded-md border bg-background opacity-70"
                        aria-label={integration.disabledTooltip}
                      >
                        <Check className="size-4 text-foreground-success" />
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p className="text-xs">{integration.disabledTooltip}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-8 shrink-0"
                    onClick={integration.onDisconnect}
                    aria-label={`Disconnect ${integration.name}`}
                  >
                    <Check className="size-4 text-foreground-success" />
                  </Button>
                )
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-8 shrink-0"
                  onClick={
                    integration.loading && integration.onCancel
                      ? integration.onCancel
                      : integration.onConnect
                  }
                  aria-label={
                    integration.loading
                      ? `Cancel connecting ${integration.name}`
                      : `Connect ${integration.name}`
                  }
                >
                  {integration.loading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default IntegrationsCard;
