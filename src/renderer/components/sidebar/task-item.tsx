import React from 'react';
import { rpc } from '@renderer/core/ipc';
import { useNavigate } from '@renderer/core/view/navigation-provider';
import { TaskItem } from './project-item';
import { SidebarMenuButton } from './sidebar-primitives';

interface SidebarTaskItemProps {
  task: TaskItem;
  isActive: boolean;
}

export const SidebarTaskItem = React.memo<SidebarTaskItemProps>(({ task, isActive }) => {
  const { navigate } = useNavigate();

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
      <span className="overflow-hidden whitespace-nowrap">{task.data.name}</span>
    </SidebarMenuButton>
  );
});

SidebarTaskItem.displayName = 'SidebarTaskItem';
