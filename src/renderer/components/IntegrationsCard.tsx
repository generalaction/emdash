import React, { useCallback, useEffect, useState } from 'react';
import { Check, Plus, Loader2 } from 'lucide-react';
import { useGithubAuth } from '../hooks/useGithubAuth';
import { useTheme } from '../hooks/useTheme';
import githubSvg from '../../assets/images/Github.svg?raw';
import jiraSvg from '../../assets/images/Jira.svg?raw';
import linearSvg from '../../assets/images/Linear.svg?raw';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Separator } from './ui/separator';
import JiraSetupForm from './integrations/JiraSetupForm';
import { GithubDeviceFlowModal } from './GithubDeviceFlowModal';

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
  const { installed, authenticated, isLoading, login, logout, checkStatus } = useGithubAuth();

  // Connection states
  const [linearConnected, setLinearConnected] = useState(false);
  const [jiraConnected, setJiraConnected] = useState(false);

  // Modal state: which integration setup is open
  const [integrationSetupModal, setIntegrationSetupModal] = useState<null | 'linear' | 'jira'>(
    null
  );
  const [showGithubModal, setShowGithubModal] = useState(false);

  // Linear state
  const [linearInput, setLinearInput] = useState('');
  const [linearLoading, setLinearLoading] = useState(false);

  // Jira state
  const [jiraSite, setJiraSite] = useState('');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraToken, setJiraToken] = useState('');
  const [jiraLoading, setJiraLoading] = useState(false);

  // Error states
  const [githubError, setGithubError] = useState<string | null>(null);
  const [linearError, setLinearError] = useState<string | null>(null);
  const [jiraError, setJiraError] = useState<string | null>(null);
  // Check connection statuses on mount
  useEffect(() => {
    const checkLinear = async () => {
      try {
        const result = await window.electronAPI.linearCheckConnection?.();
        setLinearConnected(!!result?.connected);
      } catch {
        setLinearConnected(false);
      }
    };

    const checkJira = async () => {
      try {
        const result = await window.electronAPI.jiraCheckConnection?.();
        setJiraConnected(!!result?.connected);
      } catch {
        setJiraConnected(false);
      }
    };

    void checkLinear();
    void checkJira();
  }, []);

  // GitHub handlers
  const handleGithubConnect = useCallback(async () => {
    setGithubError(null);
    try {
      if (!installed) {
        // Auto-install gh CLI
        const installResult = await window.electronAPI.githubInstallCLI();
        if (!installResult.success) {
          setGithubError(
            `Could not auto-install gh CLI: ${installResult.error || 'Unknown error'}`
          );
          return;
        }
        await checkStatus();
      }

      setShowGithubModal(true);
      const result = await login();

      if (!result?.success) {
        setGithubError(result?.error || 'Could not connect.');
        setShowGithubModal(false);
      }
    } catch (error) {
      console.error('GitHub connect failed:', error);
      setGithubError('Could not connect.');
      setShowGithubModal(false);
    }
  }, [checkStatus, login, installed]);

  const handleGithubDisconnect = useCallback(async () => {
    setGithubError(null);
    try {
      await logout();
      await checkStatus();
    } catch (error) {
      console.error('GitHub logout failed:', error);
      setGithubError('Could not disconnect.');
    }
  }, [logout, checkStatus]);

  // Linear handlers
  const handleLinearConnect = useCallback(async () => {
    const token = linearInput.trim();
    if (!token) return;

    setLinearLoading(true);
    setLinearError(null);

    try {
      const result = await window.electronAPI.linearSaveToken?.(token);
      if (result?.success) {
        setLinearConnected(true);
        setLinearInput('');
        setIntegrationSetupModal(null);
      } else {
        setLinearError(result?.error || 'Could not connect. Try again.');
      }
    } catch (error) {
      console.error('Linear connect failed:', error);
      setLinearError('Could not connect. Try again.');
    } finally {
      setLinearLoading(false);
    }
  }, [linearInput]);

  const handleLinearDisconnect = useCallback(async () => {
    try {
      const result = await window.electronAPI.linearClearToken?.();
      if (result?.success) {
        setLinearConnected(false);
        setLinearInput('');
      }
    } catch (error) {
      console.error('Linear disconnect failed:', error);
    }
  }, []);

  // Jira handlers
  const handleJiraSubmit = useCallback(async () => {
    setJiraError(null);
    setJiraLoading(true);
    try {
      const api: any = window.electronAPI;
      const res = await api?.jiraSaveCredentials?.({
        siteUrl: jiraSite.trim(),
        email: jiraEmail.trim(),
        token: jiraToken.trim(),
      });
      if (res?.success) {
        setJiraConnected(true);
        setJiraSite('');
        setJiraEmail('');
        setJiraToken('');
        setIntegrationSetupModal(null);
      } else {
        setJiraError(res?.error || 'Failed to connect.');
      }
    } catch (e: any) {
      setJiraError(e?.message || 'Failed to connect.');
    } finally {
      setJiraLoading(false);
    }
  }, [jiraSite, jiraEmail, jiraToken]);

  const handleJiraDisconnect = useCallback(async () => {
    try {
      const api: any = window.electronAPI;
      const result = await api?.jiraClearCredentials?.();
      if (result?.success) {
        setJiraConnected(false);
        setJiraSite('');
        setJiraEmail('');
        setJiraToken('');
        setIntegrationSetupModal(null);
      }
    } catch (error) {
      console.error('Jira disconnect failed:', error);
    }
  }, []);

  const integrations = [
    {
      id: 'github',
      name: 'GitHub',
      description: 'Connect your repositories',
      logoSvg: githubSvg,
      connected: authenticated,
      loading: isLoading,
      onConnect: handleGithubConnect,
      onDisconnect: handleGithubDisconnect,
    },
    {
      id: 'linear',
      name: 'Linear',
      description: 'Work on Linear tickets',
      logoSvg: linearSvg,
      connected: linearConnected,
      loading: linearLoading,
      onConnect: () => {
        setLinearError(null);
        setIntegrationSetupModal('linear');
      },
      onDisconnect: handleLinearDisconnect,
    },
    {
      id: 'jira',
      name: 'Jira',
      description: 'Work on Jira tickets',
      logoSvg: jiraSvg,
      connected: jiraConnected,
      loading: jiraLoading,
      onConnect: () => {
        setJiraError(null);
        setIntegrationSetupModal('jira');
      },
      onDisconnect: handleJiraDisconnect,
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
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-muted/50">
                <SvgLogo raw={integration.logoSvg} />
              </div>
              <div className="flex flex-1 flex-col gap-0.5">
                <h3 className="text-sm font-medium text-foreground">{integration.name}</h3>
                <p className="text-sm text-muted-foreground">{integration.description}</p>
              </div>
              {integration.connected ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 flex-shrink-0"
                  onClick={integration.onDisconnect}
                  aria-label={`Disconnect ${integration.name}`}
                >
                  <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 flex-shrink-0"
                  onClick={integration.onConnect}
                  disabled={integration.loading}
                  aria-label={`Connect ${integration.name}`}
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

      {/* GitHub error (shown inline since GitHub has no modal) */}
      {githubError && (
        <p className="text-xs text-destructive" role="alert">
          GitHub: {githubError}
        </p>
      )}

      {/* Integration setup modal */}
      <Dialog
        open={integrationSetupModal !== null}
        onOpenChange={(open) => {
          if (!open) {
            setIntegrationSetupModal(null);
            setLinearError(null);
            setJiraError(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          {integrationSetupModal === 'linear' && (
            <>
              <DialogHeader>
                <DialogTitle>Connect Linear</DialogTitle>
                <DialogDescription className="text-xs">
                  Enter your Linear API key to connect your workspace.
                </DialogDescription>
              </DialogHeader>
              <Separator />
              <div className="space-y-4">
                <Input
                  type="password"
                  value={linearInput}
                  onChange={(e) => setLinearInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && linearInput.trim() && !linearLoading) {
                      void handleLinearConnect();
                    }
                  }}
                  placeholder="Enter Linear API key"
                  className="h-9"
                  disabled={linearLoading}
                  autoFocus
                />
                {linearError && (
                  <p className="text-xs text-destructive" role="alert">
                    {linearError}
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIntegrationSetupModal(null);
                    setLinearError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleLinearConnect()}
                  disabled={!linearInput.trim() || linearLoading}
                >
                  {linearLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
              <Separator />
              <div className="space-y-4">
                <JiraSetupForm
                  site={jiraSite}
                  email={jiraEmail}
                  token={jiraToken}
                  onChange={(u) => {
                    if (typeof u.site === 'string') setJiraSite(u.site);
                    if (typeof u.email === 'string') setJiraEmail(u.email);
                    if (typeof u.token === 'string') setJiraToken(u.token);
                  }}
                  onClose={() => {
                    setIntegrationSetupModal(null);
                    setJiraError(null);
                  }}
                  canSubmit={!!(jiraSite.trim() && jiraEmail.trim() && jiraToken.trim())}
                  error={jiraError}
                  onSubmit={handleJiraSubmit}
                  hideHeader
                  hideFooter
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIntegrationSetupModal(null);
                    setJiraError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleJiraSubmit()}
                  disabled={
                    !(jiraSite.trim() && jiraEmail.trim() && jiraToken.trim()) || jiraLoading
                  }
                >
                  {jiraLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Connect
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* GitHub Device Flow Modal */}
      <GithubDeviceFlowModal
        open={showGithubModal}
        onClose={() => setShowGithubModal(false)}
        onSuccess={async () => {
          // Poll for authentication status (gh CLI takes time to authenticate)
          let attempts = 0;
          const maxAttempts = 15;

          while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 200));
            const status = await checkStatus();

            if (status?.authenticated) {
              break;
            }
            attempts++;
          }
        }}
        onError={(error) => {
          setGithubError(error);
          setShowGithubModal(false);
        }}
      />
    </>
  );
};

export default IntegrationsCard;
