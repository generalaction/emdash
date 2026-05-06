import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { useCloseGuard } from '@renderer/lib/modal/use-close-guard';
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

type Props = BaseModalProps<boolean> & ConflictDialogArgs;

export function ConflictDialog({ filePath, onSuccess }: Props) {
  const shortPath = filePath.split('/').slice(-2).join('/');
  useCloseGuard(true);

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>File Modified Externally</DialogTitle>
        <DialogDescription>
          <code className="rounded bg-muted px-1 py-0.5 text-xs">{shortPath}</code> was changed
          outside the editor while you have unsaved edits. What would you like to do?
        </DialogDescription>
      </DialogHeader>
      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={() => onSuccess(false)}>
          Keep Mine
        </Button>
        <Button onClick={() => onSuccess(true)}>Accept Incoming</Button>
      </DialogFooter>
    </>
  );
}
