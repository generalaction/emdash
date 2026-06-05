import { AlertCircle, Github, KeyRound, Loader2, Terminal } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '@renderer/lib/hooks/use-toast';
import {
  useAccountLinkProvider,
  useAccountSession,
  useAccountSignIn,
} from '@renderer/lib/hooks/useAccount';
import { useImportGitHubCliAccounts } from '@renderer/lib/hooks/useGithubAccounts';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { useGithubContext } from '@renderer/lib/providers/github-context-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';

type MethodError = { method: 'oauth' | 'cli' | 'device_flow'; message: string } | null;

export function GithubConnectModal({ onSuccess, onClose }: BaseModalProps<void>) {
  const { toast } = useToast();
  const { data: session } = useAccountSession();
  const signInMutation = useAccountSignIn();
  const linkProviderMutation = useAccountLinkProvider();
  const importCliAccountsMutation = useImportGitHubCliAccounts();
  const showDeviceFlow = useShowModal('githubDeviceFlowModal');
  const { login } = useGithubContext();
  const [oauthLoading, setOauthLoading] = useState(false);
  const [cliLoading, setCliLoading] = useState(false);
  const [error, setError] = useState<MethodError>(null);

  const anyLoading = oauthLoading || cliLoading;
  const isSignedIn = session?.isSignedIn === true;

  const connectOAuth = async () => {
    setError(null);
    setOauthLoading(true);
    try {
      const result = isSignedIn
        ? await linkProviderMutation.mutateAsync('github')
        : await signInMutation.mutateAsync('github');

      if (!result.success) {
        setError({
          method: 'oauth',
          message: result.error ?? 'Connection failed. Please try again.',
        });
        return;
      }

      toast({
        title: 'Connected to GitHub',
        description:
          'providerAccount' in result && result.providerAccount
            ? `Linked @${result.providerAccount.login}.`
            : 'GitHub is connected.',
      });
      onSuccess();
    } finally {
      setOauthLoading(false);
    }
  };

  const refreshCliAuth = async () => {
    setError(null);
    setCliLoading(true);
    try {
      const result = await importCliAccountsMutation.mutateAsync();
      if (!result.success) {
        setError({
          method: 'cli',
          message: result.error,
        });
        return;
      }

      if (result.importedAccountIds.length === 0) {
        setError({
          method: 'cli',
          message: 'No GitHub CLI session found. Run gh auth login first.',
        });
        return;
      }

      toast({
        title: 'GitHub CLI accounts imported',
        description:
          result.importedAccountIds.length === 1
            ? '1 account is available in Emdash.'
            : `${result.importedAccountIds.length} accounts are available in Emdash.`,
      });
      onSuccess();
    } finally {
      setCliLoading(false);
    }
  };

  const connectDeviceFlow = () => {
    setError(null);
    showDeviceFlow({});
    void login();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Connect GitHub</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="gap-2">
        <div className="rounded-lg border border-border p-3">
          <div className="flex items-center gap-3">
            <Github className="text-muted-foreground h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-medium text-foreground">GitHub OAuth</h3>
              <p className="text-muted-foreground mt-0.5 text-xs">Sign in with your browser</p>
            </div>
            <Button onClick={() => void connectOAuth()} disabled={anyLoading}>
              {oauthLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Connecting…
                </>
              ) : (
                'Connect'
              )}
            </Button>
          </div>
          {error?.method === 'oauth' && <InlineError message={error.message} />}
        </div>

        <div className="rounded-lg border border-border p-3">
          <div className="flex items-center gap-3">
            <KeyRound className="text-muted-foreground h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-medium text-foreground">Device Flow</h3>
              <p className="text-muted-foreground mt-0.5 text-xs">Authorize with a one-time code</p>
            </div>
            <Button variant="outline" onClick={connectDeviceFlow} disabled={anyLoading}>
              Connect
            </Button>
          </div>
          {error?.method === 'device_flow' && <InlineError message={error.message} />}
        </div>

        <div className="rounded-lg border border-border p-3">
          <div className="flex items-center gap-3">
            <Terminal className="text-muted-foreground h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-medium text-foreground">GitHub CLI</h3>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Run{' '}
                <code className="rounded bg-background-1 px-1 py-0.5 font-mono text-[11px] text-foreground">
                  gh auth login
                </code>{' '}
                in your terminal
              </p>
            </div>
            <Button variant="outline" onClick={() => void refreshCliAuth()} disabled={anyLoading}>
              {cliLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking…
                </>
              ) : (
                'Refresh'
              )}
            </Button>
          </div>
          {error?.method === 'cli' && <InlineError message={error.message} />}
        </div>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={anyLoading}>
          Cancel
        </Button>
      </DialogFooter>
    </>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="bg-destructive/10 text-destructive mt-2 flex items-start gap-1.5 rounded-md px-2.5 py-2 text-xs">
      <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
