import { Search } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { getRegisteredTaskData } from '@renderer/features/tasks/stores/task-selectors';
import { useParams, useWorkspaceSlots } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';

export const SidebarSearchTrigger = observer(function SidebarSearchTrigger() {
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

  const currentWorkspaceId =
    currentProjectId && currentTaskId
      ? getRegisteredTaskData(currentProjectId, currentTaskId)?.workspaceId
      : undefined;

  return (
    <div>
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
        className="flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground-tertiary-muted transition-colors hover:bg-background-tertiary-1 hover:text-foreground-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Search className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" />
        <span className="flex-1 truncate text-left">Search…</span>
        <ShortcutHint settingsKey="commandPalette" />
      </button>
    </div>
  );
});
