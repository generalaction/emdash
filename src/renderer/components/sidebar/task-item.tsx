import { observer } from 'mobx-react-lite';
import React from 'react';
import { MountedProjectStore } from '@renderer/core/stores/project';
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
    const projectStore = projectManagerStore.projects.get(projectId);
    if (projectStore?.state === 'mounted') {
      void (projectStore as MountedProjectStore).taskManager.provisionTask(taskId);
    }
  };

  return (
    <SidebarMenuButton
      className="pl-9"
      onClick={() => {
        handleProvision();
        navigate('task', { projectId, taskId });
      }}
      onPointerEnter={handleProvision}
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
