import { defineModal } from '@core/primitives/modals/react';
import { useModalController } from '@renderer/lib/modal/api';
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

export function UnsavedChangesDialog({ fileName }: UnsavedChangesDialogArgs) {
  const controller = useModalController('unsavedChangesModal');

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
        <Button variant="outline" onClick={() => controller.complete('discard')}>
          Discard
        </Button>
        <Button onClick={() => controller.complete('save')}>Save</Button>
      </DialogFooter>
    </>
  );
}

export const unsavedChangesModal = defineModal<UnsavedChangesDialogResult>()({
  id: 'unsavedChangesModal',
  component: UnsavedChangesDialog,
  size: 'xs',
});
