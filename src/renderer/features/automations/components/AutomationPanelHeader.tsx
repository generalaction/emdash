import { X } from 'lucide-react';
import { MicroLabel } from '@renderer/lib/ui/label';

export function AutomationPanelHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex h-[40px] flex-row items-center justify-between border-b px-3.5">
      <MicroLabel>View automation</MicroLabel>

      <button
        type="button"
        onClick={onClose}
        aria-label="Close panel"
        className="text-muted-foreground hover:bg-muted rounded-md p-1 transition-colors hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
