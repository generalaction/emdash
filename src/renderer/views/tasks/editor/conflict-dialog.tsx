import { useEffect } from 'react';
import { Button } from '@renderer/components/ui/button';
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { useModalContext, type BaseModalProps } from '@renderer/core/modal/modal-provider';

export type ConflictDialogArgs = {
  filePath: string;
};

type Props = BaseModalProps<boolean> & ConflictDialogArgs;

export function ConflictDialog({ filePath, onSuccess, onClose }: Props) {
  const shortPath = filePath.split('/').slice(-2).join('/');
  const { setCloseGuard } = useModalContext();

  // Prevent accidental dismissal via outside-click or Escape.
  // The user must explicitly choose an action.
  useEffect(() => {
    setCloseGuard(true);
    return () => setCloseGuard(false);
  }, [setCloseGuard]);

  return (
    <DialogContent showCloseButton={false} className="sm:max-w-sm">
      <DialogHeader>
        <DialogTitle>File Modified Externally</DialogTitle>
        <DialogDescription>
          <code className="rounded bg-muted px-1 py-0.5 text-xs">{shortPath}</code> was changed
          outside the editor while you have unsaved edits. What would you like to do?
        </DialogDescription>
      </DialogHeader>
      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="outline" onClick={() => onSuccess(false)}>
          Keep Mine
        </Button>
        <Button onClick={() => onSuccess(true)}>Accept Incoming</Button>
      </DialogFooter>
    </DialogContent>
  );
}
