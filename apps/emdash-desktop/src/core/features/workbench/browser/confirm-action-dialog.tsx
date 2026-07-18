import type { ReactNode } from 'react';
import { defineModal } from '@core/primitives/modals/react';
import { useModalController } from '@renderer/lib/modal/api';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';

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
