import { Button, Dialog, useToast } from '@emdash/ui/react/primitives';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getIntegrationsClient } from '@core/features/integrations/api/browser/client';
import { invalidateProviderAccountState } from '@core/features/integrations/api/browser/use-provider-accounts';
import { useModalController } from '@core/manifests/browser/modal-api';
import { openExternal } from '@core/primitives/desktop-host/browser/host-client';
import { log } from '@core/primitives/logging/browser/logger';
import { defineModal } from '@core/primitives/modals/react';
import { EMDASH_ISSUES_URL } from '@core/primitives/urls/api/urls';

export type IntegrationDeviceFlowModalArgs = {
  integrationId: string;
  providerName: string;
  /** Reconnect this account instead of adding one. */
  accountId?: string;
};

const BROWSER_OPEN_DELAY_SECONDS = 3;
/** Completion waits for the user, so its call deadline outlasts the code's lifetime. */
const COMPLETE_DEADLINE_MARGIN_SECONDS = 60;

type Code = {
  flowId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
};

type State =
  | { kind: 'starting' }
  | ({ kind: 'waiting' } & Code)
  | { kind: 'success'; displayName?: string; login?: string; avatarUrl?: string }
  | { kind: 'error'; message: string };

export function IntegrationDeviceFlowModal({
  integrationId,
  providerName,
  accountId,
}: IntegrationDeviceFlowModalArgs) {
  const modal = useModalController('integrationDeviceFlowModal');
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [state, setState] = useState<State>({ kind: 'starting' });
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [openingIn, setOpeningIn] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const flowIdRef = useRef<string | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const succeededRef = useRef(false);
  const completeRef = useRef(modal.complete);
  completeRef.current = modal.complete;

  const flashCopied = useCallback(() => {
    setCopied(true);
    clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
  }, []);
  useEffect(() => () => clearTimeout(copiedTimerRef.current), []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const client = await getIntegrationsClient();
      const started = await client.startDeviceFlow({
        integrationId,
        ...(accountId ? { accountId } : {}),
      });
      if (!active) {
        if (started.success) void client.cancelDeviceFlow({ flowId: started.flowId });
        return;
      }
      if (!started.success) {
        setState({ kind: 'error', message: started.error });
        return;
      }
      flowIdRef.current = started.flowId;
      setSecondsLeft(started.expiresIn);
      setOpeningIn(BROWSER_OPEN_DELAY_SECONDS);
      setState({ kind: 'waiting', ...started });
      // Without a link that carries the code, the provider asks for it; have it ready to paste.
      if (!started.verificationUriComplete) {
        navigator.clipboard?.writeText(started.userCode).then(
          () => {
            if (active) flashCopied();
          },
          (error: unknown) => log.warn('Failed to copy device code', error)
        );
      }

      const result = await client.completeDeviceFlow(
        { flowId: started.flowId },
        { timeoutMs: (started.expiresIn + COMPLETE_DEADLINE_MARGIN_SECONDS) * 1000 }
      );
      flowIdRef.current = null;
      if (!active) return;
      if (result.success) {
        succeededRef.current = true;
        setState({
          kind: 'success',
          displayName: result.displayName,
          login: result.login,
          avatarUrl: result.avatarUrl,
        });
        toast(`Connected to ${providerName}`, {
          description: result.login ? `@${result.login} is connected.` : undefined,
        });
        void invalidateProviderAccountState(queryClient);
        setTimeout(() => completeRef.current(), 1000);
      } else if (!result.cancelled) {
        setState({ kind: 'error', message: result.error });
      }
    })().catch((error: unknown) => {
      log.error('Device sign-in failed', { integrationId, error });
      if (active) setState({ kind: 'error', message: 'Sign-in failed.' });
    });
    return () => {
      active = false;
      const flowId = flowIdRef.current;
      if (flowId && !succeededRef.current) {
        void getIntegrationsClient().then((client) => client.cancelDeviceFlow({ flowId }));
      }
    };
  }, [accountId, flashCopied, integrationId, providerName, queryClient, toast]);

  const waiting = state.kind === 'waiting';
  const verificationUrl =
    state.kind === 'waiting' ? (state.verificationUriComplete ?? state.verificationUri) : null;

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      setSecondsLeft((seconds) => {
        if (seconds > 1) return seconds - 1;
        setState({ kind: 'error', message: 'The code expired. Try again.' });
        return 0;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  useEffect(() => {
    if (openingIn === null || !verificationUrl) return;
    if (openingIn <= 0) {
      setOpeningIn(null);
      void openExternal(verificationUrl);
      return;
    }
    const timer = setTimeout(() => setOpeningIn(openingIn - 1), 1000);
    return () => clearTimeout(timer);
  }, [openingIn, verificationUrl]);

  const userCode = state.kind === 'waiting' ? state.userCode : '';
  const copyCode = useCallback(async () => {
    if (!userCode) return;
    try {
      await navigator.clipboard.writeText(userCode);
      flashCopied();
    } catch (error) {
      log.error('Failed to copy device code', error);
      toast.error('Copy failed', { description: 'Copy the code manually.' });
    }
  }, [flashCopied, toast, userCode]);

  const openProvider = useCallback(() => {
    if (!verificationUrl) return;
    setOpeningIn(null);
    void openExternal(verificationUrl);
  }, [verificationUrl]);

  useEffect(() => {
    if (!waiting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key === 'c') {
        event.preventDefault();
        void copyCode();
      } else if (event.key === 'Enter' || (modifier && event.key === 'r')) {
        event.preventDefault();
        openProvider();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [copyCode, openProvider, waiting]);

  const title =
    state.kind === 'success'
      ? `${providerName} connected`
      : state.kind === 'error'
        ? 'Sign-in failed'
        : `Sign in with ${providerName}`;

  return (
    <>
      <Dialog.Header>
        <Dialog.Title>{title}</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body className="gap-4">
        {state.kind === 'success' ? (
          <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/60 p-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background-success">
              <Check className="h-4 w-4 text-foreground-success" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                You're connected to {providerName}
              </p>
              {state.login ? (
                <div className="mt-1 flex min-w-0 items-center gap-2">
                  {state.avatarUrl ? (
                    <img
                      src={state.avatarUrl}
                      alt={state.displayName ?? state.login}
                      className="h-5 w-5 shrink-0 rounded-full"
                    />
                  ) : null}
                  <p className="text-muted-foreground truncate text-xs">@{state.login}</p>
                </div>
              ) : null}
            </div>
          </div>
        ) : state.kind === 'error' ? (
          <div className="flex items-start gap-3 rounded-lg border border-border-destructive bg-background-destructive p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-foreground-destructive" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground-destructive">
                {providerName} authorization failed
              </p>
              <p className="mt-1 text-xs text-foreground-destructive/80">{state.message}</p>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-foreground-muted">
              Authorize Emdash in {providerName} with this one-time code.
            </p>
            <button
              type="button"
              onClick={() => void copyCode()}
              disabled={!userCode}
              className="focus-visible:border-ring focus-visible:ring-ring/50 rounded-lg border border-border bg-background/60 p-4 text-center transition-colors hover:border-border-1 hover:bg-background-1 focus-visible:ring-3 focus-visible:outline-none disabled:pointer-events-none"
              aria-label={copied ? 'Code copied' : 'Copy sign-in code'}
            >
              {userCode ? (
                <span className="font-mono text-3xl font-semibold tracking-wider text-foreground select-all">
                  {userCode}
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2 text-sm text-foreground-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Requesting a code from {providerName}
                </span>
              )}
            </button>
            <ol className="space-y-2 text-sm">
              <Step number={1}>
                Check that {providerName} shows this code. If it asks, enter the code.
              </Step>
              <Step number={2}>Authorize Emdash.</Step>
            </ol>
            {openingIn !== null && openingIn > 0 ? (
              <div className="rounded-lg border border-border-info bg-background-info p-3 text-sm text-foreground-info">
                Opening {providerName} in {openingIn}s...
              </div>
            ) : null}
            {waiting ? (
              <div className="flex items-center justify-between gap-3 text-xs text-foreground-muted">
                <div className="flex min-w-0 items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  <span>Waiting for authorization</span>
                  <span>Code expires in {formatTime(secondsLeft)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void openExternal(EMDASH_ISSUES_URL)}
                  className="shrink-0 underline-offset-3 hover:text-foreground hover:underline focus:text-foreground focus:underline focus:outline-none"
                >
                  Having trouble?
                </button>
              </div>
            ) : null}
          </>
        )}
      </Dialog.Body>
      <Dialog.Footer>
        {state.kind === 'success' || state.kind === 'error' ? (
          <Button variant="secondary" onClick={modal.dismiss}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={modal.dismiss}>
              Cancel
            </Button>
            <Button variant="secondary" onClick={() => void copyCode()} disabled={!userCode}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy code'}
            </Button>
            <Button variant="primary" onClick={openProvider} disabled={!waiting}>
              <ExternalLink className="h-4 w-4" />
              Open {providerName}
            </Button>
          </>
        )}
      </Dialog.Footer>
    </>
  );
}

function Step({ number, children }: { number: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-background-2 text-xs text-foreground-muted">
        {number}
      </span>
      <p className="text-foreground-muted">{children}</p>
    </li>
  );
}

function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
}

export const integrationDeviceFlowModal = defineModal<void>()({
  id: 'integrationDeviceFlowModal',
  component: IntegrationDeviceFlowModal,
  size: 'md',
});
