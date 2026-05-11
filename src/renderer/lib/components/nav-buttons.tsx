import { ArrowLeft, ArrowRight } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { getTaskView } from '@renderer/features/tasks/stores/task-selectors';
import { appState } from '@renderer/lib/stores/app-state';
import type { HistoryEntry } from '@renderer/lib/stores/navigation-history-store';
import { Button } from '@renderer/lib/ui/button';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

export function applyHistoryEntry(entry: HistoryEntry): void {
  if (entry.kind === 'view') {
    appState.navigation._applyNavigation(entry.viewId, entry.params);
  } else {
    appState.navigation._applyNavigation('task', {
      projectId: entry.projectId,
      taskId: entry.taskId,
    });
    getTaskView(entry.projectId, entry.taskId)?.tabManager.setActiveTab(entry.tabId);
  }
}

export const NavButtons = observer(function NavButtons() {
  const { canGoBack, canGoForward } = appState.history;
  return (
    <div className="[-webkit-app-region:no-drag] flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger>
          <Button
            variant="ghost"
            size="sm"
            className="size-7 p-0"
            disabled={!canGoBack}
            onClick={() => appState.history.back(applyHistoryEntry)}
          >
            <ArrowLeft className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Go Back
          <ShortcutHint settingsKey="navigateBack" />
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
            <ArrowRight className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Go Forward
          <ShortcutHint settingsKey="navigateForward" />
        </TooltipContent>
      </Tooltip>
    </div>
  );
});
