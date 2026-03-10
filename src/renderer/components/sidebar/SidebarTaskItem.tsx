import { motion } from 'framer-motion';
import React from 'react';
import { TaskItem } from '@renderer/components/TaskItem';
import { useTaskManagementContext } from '@renderer/contexts/TaskManagementProvider';
import type { Project } from '@renderer/types/app';
import type { Task } from '@renderer/types/chat';
import { useSidebarContext } from './SidebarProvider';

interface SidebarTaskItemProps {
  task: Task;
  project: Project;
  isActive: boolean;
  taskHoverAction: 'delete' | 'archive';
}

export const SidebarTaskItem = React.memo<SidebarTaskItemProps>(
  ({ task, project, isActive, taskHoverAction }) => {
    const { pinnedTaskIds, handlePinTask } = useSidebarContext();
    const {
      handleSelectTask: onSelectTask,
      handleRenameTask: onRenameTask,
      handleArchiveTask: onArchiveTask,
      handleDeleteTask,
    } = useTaskManagementContext();

    return (
      <motion.div
        whileTap={{ scale: 0.97 }}
        onClick={() => onSelectTask?.(task)}
        className={`group/task min-w-0 rounded-md py-1.5 pl-1 pr-2 hover:bg-accent ${isActive ? 'bg-black/[0.06] dark:bg-white/[0.08]' : ''}`}
      >
        <TaskItem
          task={task}
          showDelete={true}
          showDirectBadge={false}
          isPinned={pinnedTaskIds.has(task.id)}
          onPin={() => handlePinTask(task)}
          onRename={(n) => onRenameTask?.(project, task, n)}
          onDelete={() => handleDeleteTask(project, task)}
          onArchive={() => onArchiveTask?.(project, task)}
          primaryAction={taskHoverAction}
        />
      </motion.div>
    );
  }
);
SidebarTaskItem.displayName = 'SidebarTaskItem';
