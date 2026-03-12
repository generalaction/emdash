import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { BaseModalProps } from '../contexts/ModalProvider';

export interface ConfirmModalProps extends BaseModalProps<boolean> {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

/**
 * A reusable confirmation modal that integrates with the app's ModalProvider.
 *
 * Usage via `showModal('confirmModal', { title, description, onSuccess })`.
 * Calls `onSuccess(true)` when the user confirms, `onClose()` when cancelled.
 */
export function ConfirmModal({
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onSuccess,
  onClose,
}: ConfirmModalProps) {
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg">{title}</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogDescription className="text-sm">{description}</AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => onSuccess(true)}
            className="bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
