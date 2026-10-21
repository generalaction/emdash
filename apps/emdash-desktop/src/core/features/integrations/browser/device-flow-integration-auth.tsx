import { KeyRound, LogIn } from 'lucide-react';
import { useState } from 'react';
import type { IntegrationAuthUiProps } from '@core/features/integrations/api/browser/integration-auth-ui';
import { IntegrationAuthMethodPicker } from '@core/features/integrations/contributions/browser/integration-auth-method-picker';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { IntegrationSetupForm } from './integration-setup-modal';

/** Offers OAuth device sign-in, falling back to the integration's token form. */
export function DeviceFlowIntegrationAuth({
  metadata,
  accountId,
  displayName,
  onSuccess,
  onClose,
}: IntegrationAuthUiProps) {
  const openDeviceFlow = useOpenModal('integrationDeviceFlowModal');
  const [view, setView] = useState<'choose' | 'form'>('choose');
  const hasForm = metadata.auth.methods.some((method) => method.kind === 'form');

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

  const signIn = () => {
    void openDeviceFlow({
      integrationId: metadata.id,
      providerName: metadata.name,
      ...(accountId ? { accountId } : {}),
    }).then((outcome) => {
      if (outcome.success) onSuccess();
    });
  };

  return (
    <IntegrationAuthMethodPicker
      methods={[
        {
          id: 'device_flow',
          icon: LogIn,
          title: `Sign in with ${metadata.name}`,
          description: `Approve Emdash in ${metadata.name} with a one-time code`,
          onSelect: signIn,
        },
        ...(hasForm
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
      ]}
      onClose={onClose}
    />
  );
}
