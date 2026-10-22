import { useToast } from '@emdash/ui/react/primitives';
import { KeyRound, LogIn, RectangleEllipsis, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import {
  useAccountLinkProvider,
  useAccountSession,
  useAccountSignIn,
} from '@core/features/account/api/browser/useAccount';
import type { IntegrationAuthUiProps } from '@core/features/integrations/api/browser/integration-auth-ui';
import type { IntegrationProviderDescriptor } from '@core/features/integrations/api/contract';
import {
  IntegrationAuthMethodPicker,
  type IntegrationAuthMethodOption,
} from '@core/features/integrations/contributions/browser/integration-auth-method-picker';
import { DeviceSignIn } from '../../browser/device-sign-in';
import { IntegrationSetupForm } from '../../browser/integration-setup-modal';

type StandardIntegrationAuthProps = IntegrationAuthUiProps & {
  /** Icon of the "sign in through Emdash" option; defaults to a generic sign-in icon. */
  oauthIcon?: LucideIcon;
  /** Provider-specific options, listed after signing in through Emdash. */
  extraMethods?: IntegrationAuthMethodOption[];
};

/**
 * Offers the integration's declared methods: signing in through the Emdash auth
 * server (`oauth`), device sign-in (`oauth-device`), and its token form (`form`).
 */
export function StandardIntegrationAuth({
  metadata,
  accountId,
  displayName,
  onSuccess,
  onClose,
  oauthIcon = LogIn,
  extraMethods = [],
}: StandardIntegrationAuthProps) {
  const [view, setView] = useState<'choose' | 'form' | 'device'>('choose');
  /** Errors belong to the most recent attempt; trying another method hides them. */
  const [attemptedMethodId, setAttemptedMethodId] = useState<string>();
  const { data: session } = useAccountSession();
  const oauth = useEmdashOAuthMethod({ metadata, accountId, icon: oauthIcon, onSuccess });
  const hasMethod = (kind: string) => metadata.auth.methods.some((method) => method.kind === kind);

  if (view === 'device') {
    return (
      <DeviceSignIn
        integrationId={metadata.id}
        providerName={metadata.name}
        accountId={accountId}
        onSuccess={onSuccess}
        onBack={() => setView('choose')}
      />
    );
  }

  if (view === 'form') {
    return (
      <IntegrationSetupForm
        integration={metadata.id}
        metadata={metadata}
        accountId={accountId}
        displayName={displayName}
        onSuccess={onSuccess}
        onClose={onClose}
      />
    );
  }

  // With an Emdash account, signing in through Emdash replaces device sign-in;
  // reconnecting a device sign-in account still offers it.
  const showDeviceFlow =
    hasMethod('oauth-device') && (!oauth || session?.hasAccount !== true || !!accountId);
  const methods: IntegrationAuthMethodOption[] = [
    ...(oauth ? [oauth] : []),
    ...extraMethods,
    ...(showDeviceFlow
      ? [
          {
            id: 'device_flow',
            icon: RectangleEllipsis,
            title: 'Use device flow',
            description: `Connect ${metadata.name} on this device with a one-time code`,
            onSelect: () => setView('device'),
          },
        ]
      : []),
    ...(hasMethod('form')
      ? [
          {
            id: 'form',
            icon: KeyRound,
            title: 'Use an access token',
            description: 'Self-hosted instances, or a token you already have',
            onSelect: () => setView('form'),
          },
        ]
      : []),
  ];

  return (
    <IntegrationAuthMethodPicker
      methods={methods.map((method) => ({
        ...method,
        error: method.id === attemptedMethodId ? method.error : undefined,
        onSelect: () => {
          setAttemptedMethodId(method.id);
          method.onSelect();
        },
      }))}
      onClose={onClose}
    />
  );
}

/**
 * Signs in to Emdash with the provider, or links another provider account when
 * already signed in. The auth server issues the provider token; `null` when the
 * integration does not offer this method.
 */
function useEmdashOAuthMethod({
  metadata,
  accountId,
  icon,
  onSuccess,
}: {
  metadata: IntegrationProviderDescriptor;
  /** Reconnect this account; signing in as another identity fails. */
  accountId?: string;
  icon: LucideIcon;
  onSuccess: () => void;
}): IntegrationAuthMethodOption | null {
  const { toast } = useToast();
  const { data: session } = useAccountSession();
  const signIn = useAccountSignIn();
  const linkProvider = useAccountLinkProvider();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const method = metadata.auth.methods.find((candidate) => candidate.kind === 'oauth');
  if (method?.kind !== 'oauth') return null;
  const { name } = metadata;
  const isSignedIn = session?.isSignedIn === true;
  const content = oauthContent(name, { isSignedIn, hasAccount: session?.hasAccount === true });

  const connect = async () => {
    setError(undefined);
    setLoading(true);
    try {
      const input = { provider: method.providerId, ...(accountId ? { accountId } : {}) };
      const result = isSignedIn
        ? await linkProvider.mutateAsync(input)
        : await signIn.mutateAsync(input);
      if (!result.success) {
        setError(result.error ?? 'Connection failed. Please try again.');
        return;
      }

      const { providerAccount, providerAccountStatus } = result;
      const alreadyConnected = providerAccountStatus === 'updated';
      toast(alreadyConnected ? `${name} account already connected` : `Connected to ${name}`, {
        description:
          alreadyConnected && providerAccount
            ? `@${providerAccount.login} was already connected.`
            : providerAccount
              ? `Linked @${providerAccount.login}.`
              : `${name} is connected.`,
      });
      onSuccess();
    } finally {
      setLoading(false);
    }
  };

  return {
    id: 'oauth',
    icon,
    ...content,
    loading,
    onSelect: () => void connect(),
    error,
  };
}

function oauthContent(
  name: string,
  { isSignedIn, hasAccount }: { isSignedIn: boolean; hasAccount: boolean }
) {
  if (isSignedIn) {
    return {
      title: `Link ${name} account`,
      description: `Add another ${name} account to your Emdash account`,
      label: 'Link',
      loadingLabel: 'Linking...',
    };
  }

  if (hasAccount) {
    return {
      title: `Sign in with ${name}`,
      description: 'Sign into your Emdash account',
      label: 'Sign In',
      loadingLabel: 'Signing in...',
    };
  }

  return {
    title: 'Sign in to Emdash',
    description: `Create or sign into your Emdash account with ${name}`,
    label: 'Continue',
    loadingLabel: 'Continuing...',
  };
}
