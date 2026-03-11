import React from 'react';
import type { BaseModalProps } from '../contexts/ModalProvider';
import { useProjectManagementContext } from '../contexts/ProjectManagementProvider';
import { useWorkspaceLayoutContext } from '../contexts/WorkspaceLayoutProvider';
import { useWorkspaceNavigation } from '../contexts/WorkspaceNavigationContext';
import { useTheme } from '../hooks/useTheme';
import CommandPalette from './CommandPalette';
import { useRightSidebar } from './ui/right-sidebar';

type CommandPaletteModalProps = BaseModalProps<void>;

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({ onClose }) => {
  const { toggleLeft: toggleLeftSidebar } = useWorkspaceLayoutContext();
  const { toggle: toggleRightSidebar } = useRightSidebar();
  const { toggleTheme } = useTheme();
  const { projects } = useProjectManagementContext();
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
        navigate('task', { projectId, taskId });
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
      onOpenProject={() => {}}
    />
  );
};
