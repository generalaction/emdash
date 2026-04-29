import type { ForkDetectedPayload } from '@shared/events/forkEvents';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';

export type ForkDetectionModalArgs = ForkDetectedPayload;

type Props = BaseModalProps<{ accepted: boolean }> & ForkDetectionModalArgs;

export function ForkDetectionModal({
  forkRemoteName,
  upstreamRemoteName,
  upstreamOwnerRepo,
  onSuccess,
}: Props) {
  return (
    <div className="flex flex-col overflow-hidden">
      <DialogHeader>
        <DialogTitle>Fork detected</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="space-y-3">
        <p className="text-sm">
          This repository appears to be a fork of{' '}
          <code className="font-mono text-xs">{upstreamOwnerRepo}</code>.
        </p>
        <p className="text-sm text-muted-foreground">
          Would you like to fetch from{' '}
          <code className="font-mono text-xs">{upstreamRemoteName}</code> and push to{' '}
          <code className="font-mono text-xs">{forkRemoteName}</code>?
        </p>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={() => onSuccess({ accepted: false })}>
          No, keep current settings
        </Button>
        <ConfirmButton size="sm" onClick={() => onSuccess({ accepted: true })}>
          Yes, configure
        </ConfirmButton>
      </DialogFooter>
    </div>
  );
}
