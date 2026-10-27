import { MicroLabel } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { getSidebarStore } from '@core/features/workbench/contributions/browser/app-stores';
import { SidebarGroup, SidebarMenu } from './sidebar-primitives';
import { SidebarTaskItem } from './task-item';

export const SidebarPinnedTaskList = observer(function SidebarPinnedTaskList() {
  const entries = getSidebarStore().pinnedSidebarEntries;
  if (entries.length === 0) return null;

  return (
    <SidebarGroup className="flex shrink-0 flex-col">
      <div className="flex h-[40px] items-center justify-between pr-2.5 pl-5">
        <MicroLabel className="font-medium text-foreground-tertiary-passive">Pinned</MicroLabel>
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
