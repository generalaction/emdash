import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';

export type UnsavedChangesDialogResult = 'save' | 'discard';

export type UnsavedChangesDialogArgs = {
  fileName: string;
};

type Props = BaseModalProps<UnsavedChangesDialogResult> & UnsavedChangesDialogArgs;

export function UnsavedChangesDialog({ fileName, onSuccess }: Props) {
  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>Unsaved Changes</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <p>
          Do you want to save the changes to <strong>{fileName}</strong>?
        </p>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={() => onSuccess('discard')}>
          Discard
        </Button>
        <Button onClick={() => onSuccess('save')}>Save</Button>
      </DialogFooter>
    </>
  );
}
