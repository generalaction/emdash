import { Check, Loader2, Plus } from 'lucide-react';
import React, { useEffect } from 'react';
import forgejoSvg from '@/assets/images/Forgejo.svg?raw';
import githubSvg from '@/assets/images/Github.svg?raw';
import gitlabSvg from '@/assets/images/GitLab.svg?raw';
import jiraSvg from '@/assets/images/Jira.svg?raw';
import linearSvg from '@/assets/images/Linear.svg?raw';
import plainSvg from '@/assets/images/Plain.svg?raw';
import { Button } from '../../../components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../components/ui/tooltip';
import { useTheme } from '../../../hooks/useTheme';
import { useGithubContext } from '../../../providers/github-context-provider';
import { useIntegrationsContext } from '../../integrations/integrations-provider';
import { useShowModal } from '../../modal/modal-provider';

/** Light mode: original SVG colors. Dark / dark-black: primary colour. */
const SvgLogo = ({ raw }: { raw: string }) => {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'emdark';

  const processed = isDark
    ? raw
        .replace(/\bfill="[^"]*"/g, 'fill="currentColor"')
        .replace(/\bstroke="[^"]*"/g, 'stroke="currentColor"')
    : raw;

  return (
    <span
      className={`inline-flex h-8 w-8 items-center justify-center [&_svg]:h-full [&_svg]:w-full [&_svg]:shrink-0 ${isDark ? 'text-primary' : ''}`}
      dangerouslySetInnerHTML={{ __html: processed }}
    />
  );
};

const IntegrationsCard: React.FC = () => {
  const {
    authenticated,
    isLoading,
    githubLoading,
    handleGithubConnect,
    cancelGithubConnect,
    logout,
    tokenSource,
    checkStatus,
  } = useGithubContext();
  const {
    isLinearConnected,
    isLinearLoading,
    linearWorkspaceName,
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
  } = useIntegrationsContext();

  const showIntegrationSetup = useShowModal('integrationSetupModal');

  const isCliManaged = authenticated && tokenSource === 'cli';

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  const integrations = [
    {
      id: 'github',
      name: 'GitHub',
      description: 'Connect your repositories',
      logoSvg: githubSvg,
      connected: authenticated,
      loading: isLoading || githubLoading,
      onConnect: handleGithubConnect,
      onCancel: cancelGithubConnect,
      onDisconnect: logout,
      disabledTooltip: isCliManaged
        ? 'Run `gh auth logout` in your terminal to disconnect'
        : undefined,
    },
    {
      id: 'linear',
      name: 'Linear',
      description:
        isLinearConnected && linearWorkspaceName ? linearWorkspaceName : 'Work on Linear tickets',
      logoSvg: linearSvg,
      connected: !!isLinearConnected,
      loading: isLinearLoading,
      onConnect: () => showIntegrationSetup({ integration: 'linear' }),
      onDisconnect: disconnectLinear,
    },
    {
      id: 'jira',
      name: 'Jira',
      description: 'Work on Jira tickets',
      logoSvg: jiraSvg,
      connected: !!isJiraConnected,
      loading: isJiraLoading,
      onConnect: () => showIntegrationSetup({ integration: 'jira' }),
      onDisconnect: disconnectJira,
    },
    {
      id: 'gitlab',
      name: 'GitLab',
      description: 'Work on GitLab issues',
      logoSvg: gitlabSvg,
      connected: !!isGitlabConnected,
      loading: isGitlabLoading,
      onConnect: () => showIntegrationSetup({ integration: 'gitlab' }),
      onDisconnect: disconnectGitlab,
    },
    {
      id: 'plain',
      name: 'Plain',
      description: 'Work on Plain threads',
      logoSvg: plainSvg,
      connected: !!isPlainConnected,
      loading: isPlainLoading,
      onConnect: () => showIntegrationSetup({ integration: 'plain' }),
      onDisconnect: disconnectPlain,
    },
    {
      id: 'forgejo',
      name: 'Forgejo',
      description: 'Work on Forgejo issues',
      logoSvg: forgejoSvg,
      connected: !!isForgejoConnected,
      loading: isForgejoLoading,
      onConnect: () => showIntegrationSetup({ integration: 'forgejo' }),
      onDisconnect: disconnectForgejo,
    },
  ];

  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}
    >
      {integrations.map((integration) => (
        <div key={integration.id} className="flex h-full min-h-0">
          <div className="flex w-full items-center gap-4 rounded-lg border border-muted bg-muted/20 p-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted/50">
              <SvgLogo raw={integration.logoSvg} />
            </div>
            <div className="flex flex-1 flex-col gap-0.5">
              <h3 className="text-sm font-medium text-foreground">{integration.name}</h3>
              <p className="text-sm text-muted-foreground">{integration.description}</p>
            </div>
            {integration.connected ? (
              integration.disabledTooltip ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger
                      className="inline-flex h-8 w-8 shrink-0 cursor-default items-center justify-center rounded-md border border-input bg-background opacity-70"
                      aria-label={integration.disabledTooltip}
                    >
                      <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
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
                  className="h-8 w-8 shrink-0"
                  onClick={integration.onDisconnect}
                  aria-label={`Disconnect ${integration.name}`}
                >
                  <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                </Button>
              )
            ) : (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0"
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
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default IntegrationsCard;
