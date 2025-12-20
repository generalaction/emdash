import React from 'react';
import CommandPalette from '../components/CommandPalette';
import { useSidebar } from '../components/ui/sidebar';
import { useRightSidebar } from '../components/ui/right-sidebar';
import { useTheme } from '../hooks/useTheme';
import type { Project, Workspace } from '../types/app';

export interface CommandPaletteWrapperProps {
  isOpen: boolean;
  onClose: () => void;
  projects: Project[];
  handleSelectProject: (project: Project) => void;
  handleSelectWorkspace: (workspace: Workspace) => void;
  handleGoHome: () => void;
  handleOpenProject: () => void;
  handleOpenSettings: () => void;
  handleOpenUsageDashboard: () => void;
}

const CommandPaletteWrapper: React.FC<CommandPaletteWrapperProps> = ({
  isOpen,
  onClose,
  projects,
  handleSelectProject,
  handleSelectWorkspace,
  handleGoHome,
  handleOpenProject,
  handleOpenSettings,
  handleOpenUsageDashboard,
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
      onSelectWorkspace={(projectId, workspaceId) => {
        const project = projects.find((p) => p.id === projectId);
        const workspace = project?.workspaces?.find((w: Workspace) => w.id === workspaceId);
        if (project && workspace) {
          handleSelectProject(project);
          handleSelectWorkspace(workspace);
        }
      }}
      onOpenSettings={handleOpenSettings}
      onOpenUsageDashboard={handleOpenUsageDashboard}
      onToggleLeftSidebar={toggleLeftSidebar}
      onToggleRightSidebar={toggleRightSidebar}
      onToggleTheme={toggleTheme}
      onGoHome={handleGoHome}
      onOpenProject={handleOpenProject}
    />
  );
};

export default CommandPaletteWrapper;
