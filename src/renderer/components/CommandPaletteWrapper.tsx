import React from 'react';
import CommandPalette from '../components/CommandPalette';
import { useSidebar } from '../components/ui/sidebar';
import { useRightSidebar } from '../components/ui/right-sidebar';
import { useTheme } from '../hooks/useTheme';
import type { Project, Task } from '../types/app';

export interface CommandPaletteWrapperProps {
  isOpen: boolean;
  onClose: () => void;
  projects: Project[];
  handleSelectProject: (project: Project) => void;
  handleSelectTask: (task: Task) => void;
  handleGoHome: () => void;
  handleOpenProject: () => void;
  handleOpenSettings: () => void;
  handleNextAgent: () => void;
  handlePrevAgent: () => void;
}

const CommandPaletteWrapper: React.FC<CommandPaletteWrapperProps> = ({
  isOpen,
  onClose,
  projects,
  handleSelectProject,
  handleSelectTask,
  handleGoHome,
  handleOpenProject,
  handleOpenSettings,
  handleNextAgent,
  handlePrevAgent,
}) => {
  const { toggle: toggleLeftSidebar } = useSidebar();
  const { toggle: toggleRightSidebar } = useRightSidebar();
  const { toggleTheme } = useTheme();

  return (
    <CommandPalette
      isOpen={isOpen}
      onClose={onClose}
      projects={projects as any}
      onSelectProject={(projectId) => {
        const project = projects.find((p) => p.id === projectId);
        if (project) handleSelectProject(project);
      }}
      onSelectTask={(projectId, taskId) => {
        const project = projects.find((p) => p.id === projectId);
        const task = project?.tasks?.find((w: Task) => w.id === taskId);
        if (project && task) {
          handleSelectProject(project);
          handleSelectTask(task);
        }
      }}
      onOpenSettings={handleOpenSettings}
      onToggleLeftSidebar={toggleLeftSidebar}
      onToggleRightSidebar={toggleRightSidebar}
      onToggleTheme={toggleTheme}
      onGoHome={handleGoHome}
      onOpenProject={handleOpenProject}
      onNextAgent={handleNextAgent}
      onPrevAgent={handlePrevAgent}
    />
  );
};

export default CommandPaletteWrapper;
