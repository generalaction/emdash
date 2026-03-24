import React from 'react';
import { useTaskLifecycleContext } from '@renderer/core/tasks/task-lifecycle-provider';
import { useNavigate } from '@renderer/core/view/navigation-provider';
import { cn } from '@renderer/lib/utils';
import { TaskItem } from './project-item';
import { SidebarMenuButton } from './sidebar-primitives';

interface SidebarTaskItemProps {
  task: TaskItem;
  isActive: boolean;
}

export const SidebarTaskItem = React.memo<SidebarTaskItemProps>(({ task, isActive }) => {
  const { navigate } = useNavigate();
  const { taskStatus, provisionTask } = useTaskLifecycleContext();

  const status = taskStatus[task.data.id];
  const isBootstrapping =
    task.status === 'pending' || status === 'creating' || status === 'provisioning';

  const handleProvision = () => {
    provisionTask(task.data.id);
  };

  return (
    <SidebarMenuButton
      className="pl-9"
      onClick={() => {
        handleProvision();
        navigate('task', { projectId: task.data.projectId, taskId: task.data.id });
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
        {task.data.name}
      </span>
    </SidebarMenuButton>
  );
});

SidebarTaskItem.displayName = 'SidebarTaskItem';
