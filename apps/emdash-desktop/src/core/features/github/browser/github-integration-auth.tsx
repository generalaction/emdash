import { useToast } from '@emdash/ui/react/primitives';
import { Github, KeyRound, Terminal } from 'lucide-react';
import { useState } from 'react';
import {
  useAccountLinkProvider,
  useAccountSession,
  useAccountSignIn,
} from '@core/features/account/api/browser/useAccount';
import {
  useGitHubDeviceFlowAuth,
  useImportGitHubCliAccounts,
} from '@core/features/github/api/browser/use-github-auth';
import type { IntegrationAuthUiProps } from '@core/features/integrations/api/browser/integration-auth-ui';
import {
  IntegrationAuthMethodPicker,
  type IntegrationAuthMethodOption,
} from '@core/features/integrations/contributions/browser/integration-auth-method-picker';
import { useOpenModal } from '@core/manifests/browser/modal-api';

type MethodError = {
  method: 'oauth' | 'cli' | 'device_flow';
  message: string;
} | null;

export function GitHubIntegrationAuth({ metadata, onSuccess, onClose }: IntegrationAuthUiProps) {
  const { toast } = useToast();
  const { data: session } = useAccountSession();
  const signInMutation = useAccountSignIn();
  const linkProviderMutation = useAccountLinkProvider();
  const deviceFlowMutation = useGitHubDeviceFlowAuth();
  const importCliAccountsMutation = useImportGitHubCliAccounts();
  const openDeviceFlow = useOpenModal('githubDeviceFlowModal');
  const [oauthLoading, setOauthLoading] = useState(false);
  const [cliLoading, setCliLoading] = useState(false);
  const [error, setError] = useState<MethodError>(null);

  const isSignedIn = session?.isSignedIn === true;
  const hasAccount = session?.hasAccount === true;
  const deviceFlowLoading = deviceFlowMutation.isPending;
  const oauthContent = getOAuthContent({ isSignedIn, hasAccount });
  const hasMethod = (kind: string) => metadata.auth.methods.some((method) => method.kind === kind);
  const showDeviceFlowMethod = !hasAccount && hasMethod('oauth-device');

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

      const providerAccount = 'providerAccount' in result ? result.providerAccount : undefined;
      const providerAccountStatus =
        'providerAccountStatus' in result ? result.providerAccountStatus : undefined;

      toast(
        providerAccountStatus === 'updated'
          ? 'GitHub account already connected'
          : 'Connected to GitHub',
        {
          description:
            providerAccountStatus === 'updated' && providerAccount
              ? `@${providerAccount.login} was already connected.`
              : providerAccount
                ? `Linked @${providerAccount.login}.`
                : 'GitHub is connected.',
        }
      );
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

      toast('GitHub CLI accounts imported', {
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
    // Completing this modal when the device flow succeeds resumes whatever the
    // connect flow interrupted (spec: github-git-settings §5): a modal that
    // launched connect from its identity strip stays open underneath the stack
    // and becomes topmost again. A dismissed device flow keeps this modal open
    // so the user can retry another method.
    const deviceFlowOutcome = openDeviceFlow({});
    void deviceFlowMutation.mutateAsync();
    void deviceFlowOutcome.then((outcome) => {
      if (outcome.success) onSuccess();
    });
  };

  const methods: IntegrationAuthMethodOption[] = [];
  if (hasMethod('oauth')) {
    methods.push({
      id: 'oauth',
      icon: Github,
      title: oauthContent.title,
      description: oauthContent.description,
      label: oauthContent.buttonLabel,
      loadingLabel: oauthContent.loadingLabel,
      loading: oauthLoading,
      onSelect: () => void connectOAuth(),
      error: error?.method === 'oauth' ? error.message : undefined,
    });
  }
  if (hasMethod('cli-import')) {
    methods.push({
      id: 'cli',
      icon: Terminal,
      title: 'Import from GitHub CLI',
      description: 'Use accounts already authenticated with GitHub CLI',
      loadingLabel: 'Checking GitHub CLI accounts',
      loading: cliLoading,
      onSelect: () => void refreshCliAuth(),
      error: error?.method === 'cli' ? error.message : undefined,
    });
  }
  if (showDeviceFlowMethod) {
    methods.push({
      id: 'device_flow',
      icon: KeyRound,
      title: 'Use device flow',
      description: 'Connect GitHub on this device with a one-time code',
      loadingLabel: 'Opening device flow',
      loading: deviceFlowLoading,
      onSelect: connectDeviceFlow,
      error: error?.method === 'device_flow' ? error.message : undefined,
    });
  }

  return <IntegrationAuthMethodPicker methods={methods} onClose={onClose} />;
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
