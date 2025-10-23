import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import IntegrationRow from './IntegrationRow';
import { Input } from './ui/input';
import { useGithubAuth } from '../hooks/useGithubAuth';
import linearLogo from '../../assets/images/linear-icon.png';
import githubLogo from '../../assets/images/github.png';

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
  const { installed, authenticated, user, isLoading, login, checkStatus } = useGithubAuth();
  const [githubError, setGithubError] = useState<string | null>(null);
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
        detail: status?.workspaceName ?? null,
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
          detail: result?.workspaceName ?? null,
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
    try {
      await window.electronAPI.openExternal('https://cli.github.com/manual/installation');
    } catch (error) {
      console.error('Failed to open GitHub CLI install docs:', error);
    }
  }, []);

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
              'Sign in'
            )
          ) : (
            'Install CLI'
          )
        }
      />
      {githubError ? (
        <p className="text-xs text-red-600" role="alert">
          {githubError}
        </p>
      ) : null}
    </div>
  );
};

export default IntegrationsCard;
