import type { ReactNode } from 'react';
import { useModalController } from '@core/manifests/browser/modal-api';
import { defineModal } from '@core/primitives/modals/react';
import { Button } from '@core/primitives/ui/browser/button';
import { ConfirmButton } from '@core/primitives/ui/browser/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@core/primitives/ui/browser/dialog';

export type ConfirmActionDialogArgs = {
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  variant?: 'destructive' | 'default';
};

export function ConfirmActionDialog({
  title,
  description,
  confirmLabel = 'Confirm',
  variant = 'destructive',
}: ConfirmActionDialogArgs) {
  const controller = useModalController('confirmActionModal');

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        {typeof description === 'string' ? <p>{description}</p> : description}
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={controller.dismiss}>
          Cancel
        </Button>
        <ConfirmButton variant={variant} onClick={() => controller.complete()}>
          {confirmLabel}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
}

export const confirmActionModal = defineModal<void>()({
  id: 'confirmActionModal',
  component: ConfirmActionDialog,
  size: 'xs',
});
