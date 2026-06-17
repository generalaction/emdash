import { Globe, Plus } from 'lucide-react';
import { useState } from 'react';
import { Dialog } from '@renderer/lib/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { ManualForwardDialog } from './manual-forward-dialog';

export function ManualForwardButton() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs text-foreground-muted transition-colors hover:bg-background-1 hover:text-foreground"
              aria-label="Forward remote port"
              onClick={() => setOpen(true)}
            />
          }
        >
          <Plus className="size-3.5" />
          <Globe className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent>Forward remote port</TooltipContent>
      </Tooltip>
      <ManualForwardDialog onClose={() => setOpen(false)} />
    </Dialog>
  );
}
