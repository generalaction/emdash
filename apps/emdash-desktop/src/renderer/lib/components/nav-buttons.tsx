import { ArrowLeft, ArrowRight } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { appState } from '@renderer/lib/stores/app-state';
import type { HistoryEntry } from '@renderer/lib/stores/navigation-history-store';
import { Button } from '@renderer/lib/ui/button';
import { BoundShortcut } from '@renderer/lib/ui/shortcut';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

export function applyHistoryEntry(entry: HistoryEntry): boolean {
  return appState.navigation.applyEntry(entry);
}

export const NavButtons = observer(function NavButtons() {
  const { canGoBack, canGoForward } = appState.history;
  return (
    <div className="flex items-center gap-0.5 [-webkit-app-region:no-drag]">
      <Tooltip>
        <TooltipTrigger>
          <Button
            variant="ghost"
            size="sm"
            className="size-7 p-0"
            disabled={!canGoBack}
            onClick={() => appState.history.back(applyHistoryEntry)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Go Back
          <BoundShortcut settingsKey="navigateBack" variant="keycaps" />
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger>
          <Button
            variant="ghost"
            size="sm"
            className="size-7 p-0"
            disabled={!canGoForward}
            onClick={() => appState.history.forward(applyHistoryEntry)}
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Go Forward
          <BoundShortcut settingsKey="navigateForward" variant="keycaps" />
        </TooltipContent>
      </Tooltip>
    </div>
  );
});
