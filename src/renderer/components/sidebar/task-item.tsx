import React from 'react';
import { rpc } from '@renderer/core/ipc';
import { useTaskBootstrapContext } from '@renderer/core/tasks/task-bootstrap-provider';
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
  const { entries } = useTaskBootstrapContext();

  const isBootstrapping =
    task.status === 'pending' || entries[task.data.id]?.status === 'bootstrapping';

  const handleProvision = () => {
    if (task.status === 'ready') {
      rpc.tasks.provisionTask(task.data.id).catch(console.error);
    }
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
