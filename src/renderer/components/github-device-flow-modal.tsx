import { AlertCircle, Check, Copy, ExternalLink } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  githubAuthDeviceCodeChannel,
  githubAuthErrorChannel,
  githubAuthSuccessChannel,
} from '@shared/events/githubEvents';
import type { GitHubUser } from '@shared/github';
import type { BaseModalProps } from '@renderer/core/modal/modal-provider';
import emdashLogo from '../../assets/images/emdash/emdash_logo_white.svg';
import { events, rpc } from '../core/ipc';
import { useToast } from '../hooks/use-toast';
import { log } from '../lib/logger';
import { useGithubContext } from '../providers/github-context-provider';
import { Button } from './ui/button';
import { Spinner } from './ui/spinner';

interface GithubDeviceFlowModalProps {
  onClose: () => void;
  onError?: (error: string) => void;
}

type GithubDeviceFlowOverlayExtraProps = {
  onError?: (error: string) => void;
};

export function GithubDeviceFlowModalOverlay({
  onClose,
  onError,
}: GithubDeviceFlowOverlayExtraProps & BaseModalProps<unknown>) {
  return (
    <GithubDeviceFlowModal
      onClose={onClose}
      onError={(error) => {
        onError?.(error);
        onClose();
      }}
    />
  );
}

export function GithubDeviceFlowModal({ onClose, onError }: GithubDeviceFlowModalProps) {
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
      rpc.app.openExternal(verificationUri);
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
        copyToClipboard(data.userCode, true);

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
            rpc.app.openExternal(data.verificationUri);
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
        onClose();
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
  }, [copyToClipboard, onError, onClose, toast]);

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
        copyToClipboard(userCode);
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

  return (
    <>
      <div className="flex flex-col items-center px-8 py-12">
        <img src={emdashLogo} alt="Emdash" className="mb-8 h-8 opacity-90" />

        {success ? (
          // Success State
          <div className="flex flex-col items-center space-y-6 duration-300 animate-in fade-in zoom-in">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500 duration-500 animate-in zoom-in">
              <Check className="h-8 w-8 text-white" strokeWidth={3} />
            </div>
            <div className="space-y-2 text-center">
              <h2 className="text-2xl font-semibold">Success!</h2>
              <p className="text-sm text-muted-foreground">You're connected to GitHub</p>
              {user && (
                <div className="mt-4 flex items-center justify-center gap-2">
                  {user.avatar_url && (
                    <img src={user.avatar_url} alt={user.name} className="h-10 w-10 rounded-full" />
                  )}
                  <div className="text-left">
                    <p className="text-sm font-medium">{user.name || user.login}</p>
                    <p className="text-xs text-muted-foreground">@{user.login}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : error ? (
          // Error State
          <div className="flex w-full flex-col items-center space-y-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/20">
              <AlertCircle className="h-8 w-8 text-red-500" />
            </div>
            <div className="space-y-2 text-center">
              <h2 className="text-xl font-semibold">Authentication Failed</h2>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
            <Button onClick={handleClose} variant="outline" className="w-full">
              Close
            </Button>
          </div>
        ) : (
          // Waiting State
          <div className="flex w-full flex-col items-center space-y-6">
            <div className="space-y-2 text-center">
              <h2 className="text-2xl font-semibold">Connect to GitHub</h2>
              <p className="text-sm text-muted-foreground">
                Follow these steps to authorize Emdash
              </p>
            </div>

            {userCode && (
              <>
                <div className="w-full space-y-3 rounded-lg bg-muted/30 p-6">
                  <p className="text-center text-xs font-medium text-muted-foreground">Your code</p>
                  <p className="select-all text-center font-mono text-4xl font-bold tracking-wider">
                    {userCode}
                  </p>
                </div>

                <Button
                  onClick={() => copyToClipboard(userCode)}
                  variant="outline"
                  className="w-full"
                  disabled={copied}
                >
                  {copied ? (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="mr-2 h-4 w-4" />
                      Copy Code
                    </>
                  )}
                </Button>
              </>
            )}

            <div className="w-full space-y-3 text-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold">
                  1
                </div>
                <p className="text-muted-foreground">
                  Paste the code in GitHub{' '}
                  <span className="font-medium text-foreground">(already copied!)</span>
                </p>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold">
                  2
                </div>
                <p className="text-muted-foreground">Click Authorize</p>
              </div>
            </div>

            {browserOpening && (
              <div className="w-full rounded-lg border border-blue-500/20 bg-blue-500/10 p-4">
                <p className="text-center text-sm text-blue-600 dark:text-blue-400">
                  Opening GitHub in {browserOpenCountdown}s...
                </p>
              </div>
            )}

            <div className="flex flex-col items-center gap-2 text-center">
              <Spinner className="h-5 w-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Waiting for authorization...</p>
              {timeRemaining > 0 && (
                <p className="text-xs text-muted-foreground">
                  Code expires in {formatTime(timeRemaining)}
                </p>
              )}
            </div>

            {verificationUri && !browserOpening && (
              <Button onClick={openGitHub} className="w-full" size="lg">
                <ExternalLink className="mr-2 h-4 w-4" />
                Open GitHub
              </Button>
            )}

            <div className="w-full border-t pt-4">
              <p className="text-center text-xs text-muted-foreground">
                Having{' '}
                <button
                  onClick={() =>
                    rpc.app.openExternal('https://github.com/generalaction/emdash/issues')
                  }
                  className="text-primary hover:underline focus:underline focus:outline-none"
                >
                  trouble
                </button>
                ?
              </p>
            </div>

            <div className="space-x-3 text-center text-xs text-muted-foreground">
              <span>⌘C to copy</span>
              <span>•</span>
              <span>⌘R to reopen</span>
              <span>•</span>
              <span>Esc to cancel</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
