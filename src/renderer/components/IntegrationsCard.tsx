import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import IntegrationRow from './IntegrationRow';
import { Input } from './ui/input';
import { useGithubAuth } from '../hooks/useGithubAuth';
import { menuMotion } from './ui/motion';
import linearLogo from '../../assets/images/linear-icon.png';
import jiraLogo from '../../assets/images/jira.png';
import JiraSetupForm from './integrations/JiraSetupForm';
import githubLogo from '../../assets/images/github.png';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { Info } from 'lucide-react';

type LinearState = {
  checking: boolean;
  loading: boolean;
  connected: boolean;
  detail: string | null;
  input: string;
  error: string | null;
};

const defaultLinearState: LinearState = {
  checking: true,
  loading: false,
  connected: false,
  detail: null,
  input: '',
  error: null,
};

let cachedLinearState: LinearState | null = null;

const IntegrationsCard: React.FC = () => {
  const [linearState, setLinearState] = useState<LinearState>(
    () => cachedLinearState ?? defaultLinearState
  );
  const { installed, authenticated, user, isLoading, login, logout, checkStatus } = useGithubAuth();
  const [githubError, setGithubError] = useState<string | null>(null);
  // Jira state
  const [jiraSite, setJiraSite] = useState('');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraToken, setJiraToken] = useState('');
  const [jiraStatus, setJiraStatus] = useState<'checking' | 'connected' | 'disconnected' | 'error'>(
    'checking'
  );
  const [jiraDetail, setJiraDetail] = useState<string | null>(null);
  const [jiraError, setJiraError] = useState<string | null>(null);
  const [jiraSetupOpen, setJiraSetupOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const updateLinearState = useCallback((updater: (prev: LinearState) => LinearState) => {
    setLinearState((prev) => {
      const next = updater(prev);
      cachedLinearState = next;
      return next;
    });
  }, []);

  const loadLinearStatus = useCallback(async () => {
    if (!window?.electronAPI?.linearCheckConnection) {
      updateLinearState((prev) => ({
        ...prev,
        checking: false,
        connected: false,
        detail: null,
        error: 'Linear integration unavailable.',
      }));
      return;
    }

    try {
      const status = await window.electronAPI.linearCheckConnection();
      updateLinearState((prev) => ({
        ...prev,
        checking: false,
        connected: !!status?.connected,
        detail: status?.taskName ?? null,
        error: status?.connected ? null : null,
      }));
    } catch (error) {
      console.error('Failed to check Linear connection:', error);
      updateLinearState((prev) => ({
        ...prev,
        checking: false,
        connected: false,
        detail: null,
        error: 'Unable to verify Linear connection.',
      }));
    }
  }, [updateLinearState]);

  useEffect(() => {
    if (cachedLinearState) return;
    loadLinearStatus();
  }, [loadLinearStatus]);

  // Jira connection load
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const api: any = (window as any).electronAPI;
        if (!api?.jiraCheckConnection) {
          setJiraStatus('error');
          // setJiraError('Jira integration unavailable.');
          return;
        }
        const res = await api.jiraCheckConnection();
        if (cancel) return;
        if (res?.connected) {
          setJiraStatus('connected');
          setJiraDetail(res?.displayName || res?.siteUrl || 'Connected');
        } else {
          setJiraStatus('disconnected');
        }
      } catch (e) {
        if (!cancel) {
          setJiraStatus('error');
          setJiraError('Unable to verify Jira connection.');
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const handleLinearInputChange = useCallback(
    (value: string) => {
      updateLinearState((prev) => ({ ...prev, input: value, error: null }));
    },
    [updateLinearState]
  );

  const handleLinearConnect = useCallback(async () => {
    const token = linearState.input.trim();
    if (!token || !window?.electronAPI?.linearSaveToken) {
      return;
    }

    updateLinearState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const result = await window.electronAPI.linearSaveToken(token);
      if (result?.success) {
        updateLinearState(() => ({
          checking: false,
          loading: false,
          connected: true,
          detail: result?.taskName ?? null,
          input: '',
          error: null,
        }));
      } else {
        updateLinearState((prev) => ({
          ...prev,
          loading: false,
          connected: false,
          detail: null,
          error: result?.error || 'Could not connect. Try again.',
        }));
      }
    } catch (error) {
      console.error('Linear connect failed:', error);
      updateLinearState((prev) => ({
        ...prev,
        loading: false,
        connected: false,
        detail: null,
        error: 'Could not connect. Try again.',
      }));
    }
  }, [linearState.input, updateLinearState]);

  const handleLinearKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (!linearState.loading && !linearState.checking && linearState.input.trim()) {
          void handleLinearConnect();
        }
      }
    },
    [handleLinearConnect, linearState]
  );

  const handleLinearDisconnect = useCallback(async () => {
    if (!window?.electronAPI?.linearClearToken) {
      return;
    }

    updateLinearState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const result = await window.electronAPI.linearClearToken();
      if (result?.success) {
        updateLinearState(() => ({
          checking: false,
          loading: false,
          connected: false,
          detail: null,
          input: '',
          error: null,
        }));
      } else {
        updateLinearState((prev) => ({
          ...prev,
          loading: false,
          error: result?.error || 'Failed to disconnect.',
        }));
      }
    } catch (error) {
      console.error('Linear disconnect failed:', error);
      updateLinearState((prev) => ({
        ...prev,
        loading: false,
        error: 'Failed to disconnect.',
      }));
    }
  }, [updateLinearState]);

  const githubDetail = useMemo(() => {
    if (!user) return null;
    return user?.name || user?.login || null;
  }, [user]);
  const githubAvatarUrl = (user as any)?.avatar_url as string | undefined;

  const handleGithubConnect = useCallback(async () => {
    setGithubError(null);
    try {
      const result = await login();
      await checkStatus();
      if (!result?.success) {
        setGithubError(result?.error || 'Could not connect.');
      }
    } catch (error) {
      console.error('GitHub connect failed:', error);
      setGithubError('Could not connect.');
    }
  }, [checkStatus, login]);

  const handleGithubInstall = useCallback(async () => {
    setGithubError(null);
    try {
      // Auto-install gh CLI
      const installResult = await window.electronAPI.githubInstallCLI();

      if (!installResult.success) {
        setGithubError(`Could not auto-install gh CLI: ${installResult.error || 'Unknown error'}`);
        return;
      }

      // After successful install, proceed with OAuth authentication
      await checkStatus(); // Refresh status
      const result = await login();
      await checkStatus();

      if (!result?.success) {
        setGithubError(result?.error || 'Authentication failed.');
      }
    } catch (error) {
      console.error('Failed to install and connect GitHub:', error);
      setGithubError('Installation failed. Please install gh CLI manually.');
    }
  }, [checkStatus, login]);

  const handleGithubDisconnect = useCallback(async () => {
    setGithubError(null);
    try {
      await logout();
    } catch (error) {
      console.error('GitHub logout failed:', error);
      setGithubError('Could not disconnect.');
    }
  }, [logout]);

  const renderStatusIndicator = useCallback(
    (label: string, tone: 'connected' | 'inactive' = 'inactive') => {
      const dotClass = tone === 'connected' ? 'bg-emerald-500' : 'bg-muted-foreground/50';
      return (
        <span className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
          {label}
        </span>
      );
    },
    []
  );

  const linearStatus = useMemo(() => {
    if (linearState.checking || linearState.loading) return 'loading' as const;
    if (linearState.connected) return 'connected' as const;
    if (linearState.error) return 'error' as const;
    return 'disconnected' as const;
  }, [linearState.checking, linearState.connected, linearState.error, linearState.loading]);

  const linearMiddle = useMemo(() => {
    if (linearState.connected) {
      const label = linearState.detail ?? 'Connected via API key.';
      return renderStatusIndicator(label, 'connected');
    }

    return (
      <div className="flex items-center gap-2" aria-live="polite">
        <Input
          type="password"
          value={linearState.input}
          onChange={(event) => handleLinearInputChange(event.target.value)}
          disabled={linearState.loading || linearState.checking}
          placeholder="Enter Linear API key"
          onKeyDown={handleLinearKeyDown}
          aria-label="Linear API key"
          className="h-8 w-full max-w-[220px]"
        />
        {linearState.loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : null}
      </div>
    );
  }, [handleLinearInputChange, handleLinearKeyDown, linearState, renderStatusIndicator]);

  const canConnectLinear =
    !!linearState.input.trim() && !linearState.loading && !linearState.checking;

  const githubStatus = useMemo(() => {
    if (isLoading) return 'loading' as const;
    if (authenticated) return 'connected' as const;
    if (githubError) return 'error' as const;
    return 'disconnected' as const;
  }, [authenticated, githubError, isLoading]);

  const githubMiddle = useMemo(() => {
    if (!installed) {
      return renderStatusIndicator('Install GitHub CLI (gh) to connect.', 'inactive');
    }

    if (!authenticated) {
      return renderStatusIndicator('Sign in with GitHub CLI.', 'inactive');
    }

    const label = githubDetail ?? 'Connected via GitHub CLI.';
    return (
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        {githubAvatarUrl ? (
          <img
            src={githubAvatarUrl}
            alt="GitHub avatar"
            className="h-6 w-6 rounded-full border border-border object-cover"
            referrerPolicy="no-referrer"
          />
        ) : null}
        <span className="truncate">{label}</span>
      </span>
    );
  }, [authenticated, githubDetail, githubAvatarUrl, installed, renderStatusIndicator]);

  return (
    <div className="space-y-3" aria-live="polite">
      <IntegrationRow
        logoSrc={linearLogo}
        name="Linear"
        accountLabel={linearState.detail ?? undefined}
        status={linearStatus}
        middle={linearMiddle}
        showStatusPill={false}
        onConnect={() => void handleLinearConnect()}
        connectDisabled={!canConnectLinear}
        connectContent={
          linearState.loading ? (
            <>
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Connecting…
            </>
          ) : (
            'Connect'
          )
        }
        onDisconnect={linearState.connected ? () => void handleLinearDisconnect() : undefined}
      />
      {linearState.error && !linearState.connected ? (
        <p className="text-xs text-red-600" role="alert">
          {linearState.error}
        </p>
      ) : null}

      <IntegrationRow
        logoSrc={githubLogo}
        name="GitHub"
        accountLabel={githubDetail ?? undefined}
        status={githubStatus}
        middle={githubMiddle}
        showStatusPill={false}
        onConnect={() => (installed ? void handleGithubConnect() : void handleGithubInstall())}
        connectDisabled={installed ? isLoading : false}
        connectContent={
          installed ? (
            isLoading ? (
              <>
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Signing in…
              </>
            ) : (
              'Sign in with GitHub'
            )
          ) : (
            'Install & Sign in'
          )
        }
        onDisconnect={authenticated ? () => void handleGithubDisconnect() : undefined}
      />
      {githubError ? (
        <p className="text-xs text-red-600" role="alert">
          {githubError}
        </p>
      ) : null}

      <IntegrationRow
        logoSrc={jiraLogo}
        name="Jira"
        accountLabel={jiraDetail ?? undefined}
        status={
          jiraStatus === 'checking'
            ? 'loading'
            : jiraStatus === 'connected'
              ? 'connected'
              : jiraStatus === 'error'
                ? 'error'
                : 'disconnected'
        }
        middle={
          jiraStatus === 'connected' ? (
            <div className="flex w-full max-w-[540px] items-center gap-2">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Connected
              </span>
            </div>
          ) : false ? (
            <div className="flex w-full max-w-[540px] flex-col gap-2 sm:flex-row sm:items-center">
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/70 bg-background text-muted-foreground hover:text-foreground"
                      title="How to get Jira credentials"
                    >
                      <Info className="h-4 w-4" aria-hidden="true" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    className="max-w-sm whitespace-pre-line text-xs leading-snug"
                  >
                    {`Setup:
1) Site URL: open your Jira in the browser and copy the base URL (e.g. https://your-domain.atlassian.net).
2) Email: the Atlassian account email you use to sign in.
3) API token: create one at https://id.atlassian.com/manage-profile/security/api-tokens → Create API token → Copy.`}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Input
                placeholder="https://your-domain.atlassian.net"
                value={jiraSite}
                onChange={(e) => setJiraSite(e.target.value)}
                className="h-8 flex-1"
              />
              <Input
                placeholder="email@example.com"
                value={jiraEmail}
                onChange={(e) => setJiraEmail(e.target.value)}
                className="h-8 flex-1"
              />
              <Input
                type="password"
                placeholder="API token"
                value={jiraToken}
                onChange={(e) => setJiraToken(e.target.value)}
                className="h-8 flex-1"
              />
            </div>
          ) : null
        }
        rightExtra={
          jiraStatus !== 'connected' ? (
            <div>
              <button
                type="button"
                className="inline-flex h-8 items-center justify-center rounded-md border border-border/70 bg-background px-2.5 text-xs font-medium"
                onClick={() => setJiraSetupOpen((v) => !v)}
                aria-expanded={jiraSetupOpen}
                aria-haspopup="dialog"
              >
                Connect Jira
              </button>
              <AnimatePresence>
                {jiraSetupOpen ? (
                  <motion.div
                    role="dialog"
                    aria-label="Jira setup"
                    className="absolute left-0 top-full z-50 mt-2 w-[360px] max-w-[calc(100vw-3rem)] rounded-xl border border-border/60 bg-background/95 p-3 shadow-2xl ring-1 ring-border/60 backdrop-blur supports-[backdrop-filter]:bg-background/80"
                    style={{ transformOrigin: 'top left' }}
                    {...(menuMotion(!!reduceMotion) as any)}
                  >
                    <JiraSetupForm
                      site={jiraSite}
                      email={jiraEmail}
                      token={jiraToken}
                      onChange={(u) => {
                        if (typeof u.site === 'string') setJiraSite(u.site);
                        if (typeof u.email === 'string') setJiraEmail(u.email);
                        if (typeof u.token === 'string') setJiraToken(u.token);
                      }}
                      onClose={() => setJiraSetupOpen(false)}
                      canSubmit={!!(jiraSite.trim() && jiraEmail.trim() && jiraToken.trim())}
                      error={jiraError}
                      onSubmit={async () => {
                        try {
                          setJiraError(null);
                          const api: any = (window as any).electronAPI;
                          const res = await api?.jiraSaveCredentials?.({
                            siteUrl: jiraSite.trim(),
                            email: jiraEmail.trim(),
                            token: jiraToken.trim(),
                          });
                          if (res?.success) {
                            setJiraStatus('connected');
                            setJiraDetail(res?.displayName || jiraSite.trim());
                            setJiraSite('');
                            setJiraEmail('');
                            setJiraToken('');
                            setJiraSetupOpen(false);
                          } else {
                            setJiraStatus('error');
                            setJiraError(res?.error || 'Failed to connect.');
                          }
                        } catch (e: any) {
                          setJiraStatus('error');
                          setJiraError(e?.message || 'Failed to connect.');
                        }
                      }}
                    />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          ) : null
        }
        showStatusPill={false}
        onDisconnect={
          jiraStatus === 'connected'
            ? async () => {
                try {
                  const api: any = (window as any).electronAPI;
                  const res = await api?.jiraClearCredentials?.();
                  if (res?.success) {
                    setJiraStatus('disconnected');
                    setJiraDetail(null);
                    setJiraSetupOpen(false);
                  } else {
                    setJiraError(res?.error || 'Failed to disconnect.');
                  }
                } catch (e: any) {
                  setJiraError(e?.message || 'Failed to disconnect.');
                }
              }
            : undefined
        }
      />
      {jiraError ? (
        <p className="text-xs text-red-600" role="alert">
          {jiraError}
        </p>
      ) : null}
    </div>
  );
};

export default IntegrationsCard;
