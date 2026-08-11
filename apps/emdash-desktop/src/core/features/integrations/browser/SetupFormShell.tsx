import { Button, Dialog, useToast } from '@emdash/ui/react/primitives';
import { Loader2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useIntegrationsContext } from '@core/features/integrations/contributions/browser/integrations-provider';
import { ConfirmButton } from '@core/primitives/keybindings/browser/confirm-button';
import type { IntegrationFormInput } from './types';

export type SetupFormProps = {
  onSuccess: () => void;
  onClose: () => void;
};

type SetupFormShellProps = {
  providerId: string;
  getInput: () => IntegrationFormInput;
  canSubmit: boolean;
  onSuccess: () => void;
  onClose: () => void;
  children: ReactNode;
};

export function SetupFormShell({
  providerId,
  getInput,
  canSubmit,
  onSuccess,
  onClose,
  children,
}: SetupFormShellProps) {
  const { connectIntegration, isIntegrationMutating } = useIntegrationsContext();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const isMutating = isIntegrationMutating(providerId);

  const handleSubmit = async () => {
    setError(null);

    try {
      const result = await connectIntegration(providerId, getInput());
      if (!result.success) {
        setError(result.error);
        return;
      }

      toast('Integration connected', { description: 'Integration set up successfully.' });
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect.');
    }
  };

  return (
    <>
      <Dialog.Body>
        <div className="pt-1">{children}</div>
        {error ? (
          <p className="text-xs text-foreground-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <ConfirmButton
          variant="primary"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit || isMutating}
        >
          {isMutating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Connect
        </ConfirmButton>
      </Dialog.Footer>
    </>
  );
}
