import { Button } from '@renderer/components/ui/button';
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { type BaseModalProps } from '@renderer/core/modal/modal-provider';
import { useCloseGuard } from '@renderer/core/modal/use-close-guard';

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
