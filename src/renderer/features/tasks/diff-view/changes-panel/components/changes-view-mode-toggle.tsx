import { AlignJustify, ListTree } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import type { ChangesListViewMode } from '@shared/core/app-settings';

interface ChangesViewModeToggleProps {
  value: ChangesListViewMode;
  onChange: (mode: ChangesListViewMode) => void;
  label: string;
}

export function ChangesViewModeToggle({ value, onChange, label }: ChangesViewModeToggleProps) {
  const nextMode: ChangesListViewMode = value === 'flat' ? 'tree' : 'flat';
  const Icon = value === 'flat' ? AlignJustify : ListTree;
  const tooltip = value === 'flat' ? 'Switch to tree view' : 'Switch to flat list';
  const [open, setOpen] = useState(false);

  return (
    <Tooltip
      open={open}
      onOpenChange={(nextOpen, details) => {
        // Keep the tooltip visible after a click so the user can read the
        // updated label that reflects the new view mode.
        if (!nextOpen && details.reason === 'trigger-press') return;
        setOpen(nextOpen);
      }}
    >
      <TooltipTrigger>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onChange(nextMode)}
          aria-label={`${tooltip} (${label})`}
        >
          <Icon className="size-3" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
