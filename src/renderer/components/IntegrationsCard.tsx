import React, { useCallback, useEffect, useState } from 'react';
import { Check, Plus, Loader2 } from 'lucide-react';
import { useGithubContext } from '../contexts/GithubContextProvider';
import { useEmdashAccount } from '../contexts/EmdashAccountProvider';
import { useTheme } from '../hooks/useTheme';
import githubSvg from '../../assets/images/Github.svg?raw';
import jiraSvg from '../../assets/images/Jira.svg?raw';
import linearSvg from '../../assets/images/Linear.svg?raw';
import gitlabSvg from '../../assets/images/GitLab.svg?raw';
import plainSvg from '../../assets/images/Plain.svg?raw';
import forgejoSvg from '../../assets/images/Forgejo.svg?raw';
import sentrySvg from '../../assets/images/Sentry.svg?raw';
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
import { useModalContext } from '../contexts/ModalProvider';
import GitLabSetupForm from './integrations/GitLabSetupForm';
import ForgejoSetupForm from './integrations/ForgejoSetupForm';
import { GithubDeviceFlowModal } from './GithubDeviceFlowModal';
import { INTEGRATION_REGISTRY, type IntegrationId } from './integrations/registry';

/** Light mode: original SVG colors. Dark / dark-black: primary colour. */
const SvgLogo = ({ raw }: { raw: string }) => {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme !== 'light';

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
  const { authenticated, isLoading, login, logout, checkStatus } = useGithubContext();
  const { hasAccount, checkServerHealth, refreshSession } = useEmdashAccount();
  const { showModal, closeModal } = useModalContext();

  // Connection states
  const [linearConnected, setLinearConnected] = useState(false);
  const [jiraConnected, setJiraConnected] = useState(false);
  const [gitlabConnected, setGitlabConnected] = useState(false);
  const [plainConnected, setPlainConnected] = useState(false);

  // Modal state: which integration setup is open
  const [integrationSetupModal, setIntegrationSetupModal] = useState<
    null | 'linear' | 'jira' | 'gitlab' | 'plain' | 'forgejo' | 'sentry'
  >(null);
  const [showGithubModal, setShowGithubModal] = useState(false);

  // Linear state
  const [linearInput, setLinearInput] = useState('');
  const [linearLoading, setLinearLoading] = useState(false);

  // Jira state
  const [jiraSite, setJiraSite] = useState('');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraToken, setJiraToken] = useState('');
  const [jiraLoading, setJiraLoading] = useState(false);

  // GitLab state
  const [gitlabInstanceUrl, setGitlabInstanceUrl] = useState('');
  const [gitlabToken, setGitlabToken] = useState('');
  const [gitlabLoading, setGitlabLoading] = useState(false);

  // Plain state
  const [plainInput, setPlainInput] = useState('');
  const [plainLoading, setPlainLoading] = useState(false);

  // Forgejo state
  const [forgejoConnected, setForgejoConnected] = useState(false);
  const [forgejoInstanceUrl, setForgejoInstanceUrl] = useState('');
  const [forgejoToken, setForgejoToken] = useState('');
  const [forgejoLoading, setForgejoLoading] = useState(false);

  // Sentry state
  const [sentryConnected, setSentryConnected] = useState(false);
  const [sentryInput, setSentryInput] = useState('');
  const [sentryLoading, setSentryLoading] = useState(false);

  // Error states
  const [githubError, setGithubError] = useState<string | null>(null);
  const [linearError, setLinearError] = useState<string | null>(null);
  const [jiraError, setJiraError] = useState<string | null>(null);
  const [gitlabError, setGitlabError] = useState<string | null>(null);
  const [plainError, setPlainError] = useState<string | null>(null);
  const [forgejoError, setForgejoError] = useState<string | null>(null);
  const [sentryError, setSentryError] = useState<string | null>(null);
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

    const checkGitlab = async () => {
      try {
        const result = await window.electronAPI.gitlabCheckConnection?.();
        setGitlabConnected(!!result?.success);
      } catch {
        setGitlabConnected(false);
      }
    };

    const checkPlain = async () => {
      try {
        const result = await window.electronAPI.plainCheckConnection?.();
        setPlainConnected(!!result?.connected);
      } catch {
        setPlainConnected(false);
      }
    };

    const checkForgejo = async () => {
      try {
        const result = await window.electronAPI.forgejoCheckConnection?.();
        setForgejoConnected(!!result?.success);
      } catch {
        setForgejoConnected(false);
      }
    };

    const checkSentry = async () => {
      try {
        const result = await window.electronAPI.sentryCheckConnection?.();
        setSentryConnected(!!result?.connected);
      } catch {
        setSentryConnected(false);
      }
    };

    void checkLinear();
    void checkJira();
    void checkGitlab();
    void checkPlain();
    void checkForgejo();
    void checkSentry();
  }, []);

  // GitHub handlers
  const handleGithubConnect = useCallback(async () => {
    setGithubError(null);
    try {
      if (hasAccount && (await checkServerHealth())) {
        try {
          const result = await window.electronAPI.githubAuthOAuth();
          if (result.success) {
            await refreshSession();
            await checkStatus();
            return;
          }

          console.warn('OAuth auth failed, falling back to Device Flow:', result.error);
        } catch (err) {
          console.warn('OAuth auth error, falling back to Device Flow:', err);
        }
      }

      showModal('githubDeviceFlowModal', {
        onSuccess: async () => {
          let attempts = 0;
          const maxAttempts = 15;
          while (attempts < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 200));
            const status = await checkStatus();
            if (status?.authenticated) break;
            attempts++;
          }
        },
        onError: (error) => setGithubError(error),
      });
      const result = await login();

      if (!result?.success) {
        setGithubError(result?.error || 'Could not connect.');
        closeModal();
      }
    } catch (error) {
      console.error('GitHub connect failed:', error);
      setGithubError('Could not connect.');
      closeModal();
    }
  }, [hasAccount, checkServerHealth, refreshSession, checkStatus, login, showModal, closeModal]);

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

  // GitLab handlers
  const handleGitlabSubmit = useCallback(async () => {
    setGitlabError(null);
    setGitlabLoading(true);
    try {
      const res = await window.electronAPI.gitlabSaveCredentials?.({
        instanceUrl: gitlabInstanceUrl.trim(),
        token: gitlabToken.trim(),
      });
      if (res?.success) {
        setGitlabConnected(true);
        setGitlabInstanceUrl('');
        setGitlabToken('');
        setIntegrationSetupModal(null);
      } else {
        setGitlabError(res?.error || 'Failed to connect.');
      }
    } catch (e: any) {
      setGitlabError(e?.message || 'Failed to connect.');
    } finally {
      setGitlabLoading(false);
    }
  }, [gitlabInstanceUrl, gitlabToken]);

  const handleGitlabDisconnect = useCallback(async () => {
    try {
      const result = await window.electronAPI.gitlabClearCredentials?.();
      if (result?.success) {
        setGitlabConnected(false);
        setGitlabInstanceUrl('');
        setGitlabToken('');
        setIntegrationSetupModal(null);
      }
    } catch (error) {
      console.error('GitLab disconnect failed:', error);
    }
  }, []);

  // Plain handlers
  const handlePlainConnect = useCallback(async () => {
    const token = plainInput.trim();
    if (!token) return;

    setPlainLoading(true);
    setPlainError(null);

    try {
      const result = await window.electronAPI.plainSaveToken?.(token);
      if (result?.success) {
        setPlainConnected(true);
        setPlainInput('');
        setIntegrationSetupModal(null);
      } else {
        setPlainError(result?.error || 'Could not connect. Try again.');
      }
    } catch (error) {
      console.error('Plain connect failed:', error);
      setPlainError('Could not connect. Try again.');
    } finally {
      setPlainLoading(false);
    }
  }, [plainInput]);

  const handlePlainDisconnect = useCallback(async () => {
    try {
      const result = await window.electronAPI.plainClearToken?.();
      if (result?.success) {
        setPlainConnected(false);
        setPlainInput('');
      }
    } catch (error) {
      console.error('Plain disconnect failed:', error);
    }
  }, []);

  // Forgejo handlers
  const handleForgejoSubmit = useCallback(async () => {
    setForgejoError(null);
    setForgejoLoading(true);
    try {
      const res = await window.electronAPI.forgejoSaveCredentials?.({
        instanceUrl: forgejoInstanceUrl.trim(),
        token: forgejoToken.trim(),
      });
      if (res?.success) {
        setForgejoConnected(true);
        setForgejoInstanceUrl('');
        setForgejoToken('');
        setIntegrationSetupModal(null);
      } else {
        setForgejoError(res?.error || 'Failed to connect.');
      }
    } catch (e: any) {
      setForgejoError(e?.message || 'Failed to connect.');
    } finally {
      setForgejoLoading(false);
    }
  }, [forgejoInstanceUrl, forgejoToken]);

  const handleForgejoDisconnect = useCallback(async () => {
    try {
      const result = await window.electronAPI.forgejoClearCredentials?.();
      if (result?.success) {
        setForgejoConnected(false);
        setForgejoInstanceUrl('');
        setForgejoToken('');
        setIntegrationSetupModal(null);
      }
    } catch (error) {
      console.error('Forgejo disconnect failed:', error);
    }
  }, []);

  // Sentry handlers
  const handleSentryConnect = useCallback(async () => {
    const token = sentryInput.trim();
    if (!token) return;

    setSentryLoading(true);
    setSentryError(null);

    try {
      const result = await window.electronAPI.sentrySaveToken?.(token);
      if (result?.success) {
        setSentryConnected(true);
        setSentryInput('');
        setIntegrationSetupModal(null);
      } else {
        setSentryError(result?.error || 'Could not connect. Try again.');
      }
    } catch (error) {
      console.error('Sentry connect failed:', error);
      setSentryError('Could not connect. Try again.');
    } finally {
      setSentryLoading(false);
    }
  }, [sentryInput]);

  const handleSentryDisconnect = useCallback(async () => {
    try {
      const result = await window.electronAPI.sentryClearToken?.();
      if (result?.success) {
        setSentryConnected(false);
        setSentryInput('');
      }
    } catch (error) {
      console.error('Sentry disconnect failed:', error);
    }
  }, []);

  // Runtime state per integration. Static metadata (name/description/order)
  // lives in INTEGRATION_REGISTRY so it can be shared with the settings
  // search index.
  const integrationRuntime: Record<
    IntegrationId,
    {
      logoSvg: string;
      connected: boolean;
      loading: boolean;
      onConnect: () => void;
      onDisconnect: () => void;
    }
  > = {
    github: {
      logoSvg: githubSvg,
      connected: authenticated,
      loading: isLoading,
      onConnect: handleGithubConnect,
      onDisconnect: handleGithubDisconnect,
    },
    linear: {
      logoSvg: linearSvg,
      connected: linearConnected,
      loading: linearLoading,
      onConnect: () => {
        setLinearError(null);
        setIntegrationSetupModal('linear');
      },
      onDisconnect: handleLinearDisconnect,
    },
    jira: {
      logoSvg: jiraSvg,
      connected: jiraConnected,
      loading: jiraLoading,
      onConnect: () => {
        setJiraError(null);
        setIntegrationSetupModal('jira');
      },
      onDisconnect: handleJiraDisconnect,
    },
    gitlab: {
      logoSvg: gitlabSvg,
      connected: gitlabConnected,
      loading: gitlabLoading,
      onConnect: () => {
        setGitlabError(null);
        setIntegrationSetupModal('gitlab');
      },
      onDisconnect: handleGitlabDisconnect,
    },
    plain: {
      logoSvg: plainSvg,
      connected: plainConnected,
      loading: plainLoading,
      onConnect: () => {
        setPlainError(null);
        setIntegrationSetupModal('plain');
      },
      onDisconnect: handlePlainDisconnect,
    },
    forgejo: {
      logoSvg: forgejoSvg,
      connected: forgejoConnected,
      loading: forgejoLoading,
      onConnect: () => {
        setForgejoError(null);
        setIntegrationSetupModal('forgejo');
      },
      onDisconnect: handleForgejoDisconnect,
    },
    sentry: {
      logoSvg: sentrySvg,
      connected: sentryConnected,
      loading: sentryLoading,
      onConnect: () => {
        setSentryError(null);
        setIntegrationSetupModal('sentry');
      },
      onDisconnect: handleSentryDisconnect,
    },
  };

  const integrations = INTEGRATION_REGISTRY.map((entry) => ({
    ...entry,
    ...integrationRuntime[entry.id as IntegrationId],
  }));

  return (
    <>
      <div
        id="integrations-card"
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
            setGitlabError(null);
            setPlainError(null);
            setForgejoError(null);
            setSentryError(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          {integrationSetupModal === 'forgejo' && (
            <>
              <DialogHeader>
                <DialogTitle>Connect Forgejo</DialogTitle>
                <DialogDescription className="text-xs">
                  Enter your Forgejo instance URL and a personal access token to connect.
                </DialogDescription>
              </DialogHeader>
              <Separator />
              <div className="space-y-4">
                <ForgejoSetupForm
                  instanceUrl={forgejoInstanceUrl}
                  token={forgejoToken}
                  onChange={(u) => {
                    if (typeof u.instanceUrl === 'string') setForgejoInstanceUrl(u.instanceUrl);
                    if (typeof u.token === 'string') setForgejoToken(u.token);
                  }}
                  onClose={() => {
                    setIntegrationSetupModal(null);
                    setForgejoError(null);
                  }}
                  canSubmit={!!(forgejoInstanceUrl.trim() && forgejoToken.trim())}
                  error={forgejoError}
                  onSubmit={handleForgejoSubmit}
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
                    setForgejoError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleForgejoSubmit()}
                  disabled={!(forgejoInstanceUrl.trim() && forgejoToken.trim()) || forgejoLoading}
                >
                  {forgejoLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Connect
                </Button>
              </DialogFooter>
            </>
          )}

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

          {integrationSetupModal === 'gitlab' && (
            <>
              <DialogHeader>
                <DialogTitle>Connect GitLab</DialogTitle>
                <DialogDescription className="text-xs">
                  Enter your GitLab instance URL and a personal access token to connect.
                </DialogDescription>
              </DialogHeader>
              <Separator />
              <div className="space-y-4">
                <GitLabSetupForm
                  instanceUrl={gitlabInstanceUrl}
                  token={gitlabToken}
                  onChange={(u) => {
                    if (typeof u.instanceUrl === 'string') setGitlabInstanceUrl(u.instanceUrl);
                    if (typeof u.token === 'string') setGitlabToken(u.token);
                  }}
                  onClose={() => {
                    setIntegrationSetupModal(null);
                    setGitlabError(null);
                  }}
                  canSubmit={!!(gitlabInstanceUrl.trim() && gitlabToken.trim())}
                  error={gitlabError}
                  onSubmit={handleGitlabSubmit}
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
                    setGitlabError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleGitlabSubmit()}
                  disabled={!(gitlabInstanceUrl.trim() && gitlabToken.trim()) || gitlabLoading}
                >
                  {gitlabLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Connect
                </Button>
              </DialogFooter>
            </>
          )}

          {integrationSetupModal === 'sentry' && (
            <>
              <DialogHeader>
                <DialogTitle>Connect Sentry</DialogTitle>
                <DialogDescription className="text-xs">
                  Enter your Sentry auth token to connect your organization.
                </DialogDescription>
              </DialogHeader>
              <Separator />
              <div className="space-y-4">
                <Input
                  type="password"
                  value={sentryInput}
                  onChange={(e) => setSentryInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && sentryInput.trim() && !sentryLoading) {
                      void handleSentryConnect();
                    }
                  }}
                  placeholder="Enter Sentry auth token"
                  className="h-9"
                  disabled={sentryLoading}
                  autoFocus
                />
                {sentryError && (
                  <p className="text-xs text-destructive" role="alert">
                    {sentryError}
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
                    setSentryError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleSentryConnect()}
                  disabled={!sentryInput.trim() || sentryLoading}
                >
                  {sentryLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Connect
                </Button>
              </DialogFooter>
            </>
          )}

          {integrationSetupModal === 'plain' && (
            <>
              <DialogHeader>
                <DialogTitle>Connect Plain</DialogTitle>
                <DialogDescription className="text-xs">
                  Enter your Plain API key to connect your workspace.
                </DialogDescription>
              </DialogHeader>
              <Separator />
              <div className="space-y-4">
                <Input
                  type="password"
                  value={plainInput}
                  onChange={(e) => setPlainInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && plainInput.trim() && !plainLoading) {
                      void handlePlainConnect();
                    }
                  }}
                  placeholder="Enter Plain API key"
                  className="h-9"
                  disabled={plainLoading}
                  autoFocus
                />
                {plainError && (
                  <p className="text-xs text-destructive" role="alert">
                    {plainError}
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
                    setPlainError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handlePlainConnect()}
                  disabled={!plainInput.trim() || plainLoading}
                >
                  {plainLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Connect
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* GitHub Device Flow Modal */}
    </>
  );
};

export default IntegrationsCard;
