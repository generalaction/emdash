import { Check, Copy, ExternalLink, Globe } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';

export type ExternalLinkChoice = 'emdash-browser' | 'external-browser';

export type ExternalLinkChoiceDialogArgs = {
  url: string;
  canOpenInEmdashBrowser: boolean;
  onCopy: () => boolean | Promise<boolean>;
};

type Props = BaseModalProps<ExternalLinkChoice> & ExternalLinkChoiceDialogArgs;

export function ExternalLinkChoiceDialog({
  url,
  canOpenInEmdashBrowser,
  onCopy,
  onSuccess,
  onClose,
}: Props) {
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current);
    },
    []
  );

  const handleCopy = async () => {
    if (!(await onCopy())) return;
    setCopied(true);
    if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current);
    copyResetRef.current = window.setTimeout(() => {
      setCopied(false);
      copyResetRef.current = null;
    }, 1_500);
  };

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>Open link?</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="space-y-4 pt-0 text-sm leading-relaxed">
        <p>Choose where to open this link.</p>
        <div className="bg-muted/50 relative rounded-md border border-border">
          <div className="max-h-32 overflow-y-auto px-3 py-2.5 pr-10 font-mono text-[13px] leading-relaxed break-all text-foreground">
            {url}
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute top-1.5 right-1.5"
                    aria-label={copied ? 'Link copied' : 'Copy link'}
                    onClick={() => void handleCopy()}
                  />
                }
              >
                {copied ? (
                  <Check className="size-4 text-foreground-success" />
                ) : (
                  <Copy className="size-4" />
                )}
              </TooltipTrigger>
              <TooltipContent>{copied ? 'Copied' : 'Copy link'}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
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
