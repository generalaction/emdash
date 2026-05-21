import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
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
  description: string;
  detail?: string;
  confirmLabel?: string;
  variant?: 'destructive' | 'default';
};

type Props = BaseModalProps<void> & ConfirmActionDialogArgs;

export function ConfirmActionDialog({
  title,
  description,
  detail,
  confirmLabel = 'Confirm',
  variant = 'destructive',
  onSuccess,
  onClose,
}: Props) {
  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="flex flex-col gap-3 pt-0">
        <p className="wrap-anywhere">{description}</p>
        {detail ? (
          <code className="block max-h-32 overflow-auto rounded-md border border-border bg-background-1 px-2.5 py-2 font-mono text-xs wrap-anywhere text-foreground-passive">
            {detail}
          </code>
        ) : null}
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <ConfirmButton variant={variant} onClick={() => onSuccess()}>
          {confirmLabel}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
}
