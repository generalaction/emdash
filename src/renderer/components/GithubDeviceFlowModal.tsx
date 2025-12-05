import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from './ui/button';
import { Spinner } from './ui/spinner';
import { Check, Copy, ExternalLink, RefreshCw, AlertCircle, X } from 'lucide-react';
import { useToast } from '../hooks/use-toast';
import emdashLogo from '../../assets/images/emdash/emdash_logo_white.svg';

interface GithubDeviceFlowModalProps {
  open: boolean;
  onClose: () => void;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  onSuccess?: (user: any) => void;
  onError?: (error: string) => void;
}

export function GithubDeviceFlowModal({
  open,
  onClose,
  deviceCode,
  userCode,
  verificationUri,
  expiresIn,
  interval,
  onSuccess,
  onError,
}: GithubDeviceFlowModalProps) {
  const { toast } = useToast();
  const [timeRemaining, setTimeRemaining] = useState(expiresIn);
  const [copied, setCopied] = useState(false);
  const [polling, setPolling] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollingError, setPollingError] = useState<string | null>(null);
  const [currentInterval, setCurrentInterval] = useState(interval);
  const [user, setUser] = useState<any>(null);
  const [browserOpening, setBrowserOpening] = useState(false);
  const [browserOpenCountdown, setBrowserOpenCountdown] = useState(3);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasAutocopied = useRef(false);

  // Auto-copy code on mount and open browser after delay
  useEffect(() => {
    if (open && !hasAutocopied.current) {
      hasAutocopied.current = true;
      
      // Auto-copy immediately
      copyToClipboard(true);
      
      // Show countdown
      setBrowserOpening(true);
      
      // Countdown timer
      let countdown = 3;
      const countdownTimer = setInterval(() => {
        countdown--;
        setBrowserOpenCountdown(countdown);
        if (countdown <= 0) {
          clearInterval(countdownTimer);
        }
      }, 1000);
      
      // Wait 3 seconds before opening browser so user can see the code
      setTimeout(() => {
        setBrowserOpening(false);
        window.electronAPI.openExternal(verificationUri);
      }, 3000);
    }
  }, [open, verificationUri]);

  // Countdown timer
  useEffect(() => {
    if (!open || success) return;

    countdownIntervalRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          stopPolling();
          setError('Code expired. Please try again.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, [open, success]);

  // Start polling
  useEffect(() => {
    if (!open || success || error) return;

    const startPolling = async () => {
      setPolling(true);
      setPollingError(null);

      const poll = async () => {
        try {
          const result = await window.electronAPI.githubPollDeviceAuth(deviceCode, currentInterval);

          if (result.success && result.token) {
            // Success!
            setSuccess(true);
            setUser(result.user);
            setPolling(false);
            stopPolling();

            toast({
              title: 'Success!',
              description: 'Connected to GitHub',
            });

            if (onSuccess) {
              onSuccess(result.user);
            }

            // Auto-close after showing success for 2 seconds
            setTimeout(() => {
              onClose();
            }, 2000);
          } else if (result.error) {
            const errorType = result.error;

            if (errorType === 'authorization_pending') {
              // Keep polling
              return;
            } else if (errorType === 'slow_down') {
              // Add 5 seconds to interval
              setCurrentInterval((prev) => prev + 5);
              return;
            } else if (errorType === 'expired_token') {
              // Code expired
              setError('Code expired. Please try again.');
              setPolling(false);
              stopPolling();
              if (onError) {
                onError('Code expired');
              }
            } else if (errorType === 'access_denied') {
              // User denied
              setError('Authorization cancelled');
              setPolling(false);
              stopPolling();
              if (onError) {
                onError('User denied');
              }
            } else {
              // Unknown error
              setPollingError(errorType);
            }
          }
        } catch (err) {
          console.error('Device Flow polling error:', err);
          setPollingError('Network error. Retrying...');
        }
      };

      // Initial poll
      await poll();

      // Set up interval polling
      pollingIntervalRef.current = setInterval(poll, currentInterval * 1000);
    };

    startPolling();

    return () => {
      stopPolling();
    };
  }, [open, deviceCode, currentInterval, success, error]);

  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  };

  const copyToClipboard = async (isAutomatic = false) => {
    try {
      // Try modern Clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(userCode);
      } else {
        // Fallback to execCommand
        const textArea = document.createElement('textarea');
        textArea.value = userCode;
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
      console.error('Failed to copy:', err);
      if (!isAutomatic) {
        toast({
          title: 'Copy failed',
          description: 'Please copy the code manually',
          variant: 'destructive',
        });
      }
    }
  };

  const openGitHub = () => {
    window.electronAPI.openExternal(verificationUri);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleClose = () => {
    stopPolling();
    onClose();
  };

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        e.preventDefault();
        copyToClipboard();
      } else if (e.key === 'Escape') {
        handleClose();
      } else if (e.key === 'Enter') {
        openGitHub();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault();
        openGitHub();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <Dialog.Root open={open} onOpenChange={handleClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-[50%] top-[50%] z-50 grid w-full max-w-[480px] translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg overflow-hidden p-0">
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground z-10"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </button>

        <div className="flex flex-col items-center px-8 py-12">
          {/* Logo */}
          <img src={emdashLogo} alt="emdash" className="h-8 mb-8 opacity-90" />

          {success ? (
            // Success State
            <div className="flex flex-col items-center space-y-6 animate-in fade-in zoom-in duration-300">
              <div className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center animate-in zoom-in duration-500">
                <Check className="h-8 w-8 text-white" strokeWidth={3} />
              </div>
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-semibold">Success!</h2>
                <p className="text-sm text-muted-foreground">You're connected to GitHub</p>
                {user && (
                  <div className="flex items-center justify-center gap-2 mt-4">
                    {user.avatar_url && (
                      <img
                        src={user.avatar_url}
                        alt={user.login}
                        className="w-8 h-8 rounded-full"
                      />
                    )}
                    <span className="text-sm font-medium">{user.login || user.name}</span>
                  </div>
                )}
              </div>
            </div>
          ) : error ? (
            // Error State
            <div className="flex flex-col items-center space-y-6 w-full">
              <div className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center">
                <AlertCircle className="h-8 w-8 text-white" />
              </div>
              <div className="text-center space-y-2">
                <h2 className="text-xl font-semibold text-red-500">Authorization Failed</h2>
                <p className="text-sm text-muted-foreground">{error}</p>
              </div>
              <Button onClick={handleClose} variant="outline" className="w-full">
                Close
              </Button>
            </div>
          ) : (
            // Waiting State
            <div className="flex flex-col items-center space-y-6 w-full">
              <div className="text-center space-y-2">
                <h2 className="text-xl font-semibold">Connect to GitHub</h2>
                <p className="text-xs text-muted-foreground">
                  Follow these steps to authorize emdash
                </p>
              </div>

              {/* Device Code */}
              <div className="w-full space-y-3">
                <div className="relative">
                  <div
                    className={`
                      bg-muted/50 rounded-lg px-6 py-4 border-2 border-muted
                      ${polling ? 'animate-pulse' : ''}
                    `}
                  >
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground mb-2">Your code</p>
                      <div className="text-3xl font-mono font-bold tracking-wider select-all">
                        {userCode}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Copy Button */}
                <Button
                  onClick={() => copyToClipboard()}
                  variant="outline"
                  className="w-full"
                  size="lg"
                >
                  {copied ? (
                    <>
                      <Check className="h-4 w-4 mr-2 text-green-500" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy Code
                    </>
                  )}
                </Button>
              </div>

              {/* Instructions */}
              <div className="w-full space-y-3 text-sm">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold">
                    1
                  </div>
                  <div className="flex-1">
                    <p className="text-muted-foreground">
                      Paste the code in GitHub{' '}
                      <span className="text-foreground font-medium">(already copied!)</span>
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold">
                    2
                  </div>
                  <div className="flex-1">
                    <p className="text-muted-foreground">Click Authorize</p>
                  </div>
                </div>
              </div>

              {/* Status */}
              <div className="w-full flex flex-col items-center gap-2">
                {browserOpening ? (
                  <div className="flex items-center gap-2 text-sm text-primary font-medium">
                    <span>Opening GitHub in {browserOpenCountdown}...</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner size="sm" />
                    <span>Waiting for authorization...</span>
                  </div>
                )}
                {pollingError && (
                  <p className="text-xs text-yellow-500">{pollingError}</p>
                )}
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Code expires in</span>
                  <span
                    className={`font-mono font-semibold ${timeRemaining < 300 ? 'text-yellow-500' : ''}`}
                  >
                    {formatTime(timeRemaining)}
                  </span>
                </div>
              </div>

              {/* Open GitHub Button */}
              <Button 
                onClick={openGitHub} 
                className="w-full" 
                size="lg"
                disabled={browserOpening}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                {browserOpening ? `Opening in ${browserOpenCountdown}...` : 'Open GitHub'}
              </Button>

              {/* Troubleshooting */}
              <div className="w-full pt-4 border-t border-border">
                <details className="group">
                  <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground flex items-center justify-center gap-1">
                    <span>Having trouble?</span>
                  </summary>
                  <div className="mt-3 space-y-2">
                    <Button
                      onClick={() => copyToClipboard()}
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start text-xs"
                    >
                      <Copy className="h-3 w-3 mr-2" />
                      Copy code again
                    </Button>
                    <Button
                      onClick={openGitHub}
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start text-xs"
                    >
                      <RefreshCw className="h-3 w-3 mr-2" />
                      Open GitHub again
                    </Button>
                  </div>
                </details>
              </div>

              {/* Keyboard Shortcuts Helper */}
              <div className="text-[10px] text-muted-foreground/50 text-center">
                ⌘C to copy • ⌘R to reopen • Esc to cancel
              </div>
            </div>
          )}
        </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

