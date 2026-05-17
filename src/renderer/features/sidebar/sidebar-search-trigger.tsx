import { Search } from 'lucide-react';
import { useObserver } from 'mobx-react-lite';
import { getRegisteredTaskData } from '@renderer/features/tasks/stores/task-selectors';
import { useParams, useWorkspaceSlots } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';

export function SidebarSearchTrigger() {
  const showCommandPalette = useShowModal('commandPaletteModal');
  const { currentView } = useWorkspaceSlots();
  const { params: taskParams } = useParams('task');
  const { params: projectParams } = useParams('project');

  const currentProjectId =
    currentView === 'task'
      ? taskParams.projectId
      : currentView === 'project'
        ? projectParams.projectId
        : undefined;
  const currentTaskId = currentView === 'task' ? taskParams.taskId : undefined;

  const currentWorkspaceId = useObserver(() => {
    if (!currentProjectId || !currentTaskId) return undefined;
    return getRegisteredTaskData(currentProjectId, currentTaskId)?.workspaceId ?? undefined;
  });

  return (
    <div className="px-3 pt-3 pb-2">
      <button
        type="button"
        onClick={() =>
          showCommandPalette({
            projectId: currentProjectId,
            taskId: currentTaskId,
            workspaceId: currentWorkspaceId,
          })
        }
        aria-label="Search"
        className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md pl-2 pr-1 text-sm text-foreground-passive transition-colors hover:bg-background-tertiary-2 hover:text-foreground-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
      >
        <Search className="size-3.5 shrink-0" />
        <span className="flex-1 truncate text-left">Search…</span>
        <ShortcutHint settingsKey="commandPalette" />
      </button>
    </div>
  );
}
