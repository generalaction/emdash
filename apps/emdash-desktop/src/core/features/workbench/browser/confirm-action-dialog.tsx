import { Checkbox } from '@emdash/ui/react/primitives';
import { useState, type ReactNode } from 'react';
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
  /** Optional secondary choice surfaced with the confirmation. */
  checkbox?: { label: string; defaultChecked?: boolean };
};

export type ConfirmActionDialogResult = { checked: boolean } | undefined;

export function ConfirmActionDialog({
  title,
  description,
  confirmLabel = 'Confirm',
  variant = 'destructive',
  checkbox,
}: ConfirmActionDialogArgs) {
  const controller = useModalController('confirmActionModal');
  const [checked, setChecked] = useState(checkbox?.defaultChecked ?? false);

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="flex flex-col gap-3 pt-0">
        {typeof description === 'string' ? <p>{description}</p> : description}
        {checkbox && (
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={checked} onCheckedChange={(value) => setChecked(Boolean(value))} />
            {checkbox.label}
          </label>
        )}
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={controller.dismiss}>
          Cancel
        </Button>
        <ConfirmButton
          variant={variant}
          onClick={() => controller.complete(checkbox ? { checked } : undefined)}
        >
          {confirmLabel}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
}

export const confirmActionModal = defineModal<ConfirmActionDialogResult>()({
  id: 'confirmActionModal',
  component: ConfirmActionDialog,
  size: 'xs',
});
