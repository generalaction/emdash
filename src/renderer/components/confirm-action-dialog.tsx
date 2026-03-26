import type { BaseModalProps } from '@renderer/core/modal/modal-provider';
import { Button } from './ui/button';
import { ConfirmButton } from './ui/confirm-button';
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

export type ConfirmActionDialogArgs = {
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: 'destructive' | 'default';
};

type Props = BaseModalProps<void> & ConfirmActionDialogArgs;

export function ConfirmActionDialog({
  title,
  description,
  confirmLabel = 'Confirm',
  variant = 'destructive',
  onSuccess,
  onClose,
}: Props) {
  return (
    <DialogContent showCloseButton={false} className="sm:max-w-xs">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <ConfirmButton variant={variant} onClick={() => onSuccess()}>
          {confirmLabel}
        </ConfirmButton>
      </DialogFooter>
    </DialogContent>
  );
}
