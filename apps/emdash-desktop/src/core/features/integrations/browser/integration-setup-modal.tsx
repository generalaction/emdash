import { ExternalLink } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  useIntegrationsContext,
  type IntegrationMetadata,
} from '@core/features/integrations/api/browser/integrations-provider';
import { useModalController } from '@core/manifests/browser/modal-api';
import { defineModal } from '@core/primitives/modals/react';
import { Button } from '@core/primitives/ui/browser/button';
import { DialogHeader, DialogTitle } from '@core/primitives/ui/browser/dialog';
import { Input } from '@core/primitives/ui/browser/input';
import { SetupFormShell } from './SetupFormShell';
import type { SetupIntegrationType } from './types';

type IntegrationSetupModalArgs = {
  integration: SetupIntegrationType;
};

type Props = IntegrationSetupModalArgs;

export function IntegrationSetupModal({ integration }: Props) {
  const { complete, dismiss } = useModalController('integrationSetupModal');
  const { integrationById } = useIntegrationsContext();
  const metadata = integrationById[integration];

  return (
    <>
      <DialogHeader className="flex-col items-start gap-1" showCloseButton={false}>
        <DialogTitle>{metadata ? `Connect ${metadata.name}` : 'Connect integration'}</DialogTitle>
      </DialogHeader>
      {metadata ? (
        <IntegrationSetupForm
          integration={integration}
          metadata={metadata}
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

function formMethod(metadata: IntegrationMetadata | undefined) {
  return metadata?.auth.methods.find((method) => method.kind === 'form');
}

function IntegrationSetupForm({
  integration,
  metadata,
  onSuccess,
  onClose,
}: {
  integration: SetupIntegrationType;
  metadata: IntegrationMetadata;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const method = formMethod(metadata);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((method?.fields ?? []).map((field) => [field.id, field.defaultValue ?? '']))
  );

  const canSubmit = useMemo(
    () => !!method && method.fields.every((field) => !field.required || values[field.id]?.trim()),
    [method, values]
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
      canSubmit={canSubmit}
      onSuccess={onSuccess}
      onClose={onClose}
    >
      <div className="grid gap-3">
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
              autoFocus={index === 0}
            />
          </div>
        ))}
        {method.help || method.helpUrl ? (
          <div className="flex items-start justify-between gap-2">
            {method.help ? <p className="text-xs text-foreground-muted">{method.help}</p> : null}
            {method.helpUrl ? (
              <Button
                variant="link"
                size="icon-xs"
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
