import type { BaseModalProps } from '@renderer/core/modal-provider';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';

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
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant={variant} onClick={() => onSuccess()}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
