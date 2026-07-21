import { useModalController } from '@core/manifests/browser/modal-api';
import { defineModal } from '@core/primitives/modals/react';
import { Button } from '@core/primitives/ui/browser/button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@core/primitives/ui/browser/dialog';

export type QuitUnsavedChangesResult = 'save-all' | 'discard';

export interface QuitUnsavedChangesDialogArgs {
  count: number;
}

export function QuitUnsavedChangesDialog({ count }: QuitUnsavedChangesDialogArgs) {
  const controller = useModalController('quitUnsavedChangesModal');
  const label = count === 1 ? 'file has' : 'files have';

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>Save changes before quitting?</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <p>
          {count} {label} unsaved changes. Save them before quitting Emdash?
        </p>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={controller.dismiss}>
          Cancel
        </Button>
        <Button variant="outline" onClick={() => controller.complete('discard')}>
          Discard
        </Button>
        <Button onClick={() => controller.complete('save-all')}>Save All</Button>
      </DialogFooter>
    </>
  );
}

export const quitUnsavedChangesModal = defineModal<QuitUnsavedChangesResult>()({
  id: 'quitUnsavedChangesModal',
  component: QuitUnsavedChangesDialog,
  size: 'sm',
});
