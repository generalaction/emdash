import { observer } from 'mobx-react-lite';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { MicroLabel } from '@renderer/lib/ui/label';
import { SidebarGroup, SidebarMenu } from './sidebar-primitives';
import { SidebarTaskItem } from './task-item';

export const SidebarPinnedTaskList = observer(function SidebarPinnedTaskList() {
  const entries = sidebarStore.pinnedSidebarEntries;
  if (entries.length === 0) return null;

  return (
    <SidebarGroup className="flex shrink-0 flex-col">
      <div className="flex h-[40px] items-center justify-between pr-2.5 pl-5">
        <MicroLabel className="text-foreground-passive">Pinned</MicroLabel>
      </div>
      <SidebarMenu className="px-3 pb-2">
        {entries.map(({ projectId, taskId }) => (
          <SidebarTaskItem
            key={`${projectId}:${taskId}`}
            projectId={projectId}
            taskId={taskId}
            rowVariant="pinned"
          />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
});
