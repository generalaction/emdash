import { Search } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { getRegisteredTaskData } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { BoundShortcut } from '@core/primitives/ui/browser/shortcut';
import { useViewParams, useWorkspaceSlots } from '@renderer/lib/layout/navigation-provider';
import { SidebarMenuButton } from './sidebar-primitives';

export const SidebarSearchTrigger = observer(function SidebarSearchTrigger() {
  const openCommandPalette = useOpenModal('commandPaletteModal');
  const { currentView } = useWorkspaceSlots();
  const taskParams = useViewParams(taskViewDef);
  const projectParams = useViewParams(projectViewDef);

  const currentProjectId =
    currentView === 'task'
      ? taskParams?.projectId
      : currentView === 'project'
        ? projectParams?.projectId
        : undefined;
  const currentTaskId = currentView === 'task' ? taskParams?.taskId : undefined;

  const currentWorkspaceId =
    currentProjectId && currentTaskId
      ? getRegisteredTaskData(currentProjectId, currentTaskId)?.workspaceId
      : undefined;

  return (
    <SidebarMenuButton
      isActive={false}
      onClick={() => {
        void openCommandPalette({
          projectId: currentProjectId,
          taskId: currentTaskId,
          workspaceId: currentWorkspaceId,
        });
      }}
      aria-label="Search"
      className="w-full justify-between"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Search className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" />
        <span className="truncate">Search…</span>
      </span>
      <BoundShortcut command="app.commandPalette" variant="keycaps" />
    </SidebarMenuButton>
  );
});
