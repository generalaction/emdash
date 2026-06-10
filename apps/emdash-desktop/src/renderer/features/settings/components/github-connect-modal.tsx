import {
  AlertCircle,
  ArrowRight,
  Github,
  KeyRound,
  Loader2,
  type LucideIcon,
  Terminal,
} from 'lucide-react';
import { useState } from 'react';
import { useToast } from '@renderer/lib/hooks/use-toast';
import {
  useAccountLinkProvider,
  useAccountSession,
  useAccountSignIn,
} from '@renderer/lib/hooks/useAccount';
import {
  useGitHubDeviceFlowAuth,
  useImportGitHubCliAccounts,
} from '@renderer/lib/hooks/useGithubAccounts';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { cn } from '@renderer/utils/utils';

type MethodError = {
  method: 'oauth' | 'cli' | 'device_flow';
  message: string;
} | null;

export function GithubConnectModal({ onSuccess, onClose }: BaseModalProps<void>) {
  const { toast } = useToast();
  const { data: session } = useAccountSession();
  const signInMutation = useAccountSignIn();
  const linkProviderMutation = useAccountLinkProvider();
  const deviceFlowMutation = useGitHubDeviceFlowAuth();
  const importCliAccountsMutation = useImportGitHubCliAccounts();
  const showDeviceFlow = useShowModal('githubDeviceFlowModal');
  const [oauthLoading, setOauthLoading] = useState(false);
  const [cliLoading, setCliLoading] = useState(false);
  const [error, setError] = useState<MethodError>(null);

  const isSignedIn = session?.isSignedIn === true;
  const hasAccount = session?.hasAccount === true;
  const deviceFlowLoading = deviceFlowMutation.isPending;
  const anyLoading = oauthLoading || cliLoading || deviceFlowLoading;
  const oauthContent = getOAuthContent({ isSignedIn, hasAccount });
  const showDeviceFlowMethod = !hasAccount;

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
    void deviceFlowMutation.mutateAsync();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Connect GitHub</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="gap-3">
        <ConnectMethodCard
          icon={Github}
          title={oauthContent.title}
          description={oauthContent.description}
          label={oauthContent.buttonLabel}
          loadingLabel={oauthContent.loadingLabel}
          loading={oauthLoading}
          disabled={anyLoading}
          onClick={() => void connectOAuth()}
          error={error?.method === 'oauth' ? error.message : undefined}
        />

        <ConnectMethodCard
          icon={Terminal}
          title="Import from GitHub CLI"
          description="Use accounts already authenticated with GitHub CLI"
          label="Import from GitHub CLI"
          loadingLabel="Checking GitHub CLI accounts"
          loading={cliLoading}
          disabled={anyLoading}
          onClick={() => void refreshCliAuth()}
          error={error?.method === 'cli' ? error.message : undefined}
        />

        {showDeviceFlowMethod && (
          <ConnectMethodCard
            icon={KeyRound}
            title="Use device flow"
            description="Connect GitHub on this device with a one-time code"
            label="Use device flow"
            loadingLabel="Opening device flow"
            loading={deviceFlowLoading}
            disabled={anyLoading}
            onClick={connectDeviceFlow}
            error={error?.method === 'device_flow' ? error.message : undefined}
          />
        )}
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={anyLoading}>
          Cancel
        </Button>
      </DialogFooter>
    </>
  );
}

function ConnectMethodCard({
  icon: Icon,
  title,
  description,
  label,
  loadingLabel,
  loading,
  disabled,
  onClick,
  error,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  label: string;
  loadingLabel: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
  error?: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={loading ? loadingLabel : label}
        className={cn(
          'group flex w-full items-center gap-3 p-3 text-left transition-colors',
          'hover:bg-background-2',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent'
        )}
      >
        <Icon className="text-muted-foreground h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
        </div>
        {loading ? (
          <Loader2 className="text-muted-foreground h-4 w-4 shrink-0 animate-spin" />
        ) : (
          <ArrowRight className="text-muted-foreground h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
        )}
      </button>
      {error && <InlineError message={error} className="mx-3 mb-3" />}
    </div>
  );
}

function getOAuthContent({ isSignedIn, hasAccount }: { isSignedIn: boolean; hasAccount: boolean }) {
  if (isSignedIn) {
    return {
      title: 'Link GitHub account',
      description: 'Add another GitHub account to your Emdash account',
      buttonLabel: 'Link',
      loadingLabel: 'Linking...',
    };
  }

  if (hasAccount) {
    return {
      title: 'Sign in with GitHub',
      description: 'Sign into your Emdash account',
      buttonLabel: 'Sign In',
      loadingLabel: 'Signing in...',
    };
  }

  return {
    title: 'Sign in to Emdash',
    description: 'Create or sign into your Emdash account with GitHub',
    buttonLabel: 'Continue',
    loadingLabel: 'Continuing...',
  };
}

function InlineError({ message, className }: { message: string; className?: string }) {
  return (
    <div
      className={cn(
        'bg-destructive/10 text-destructive flex items-start gap-1.5 rounded-md px-2.5 py-2 text-xs',
        className
      )}
    >
      <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
