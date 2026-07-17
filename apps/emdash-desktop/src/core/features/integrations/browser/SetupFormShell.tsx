import { Loader2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import { DialogContentArea, DialogFooter } from '@renderer/lib/ui/dialog';
import { useIntegrationsContext } from './integrations-provider';
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
          <p className="text-xs text-foreground-destructive" role="alert">
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
