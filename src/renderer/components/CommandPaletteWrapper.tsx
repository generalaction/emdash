import React from 'react';
import CommandPalette from '../components/CommandPalette';
import { useSidebar } from '../components/ui/sidebar';
import { useRightSidebar } from '../components/ui/right-sidebar';
import { useTheme } from '../hooks/useTheme';
import type { Task } from '../types/app';
import { useProjectManagementContext } from '../contexts/ProjectManagementProvider';
import { useTaskManagementContext } from '../contexts/TaskManagementContext';

export interface CommandPaletteWrapperProps {
  isOpen: boolean;
  onClose: () => void;
  handleGoHome: () => void;
  handleOpenSettings: () => void;
  handleOpenKeyboardShortcuts: () => void;
}

const CommandPaletteWrapper: React.FC<CommandPaletteWrapperProps> = ({
  isOpen,
  onClose,
  handleGoHome,
  handleOpenSettings,
  handleOpenKeyboardShortcuts,
}) => {
  const { toggle: toggleLeftSidebar } = useSidebar();
  const { toggle: toggleRightSidebar } = useRightSidebar();
  const { toggleTheme } = useTheme();
  const { projects, handleSelectProject, handleOpenProject } = useProjectManagementContext();
  const { handleSelectTask, tasksByProjectId } = useTaskManagementContext();

  // Populate projects with their tasks from tasksByProjectId
  const projectsWithTasks = React.useMemo(
    () =>
      projects.map((project) => ({
        ...project,
        tasks: tasksByProjectId[project.id] ?? [],
      })),
    [projects, tasksByProjectId]
  );

  return (
    <CommandPalette
      isOpen={isOpen}
      onClose={onClose}
      projects={projectsWithTasks as any}
      onSelectProject={(projectId) => {
        const project = projects.find((p) => p.id === projectId);
        if (project) handleSelectProject(project);
      }}
      onSelectTask={(projectId, taskId) => {
        const tasks = tasksByProjectId[projectId] ?? [];
        const task = tasks.find((w: Task) => w.id === taskId);
        const project = projects.find((p) => p.id === projectId);
        if (project && task) {
          handleSelectProject(project);
          handleSelectTask(task);
        }
      }}
      onOpenSettings={handleOpenSettings}
      onOpenKeyboardShortcuts={handleOpenKeyboardShortcuts}
      onToggleLeftSidebar={toggleLeftSidebar}
      onToggleRightSidebar={toggleRightSidebar}
      onToggleTheme={toggleTheme}
      onGoHome={handleGoHome}
      onOpenProject={handleOpenProject}
    />
  );
};

export default CommandPaletteWrapper;
