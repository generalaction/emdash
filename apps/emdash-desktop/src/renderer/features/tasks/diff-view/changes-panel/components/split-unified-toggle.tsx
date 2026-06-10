import { Layers, Rows3 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import type { ChangesPanelMode } from '@shared/core/app-settings';

interface SplitUnifiedToggleProps {
  value: ChangesPanelMode;
  onChange: (mode: ChangesPanelMode) => void;
}

export function SplitUnifiedToggle({ value, onChange }: SplitUnifiedToggleProps) {
  const next: ChangesPanelMode = value === 'split' ? 'unified' : 'split';
  const Icon = value === 'split' ? Layers : Rows3;
  const tooltip = value === 'split' ? 'Switch to unified view' : 'Switch to split view';
  const [open, setOpen] = useState(false);

  return (
    <Tooltip
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && details.reason === 'trigger-press') return;
        setOpen(nextOpen);
      }}
    >
      <TooltipTrigger>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onChange(next)}
          aria-label={tooltip}
        >
          <Icon className="size-3" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
