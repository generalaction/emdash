import { Button, Dialog, Input } from '@emdash/ui/react/primitives';
import { ExternalLink } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { IntegrationProviderDescriptor } from '@core/features/integrations/api/contract';
import { useIntegrationsContext } from '@core/features/integrations/contributions/browser/integrations-provider';
import {
  getIntegrationAuthUi,
  supportsIntegrationReconnect,
} from '@core/manifests/browser/integration-auth-contributions';
import { useModalController } from '@core/manifests/browser/modal-api';
import { defineModal } from '@core/primitives/modals/react';
import { SetupFormShell } from './SetupFormShell';
import type { SetupIntegrationType } from './types';

type IntegrationSetupModalArgs = {
  integration: SetupIntegrationType;
  accountId?: string;
  displayName?: string;
};

type Props = IntegrationSetupModalArgs;

export function IntegrationSetupModal({ integration, accountId, displayName }: Props) {
  const { complete, dismiss } = useModalController('integrationSetupModal');
  const { integrationById } = useIntegrationsContext();
  const metadata = integrationById[integration];
  const authUi = metadata ? getIntegrationAuthUi(metadata) : undefined;
  const AuthUi = authUi?.component;
  const reconnectSupported = !accountId || (metadata && supportsIntegrationReconnect(metadata));

  return (
    <>
      <Dialog.Header className="flex-col items-start gap-1" showCloseButton={false}>
        <Dialog.Title>
          {metadata
            ? `${accountId ? 'Reconnect' : 'Connect'} ${metadata.name}`
            : 'Connect integration'}
        </Dialog.Title>
      </Dialog.Header>
      {metadata && !reconnectSupported ? (
        <Dialog.Body>This connection method cannot reconnect a selected account.</Dialog.Body>
      ) : metadata && AuthUi && (!accountId || authUi?.supportsReconnect) ? (
        <AuthUi
          metadata={metadata}
          accountId={accountId}
          displayName={displayName}
          onSuccess={complete}
          onClose={dismiss}
        />
      ) : metadata ? (
        <IntegrationSetupForm
          integration={integration}
          metadata={metadata}
          accountId={accountId}
          displayName={displayName}
          onSuccess={complete}
          onClose={dismiss}
        />
      ) : null}
    </>
  );
}

export const integrationSetupModal = defineModal<void>()({
  id: 'integrationSetupModal',
  component: IntegrationSetupModal,
  size: 'md',
});

function formMethod(metadata: IntegrationProviderDescriptor | undefined) {
  return metadata?.auth.methods.find((method) => method.kind === 'form');
}

function IntegrationSetupForm({
  integration,
  metadata,
  accountId,
  displayName,
  onSuccess,
  onClose,
}: {
  integration: SetupIntegrationType;
  metadata: IntegrationProviderDescriptor;
  accountId?: string;
  displayName?: string;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const method = formMethod(metadata);
  const [accountName, setAccountName] = useState(displayName ?? '');
  const needsAccountName = metadata.auth.accountLabelRequired === true;
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((method?.fields ?? []).map((field) => [field.id, field.defaultValue ?? '']))
  );

  const canSubmit = useMemo(
    () =>
      !!method &&
      (!needsAccountName || !!accountName.trim()) &&
      method.fields.every((field) => !field.required || values[field.id]?.trim()),
    [method, values, needsAccountName, accountName]
  );

  if (!method) return null;

  const updateField = (id: string, value: string) => {
    setValues((current) => ({ ...current, [id]: value }));
  };

  return (
    <SetupFormShell
      providerId={integration}
      getInput={() =>
        Object.fromEntries(method.fields.map((field) => [field.id, values[field.id]?.trim() ?? '']))
      }
      getConnectionOptions={() => ({
        accountId,
        ...(needsAccountName ? { displayName: accountName.trim() } : {}),
      })}
      reconnect={accountId !== undefined}
      canSubmit={canSubmit}
      onSuccess={onSuccess}
      onClose={onClose}
    >
      <div className="grid gap-3">
        {needsAccountName ? (
          <div className="grid gap-1.5">
            <Input
              id="integration-account-name"
              aria-label="Account name"
              placeholder="Account name *"
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
              autoFocus
            />
            <p className="text-xs text-foreground-muted">
              A name to distinguish this account, such as your team or workspace.
            </p>
          </div>
        ) : null}
        {method.fields.map((field, index) => (
          <div key={field.id} className="grid gap-1.5">
            <Input
              id={`integration-field-${field.id}`}
              type={field.secret ? 'password' : 'text'}
              placeholder={`${field.placeholder ?? field.label}${field.required ? ' *' : ''}`}
              value={values[field.id] ?? ''}
              onChange={(event) => updateField(field.id, event.target.value)}
              className="h-9 w-full"
              autoComplete="off"
              autoFocus={!needsAccountName && index === 0}
            />
          </div>
        ))}
        {method.help || method.helpUrl ? (
          <div className="flex items-start justify-between gap-2">
            {method.help ? <p className="text-xs text-foreground-muted">{method.help}</p> : null}
            {method.helpUrl ? (
              <Button
                variant="link"
                size="xs"
                icon
                className="mt-0.5 size-4 shrink-0 p-0"
                aria-label={`Open ${metadata.name} setup guide`}
                onClick={() => window.open(method.helpUrl, '_blank', 'noopener,noreferrer')}
              >
                <ExternalLink className="h-3 w-3" />
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </SetupFormShell>
  );
}
