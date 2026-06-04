import { ExternalLink, Globe } from 'lucide-react';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';

export type ExternalLinkChoice = 'emdash-browser' | 'external-browser';

export type ExternalLinkChoiceDialogArgs = {
  url: string;
  canOpenInEmdashBrowser: boolean;
};

type Props = BaseModalProps<ExternalLinkChoice> & ExternalLinkChoiceDialogArgs;

export function ExternalLinkChoiceDialog({
  url,
  canOpenInEmdashBrowser,
  onSuccess,
  onClose,
}: Props) {
  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>Open link?</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="space-y-4 pt-0 text-sm leading-relaxed">
        <p>Choose where to open this link.</p>
        <div className="bg-muted/50 max-h-32 overflow-y-auto rounded-md border border-border px-3 py-2.5 font-mono text-[13px] leading-relaxed break-all text-foreground">
          {url}
        </div>
      </DialogContentArea>
      <DialogFooter className="flex-col-reverse sm:flex-col-reverse">
        <Button className="w-full" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          className="w-full"
          variant="outline"
          disabled={!canOpenInEmdashBrowser}
          onClick={() => onSuccess('emdash-browser')}
        >
          <Globe className="size-4" />
          Open in Emdash
        </Button>
        <Button className="w-full" variant="default" onClick={() => onSuccess('external-browser')}>
          <ExternalLink className="size-4" />
          Open in Browser
        </Button>
      </DialogFooter>
    </>
  );
}
