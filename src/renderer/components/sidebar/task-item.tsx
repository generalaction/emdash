import { observer } from 'mobx-react-lite';
import { useRef } from 'react';
import { projectManagerStore } from '@renderer/core/stores/project-manager';
import { TaskStore } from '@renderer/core/stores/task';
import { useNavigate } from '@renderer/core/view/navigation-provider';
import { cn } from '@renderer/lib/utils';
import { SidebarMenuButton } from './sidebar-primitives';

interface SidebarTaskItemProps {
  task: TaskStore;
  projectId: string;
  isActive: boolean;
}

export const SidebarTaskItem = observer(function SidebarTaskItem({
  task,
  projectId,
  isActive,
}: SidebarTaskItemProps) {
  const { navigate } = useNavigate();

  const isBootstrapping =
    task.state === 'unregistered' ||
    (task.state === 'unprovisioned' &&
      (task.phase === 'provision' || task.phase === 'provision-error'));

  const taskId = task.data.id;
  const taskName = task.data.name;

  const handleProvision = () => {
    if (task.state !== 'unprovisioned' || task.phase !== 'idle') return;
    const projectStore = projectManagerStore.projects.get(projectId);
    if (projectStore?.state === 'mounted') {
      void projectStore.taskManager.provisionTask(taskId);
    }
  };

  const provisionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePointerEnter = () => {
    provisionTimer.current = setTimeout(handleProvision, 150);
  };
  const handlePointerLeave = () => {
    if (provisionTimer.current) clearTimeout(provisionTimer.current);
  };

  return (
    <SidebarMenuButton
      className="pl-9"
      onClick={() => {
        handleProvision();
        navigate('task', { projectId, taskId });
      }}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      isActive={isActive}
    >
      <span
        className={cn(
          'overflow-hidden whitespace-nowrap transition-colors',
          isBootstrapping && 'text-foreground/40'
        )}
      >
        {taskName}
      </span>
    </SidebarMenuButton>
  );
});
