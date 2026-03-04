import React from 'react';
import CommandPalette from './CommandPalette';
import { useSidebar } from './ui/sidebar';
import { useRightSidebar } from './ui/right-sidebar';
import { useTheme } from '../hooks/useTheme';
import type { Task } from '../types/app';
import { useProjectManagementContext } from '../contexts/ProjectManagementProvider';
import { useTaskManagementContext } from '../contexts/TaskManagementContext';
import { useWorkspaceNavigation } from '../contexts/WorkspaceNavigationContext';
import type { BaseModalProps } from '../contexts/ModalProvider';

type CommandPaletteModalProps = BaseModalProps<void>;

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({ onClose }) => {
  const { toggle: toggleLeftSidebar } = useSidebar();
  const { toggle: toggleRightSidebar } = useRightSidebar();
  const { toggleTheme } = useTheme();
  const { projects, handleOpenProject } = useProjectManagementContext();
  const { handleSelectTask } = useTaskManagementContext();
  const { navigate } = useWorkspaceNavigation();

  return (
    <CommandPalette
      isOpen={true}
      onClose={onClose}
      projects={projects as any}
      onSelectProject={(projectId) => {
        navigate('project', { projectId });
        onClose();
      }}
      onSelectTask={(projectId, taskId) => {
        const project = projects.find((p) => p.id === projectId);
        const task = project?.tasks?.find((w: Task) => w.id === taskId);
        if (project && task) {
          handleSelectTask(task);
        }
        onClose();
      }}
      onOpenSettings={() => {
        navigate('settings');
        onClose();
      }}
      onOpenKeyboardShortcuts={() => {
        navigate('settings', { tab: 'keyboard' });
        onClose();
      }}
      onToggleLeftSidebar={() => {
        toggleLeftSidebar();
        onClose();
      }}
      onToggleRightSidebar={() => {
        toggleRightSidebar();
        onClose();
      }}
      onToggleTheme={() => {
        toggleTheme();
        onClose();
      }}
      onGoHome={() => {
        navigate('home');
        onClose();
      }}
      onOpenProject={handleOpenProject}
    />
  );
};
