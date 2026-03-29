import { Check, Loader2, Plus } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import githubSvg from '@/assets/images/Github.svg?raw';
import jiraSvg from '@/assets/images/Jira.svg?raw';
import linearSvg from '@/assets/images/Linear.svg?raw';
import { useGithubContext } from '../../core/github-context-provider';
import { useIntegrationsContext } from '../../core/integrations/integrations-provider';
import JiraSetupForm from '../../core/integrations/JiraSetupForm';
import { useTheme } from '../../hooks/useTheme';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogContentArea,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Separator } from '../ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';

/** Light mode: original SVG colors. Dark / dark-black: primary colour. */
const SvgLogo = ({ raw }: { raw: string }) => {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark' || effectiveTheme === 'dark-black';

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
    connectLinear,
    disconnectLinear,
    isJiraConnected,
    isJiraLoading,
    connectJira,
    disconnectJira,
  } = useIntegrationsContext();

  // Modal state: which integration setup is open
  const [integrationSetupModal, setIntegrationSetupModal] = useState<null | 'linear' | 'jira'>(
    null
  );

  // Linear form state
  const [linearInput, setLinearInput] = useState('');
  const [linearError, setLinearError] = useState<string | null>(null);

  // Jira form state
  const [jiraSite, setJiraSite] = useState('');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraToken, setJiraToken] = useState('');
  const [jiraError, setJiraError] = useState<string | null>(null);

  const closeModal = useCallback(() => {
    setIntegrationSetupModal(null);
    setLinearInput('');
    setLinearError(null);
    setJiraSite('');
    setJiraEmail('');
    setJiraToken('');
    setJiraError(null);
  }, []);

  const handleLinearConnect = useCallback(async () => {
    const token = linearInput.trim();
    if (!token) return;
    setLinearError(null);
    try {
      await connectLinear(token);
      closeModal();
    } catch (error) {
      setLinearError((error as Error).message || 'Could not connect. Try again.');
    }
  }, [linearInput, connectLinear, closeModal]);

  const handleJiraSubmit = useCallback(async () => {
    setJiraError(null);
    try {
      await connectJira({
        siteUrl: jiraSite.trim(),
        email: jiraEmail.trim(),
        token: jiraToken.trim(),
      });
      closeModal();
    } catch (error) {
      setJiraError((error as Error).message || 'Failed to connect.');
    }
  }, [jiraSite, jiraEmail, jiraToken, connectJira, closeModal]);

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
      onConnect: () => setIntegrationSetupModal('linear'),
      onDisconnect: disconnectLinear,
    },
    {
      id: 'jira',
      name: 'Jira',
      description: 'Work on Jira tickets',
      logoSvg: jiraSvg,
      connected: !!isJiraConnected,
      loading: isJiraLoading,
      onConnect: () => setIntegrationSetupModal('jira'),
      onDisconnect: disconnectJira,
    },
  ];

  return (
    <>
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

      {/* Integration setup modal */}
      <Dialog open={integrationSetupModal !== null} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="max-w-md">
          {integrationSetupModal === 'linear' && (
            <>
              <DialogHeader>
                <DialogTitle>Connect Linear</DialogTitle>
                <DialogDescription className="text-xs">
                  Enter your Linear API key to connect your workspace.
                </DialogDescription>
              </DialogHeader>
              <DialogContentArea>
                <Input
                  type="password"
                  value={linearInput}
                  onChange={(e) => setLinearInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && linearInput.trim() && !isLinearLoading) {
                      void handleLinearConnect();
                    }
                  }}
                  placeholder="Enter Linear API key"
                  className="h-9"
                  disabled={isLinearLoading}
                  autoFocus
                />
                {linearError && (
                  <p className="text-xs text-destructive" role="alert">
                    {linearError}
                  </p>
                )}
              </DialogContentArea>
              <DialogFooter>
                <Button type="button" variant="outline" size="sm" onClick={closeModal}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleLinearConnect()}
                  disabled={!linearInput.trim() || isLinearLoading}
                >
                  {isLinearLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Connect
                </Button>
              </DialogFooter>
            </>
          )}

          {integrationSetupModal === 'jira' && (
            <>
              <DialogHeader>
                <DialogTitle>Connect Jira</DialogTitle>
                <DialogDescription className="text-xs">
                  Enter your Jira site URL, email, and API token to connect.
                </DialogDescription>
              </DialogHeader>
              <DialogContentArea>
                <JiraSetupForm
                  site={jiraSite}
                  email={jiraEmail}
                  token={jiraToken}
                  onChange={(u) => {
                    if (typeof u.site === 'string') setJiraSite(u.site);
                    if (typeof u.email === 'string') setJiraEmail(u.email);
                    if (typeof u.token === 'string') setJiraToken(u.token);
                  }}
                  onClose={closeModal}
                  canSubmit={!!(jiraSite.trim() && jiraEmail.trim() && jiraToken.trim())}
                  error={jiraError}
                  onSubmit={handleJiraSubmit}
                  hideHeader
                  hideFooter
                />
              </DialogContentArea>
              <DialogFooter>
                <Button type="button" variant="outline" size="sm" onClick={closeModal}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleJiraSubmit()}
                  disabled={
                    !(jiraSite.trim() && jiraEmail.trim() && jiraToken.trim()) || isJiraLoading
                  }
                >
                  {isJiraLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Connect
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default IntegrationsCard;
