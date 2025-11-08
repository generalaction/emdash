import React from 'react';
import CommandPalette from '../components/CommandPalette';
import { useSidebar } from '../components/ui/sidebar';
import { useRightSidebar } from '../components/ui/right-sidebar';
import { useTheme } from '../hooks/useTheme';

// Minimal shapes to satisfy structural typing and avoid coupling to App.tsx locals
export interface CPWorkspace {
  id: string;
}

export interface CPProject {
  id: string;
  workspaces?: CPWorkspace[];
}

export interface CommandPaletteWrapperProps {
  isOpen: boolean;
  onClose: () => void;
  projects: any[];
  handleSelectProject: (project: any) => void;
  handleSelectWorkspace: (workspace: any) => void;
  handleGoHome: () => void;
  handleOpenProject: () => void;
  handleOpenSettings: () => void;
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
        const workspace = project?.workspaces?.find((w: any) => w.id === workspaceId);
        if (project && workspace) {
          handleSelectProject(project);
          handleSelectWorkspace(workspace);
        }
      }}
      onOpenSettings={handleOpenSettings}
      onToggleLeftSidebar={toggleLeftSidebar}
      onToggleRightSidebar={toggleRightSidebar}
      onToggleTheme={toggleTheme}
      onGoHome={handleGoHome}
      onOpenProject={handleOpenProject}
    />
  );
};

export default CommandPaletteWrapper;
