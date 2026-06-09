import { AlertCircle, Check, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { events, rpc } from '@renderer/lib/ipc';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { useGithubContext } from '@renderer/lib/providers/github-context-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { log } from '@renderer/utils/logger';
import {
  githubAuthDeviceCodeChannel,
  githubAuthErrorChannel,
  githubAuthSuccessChannel,
} from '@shared/events/githubEvents';
import type { GitHubUser } from '@shared/github';
import { EMDASH_ISSUES_URL } from '@shared/urls';

export type GithubDeviceFlowModalArgs = {
  onError?: (error: string) => void;
};

type GithubDeviceFlowModalProps = BaseModalProps<void> & GithubDeviceFlowModalArgs;

export function GithubDeviceFlowModal({ onSuccess, onClose, onError }: GithubDeviceFlowModalProps) {
  const { toast } = useToast();
  const { cancelGithubConnect } = useGithubContext();

  // Presentational state - updated via IPC events from main process
  const [userCode, setUserCode] = useState<string>('');
  const [verificationUri, setVerificationUri] = useState<string>('');
  const [timeRemaining, setTimeRemaining] = useState<number>(900);
  const [copied, setCopied] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [browserOpening, setBrowserOpening] = useState(false);
  const [browserOpenCountdown, setBrowserOpenCountdown] = useState(3);

  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasAutocopied = useRef(false);
  const hasOpenedBrowser = useRef(false);
  const authSucceededRef = useRef(false);

  // Cancel the auth flow if the modal is dismissed before auth completes
  useEffect(() => {
    return () => {
      if (!authSucceededRef.current) {
        cancelGithubConnect();
      }
    };
  }, [cancelGithubConnect]);

  // Countdown timer for code expiration
  useEffect(() => {
    if (success || error) return;

    countdownIntervalRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          setError('Code expired. Please try again.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, [success, error]);

  // Reset state on mount (new auth flow)
  useEffect(() => {
    setSuccess(false);
    setError(null);
    setUser(null);
    setCopied(false);
    hasAutocopied.current = false;
    hasOpenedBrowser.current = false;
  }, []);

  const copyToClipboard = useCallback(
    async (code: string, isAutomatic = false) => {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(code);
        } else {
          // Fallback for older browsers
          const textArea = document.createElement('textarea');
          textArea.value = code;
          textArea.style.position = 'fixed';
          textArea.style.left = '-999999px';
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);
        }

        setCopied(true);

        if (!isAutomatic) {
          toast({
            title: '✓ Code copied',
            description: 'Paste it in GitHub to authorize',
          });
        }

        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        log.error('Failed to copy:', err);
        if (!isAutomatic) {
          toast({
            title: 'Copy failed',
            description: 'Please copy the code manually',
            variant: 'destructive',
          });
        }
      }
    },
    [toast]
  );

  const openGitHub = useCallback(() => {
    if (verificationUri) {
      void rpc.app.openExternal(verificationUri);
    }
  }, [verificationUri]);

  // Subscribe to auth events from main process
  useEffect(() => {
    // Device code received - display to user
    const cleanupDeviceCode = events.on(githubAuthDeviceCodeChannel, (data) => {
      setUserCode(data.userCode);
      setVerificationUri(data.verificationUri);
      setTimeRemaining(data.expiresIn);

      // Auto-copy code
      if (!hasAutocopied.current) {
        hasAutocopied.current = true;
        void copyToClipboard(data.userCode, true);

        // Show countdown and open browser after 3 seconds
        setBrowserOpening(true);
        let countdown = 3;
        const countdownTimer = setInterval(() => {
          countdown--;
          setBrowserOpenCountdown(countdown);
          if (countdown <= 0) {
            clearInterval(countdownTimer);
          }
        }, 1000);

        setTimeout(() => {
          setBrowserOpening(false);
          if (!hasOpenedBrowser.current) {
            hasOpenedBrowser.current = true;
            void rpc.app.openExternal(data.verificationUri);
          }
        }, 3000);
      }
    });

    // Auth successful
    const cleanupSuccess = events.on(githubAuthSuccessChannel, (data) => {
      authSucceededRef.current = true;
      setSuccess(true);
      setUser(data.user);

      // Auto-close after showing success animation
      setTimeout(() => {
        onSuccess();
      }, 1000); // 1 second is enough to see success
    });

    // Auth error
    const cleanupError = events.on(githubAuthErrorChannel, (data) => {
      setError(data.message || data.error);

      if (onError) {
        onError(data.error);
      }

      toast({
        title: 'Authentication Failed',
        description: data.message || 'An error occurred',
        variant: 'destructive',
      });
    });

    // Cleanup listeners on unmount
    return () => {
      cleanupDeviceCode();
      cleanupSuccess();
      cleanupError();
    };
  }, [copyToClipboard, onError, onSuccess, toast]);

  const handleClose = () => {
    onClose();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Keyboard shortcuts (Escape is handled by DialogContent's onEscapeKeyDown)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        e.preventDefault();
        void copyToClipboard(userCode);
      } else if (e.key === 'Enter') {
        openGitHub();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault();
        openGitHub();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [copyToClipboard, openGitHub, userCode]);

  const title = success ? 'GitHub connected' : error ? 'Authentication failed' : 'Authorize GitHub';

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="gap-4">
        {success ? (
          <div className="rounded-lg border border-border/60 bg-background/60 p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background-success">
                <Check className="h-4 w-4 text-foreground-success" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">You're connected to GitHub</p>
                {user ? (
                  <div className="mt-1 flex min-w-0 items-center gap-2">
                    {user.avatar_url ? (
                      <img
                        src={user.avatar_url}
                        alt={user.name || user.login}
                        className="h-5 w-5 shrink-0 rounded-full"
                      />
                    ) : null}
                    <p className="text-muted-foreground truncate text-xs">@{user.login}</p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : error ? (
          <div className="rounded-lg border border-border-destructive bg-background-destructive p-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-foreground-destructive" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground-destructive">
                  GitHub authorization failed
                </p>
                <p className="mt-1 text-xs text-foreground-destructive/80">{error}</p>
              </div>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-foreground-muted">
              Enter this one-time code in GitHub to authorize Emdash.
            </p>

            <button
              type="button"
              onClick={() => copyToClipboard(userCode)}
              disabled={!userCode}
              className="focus-visible:border-ring focus-visible:ring-ring/50 rounded-lg border border-border bg-background/60 p-4 text-left transition-colors hover:border-border-1 hover:bg-background-1 focus-visible:ring-3 focus-visible:outline-none disabled:pointer-events-none"
              aria-label={copied ? 'Code copied' : 'Copy authorization code'}
            >
              {userCode ? (
                <p className="text-center font-mono text-3xl font-semibold tracking-wider text-foreground select-all">
                  {userCode}
                </p>
              ) : (
                <div className="flex items-center justify-center gap-2 text-sm text-foreground-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Waiting for GitHub...
                </div>
              )}
            </button>

            <div className="space-y-2 text-sm">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-background-2 text-xs text-foreground-muted">
                  1
                </span>
                <p className="text-foreground-muted">
                  Paste the code in GitHub. The code has already been copied.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-background-2 text-xs text-foreground-muted">
                  2
                </span>
                <p className="text-foreground-muted">Authorize Emdash.</p>
              </div>
            </div>

            {browserOpening ? (
              <div className="rounded-lg border border-border-info bg-background-info p-3 text-sm text-foreground-info">
                Opening GitHub in {browserOpenCountdown}s...
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-3 text-xs text-foreground-muted">
              <div className="flex min-w-0 items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                <span>Waiting for authorization</span>
                {timeRemaining > 0 ? (
                  <span>Code expires in {formatTime(timeRemaining)}</span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => rpc.app.openExternal(EMDASH_ISSUES_URL)}
                className="shrink-0 underline-offset-3 hover:text-foreground hover:underline focus:text-foreground focus:underline focus:outline-none"
              >
                Having trouble?
              </button>
            </div>
          </>
        )}
      </DialogContentArea>
      <DialogFooter>
        {error || success ? (
          <Button variant="outline" onClick={handleClose}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => copyToClipboard(userCode)}
              disabled={!userCode || copied}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy code'}
            </Button>
            <Button onClick={openGitHub} disabled={!verificationUri || browserOpening}>
              <ExternalLink className="h-4 w-4" />
              Open GitHub
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  );
}
