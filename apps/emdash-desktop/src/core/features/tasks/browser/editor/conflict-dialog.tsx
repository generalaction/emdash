import { useEffect } from 'react';
import { defineModal } from '@core/primitives/modals/react';
import { useModalController } from '@renderer/lib/modal/api';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';

export type ConflictDialogArgs = {
  filePath: string;
};

export function ConflictDialog({ filePath }: ConflictDialogArgs) {
  const { complete, setCloseGuard } = useModalController('conflictDialog');
  const shortPath = filePath.split('/').slice(-2).join('/');

  useEffect(() => {
    setCloseGuard(true);
    return () => setCloseGuard(false);
  }, [setCloseGuard]);

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>File Modified Externally</DialogTitle>
        <DialogDescription>
          <code className="bg-muted rounded px-1 py-0.5 text-xs">{shortPath}</code> was changed
          outside the editor while you have unsaved edits. What would you like to do?
        </DialogDescription>
      </DialogHeader>
      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={() => complete(false)}>
          Keep Mine
        </Button>
        <Button onClick={() => complete(true)}>Accept Incoming</Button>
      </DialogFooter>
    </>
  );
}

export const conflictDialog = defineModal<boolean>()({
  id: 'conflictDialog',
  component: ConflictDialog,
  size: 'sm',
});
