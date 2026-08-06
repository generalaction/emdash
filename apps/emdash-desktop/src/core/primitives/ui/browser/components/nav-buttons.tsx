import { Tooltip } from '@emdash/ui/react/primitives';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Button } from '@core/primitives/ui/browser/button';
import { BoundShortcut } from '@core/primitives/ui/browser/shortcut';
import { appState } from '@renderer/lib/stores/app-state';
import type { HistoryEntry } from '@renderer/lib/stores/navigation-history-store';

export function applyHistoryEntry(entry: HistoryEntry): boolean {
  return appState.navigation.applyEntry(entry);
}

export const NavButtons = observer(function NavButtons() {
  const { canGoBack, canGoForward } = appState.history;
  return (
    <div className="flex items-center gap-0.5 [-webkit-app-region:no-drag]">
      <Tooltip.Root>
        <Tooltip.Trigger>
          <Button
            variant="ghost"
            size="sm"
            className="size-7 p-0"
            disabled={!canGoBack}
            onClick={() => appState.history.back(applyHistoryEntry)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content>
          Go Back
          <BoundShortcut command="app.navigateBack" variant="keycaps" />
        </Tooltip.Content>
      </Tooltip.Root>
      <Tooltip.Root>
        <Tooltip.Trigger>
          <Button
            variant="ghost"
            size="sm"
            className="size-7 p-0"
            disabled={!canGoForward}
            onClick={() => appState.history.forward(applyHistoryEntry)}
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content>
          Go Forward
          <BoundShortcut command="app.navigateForward" variant="keycaps" />
        </Tooltip.Content>
      </Tooltip.Root>
    </div>
  );
});
