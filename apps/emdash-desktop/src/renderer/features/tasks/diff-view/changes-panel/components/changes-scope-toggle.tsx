import { History } from 'lucide-react';
import { useState } from 'react';
import type { ChangesScope } from '@renderer/features/tasks/diff-view/stores/changes-view-store';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

interface ChangesScopeToggleProps {
  scope: ChangesScope;
  onChange: (scope: ChangesScope) => void;
}

/**
 * Toggles the "Changed" section between the whole-task diff and only the most recent
 * agent turn's changes (#1635).
 */
export function ChangesScopeToggle({ scope, onChange }: ChangesScopeToggleProps) {
  const isLastTurn = scope === 'last-turn';
  const tooltip = isLastTurn
    ? 'Showing the last turn. Show all task changes'
    : 'Show only the last turn';
  const [open, setOpen] = useState(false);

  return (
    <Tooltip
      open={open}
      onOpenChange={(nextOpen, details) => {
        // Keep the tooltip visible after a click so the user can read the updated label.
        if (!nextOpen && details.reason === 'trigger-press') return;
        setOpen(nextOpen);
      }}
    >
      <TooltipTrigger>
        <Button
          variant={isLastTurn ? 'secondary' : 'ghost'}
          size="icon-xs"
          onClick={() => onChange(isLastTurn ? 'session' : 'last-turn')}
          aria-label={tooltip}
          aria-pressed={isLastTurn}
        >
          <History className="size-3" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
