import React from 'react';
import { useNavigate } from '@renderer/core/view/navigation-provider';
import { TaskItem } from './project-item';
import { SidebarMenuButton } from './sidebar-primitives';

interface SidebarTaskItemProps {
  task: TaskItem;
  isActive: boolean;
}

export const SidebarTaskItem = React.memo<SidebarTaskItemProps>(({ task, isActive }) => {
  const { navigate } = useNavigate();

  return (
    <SidebarMenuButton
      className="pl-9"
      onClick={() => navigate('task', { projectId: task.data.projectId, taskId: task.data.id })}
      isActive={isActive}
    >
      {task.data.name}
    </SidebarMenuButton>
  );
});

SidebarTaskItem.displayName = 'SidebarTaskItem';
