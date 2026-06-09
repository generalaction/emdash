import { Loader2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import { DialogContentArea, DialogFooter } from '@renderer/lib/ui/dialog';
import { useIntegrationsContext } from './integrations-provider';
import type { ProviderInput, SetupIntegrationType } from './types';

export type SetupFormProps = {
  onSuccess: () => void;
  onClose: () => void;
};

type SetupFormShellProps<P extends SetupIntegrationType> = {
  providerId: P;
  getInput: () => ProviderInput[P];
  canSubmit: boolean;
  onSuccess: () => void;
  onClose: () => void;
  children: ReactNode;
};

export function SetupFormShell<P extends SetupIntegrationType>({
  providerId,
  getInput,
  canSubmit,
  onSuccess,
  onClose,
  children,
}: SetupFormShellProps<P>) {
  const { providers } = useIntegrationsContext();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const isMutating = providers[providerId].isMutating;

  const handleSubmit = async () => {
    setError(null);

    try {
      await providers[providerId].connect(getInput());
      toast({
        title: 'Integration connected',
        description: 'Integration set up successfully.',
      });
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect.');
    }
  };

  return (
    <>
      <DialogContentArea className="pt-1">
        {children}
        {error ? (
          <p className="text-destructive text-xs" role="alert">
            {error}
          </p>
        ) : null}
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <ConfirmButton onClick={() => void handleSubmit()} disabled={!canSubmit || isMutating}>
          {isMutating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Connect
        </ConfirmButton>
      </DialogFooter>
    </>
  );
}
